import type { FastifyInstance } from "fastify";

import { bearerToken } from "./request-authentication.js";
import type { AuthService } from "./service.js";

const tokenProperties = {
  accessToken: { type: "string" },
  refreshToken: { type: "string" },
  accessExpiresAt: { type: "string", format: "date-time" },
  refreshExpiresAt: { type: "string", format: "date-time" },
} as const;

export function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
): void {
  app.post<{ Body: { code: string } }>(
    "/api/v1/auth/wechat/login",
    {
      schema: {
        operationId: "wechatLogin",
        summary: "使用微信临时 code 登录",
        tags: ["auth"],
        security: [{ idempotencyKey: [] }],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["code"],
          properties: {
            code: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["data"],
            properties: {
              data: {
                type: "object",
                additionalProperties: false,
                required: [...Object.keys(tokenProperties), "user", "families"],
                properties: {
                  ...tokenProperties,
                  user: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "displayName", "status"],
                    properties: {
                      id: { type: "string", format: "uuid" },
                      displayName: { type: ["string", "null"] },
                      status: { type: "string" },
                    },
                  },
                  families: { type: "array", items: {} },
                },
              },
            },
          },
        },
      },
    },
    async (request) => ({ data: await authService.login(request.body.code) }),
  );

  app.post<{ Body: { refreshToken: string } }>(
    "/api/v1/auth/refresh",
    {
      schema: {
        operationId: "refreshSession",
        summary: "轮换访问和刷新凭证",
        tags: ["auth"],
        security: [{ idempotencyKey: [] }],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["refreshToken"],
          properties: {
            refreshToken: { type: "string", minLength: 32, maxLength: 256 },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["data"],
            properties: {
              data: {
                type: "object",
                additionalProperties: false,
                required: Object.keys(tokenProperties),
                properties: tokenProperties,
              },
            },
          },
        },
      },
    },
    async (request) => ({
      data: await authService.refresh(request.body.refreshToken),
    }),
  );

  app.post(
    "/api/v1/auth/logout",
    {
      schema: {
        operationId: "logout",
        summary: "撤销当前会话",
        tags: ["auth"],
        security: [{ bearerAuth: [], idempotencyKey: [] }],
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["data"],
            properties: {
              data: {
                type: "object",
                additionalProperties: false,
                required: ["loggedOut"],
                properties: { loggedOut: { type: "boolean", const: true } },
              },
            },
          },
        },
      },
    },
    async (request) => {
      await authService.logout(bearerToken(request));
      return { data: { loggedOut: true as const } };
    },
  );
}
