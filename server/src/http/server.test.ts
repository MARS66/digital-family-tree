import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHttpServer } from "./server.js";

const successSchema = {
  type: "object",
  additionalProperties: false,
  required: ["data"],
  properties: {
    data: {
      type: "object",
      additionalProperties: false,
      required: ["value"],
      properties: { value: { type: "string" } },
    },
  },
} as const;

describe("HTTP foundation", () => {
  let app: FastifyInstance;
  let handlerCallCount = 0;

  beforeEach(async () => {
    handlerCallCount = 0;
    app = await createHttpServer({
      logger: false,
      registerRoutes(server) {
        server.post<{ Body: { value: string } }>(
          "/api/v1/test/echo",
          {
            schema: {
              body: {
                type: "object",
                additionalProperties: false,
                required: ["value"],
                properties: { value: { type: "string", minLength: 1 } },
              },
              response: { 200: successSchema },
            },
          },
          (request) => {
            handlerCallCount += 1;
            return { data: request.body };
          },
        );
        server.get("/api/v1/test/fail", () => {
          throw new Error("sensitive internal failure");
        });
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns the health envelope and a server-generated trace ID", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { status: "ok" } });
    expect(response.headers["x-trace-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("normalizes validation and not-found errors", async () => {
    const validation = await app.inject({
      method: "POST",
      url: "/api/v1/test/echo",
      headers: { "idempotency-key": "validation-case-1" },
      payload: {},
    });
    expect(validation.statusCode).toBe(400);
    expect(validation.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "请求参数校验失败",
        traceId: validation.headers["x-trace-id"],
      },
    });

    const notFound = await app.inject({ method: "GET", url: "/missing" });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toMatchObject({
      error: { code: "NOT_FOUND", traceId: notFound.headers["x-trace-id"] },
    });
  });

  it("does not expose internal error messages", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/test/fail",
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("sensitive internal failure");
    expect(response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "服务器内部错误",
        traceId: response.headers["x-trace-id"],
      },
    });
  });

  it("requires an idempotency key for write requests", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/test/echo",
      payload: { value: "first" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_REQUIRED" },
    });
  });

  it("replays identical writes without executing the handler twice", async () => {
    const request = {
      method: "POST" as const,
      url: "/api/v1/test/echo",
      headers: { "idempotency-key": "same-request-1" },
      payload: { value: "saved" },
    };

    const first = await app.inject(request);
    const replayed = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toEqual(first.json());
    expect(replayed.headers["idempotency-replayed"]).toBe("true");
    expect(handlerCallCount).toBe(1);
  });

  it("rejects reuse of a key for a different request", async () => {
    const headers = { "idempotency-key": "conflicting-key-1" };
    await app.inject({
      method: "POST",
      url: "/api/v1/test/echo",
      headers,
      payload: { value: "first" },
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/test/echo",
      headers,
      payload: { value: "second" },
    });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_CONFLICT" },
    });
  });

  it("publishes an OpenAPI 3.1 document", async () => {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    const document = response.json<{
      openapi: string;
      paths: Record<string, { get: { operationId: string } }>;
    }>();

    expect(response.statusCode).toBe(200);
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/health"]!.get.operationId).toBe("getHealth");
  });
});
