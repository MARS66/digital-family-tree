import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeWechatLoginProvider } from "../../server/src/auth/provider.js";
import { registerAuthRoutes } from "../../server/src/auth/routes.js";
import { AuthService } from "../../server/src/auth/service.js";
import { createDatabaseClient } from "../../server/src/database/client.js";
import { registerFamilyRoutes } from "../../server/src/family/routes.js";
import { FamilyService } from "../../server/src/family/service.js";
import { createHttpServer } from "../../server/src/http/server.js";
import { registerPersonRoutes } from "../../server/src/person/routes.js";
import { PersonService } from "../../server/src/person/service.js";
import { registerRelationshipRoutes } from "../../server/src/relationship/routes.js";
import { RelationshipService } from "../../server/src/relationship/service.js";
import {
  createIsolatedDatabase,
  type IsolatedDatabase,
} from "./database-test-kit.js";

describe("parent relationships with PostgreSQL", () => {
  let app: FastifyInstance | undefined;
  let authService: AuthService;
  let familyService: FamilyService;
  let personService: PersonService;
  let relationshipService: RelationshipService;
  let database: ReturnType<typeof createDatabaseClient> | undefined;
  let isolated: IsolatedDatabase | undefined;

  beforeEach(async () => {
    isolated = await createIsolatedDatabase();
    database = createDatabaseClient(isolated.url);
    authService = new AuthService(database, new FakeWechatLoginProvider());
    familyService = new FamilyService(database);
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

  it("stores one directed fact and reads it from both endpoints", async () => {
    const owner = await createOwner("dev_relationship_read");
    const [parent, child] = await createPeople(owner.user.id, owner.family.id, [
      "父亲",
      "子女",
    ]);
    const relationship = await relationshipService.createParent(
      owner.user.id,
      owner.family.id,
      { parentId: parent!.id, childId: child!.id, parentRole: "FATHER" },
    );

    const parentView = await relationshipService.getPersonRelations(
      owner.user.id,
      owner.family.id,
      parent!.id,
    );
    expect(parentView.parents).toEqual([]);
    expect(parentView.children).toMatchObject([
      {
        relationshipId: relationship.id,
        parentRole: "FATHER",
        person: { id: child!.id },
      },
    ]);

    const response = await app!.inject({
      method: "GET",
      url:
        "/api/v1/families/" +
        owner.family.id +
        "/persons/" +
        child!.id +
        "/relations",
      headers: { authorization: "Bearer " + owner.accessToken },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        parents: [
          {
            relationshipId: relationship.id,
            person: { id: parent!.id },
          },
        ],
      },
    });
    expect(await database!.relationship.count()).toBe(1);
  });

  it("rejects self loops, duplicates, role conflicts, and cross-Family endpoints", async () => {
    const owner = await createOwner("dev_relationship_rules");
    const outsider = await createOwner("dev_relationship_other_family");
    const [first, second, third] = await createPeople(
      owner.user.id,
      owner.family.id,
      ["甲", "乙", "丙"],
    );
    const [outsidePerson] = await createPeople(
      outsider.user.id,
      outsider.family.id,
      ["外族人物"],
    );

    await expect(
      relationshipService.createParent(owner.user.id, owner.family.id, {
        parentId: first!.id,
        childId: first!.id,
      }),
    ).rejects.toMatchObject({ code: "RELATIONSHIP_SELF_LOOP" });
    await relationshipService.createParent(owner.user.id, owner.family.id, {
      parentId: first!.id,
      childId: second!.id,
      parentRole: "FATHER",
    });
    await expect(
      relationshipService.createParent(owner.user.id, owner.family.id, {
        parentId: first!.id,
        childId: second!.id,
      }),
    ).rejects.toMatchObject({ code: "RELATIONSHIP_DUPLICATE" });
    await expect(
      relationshipService.createParent(owner.user.id, owner.family.id, {
        parentId: third!.id,
        childId: second!.id,
        parentRole: "FATHER",
      }),
    ).rejects.toMatchObject({ code: "PARENT_ROLE_CONFLICT" });
    await expect(
      relationshipService.createParent(owner.user.id, owner.family.id, {
        parentId: first!.id,
        childId: outsidePerson!.id,
      }),
    ).rejects.toMatchObject({ code: "RELATIONSHIP_ENDPOINT_INVALID" });
  });

  it("rejects an ancestor cycle through multiple generations", async () => {
    const owner = await createOwner("dev_relationship_cycle");
    const [grandparent, parent, child] = await createPeople(
      owner.user.id,
      owner.family.id,
      ["祖父", "父亲", "子女"],
    );
    await relationshipService.createParent(owner.user.id, owner.family.id, {
      parentId: grandparent!.id,
      childId: parent!.id,
    });
    await relationshipService.createParent(owner.user.id, owner.family.id, {
      parentId: parent!.id,
      childId: child!.id,
    });

    await expect(
      relationshipService.createParent(owner.user.id, owner.family.id, {
        parentId: child!.id,
        childId: grandparent!.id,
      }),
    ).rejects.toMatchObject({ code: "RELATIONSHIP_CYCLE" });
    expect(await database!.relationship.count()).toBe(2);
  });

  it("derives full, half, and unknown siblings without storing sibling edges", async () => {
    const owner = await createOwner("dev_relationship_siblings");
    const [parentA, parentB, parentC, target, full, half, unknown] =
      await createPeople(owner.user.id, owner.family.id, [
        "父母甲",
        "父母乙",
        "父母丙",
        "目标人物",
        "全同胞",
        "半同胞",
        "信息不足同胞",
      ]);
    const edges = [
      [parentA!, target!],
      [parentB!, target!],
      [parentA!, full!],
      [parentB!, full!],
      [parentA!, half!],
      [parentC!, half!],
      [parentA!, unknown!],
    ];
    for (const [parent, child] of edges) {
      await relationshipService.createParent(owner.user.id, owner.family.id, {
        parentId: parent!.id,
        childId: child!.id,
        parentRole: "PARENT",
      });
    }

    const relations = await relationshipService.getPersonRelations(
      owner.user.id,
      owner.family.id,
      target!.id,
    );
    const kinds = Object.fromEntries(
      relations.siblings.map((sibling) => [
        sibling.person.primaryName,
        sibling.kind,
      ]),
    );
    expect(kinds).toEqual({
      全同胞: "FULL",
      半同胞: "HALF",
      信息不足同胞: "UNKNOWN",
    });
    expect(await database!.relationship.count()).toBe(7);
  });

  it("rejects reverse edges across a deterministic random DAG", async () => {
    const owner = await createOwner("dev_relationship_property");
    const people = await createPeople(
      owner.user.id,
      owner.family.id,
      Array.from({ length: 12 }, (_, index) => "节点" + index),
    );
    let state = 20260831;
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const inserted: { parentId: string; childId: string }[] = [];
    for (let parentIndex = 0; parentIndex < people.length; parentIndex += 1) {
      for (
        let childIndex = parentIndex + 1;
        childIndex < people.length;
        childIndex += 1
      ) {
        if (random() < 0.16) {
          const edge = {
            parentId: people[parentIndex]!.id,
            childId: people[childIndex]!.id,
          };
          await relationshipService.createParent(
            owner.user.id,
            owner.family.id,
            edge,
          );
          inserted.push(edge);
        }
      }
    }
    expect(inserted.length).toBeGreaterThan(3);
    for (const edge of inserted.slice(0, 6)) {
      await expect(
        relationshipService.createParent(owner.user.id, owner.family.id, {
          parentId: edge.childId,
          childId: edge.parentId,
        }),
      ).rejects.toMatchObject({ code: "RELATIONSHIP_CYCLE" });
    }
  });

  it("serializes opposite concurrent inserts so only one can commit", async () => {
    const owner = await createOwner("dev_relationship_concurrency");
    const [first, second] = await createPeople(owner.user.id, owner.family.id, [
      "并发甲",
      "并发乙",
    ]);
    const results = await Promise.allSettled([
      relationshipService.createParent(owner.user.id, owner.family.id, {
        parentId: first!.id,
        childId: second!.id,
      }),
      relationshipService.createParent(owner.user.id, owner.family.id, {
        parentId: second!.id,
        childId: first!.id,
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "RELATIONSHIP_CYCLE" },
    });
    expect(await database!.relationship.count()).toBe(1);
  });

  it("enforces endpoint Family scope for direct PostgreSQL writes", async () => {
    const owner = await createOwner("dev_relationship_db_scope");
    const outsider = await createOwner("dev_relationship_db_outside");
    const [insidePerson] = await createPeople(owner.user.id, owner.family.id, [
      "家族内",
    ]);
    const [outsidePerson] = await createPeople(
      outsider.user.id,
      outsider.family.id,
      ["家族外"],
    );

    await expect(
      database!.relationship.create({
        data: {
          familyId: owner.family.id,
          fromPersonId: insidePerson!.id,
          toPersonId: outsidePerson!.id,
          type: "PARENT_OF",
          parentRole: "UNKNOWN",
          status: "ACTIVE",
          createdBy: owner.user.id,
        },
      }),
    ).rejects.toBeDefined();
    expect(await database!.relationship.count()).toBe(0);
  });

  it("prevents soft deletion while a Person has active relationships", async () => {
    const owner = await createOwner("dev_relationship_delete_guard");
    const [parent, child] = await createPeople(owner.user.id, owner.family.id, [
      "不可删除父母",
      "关联子女",
    ]);
    await relationshipService.createParent(owner.user.id, owner.family.id, {
      parentId: parent!.id,
      childId: child!.id,
    });

    await expect(
      personService.delete(
        owner.user.id,
        owner.family.id,
        parent!.id,
        parent!.version,
      ),
    ).rejects.toMatchObject({ code: "PERSON_HAS_ACTIVE_RELATIONSHIPS" });
    await expect(
      database!.person.update({
        where: { id: child!.id },
        data: { deletedAt: new Date(), deletedBy: owner.user.id },
      }),
    ).rejects.toBeDefined();
  });
});
