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
import {
  createIsolatedDatabase,
  type IsolatedDatabase,
} from "./database-test-kit.js";

describe("Person foundation with PostgreSQL", () => {
  let app: FastifyInstance | undefined;
  let authService: AuthService;
  let familyService: FamilyService;
  let personService: PersonService;
  let database: ReturnType<typeof createDatabaseClient> | undefined;
  let isolated: IsolatedDatabase | undefined;

  beforeEach(async () => {
    isolated = await createIsolatedDatabase();
    database = createDatabaseClient(isolated.url);
    authService = new AuthService(database, new FakeWechatLoginProvider());
    familyService = new FamilyService(database);
    personService = new PersonService(database);
    app = await createHttpServer({
      logger: false,
      registerRoutes(server) {
        registerAuthRoutes(server, authService);
        registerFamilyRoutes(server, authService, familyService);
        registerPersonRoutes(server, authService, personService);
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
      name: `${code} 的家族`,
    });
    return { accessToken: login.accessToken, family, user: login.user };
  }

  it("preserves date precision and leaves unknown dates null", async () => {
    const owner = await createOwner("dev_person_dates");
    const person = await personService.create(owner.user.id, owner.family.id, {
      primaryName: "林明",
      birthDate: { value: "1932", precision: "YEAR" },
      deathDate: { value: "2001-06", precision: "MONTH" },
    });

    expect(person.birthDate).toEqual({ value: "1932", precision: "YEAR" });
    expect(person.deathDate).toEqual({
      value: "2001-06",
      precision: "MONTH",
    });
    const unknown = await personService.create(owner.user.id, owner.family.id, {
      primaryName: "林静",
    });
    expect(unknown.birthDate).toBeNull();
    expect(unknown.deathDate).toBeNull();

    const response = await app!.inject({
      method: "GET",
      url: `/api/v1/families/${owner.family.id}/persons/${person.id}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        id: person.id,
        birthDate: { value: "1932", precision: "YEAR" },
      },
    });
  });

  it("rejects invalid calendar values and death before birth", async () => {
    const owner = await createOwner("dev_person_invalid_dates");
    await expect(
      personService.create(owner.user.id, owner.family.id, {
        primaryName: "无效日期",
        birthDate: { value: "2024-02-31", precision: "DAY" },
      }),
    ).rejects.toMatchObject({ code: "PERSON_DATE_INVALID" });
    await expect(
      personService.create(owner.user.id, owner.family.id, {
        primaryName: "日期倒置",
        birthDate: { value: "2000", precision: "YEAR" },
        deathDate: { value: "1999", precision: "YEAR" },
      }),
    ).rejects.toMatchObject({ code: "PERSON_DATE_ORDER_INVALID" });
    const overlappingPrecision = await personService.create(
      owner.user.id,
      owner.family.id,
      {
        primaryName: "同年精度重叠",
        birthDate: { value: "2000-12-31", precision: "DAY" },
        deathDate: { value: "2000", precision: "YEAR" },
      },
    );
    expect(overlappingPrecision.deathDate).toEqual({
      value: "2000",
      precision: "YEAR",
    });
    expect(await database!.person.count()).toBe(1);
  });

  it("requires an explicit label for placeholders without inventing a name", async () => {
    const owner = await createOwner("dev_person_placeholder");
    await expect(
      personService.create(owner.user.id, owner.family.id, {
        isPlaceholder: true,
      }),
    ).rejects.toMatchObject({ code: "PLACEHOLDER_LABEL_REQUIRED" });

    const placeholder = await personService.create(
      owner.user.id,
      owner.family.id,
      {
        isPlaceholder: true,
        placeholderLabel: "林明之父（姓名待考）",
      },
    );
    expect(placeholder).toMatchObject({
      primaryName: "林明之父（姓名待考）",
      isPlaceholder: true,
      placeholderLabel: "林明之父（姓名待考）",
    });
  });

  it("increments versions atomically and rejects stale updates", async () => {
    const owner = await createOwner("dev_person_version");
    const person = await personService.create(owner.user.id, owner.family.id, {
      primaryName: "林初",
    });
    const updated = await personService.update(
      owner.user.id,
      owner.family.id,
      person.id,
      {
        expectedVersion: 1,
        primaryName: "林新",
        birthDate: { value: "1988-03-05", precision: "DAY" },
      },
    );
    expect(updated).toMatchObject({ primaryName: "林新", version: 2 });

    await expect(
      personService.update(owner.user.id, owner.family.id, person.id, {
        expectedVersion: 1,
        summary: "过期写入",
      }),
    ).rejects.toMatchObject({
      code: "PERSON_VERSION_CONFLICT",
      details: { currentVersion: 2 },
    });
  });

  it("soft deletes with actor context and excludes the Person from reads", async () => {
    const owner = await createOwner("dev_person_delete");
    const person = await personService.create(owner.user.id, owner.family.id, {
      primaryName: "待删除人物",
    });
    await personService.delete(
      owner.user.id,
      owner.family.id,
      person.id,
      person.version,
    );

    await expect(
      personService.get(owner.user.id, owner.family.id, person.id),
    ).rejects.toMatchObject({ code: "PERSON_NOT_FOUND" });
    const stored = await database!.person.findUniqueOrThrow({
      where: { id: person.id },
    });
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.deletedBy).toBe(owner.user.id);
    expect(stored.version).toBe(2);
  });

  it("never returns a Person through another Family scope", async () => {
    const owner = await createOwner("dev_person_scope_owner");
    const outsider = await createOwner("dev_person_scope_outsider");
    const person = await personService.create(owner.user.id, owner.family.id, {
      primaryName: "仅本家族可见",
    });

    await expect(
      personService.get(outsider.user.id, owner.family.id, person.id),
    ).rejects.toMatchObject({ code: "FAMILY_NOT_FOUND" });
    await expect(
      personService.get(outsider.user.id, outsider.family.id, person.id),
    ).rejects.toMatchObject({ code: "PERSON_NOT_FOUND" });
  });

  it("enforces placeholder and canonical date rules in PostgreSQL", async () => {
    const owner = await createOwner("dev_person_constraints");
    await expect(
      database!.person.create({
        data: {
          familyId: owner.family.id,
          primaryName: "伪造姓名",
          isPlaceholder: true,
          placeholderLabel: "姓名待考",
          birthDate: new Date("1988-03-02T00:00:00.000Z"),
          birthDatePrecision: "MONTH",
          createdBy: owner.user.id,
        },
      }),
    ).rejects.toBeDefined();
    expect(await database!.person.count()).toBe(0);
  });
});
