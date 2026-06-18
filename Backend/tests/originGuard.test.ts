/**
 * originGuard.test.ts — Sprint D: CSRF/Origin Protection for Cookie Auth
 *
 * Tests the createOriginGuard() middleware and its application to the real
 * cookie-auth endpoints.
 *
 * ── Section 1: Middleware unit tests (minimal express app) ──────────────────
 *
 *   ✓ staging  — configured HTTPS origin is allowed
 *   ✓ production — configured HTTPS origin is allowed
 *   ✓ staging  — missing Origin AND Referer → 403 FORBIDDEN_ORIGIN
 *   ✓ production — missing Origin AND Referer → 403 FORBIDDEN_ORIGIN
 *   ✓ staging  — Origin not in allow-list → 403 FORBIDDEN_ORIGIN
 *   ✓ staging  — http:// origin (non-HTTPS) → 403 FORBIDDEN_ORIGIN
 *   ✓ staging  — Referer header used as fallback when Origin absent → allowed
 *   ✓ staging  — malformed Referer and no Origin → 403 FORBIDDEN_ORIGIN
 *   ✓ development — no Origin header → pass-through (200)
 *   ✓ test     — no Origin header → pass-through (200)
 *
 * ── Section 2: Real route integration tests ─────────────────────────────────
 *
 *   ✓ staging app — /auth/refresh returns 403 when Origin is missing
 *   ✓ staging app — /auth/logout returns 403 when Origin is missing
 *   ✓ staging app — /auth/login returns 403 when Origin is missing
 *   ✓ staging app — /auth/mfa/verify returns 403 when Origin is missing
 *   ✓ staging app — /auth/refresh succeeds with configured origin
 *   ✓ test app  — /auth/refresh passes through without Origin (existing behaviour)
 */

import express from "express";
import request from "supertest";

import { createOriginGuard } from "../src/middleware/originGuard.js";
import { createApp } from "../src/app.js";
import { createAppDependencies } from "../src/bootstrap/dependencies.js";
import { createLogger } from "../src/utils/logger.js";
import { loadConfig } from "../src/config/index.js";
import type { EnvConfig } from "../src/config/index.js";
import {
  TEST_JWT_ACCESS_SECRET,
  TEST_JWT_REFRESH_SECRET,
  TEST_MFA_ENCRYPTION_KEY,
} from "./helpers/testApp.js";

// ---------------------------------------------------------------------------
// Minimal express app factory for middleware unit tests
// ---------------------------------------------------------------------------

/**
 * Builds a minimal Express app with only the origin guard and a dummy POST
 * route.  Used to test the middleware logic in complete isolation.
 */
