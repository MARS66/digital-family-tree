import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeWechatLoginProvider } from "../../server/src/auth/provider.js";
import { registerAuthRoutes } from "../../server/src/auth/routes.js";
import { AuthService } from "../../server/src/auth/service.js";
import { createDatabaseClient } from "../../server/src/database/client.js";
import { registerFamilyRoutes } from "../../server/src/family/routes.js";
import { FamilyService } from "../../server/src/family/service.js";
import { createHttpServer } from "../../server/src/http/server.js";
import {
  createIsolatedDatabase,
  type IsolatedDatabase,
} from "./database-test-kit.js";

describe("Family and Membership with PostgreSQL", () => {
  let app: FastifyInstance | undefined;
  let database: ReturnType<typeof createDatabaseClient> | undefined;
  let isolated: IsolatedDatabase | undefined;

  beforeEach(async () => {
    isolated = await createIsolatedDatabase();
    database = createDatabaseClient(isolated.url);
    const authService = new AuthService(
      database,
      new FakeWechatLoginProvider(),
    );
    const familyService = new FamilyService(database);
    app = await createHttpServer({
      logger: false,
      registerRoutes(server) {
        registerAuthRoutes(server, authService);
        registerFamilyRoutes(server, authService, familyService);
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

  async function login(code: string, key: string): Promise<string> {
    const response = await app!.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/login",
      headers: { "idempotency-key": key },
      payload: { code },
    });
    expect(response.statusCode).toBe(200);
    return response.json<{ data: { accessToken: string } }>().data.accessToken;
  }

  async function createFamily(
    accessToken: string,
    key: string,
    name = "林氏家族",
  ) {
    return app!.inject({
      method: "POST",
      url: "/api/v1/families",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": key,
      },
      payload: {
        name,
        description: "共同整理家族资料",
        originPlace: "福建",
        firstPerson: { primaryName: "首位人物" },
      },
    });
  }

  it("atomically creates a Family and its active OWNER membership", async () => {
    const accessToken = await login("dev_family_owner", "login-family-owner");
    const response = await createFamily(accessToken, "create-family-owner");

    expect(response.statusCode).toBe(200);
    const family = response.json<{
      data: {
        id: string;
        ownerUserId: string;
        membership: { role: string; status: string; joinedAt: string };
      };
    }>().data;
    const stored = await database!.family.findUniqueOrThrow({
      where: { id: family.id },
      include: { memberships: true },
    });
    expect(stored.ownerUserId).toBe(family.ownerUserId);
    expect(stored.memberships).toHaveLength(1);
    expect(stored.memberships[0]).toMatchObject({
      userId: family.ownerUserId,
      role: "OWNER",
      status: "ACTIVE",
    });
    expect(family.membership).toMatchObject({
      role: "OWNER",
      status: "ACTIVE",
    });
    expect(typeof family.membership.joinedAt).toBe("string");

    const nextLogin = await app!.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/login",
      headers: { "idempotency-key": "login-family-owner-again" },
      payload: { code: "dev_family_owner" },
    });
    expect(
      nextLogin.json<{
        data: { families: { familyId: string; role: string }[] };
      }>().data.families,
    ).toEqual([
      {
        familyId: family.id,
        familyName: "林氏家族",
        role: "OWNER",
        status: "ACTIVE",
      },
    ]);
  });

  it("replays an idempotent create without duplicating data", async () => {
    const accessToken = await login("dev_idempotent_owner", "login-idempotent");
    const first = await createFamily(accessToken, "create-idempotent-family");
    const second = await createFamily(accessToken, "create-idempotent-family");

    expect(second.statusCode).toBe(200);
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(second.json()).toEqual(first.json());
    expect(await database!.family.count()).toBe(1);
    expect(await database!.familyMembership.count()).toBe(1);
    expect(await database!.person.count()).toBe(1);
  });

  it("does not disclose a Family across users", async () => {
    const ownerToken = await login(
      "dev_isolated_owner",
      "login-owner-isolation",
    );
    const outsiderToken = await login(
      "dev_isolated_outsider",
      "login-outsider-isolation",
    );
    const created = await createFamily(ownerToken, "create-isolated-family");
    const familyId = created.json<{ data: { id: string } }>().data.id;

    const ownerRead = await app!.inject({
      method: "GET",
      url: `/api/v1/families/${familyId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const outsiderRead = await app!.inject({
      method: "GET",
      url: `/api/v1/families/${familyId}`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });

    expect(ownerRead.statusCode).toBe(200);
    expect(outsiderRead.statusCode).toBe(404);
    expect(outsiderRead.json()).toMatchObject({
      error: { code: "FAMILY_NOT_FOUND" },
    });
  });

  it("scopes idempotency replay to the authenticated credential", async () => {
    const firstToken = await login("dev_first_key_owner", "login-first-key");
    const secondToken = await login("dev_second_key_owner", "login-second-key");

    const first = await createFamily(firstToken, "shared-client-key");
    const second = await createFamily(secondToken, "shared-client-key");

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.headers["idempotency-replayed"]).toBeUndefined();
    expect(second.json<{ data: { id: string } }>().data.id).not.toBe(
      first.json<{ data: { id: string } }>().data.id,
    );
    expect(await database!.family.count()).toBe(2);
  });

  it("enforces one membership per user and Family in PostgreSQL", async () => {
    const accessToken = await login("dev_unique_member", "login-unique-member");
    const created = await createFamily(accessToken, "create-unique-family");
    const familyId = created.json<{
      data: { id: string; ownerUserId: string };
    }>().data;

    await expect(
      database!.familyMembership.create({
        data: {
          familyId: familyId.id,
          userId: familyId.ownerUserId,
          role: "MEMBER",
          status: "ACTIVE",
          joinedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rolls the Family back when OWNER membership creation fails", async () => {
    await database!.$executeRawUnsafe(`
      CREATE FUNCTION reject_membership_for_test() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'membership rejected for transaction test';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_membership_for_test
      BEFORE INSERT ON family_memberships
      FOR EACH ROW EXECUTE FUNCTION reject_membership_for_test();
    `);
    const accessToken = await login("dev_rollback_owner", "login-rollback");
    const response = await createFamily(
      accessToken,
      "create-rollback-family",
      "应回滚的家族",
    );

    expect(response.statusCode).toBe(500);
    expect(await database!.family.count()).toBe(0);
    expect(await database!.familyMembership.count()).toBe(0);
    expect(await database!.person.count()).toBe(0);
    expect(await database!.personClaim.count()).toBe(0);
  });
});
