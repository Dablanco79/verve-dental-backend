import request from "supertest";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/index.js";
import { createLogger } from "../src/utils/logger.js";

describe("GET /api/v1/health", () => {
  it("returns service health status", async () => {
    process.env.NODE_ENV = "test";
    const config = loadConfig();
    const logger = createLogger(config);
    const app = createApp(config, logger);

    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "ok",
      service: "@verve/backend",
    });
    expect(response.body.timestamp).toBeDefined();
  });
});
