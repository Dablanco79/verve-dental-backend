import request from "supertest";
import { jest } from "@jest/globals";

import { extractRefreshCookie, loginAndGetTokens } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

type ApiError = { error: { code: string } };

describe("session inactivity and absolute expiry", () => {
  const baseTime = Date.UTC(2026, 0, 1, 0, 0, 0);
  let nowSpy: jest.SpiedFunction<typeof Date.now>;

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, "now").mockReturnValue(baseTime);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it("allows refresh after 59 minutes of inactivity", async () => {
    const app = await createTestApp();
    const session = await loginAndGetTokens(app, "staff@clinic-a.au");

    nowSpy.mockReturnValue(baseTime + 59 * 60 * 1000);
    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", session.refreshCookie)
      .send();

    expect(response.status).toBe(200);
  });

  it("requires login after more than 60 minutes of inactivity", async () => {
    const app = await createTestApp();
    const session = await loginAndGetTokens(app, "staff@clinic-a.au");

    nowSpy.mockReturnValue(baseTime + 60 * 60 * 1000 + 1_000);
    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", session.refreshCookie)
      .send();

    expect(response.status).toBe(401);
    expect((response.body as ApiError).error.code).toBe("SESSION_IDLE_EXPIRED");
  });

  it("does not count refresh-token rotation as user activity", async () => {
    const app = await createTestApp();
    const session = await loginAndGetTokens(app, "staff@clinic-a.au");

    nowSpy.mockReturnValue(baseTime + 30 * 60 * 1000);
    const firstRefresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", session.refreshCookie)
      .send();
    expect(firstRefresh.status).toBe(200);

    const rotatedCookie = extractRefreshCookie(firstRefresh);
    nowSpy.mockReturnValue(baseTime + 60 * 60 * 1000 + 1_000);
    const secondRefresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", rotatedCookie)
      .send();

    expect(secondRefresh.status).toBe(401);
    expect((secondRefresh.body as ApiError).error.code).toBe("SESSION_IDLE_EXPIRED");
  });

  it("extends the idle deadline only through the user-activity endpoint", async () => {
    const app = await createTestApp();
    const session = await loginAndGetTokens(app, "staff@clinic-a.au");

    nowSpy.mockReturnValue(baseTime + 59 * 60 * 1000);
    const activity = await request(app)
      .post("/api/v1/auth/activity")
      .set("Cookie", session.refreshCookie)
      .send();
    expect(activity.status).toBe(204);
    const activityCookie = extractRefreshCookie(activity);

    nowSpy.mockReturnValue(baseTime + 118 * 60 * 1000);
    const refresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", activityCookie)
      .send();
    expect(refresh.status).toBe(200);
  });

  it("rejects refresh exactly at the 12-hour absolute boundary", async () => {
    const app = await createTestApp({ sessionIdleTimeoutSeconds: 13 * 60 * 60 });
    const session = await loginAndGetTokens(app, "staff@clinic-a.au");

    nowSpy.mockReturnValue(baseTime + 12 * 60 * 60 * 1000);
    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", session.refreshCookie)
      .send();

    expect(response.status).toBe(401);
    expect((response.body as ApiError).error.code).toBe("SESSION_EXPIRED");
  });

  it("rejects an otherwise-valid access token at the absolute boundary", async () => {
    const app = await createTestApp({
      accessExpiresIn: "13h",
      sessionIdleTimeoutSeconds: 13 * 60 * 60,
    });
    const session = await loginAndGetTokens(app, "staff@clinic-a.au");

    nowSpy.mockReturnValue(baseTime + 12 * 60 * 60 * 1000);
    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${session.accessToken}`);

    expect(response.status).toBe(401);
  });

  it("requires MFA again after an idle-expired privileged session", async () => {
    const app = await createTestApp();
    const session = await loginAndGetTokens(app, "manager@clinic-a.au");

    nowSpy.mockReturnValue(baseTime + 60 * 60 * 1000 + 1_000);
    const expired = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", session.refreshCookie)
      .send();
    expect(expired.status).toBe(401);

    const freshLogin = await request(app).post("/api/v1/auth/login").send({
      email: "manager@clinic-a.au",
      password: "password123",
    });
    expect(freshLogin.status).toBe(200);
    expect((freshLogin.body as { data: { requiresMfa: boolean } }).data.requiresMfa).toBe(true);
  });
});
