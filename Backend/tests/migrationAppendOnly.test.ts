import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";

type MigrationFixture = { id: string; sql: string };

const checker = fileURLToPath(
  new URL("../scripts/checkMigrationAppendOnly.mjs", import.meta.url),
);

function source(
  migrations: MigrationFixture[],
  reviewedHash: string,
): string {
  const entries = migrations
    .map(
      ({ id, sql }) => `{
    id: ${JSON.stringify(id)},
    sql: \`${sql}\`,
  }`,
    )
    .join(",\n");
  return `export const BOOTSTRAP_MIGRATIONS = [
${entries}
];
const reviewedSqlHashes = { first: ${JSON.stringify(reviewedHash)} };
`;
}

function runChecker(
  baseMigrations: MigrationFixture[],
  candidateMigrations: MigrationFixture[],
  options: { baseHash?: string; candidateHash?: string } = {},
): ReturnType<typeof spawnSync> {
  const directory = mkdtempSync(join(tmpdir(), "renqor-migration-history-"));
  const baseFile = join(directory, "base.ts");
  const candidateFile = join(directory, "candidate.ts");
  writeFileSync(
    baseFile,
    source(baseMigrations, options.baseHash ?? "base-reviewed-hash"),
  );
  writeFileSync(
    candidateFile,
    source(
      candidateMigrations,
      options.candidateHash ?? options.baseHash ?? "base-reviewed-hash",
    ),
  );

  try {
    return spawnSync(
      process.execPath,
      [
        checker,
        "--base-file",
        baseFile,
        "--candidate-file",
        candidateFile,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10_000,
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const first = { id: "001_first", sql: "\nSELECT 1;\n" };
const second = { id: "002_second", sql: "\nSELECT 2;\n" };

describe("PR embedded-migration append-only checker", () => {
  it("permits migrations appended after the complete base sequence", () => {
    const result = runChecker(
      [first],
      [first, second],
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/1 preserved, 1 appended/);
    expect(result.stderr).toBe("");
  });

  it("rejects removal of an existing embedded migration", () => {
    const result = runChecker([first, second], [first]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/removed/i);
  });

  it("rejects reordering of existing embedded migrations", () => {
    const result = runChecker([first, second], [second, first]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/reordered/i);
  });

  it("rejects edited SQL even when the candidate stored hash is edited too", () => {
    const result = runChecker(
      [first],
      [{ ...first, sql: "\nSELECT 999;\n" }],
      {
        baseHash: "old-sql-hash",
        candidateHash: "matching-new-sql-hash",
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /existing embedded migration SQL modified: 001_first/i,
    );
  });
});
