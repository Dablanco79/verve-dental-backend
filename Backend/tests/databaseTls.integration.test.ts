/**
 * End-to-end certificate verification through createDatabasePool().
 *
 * CI supplies a disposable TLS-enabled PostgreSQL container and a synthetic CA.
 * Each assertion starts a fresh Node process because NODE_EXTRA_CA_CERTS is read
 * only during process startup.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";

const TLS_DATABASE_URL = process.env["TLS_DATABASE_URL"];
const TLS_CA_CERT_PATH = process.env["TLS_CA_CERT_PATH"];
const describeWithTlsDatabase =
  TLS_DATABASE_URL && TLS_CA_CERT_PATH ? describe : describe.skip;

const requireFromBackendTest = createRequire(import.meta.url);
const tsxCli = requireFromBackendTest.resolve("tsx/cli");
const probe = fileURLToPath(
  new URL("./helpers/databaseTlsProbe.ts", import.meta.url),
);
const backendWorkingDirectory = fileURLToPath(
  new URL("../", import.meta.url),
);

function runProbe(
  databaseUrl: string,
  trustedCaPath?: string,
  disableNodeDefaultVerification = false,
): ReturnType<typeof spawnSync> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    NODE_ENV: "production",
    DATABASE_SSL: "auto",
  };
  delete env["NODE_EXTRA_CA_CERTS"];
  if (trustedCaPath) {
    env["NODE_EXTRA_CA_CERTS"] = trustedCaPath;
  }
  if (disableNodeDefaultVerification) {
    // Regression sentinel: explicit pool TLS must remain authoritative even if
    // the process-wide Node default is made unsafe. Before URL sanitisation,
    // node-postgres replaced the explicit object and this connection succeeded.
    env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
  } else {
    delete env["NODE_TLS_REJECT_UNAUTHORIZED"];
  }

  return spawnSync(process.execPath, [tsxCli, probe], {
    cwd: backendWorkingDirectory,
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
}

describe("PostgreSQL TLS probe subprocess launcher", () => {
  it("resolves the declared tsx dependency and launches from the Backend workspace", () => {
    expect(isAbsolute(tsxCli)).toBe(true);
    expect(existsSync(tsxCli)).toBe(true);
    expect(isAbsolute(probe)).toBe(true);
    expect(existsSync(probe)).toBe(true);
    expect(existsSync(join(backendWorkingDirectory, "package.json"))).toBe(true);

    const env = { ...process.env };
    delete env["DATABASE_URL"];
    const result = spawnSync(process.execPath, [tsxCli, probe], {
      cwd: backendWorkingDirectory,
      env,
      encoding: "utf8",
      timeout: 20_000,
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("TLS_PROBE_CONFIG_MISSING\n");
  });
});

describeWithTlsDatabase("PostgreSQL TLS certificate verification", () => {
  it("connects when the certificate is trusted and matches the hostname", () => {
    if (!TLS_DATABASE_URL || !TLS_CA_CERT_PATH) {
      throw new Error("TLS integration environment is incomplete");
    }
    const result = runProbe(TLS_DATABASE_URL, TLS_CA_CERT_PATH);
    expect({
      status: result.status,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
    }).toEqual({
      status: 0,
      signal: null,
      stdout: "TLS_PROBE_OK\n",
      stderr: "",
    });
  });

  it("rejects the same server certificate when its CA is not trusted", () => {
    if (!TLS_DATABASE_URL) {
      throw new Error("TLS integration environment is incomplete");
    }
    const result = runProbe(TLS_DATABASE_URL, undefined, true);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(
      /SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_GET_ISSUER_CERT/i,
    );
  });

  it("rejects a trusted certificate when the connection hostname is wrong", () => {
    if (!TLS_DATABASE_URL || !TLS_CA_CERT_PATH) {
      throw new Error("TLS integration environment is incomplete");
    }
    const wrongHostnameUrl = new URL(TLS_DATABASE_URL);
    wrongHostnameUrl.hostname = "127.0.0.1";

    const result = runProbe(wrongHostnameUrl.toString(), TLS_CA_CERT_PATH);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/ERR_TLS_CERT_ALTNAME_INVALID/i);
  });
});
