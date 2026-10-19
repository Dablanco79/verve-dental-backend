import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const MIGRATION_SOURCE_PATH = "Backend/src/db/migrate.ts";
const REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);

export function extractEmbeddedMigrations(source, sourceName) {
  // `git show` emits LF while a Windows worktree may contain CRLF. Line-ending
  // conversion is not a migration-body change and must not fail the PR gate.
  const normalizedSource = source.replace(/\r\n?/g, "\n");
  const sourceFile = ts.createSourceFile(
    sourceName,
    normalizedSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let initializer;

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "BOOTSTRAP_MIGRATIONS"
    ) {
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
    throw new Error(
      `${sourceName}: BOOTSTRAP_MIGRATIONS array literal was not found`,
    );
  }

  return initializer.elements.map((element, index) => {
    if (!ts.isObjectLiteralExpression(element)) {
      throw new Error(
        `${sourceName}: migration at index ${String(index)} is not an object literal`,
      );
    }
    const idProperty = element.properties.find(
      (property) =>
        ts.isPropertyAssignment(property) &&
        property.name.getText(sourceFile) === "id",
    );
    const sqlProperty = element.properties.find(
      (property) =>
        ts.isPropertyAssignment(property) &&
        property.name.getText(sourceFile) === "sql",
    );
    if (
      !idProperty ||
      !ts.isPropertyAssignment(idProperty) ||
      !ts.isStringLiteral(idProperty.initializer)
    ) {
      throw new Error(
        `${sourceName}: migration at index ${String(index)} has no literal id`,
      );
    }
    if (
      !sqlProperty ||
      !ts.isPropertyAssignment(sqlProperty) ||
      !ts.isNoSubstitutionTemplateLiteral(sqlProperty.initializer)
    ) {
      throw new Error(
        `${sourceName}: migration ${idProperty.initializer.text} has no static SQL template`,
      );
    }
    return {
      id: idProperty.initializer.text,
      sql: sqlProperty.initializer.rawText ?? sqlProperty.initializer.text,
    };
  });
}

export function compareAppendOnlyMigrations(baseMigrations, candidateMigrations) {
  const baseIds = baseMigrations.map(({ id }) => id);
  const candidateIds = candidateMigrations.map(({ id }) => id);
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error("Candidate contains duplicate embedded migration IDs");
  }
  if (candidateMigrations.length < baseMigrations.length) {
    throw new Error(
      `Candidate removed ${String(
        baseMigrations.length - candidateMigrations.length,
      )} existing embedded migration(s)`,
    );
  }

  for (let index = 0; index < baseMigrations.length; index += 1) {
    const base = baseMigrations[index];
    const candidate = candidateMigrations[index];
    if (candidate.id !== base.id) {
      const candidatePosition = candidateIds.indexOf(base.id);
      if (candidatePosition === -1) {
        throw new Error(`Existing embedded migration removed: ${base.id}`);
      }
      throw new Error(
        `Existing embedded migration reordered: ${base.id} moved from index ${String(
          index,
        )} to ${String(candidatePosition)}`,
      );
    }
    if (candidate.sql !== base.sql) {
      throw new Error(`Existing embedded migration SQL modified: ${base.id}`);
    }
  }

  return {
    preserved: baseIds.length,
    appended: candidateMigrations.length - baseMigrations.length,
  };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function readInputs() {
  const baseFile = argumentValue("--base-file");
  const candidateFile = argumentValue("--candidate-file");
  const baseRef = argumentValue("--base-ref");

  const candidateSource = readFileSync(
    candidateFile
      ? resolve(candidateFile)
      : resolve(REPOSITORY_ROOT, MIGRATION_SOURCE_PATH),
    "utf8",
  );
  if (baseFile) {
    return {
      baseName: baseFile,
      baseSource: readFileSync(resolve(baseFile), "utf8"),
      candidateName: candidateFile ?? MIGRATION_SOURCE_PATH,
      candidateSource,
    };
  }
  if (!baseRef) {
    throw new Error("Provide --base-ref or --base-file");
  }

  return {
    baseName: `${baseRef}:${MIGRATION_SOURCE_PATH}`,
    baseSource: execFileSync(
      "git",
      ["show", `${baseRef}:${MIGRATION_SOURCE_PATH}`],
      {
        cwd: REPOSITORY_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
    candidateName: candidateFile ?? MIGRATION_SOURCE_PATH,
    candidateSource,
  };
}

export function main() {
  const input = readInputs();
  const result = compareAppendOnlyMigrations(
    extractEmbeddedMigrations(input.baseSource, input.baseName),
    extractEmbeddedMigrations(input.candidateSource, input.candidateName),
  );
  process.stdout.write(
    `Embedded migration history is append-only: ${String(
      result.preserved,
    )} preserved, ${String(result.appended)} appended.\n`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Migration immutability check failed: ${message}\n`);
    process.exitCode = 1;
  }
}
