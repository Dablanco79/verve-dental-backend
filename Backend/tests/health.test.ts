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
    const body = response.body as {
      status: string;
      service: string;
      timestamp: string;
    };

    expect(body.status).toBe("ok");
    expect(body.service).toBe("@verve/backend");
    expect(body.timestamp).toEqual(expect.any(String));
  });
});
