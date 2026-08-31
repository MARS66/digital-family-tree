import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeWechatLoginProvider } from "../../server/src/auth/provider.js";
import { registerAuthRoutes } from "../../server/src/auth/routes.js";
import { AuthService } from "../../server/src/auth/service.js";
import { createDatabaseClient } from "../../server/src/database/client.js";
import { registerFamilyRoutes } from "../../server/src/family/routes.js";
import { FamilyService } from "../../server/src/family/service.js";
import { createHttpServer } from "../../server/src/http/server.js";
import { PartnerUnionService } from "../../server/src/partner/service.js";
import { registerPersonRoutes } from "../../server/src/person/routes.js";
import { PersonService } from "../../server/src/person/service.js";
import { registerRelationshipRoutes } from "../../server/src/relationship/routes.js";
import { RelationshipService } from "../../server/src/relationship/service.js";
import {
  createIsolatedDatabase,
  type IsolatedDatabase,
} from "./database-test-kit.js";

describe("PartnerUnion with PostgreSQL", () => {
  let app: FastifyInstance | undefined;
  let authService: AuthService;
  let familyService: FamilyService;
  let partnerService: PartnerUnionService;
  let personService: PersonService;
  let relationshipService: RelationshipService;
  let database: ReturnType<typeof createDatabaseClient> | undefined;
  let isolated: IsolatedDatabase | undefined;

  beforeEach(async () => {
    isolated = await createIsolatedDatabase();
    database = createDatabaseClient(isolated.url);
    authService = new AuthService(database, new FakeWechatLoginProvider());
    familyService = new FamilyService(database);
    partnerService = new PartnerUnionService(database);
    personService = new PersonService(database);
    relationshipService = new RelationshipService(database);
    app = await createHttpServer({
      logger: false,
      registerRoutes(server) {
        registerAuthRoutes(server, authService);
        registerFamilyRoutes(server, authService, familyService);
        registerPersonRoutes(server, authService, personService);
        registerRelationshipRoutes(server, authService, relationshipService);
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

  async function createOwner(code: string) {
    const login = await authService.login(code);
    const family = await familyService.create(login.user.id, {
      name: code + " 的家族",
    });
    return { accessToken: login.accessToken, family, user: login.user };
  }

  async function createPeople(
    userId: string,
    familyId: string,
    names: string[],
  ) {
    return Promise.all(
      names.map((primaryName) =>
        personService.create(userId, familyId, { primaryName }),
      ),
    );
  }

  it("normalizes endpoints and returns the same union from either Person", async () => {
    const owner = await createOwner("dev_partner_read");
    const [first, second] = await createPeople(owner.user.id, owner.family.id, [
      "伴侣甲",
      "伴侣乙",
    ]);
    const union = await partnerService.create(owner.user.id, owner.family.id, {
      person1Id: second!.id,
      person2Id: first!.id,
      unionType: "MARRIAGE",
      startDate: "1998-06-12",
    });

    expect(union.personAId < union.personBId).toBe(true);
    for (const person of [first!, second!]) {
      const relations = await relationshipService.getPersonRelations(
        owner.user.id,
        owner.family.id,
        person.id,
      );
      expect(relations.partners).toMatchObject([
        {
          unionId: union.id,
          unionType: "MARRIAGE",
          startDate: "1998-06-12",
        },
      ]);
      expect(relations.parents).toEqual([]);
      expect(relations.children).toEqual([]);
    }

    const response = await app!.inject({
      method: "GET",
      url:
        "/api/v1/families/" +
        owner.family.id +
        "/persons/" +
        first!.id +
        "/relations",
      headers: { authorization: "Bearer " + owner.accessToken },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { partners: [{ unionId: union.id }] },
    });
    expect(await database!.relationship.count()).toBe(0);
  });

  it("treats A-B and B-A as the same active union", async () => {
    const owner = await createOwner("dev_partner_duplicate");
    const [first, second] = await createPeople(owner.user.id, owner.family.id, [
      "甲",
      "乙",
    ]);
    await partnerService.create(owner.user.id, owner.family.id, {
      person1Id: first!.id,
      person2Id: second!.id,
    });
    await expect(
      partnerService.create(owner.user.id, owner.family.id, {
        person1Id: second!.id,
        person2Id: first!.id,
      }),
    ).rejects.toMatchObject({ code: "PARTNER_UNION_DUPLICATE" });
    expect(await database!.partnerUnion.count()).toBe(1);
  });

  it("serializes concurrent reverse-order creation", async () => {
    const owner = await createOwner("dev_partner_concurrent");
    const [first, second] = await createPeople(owner.user.id, owner.family.id, [
      "并发甲",
      "并发乙",
    ]);
    const results = await Promise.allSettled([
      partnerService.create(owner.user.id, owner.family.id, {
        person1Id: first!.id,
        person2Id: second!.id,
      }),
      partnerService.create(owner.user.id, owner.family.id, {
        person1Id: second!.id,
        person2Id: first!.id,
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({
      reason: { code: "PARTNER_UNION_DUPLICATE" },
    });
    expect(await database!.partnerUnion.count()).toBe(1);
  });

  it("rejects self unions, cross-Family endpoints, and invalid dates", async () => {
    const owner = await createOwner("dev_partner_rules");
    const outsider = await createOwner("dev_partner_outside");
    const [first, second] = await createPeople(owner.user.id, owner.family.id, [
      "规则甲",
      "规则乙",
    ]);
    const [outside] = await createPeople(outsider.user.id, outsider.family.id, [
      "外族",
    ]);

    await expect(
      partnerService.create(owner.user.id, owner.family.id, {
        person1Id: first!.id,
        person2Id: first!.id,
      }),
    ).rejects.toMatchObject({ code: "PARTNER_UNION_SELF_LOOP" });
    await expect(
      partnerService.create(owner.user.id, owner.family.id, {
        person1Id: first!.id,
        person2Id: outside!.id,
      }),
    ).rejects.toMatchObject({ code: "PARTNER_UNION_ENDPOINT_INVALID" });
    await expect(
      partnerService.create(owner.user.id, owner.family.id, {
        person1Id: first!.id,
        person2Id: second!.id,
        startDate: "2024-02-31",
      }),
    ).rejects.toMatchObject({ code: "PARTNER_UNION_DATE_INVALID" });
    await expect(
      partnerService.create(owner.user.id, owner.family.id, {
        person1Id: first!.id,
        person2Id: second!.id,
        startDate: "2020-01-01",
        endDate: "2019-12-31",
      }),
    ).rejects.toMatchObject({ code: "PARTNER_UNION_DATE_ORDER_INVALID" });
  });

  it("soft deletes with a version and allows the same pair to be rebuilt", async () => {
    const owner = await createOwner("dev_partner_rebuild");
    const [first, second] = await createPeople(owner.user.id, owner.family.id, [
      "重建甲",
      "重建乙",
    ]);
    const original = await partnerService.create(
      owner.user.id,
      owner.family.id,
      {
        person1Id: first!.id,
        person2Id: second!.id,
        unionType: "PARTNERSHIP",
      },
    );
    await expect(
      partnerService.delete(owner.user.id, owner.family.id, original.id, 2),
    ).rejects.toMatchObject({ code: "PARTNER_UNION_VERSION_CONFLICT" });
    await partnerService.delete(
      owner.user.id,
      owner.family.id,
      original.id,
      original.version,
    );
    const rebuilt = await partnerService.create(
      owner.user.id,
      owner.family.id,
      {
        person1Id: second!.id,
        person2Id: first!.id,
        unionType: "UNKNOWN",
      },
    );

    expect(rebuilt.id).not.toBe(original.id);
    expect(await database!.partnerUnion.count()).toBe(2);
    expect(
      await database!.partnerUnion.count({
        where: { deletedAt: null, status: "ACTIVE" },
      }),
    ).toBe(1);
  });

  it("prevents deleting a Person with an active PartnerUnion", async () => {
    const owner = await createOwner("dev_partner_delete_guard");
    const [first, second] = await createPeople(owner.user.id, owner.family.id, [
      "保护甲",
      "保护乙",
    ]);
    await partnerService.create(owner.user.id, owner.family.id, {
      person1Id: first!.id,
      person2Id: second!.id,
    });

    await expect(
      personService.delete(
        owner.user.id,
        owner.family.id,
        first!.id,
        first!.version,
      ),
    ).rejects.toMatchObject({ code: "PERSON_HAS_ACTIVE_RELATIONSHIPS" });
    await expect(
      database!.person.update({
        where: { id: second!.id },
        data: { deletedAt: new Date(), deletedBy: owner.user.id },
      }),
    ).rejects.toBeDefined();
  });

  it("enforces canonical and same-Family endpoints in PostgreSQL", async () => {
    const owner = await createOwner("dev_partner_db_rules");
    const outsider = await createOwner("dev_partner_db_outside");
    const [inside] = await createPeople(owner.user.id, owner.family.id, [
      "内族",
    ]);
    const [outside] = await createPeople(outsider.user.id, outsider.family.id, [
      "外族",
    ]);
    const [personAId, personBId] =
      inside!.id < outside!.id
        ? [inside!.id, outside!.id]
        : [outside!.id, inside!.id];

    await expect(
      database!.partnerUnion.create({
        data: {
          familyId: owner.family.id,
          personAId,
          personBId,
          createdBy: owner.user.id,
        },
      }),
    ).rejects.toBeDefined();
    expect(await database!.partnerUnion.count()).toBe(0);
  });
});
