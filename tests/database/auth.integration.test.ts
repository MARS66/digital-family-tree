import { createHash } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeWechatLoginProvider } from "../../server/src/auth/provider.js";
import { registerAuthRoutes } from "../../server/src/auth/routes.js";
import { AuthService } from "../../server/src/auth/service.js";
import { createDatabaseClient } from "../../server/src/database/client.js";
import { createHttpServer } from "../../server/src/http/server.js";
import {
  createIsolatedDatabase,
  type IsolatedDatabase,
} from "./database-test-kit.js";

describe("authentication with PostgreSQL", () => {
  let app: FastifyInstance | undefined;
  let authService: AuthService;
  let database: ReturnType<typeof createDatabaseClient> | undefined;
  let isolated: IsolatedDatabase | undefined;
  let now: Date;

  beforeEach(async () => {
    isolated = await createIsolatedDatabase();
    database = createDatabaseClient(isolated.url);
    now = new Date("2026-08-22T00:00:00.000Z");
    authService = new AuthService(database, new FakeWechatLoginProvider(), {
      accessTtlMs: 60_000,
      refreshTtlMs: 3_600_000,
      clock: () => now,
    });
    app = await createHttpServer({
      logger: false,
      registerRoutes(server) {
        registerAuthRoutes(server, authService);
      },
    });
  }, 30_000);

  afterEach(async () => {
    await app?.close();
    await database?.$disconnect();
    await isolated?.dispose();
    app = undefined;
    database = undefined;
    isolated = undefined;
  });

  async function login(code: string, key: string) {
    return app!.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/login",
      headers: { "idempotency-key": key },
      payload: { code },
    });
  }

  it("creates one User for repeated login with the same OpenID", async () => {
    const first = await login("dev_same_member", "login-attempt-001");
    const second = await login("dev_same_member", "login-attempt-002");

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const firstLogin = first.json<{
      data: { user: { id: string }; accessToken: string; refreshToken: string };
    }>();
    const secondLogin = second.json<{ data: { user: { id: string } } }>();
    expect(secondLogin.data.user.id).toBe(firstLogin.data.user.id);
    expect(await database!.user.count()).toBe(1);
    expect(await database!.session.count()).toBe(2);

    const firstTokens = firstLogin.data;
    const stored = await database!.session.findFirstOrThrow({
      orderBy: { createdAt: "asc" },
    });
    expect(stored.accessTokenHash).toBe(
      createHash("sha256").update(firstTokens.accessToken).digest("hex"),
    );
    expect(stored.accessTokenHash).not.toBe(firstTokens.accessToken);
    expect(stored.refreshTokenHash).not.toBe(firstTokens.refreshToken);
  });

  it("rotates refresh tokens and rejects reuse of the old session", async () => {
    const loggedIn = await login("dev_rotation_member", "login-rotation-001");
    const original = loggedIn.json<{
      data: { accessToken: string; refreshToken: string };
    }>().data;

    const refreshed = await app!.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { "idempotency-key": "refresh-rotation-001" },
      payload: { refreshToken: original.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(
      refreshed.json<{ data: { refreshToken: string } }>().data.refreshToken,
    ).not.toBe(original.refreshToken);

    const reused = await app!.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { "idempotency-key": "refresh-rotation-002" },
      payload: { refreshToken: original.refreshToken },
    });
    expect(reused.statusCode).toBe(401);
    expect(reused.json()).toMatchObject({
      error: { code: "REFRESH_TOKEN_INVALID" },
    });
    await expect(
      authService.authenticate(original.accessToken),
    ).rejects.toMatchObject({ code: "ACCESS_TOKEN_INVALID" });
  });

  it("rejects expired access and refresh tokens", async () => {
    const loggedIn = await login("dev_expiring_member", "login-expiry-001");
    const tokens = loggedIn.json<{
      data: { accessToken: string; refreshToken: string };
    }>().data;

    now = new Date(now.getTime() + 60_001);
    await expect(
      authService.authenticate(tokens.accessToken),
    ).rejects.toMatchObject({ code: "ACCESS_TOKEN_INVALID" });

    now = new Date(now.getTime() + 3_600_000);
    const response = await app!.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { "idempotency-key": "refresh-expiry-001" },
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "REFRESH_TOKEN_INVALID" },
    });
  });

  it("revokes the current access token on logout", async () => {
    const loggedIn = await login("dev_logout_member", "login-logout-001");
    const { accessToken } = loggedIn.json<{
      data: { accessToken: string };
    }>().data;

    const response = await app!.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": "logout-request-001",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { loggedOut: true } });
    await expect(authService.authenticate(accessToken)).rejects.toMatchObject({
      code: "ACCESS_TOKEN_INVALID",
    });
  });
});
