import express from "express";
import { describe, expect, it } from "@jest/globals";
import { pinoHttp } from "pino-http";
import request from "supertest";

import { createLogger } from "../src/utils/logger.js";

describe("request logging credential redaction", () => {
  it("removes request, response, and nested header containers while preserving operations", async () => {
    const output: string[] = [];
    const logger = createLogger(
      { LOG_LEVEL: "info" },
      {
        write(message: string) {
          output.push(message);
        },
      },
    );
    const app = express();
    app.use(pinoHttp({ logger }));
    app.get("/logging-security", (_req, res) => {
      res.setHeader("Set-Cookie", "refreshToken=response-cookie-secret; HttpOnly");
      res.status(204).end();
    });

    await request(app)
      .get("/logging-security")
      .set("Authorization", "Bearer bearer-token-secret")
      .set("Cookie", "refreshToken=request-cookie-secret")
      .set("Proxy-Authorization", "Basic proxy-credential-secret")
      .set("X-API-Key", "api-key-secret")
      .set("X-Auth-Token", "auth-token-secret")
      .set("Authentication-Token", "authentication-token-secret")
      .expect(204);

    logger.info(
      {
        envelope: {
          request: {
            headers: {
              authorization: "Bearer nested-bearer-secret",
              cookie: "refreshToken=nested-cookie-secret",
            },
          },
        },
      },
      "nested request metadata",
    );
    logger.info(
      {
        envelope: {
          response: {
            headers: {
              "set-cookie": "refreshToken=nested-response-cookie-secret",
              "x-api-key": "nested-response-api-key-secret",
            },
          },
        },
      },
      "nested response metadata",
    );

    const serialized = output.join("");
    for (const secret of [
      "bearer-token-secret",
      "request-cookie-secret",
      "proxy-credential-secret",
      "api-key-secret",
      "auth-token-secret",
      "authentication-token-secret",
      "response-cookie-secret",
      "nested-bearer-secret",
      "nested-cookie-secret",
      "nested-response-cookie-secret",
      "nested-response-api-key-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }

    expect(serialized).toContain("/logging-security");
    expect(serialized).toContain('"statusCode":204');
    expect(serialized).toContain("request completed");
    expect(serialized).toContain("nested request metadata");
    expect(serialized).toContain("nested response metadata");
  });
});
