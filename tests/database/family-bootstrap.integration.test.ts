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

describe("family bootstrap transaction with PostgreSQL", () => {
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

  async function login(code: string): Promise<string> {
    const response = await app!.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/login",
      headers: { "idempotency-key": "login-" + code },
      payload: { code },
    });
    expect(response.statusCode).toBe(200);
    return response.json<{ data: { accessToken: string } }>().data.accessToken;
  }

  async function bootstrap(
    accessToken: string,
    key: string,
    payload: Record<string, unknown>,
  ) {
    return app!.inject({
      method: "POST",
      url: "/api/v1/families",
      headers: {
        authorization: "Bearer " + accessToken,
        "idempotency-key": key,
      },
      payload,
    });
  }

  it("atomically creates Family, OWNER, first Person, and approved SELF claim", async () => {
    const accessToken = await login("dev_bootstrap_claim");
    const response = await bootstrap(accessToken, "bootstrap-with-claim", {
      name: "林氏家族",
      originPlace: "福建",
      firstPerson: {
        primaryName: "林明",
        gender: "MALE",
        birthDate: { value: "1988-03", precision: "MONTH" },
      },
      claimSelf: true,
    });

    expect(response.statusCode).toBe(200);
    const result = response.json<{
      data: {
        id: string;
        ownerUserId: string;
        firstPerson: { id: string; familyId: string; birthDate: unknown };
        selfClaim: {
          personId: string;
          userId: string;
          claimType: string;
          status: string;
        };
      };
    }>().data;
    expect(result.firstPerson.familyId).toBe(result.id);
    expect(result.firstPerson.birthDate).toEqual({
      value: "1988-03",
      precision: "MONTH",
    });
    expect(result.selfClaim).toMatchObject({
      personId: result.firstPerson.id,
      userId: result.ownerUserId,
      claimType: "SELF",
      status: "APPROVED",
    });
    expect(await database!.family.count()).toBe(1);
    expect(await database!.familyMembership.count()).toBe(1);
    expect(await database!.person.count()).toBe(1);
    expect(await database!.personClaim.count()).toBe(1);
  });

  it("creates a first Person without a claim when claimSelf is false", async () => {
    const accessToken = await login("dev_bootstrap_no_claim");
    const response = await bootstrap(accessToken, "bootstrap-without-claim", {
      name: "无认领家族",
      firstPerson: { primaryName: "首位人物" },
      claimSelf: false,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { firstPerson: { primaryName: "首位人物" }, selfClaim: null },
    });
    expect(await database!.personClaim.count()).toBe(0);
  });

  it("rejects claiming a placeholder and leaves no partial records", async () => {
    const accessToken = await login("dev_bootstrap_placeholder");
    const response = await bootstrap(accessToken, "bootstrap-placeholder", {
      name: "占位家族",
      firstPerson: {
        isPlaceholder: true,
        placeholderLabel: "姓名待考",
      },
      claimSelf: true,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "PLACEHOLDER_CANNOT_BE_CLAIMED" },
    });
    expect(await database!.family.count()).toBe(0);
    expect(await database!.familyMembership.count()).toBe(0);
    expect(await database!.person.count()).toBe(0);
    expect(await database!.personClaim.count()).toBe(0);
  });

  it("rolls every record back when claim persistence fails", async () => {
    await database!.$executeRawUnsafe(`
      CREATE FUNCTION reject_claim_for_test() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'claim rejected for transaction test';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_claim_for_test
      BEFORE INSERT ON person_claims
      FOR EACH ROW EXECUTE FUNCTION reject_claim_for_test();
    `);
    const accessToken = await login("dev_bootstrap_rollback");
    const response = await bootstrap(accessToken, "bootstrap-rollback", {
      name: "应完全回滚",
      firstPerson: { primaryName: "回滚人物" },
      claimSelf: true,
    });

    expect(response.statusCode).toBe(500);
    expect(await database!.family.count()).toBe(0);
    expect(await database!.familyMembership.count()).toBe(0);
    expect(await database!.person.count()).toBe(0);
    expect(await database!.personClaim.count()).toBe(0);
  });

  it("replays the complete result without duplicating any entity", async () => {
    const accessToken = await login("dev_bootstrap_retry");
    const payload = {
      name: "弱网重试家族",
      firstPerson: { primaryName: "重试人物" },
      claimSelf: true,
    };
    const first = await bootstrap(accessToken, "bootstrap-retry-key", payload);
    const second = await bootstrap(accessToken, "bootstrap-retry-key", payload);

    expect(second.statusCode).toBe(200);
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(second.json()).toEqual(first.json());
    expect(await database!.family.count()).toBe(1);
    expect(await database!.familyMembership.count()).toBe(1);
    expect(await database!.person.count()).toBe(1);
    expect(await database!.personClaim.count()).toBe(1);
  });
});