function makeGuardApp(nodeEnv: string, corsOrigin: string) {
  const app = express();
  app.use(express.json());

  const config = {
    NODE_ENV: nodeEnv,
    CORS_ORIGIN: corsOrigin,
  } as EnvConfig;

  app.post("/test", createOriginGuard(config), (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // Minimal error handler so AppErrors surface as structured JSON.
  app.use(
    (
      err: { statusCode?: number; code?: string; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction,
    ) => {
      res.status(err.statusCode ?? 500).json({
        error: { code: err.code ?? "INTERNAL_ERROR", message: err.message },
      });
    },
  );

  return app;
}

/** Extracts the structured error code from a 4xx response body. */
function errorCode(res: request.Response): string {
  return (res.body as { error: { code: string } }).error.code;
}

// ---------------------------------------------------------------------------
// Section 1: Middleware unit tests
// ---------------------------------------------------------------------------

const STAGING_ORIGIN = "https://staging.vervedental.com.au";
const PROD_ORIGIN = "https://app.vervedental.com.au";

describe("Origin guard — staging allows configured HTTPS origin", () => {
  it("passes through when Origin matches the allow-list", async () => {
    const app = makeGuardApp("staging", STAGING_ORIGIN);

    const res = await request(app)
      .post("/test")
      .set("Origin", STAGING_ORIGIN)
      .send();

    expect(res.status).toBe(200);
  });
});

describe("Origin guard — production allows configured HTTPS origin", () => {
  it("passes through when Origin matches the allow-list", async () => {
    const app = makeGuardApp("production", PROD_ORIGIN);

    const res = await request(app)
      .post("/test")
      .set("Origin", PROD_ORIGIN)
      .send();

    expect(res.status).toBe(200);
  });
});

describe("Origin guard — staging rejects missing Origin/Referer", () => {
  it("returns 403 FORBIDDEN_ORIGIN when no Origin or Referer is sent", async () => {
    const app = makeGuardApp("staging", STAGING_ORIGIN);

    const res = await request(app).post("/test").send();

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe("FORBIDDEN_ORIGIN");
  });

  it("error message mentions the required header", async () => {
    const app = makeGuardApp("staging", STAGING_ORIGIN);

    const res = await request(app).post("/test").send();

    expect(res.status).toBe(403);
    expect(
      (res.body as { error: { message: string } }).error.message,
    ).toMatch(/Origin/i);
  });
});

describe("Origin guard — production rejects missing Origin/Referer", () => {
  it("returns 403 FORBIDDEN_ORIGIN when no Origin or Referer is sent", async () => {
    const app = makeGuardApp("production", PROD_ORIGIN);

    const res = await request(app).post("/test").send();

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe("FORBIDDEN_ORIGIN");
  });
});

describe("Origin guard — staging rejects mismatched origin", () => {
  it("returns 403 when Origin is from a different domain", async () => {
    const app = makeGuardApp("staging", STAGING_ORIGIN);

    const res = await request(app)
      .post("/test")
      .set("Origin", "https://attacker.example.com")
      .send();

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe("FORBIDDEN_ORIGIN");
  });

  it("returns 403 when Origin is a subdomain of the allowed origin", async () => {
    const app = makeGuardApp("staging", STAGING_ORIGIN);

    const res = await request(app)
      .post("/test")
      .set("Origin", "https://evil.staging.vervedental.com.au")
      .send();

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe("FORBIDDEN_ORIGIN");
  });
});

describe("Origin guard — staging rejects non-HTTPS origin", () => {
  it("returns 403 when Origin uses http:// even if the host is configured", async () => {
    // CORS_ORIGIN is configured as HTTPS; http:// variant is never allowed.
    const app = makeGuardApp("staging", STAGING_ORIGIN);

    const res = await request(app)
      .post("/test")
      .set("Origin", "http://staging.vervedental.com.au")
      .send();

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe("FORBIDDEN_ORIGIN");
  });

  it("returns 403 when Origin is http://localhost (non-HTTPS)", async () => {
    const app = makeGuardApp("staging", STAGING_ORIGIN);

    const res = await request(app)
      .post("/test")
      .set("Origin", "http://localhost:3000")
      .send();

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe("FORBIDDEN_ORIGIN");
  });
});

describe("Origin guard — staging accepts Referer as fallback", () => {
  it("passes through when only Referer is sent and its origin matches", async () => {
    const app = makeGuardApp("staging", STAGING_ORIGIN);

    const res = await request(app)
      .post("/test")
      .set("Referer", `${STAGING_ORIGIN}/dashboard`)
      .send();

    expect(res.status).toBe(200);
  });

  it("returns 403 when Referer host is mismatched", async () => {
    const app = makeGuardApp("staging", STAGING_ORIGIN);

    const res = await request(app)
      .post("/test")
      .set("Referer", "https://attacker.example.com/page")
      .send();

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe("FORBIDDEN_ORIGIN");
  });

  it("returns 403 when Referer is malformed and Origin is absent", async () => {
    const app = makeGuardApp("staging", STAGING_ORIGIN);

    const res = await request(app)
      .post("/test")
      .set("Referer", "not-a-valid-url")
      .send();

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe("FORBIDDEN_ORIGIN");
  });
});

describe("Origin guard — development passes through without Origin", () => {
  it("allows requests with no Origin header in development", async () => {
    const app = makeGuardApp("development", "http://localhost:5173");

    const res = await request(app).post("/test").send();

    expect(res.status).toBe(200);
  });

  it("allows requests with any Origin in development", async () => {
    const app = makeGuardApp("development", "http://localhost:5173");

    const res = await request(app)
      .post("/test")
      .set("Origin", "http://localhost:5173")
      .send();

    expect(res.status).toBe(200);
  });
});

describe("Origin guard — test passes through without Origin", () => {
  it("allows requests with no Origin header in test", async () => {
    const app = makeGuardApp("test", "http://localhost:5173");

    const res = await request(app).post("/test").send();

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Section 2: Real route integration tests
// ---------------------------------------------------------------------------
//
// Build a staging-config Express app that uses in-memory deps (no DB/Redis)
// so we can verify the origin guard is wired to the actual auth routes.
// The trick: createAppDependencies() is called with test config, then we build
// the app with a staging config — same deps, different middleware config.

async function createStagingOriginTestApp(
  corsOrigin = STAGING_ORIGIN,
): Promise<express.Express> {
  process.env.NODE_ENV = "test";
  process.env.JWT_ACCESS_SECRET = TEST_JWT_ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = TEST_JWT_REFRESH_SECRET;
  process.env.CORS_ORIGIN = "http://localhost:5173";
  process.env.MFA_ENCRYPTION_KEY = TEST_MFA_ENCRYPTION_KEY;
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;

  const testConfig = loadConfig();
  const logger = createLogger({ LOG_LEVEL: "silent" });
  const deps = await createAppDependencies(testConfig, logger);

  // Construct a staging config: same secrets as test but with staging NODE_ENV
  // and the provided HTTPS CORS_ORIGIN.
  const stagingConfig: EnvConfig = {
    ...testConfig,
    NODE_ENV: "staging",
    CORS_ORIGIN: corsOrigin,
  };

  return createApp(stagingConfig, logger, deps);
}

describe("Origin guard — real auth routes protected in staging", () => {
  it("POST /auth/refresh returns 403 FORBIDDEN_ORIGIN when Origin is absent", async () => {
    const app = await createStagingOriginTestApp();

    const res = await request(app).post("/api/v1/auth/refresh").send();

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe("FORBIDDEN_ORIGIN");
  });

  it("POST /auth/logout returns 403 FORBIDDEN_ORIGIN when Origin is absent", async () => {
    const app = await createStagingOriginTestApp();

    const res = await request(app).post("/api/v1/auth/logout").send();

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe("FORBIDDEN_ORIGIN");
  });

  it("POST /auth/login returns 403 FORBIDDEN_ORIGIN when Origin is absent", async () => {
    const app = await createStagingOriginTestApp();

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@clinic-a.au", password: "password123" });

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe("FORBIDDEN_ORIGIN");
  });

  it("POST /auth/mfa/verify returns 403 FORBIDDEN_ORIGIN when Origin is absent", async () => {
    const app = await createStagingOriginTestApp();

    const res = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken: "dummy", code: "123456" });

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe("FORBIDDEN_ORIGIN");
  });

  it("POST /auth/mfa/setup returns 403 FORBIDDEN_ORIGIN when Origin is absent", async () => {
    const app = await createStagingOriginTestApp();

    const res = await request(app).post("/api/v1/auth/mfa/setup").send();

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe("FORBIDDEN_ORIGIN");
  });

  it("POST /auth/mfa/confirm returns 403 FORBIDDEN_ORIGIN when Origin is absent", async () => {
    const app = await createStagingOriginTestApp();

    const res = await request(app)
      .post("/api/v1/auth/mfa/confirm")
      .send({ code: "123456" });

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe("FORBIDDEN_ORIGIN");
  });

  it("POST /auth/refresh proceeds past origin guard with correct Origin header", async () => {
    const app = await createStagingOriginTestApp();

    // Guard passes — endpoint then returns 400 (missing refresh cookie), not 403
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", STAGING_ORIGIN)
      .send();

    // 403 would mean origin guard fired; 400 means it passed and the real handler ran
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(400);
  });
});

describe("Origin guard — test env auth routes unaffected (pass-through)", () => {
  it("POST /auth/refresh passes origin guard in test mode with no Origin header", async () => {
    // createTestApp() uses NODE_ENV=test, so originGuard is a no-op.
    // The endpoint returns 400 (missing cookie), NOT 403.
    process.env.NODE_ENV = "test";
    process.env.JWT_ACCESS_SECRET = TEST_JWT_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_JWT_REFRESH_SECRET;
    process.env.CORS_ORIGIN = "http://localhost:5173";
    process.env.MFA_ENCRYPTION_KEY = TEST_MFA_ENCRYPTION_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;

    const testConfig = loadConfig();
    const logger = createLogger({ LOG_LEVEL: "silent" });
    const deps = await createAppDependencies(testConfig, logger);
    const app = createApp(testConfig, logger, deps);

    const res = await request(app).post("/api/v1/auth/refresh").send();

    // Origin guard is a pass-through in test; real handler fires and returns 400
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe("MISSING_REFRESH_TOKEN");
  });
});
