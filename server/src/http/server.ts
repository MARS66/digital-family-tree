import { randomUUID } from "node:crypto";

import swagger from "@fastify/swagger";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";

import { registerErrorHandlers } from "./errors.js";
import { registerIdempotency } from "./idempotency.js";
import { errorResponseSchema, healthResponseSchema } from "./schemas.js";

export interface CreateHttpServerOptions {
  logger?: FastifyServerOptions["logger"];
  registerRoutes?: (app: FastifyInstance) => Promise<void> | void;
}

export async function createHttpServer(
  options: CreateHttpServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    genReqId: () => randomUUID(),
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Digital Family Tree API",
        description: "数字家谱服务端 API",
        version: "0.1.0",
      },
      servers: [{ url: "/", description: "Current server" }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "Opaque",
          },
          idempotencyKey: {
            type: "apiKey",
            in: "header",
            name: "Idempotency-Key",
          },
        },
      },
    },
  });

  registerErrorHandlers(app);
  registerIdempotency(app);

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-trace-id", request.id);
    return payload;
  });

  app.get(
    "/health",
    {
      schema: {
        operationId: "getHealth",
        summary: "服务存活检查",
        tags: ["system"],
        response: {
          200: healthResponseSchema,
          default: errorResponseSchema,
        },
      },
    },
    () => ({ data: { status: "ok" as const } }),
  );

  app.get(
    "/openapi.json",
    {
      schema: {
        hide: true,
      },
    },
    () => app.swagger(),
  );

  await options.registerRoutes?.(app);
  await app.ready();
  return app;
}
