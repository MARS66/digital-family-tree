import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createIsolatedDatabase,
  type IsolatedDatabase,
  runSeed,
  withRollback,
} from "./database-test-kit.js";

describe("PostgreSQL migration framework", () => {
  let database: IsolatedDatabase | undefined;

  beforeEach(async () => {
    database = await createIsolatedDatabase();
  }, 30_000);

  afterEach(async () => {
    await database?.dispose();
    database = undefined;
  });

  it("upgrades an empty database to the latest migration and seeds idempotently", async () => {
    const relation = await database!.pool.query<{ name: string | null }>(
      "SELECT to_regclass('public.app_metadata')::text AS name",
    );
    expect(relation.rows[0]?.name).toBe("app_metadata");

    await runSeed(database!.url);
    await runSeed(database!.url);

    const metadata = await database!.pool.query<{ value: unknown }>(
      "SELECT value FROM app_metadata WHERE key = $1",
      ["seed_status"],
    );
    expect(metadata.rows).toEqual([{ value: { initialized: true } }]);
  }, 30_000);

  it("enforces the metadata key unique constraint in PostgreSQL", async () => {
    await database!.pool.query(
      "INSERT INTO app_metadata (key, value) VALUES ($1, $2::jsonb)",
      ["unique_key", "{}"],
    );

    await expect(
      database!.pool.query(
        "INSERT INTO app_metadata (key, value) VALUES ($1, $2::jsonb)",
        ["unique_key", "{}"],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("rolls test transactions back between assertions", async () => {
    await withRollback(database!.pool, async (client) => {
      await client.query(
        "INSERT INTO app_metadata (key, value) VALUES ($1, $2::jsonb)",
        ["rolled_back", "{}"],
      );
    });

    const result = await database!.pool.query(
      "SELECT key FROM app_metadata WHERE key = $1",
      ["rolled_back"],
    );
    expect(result.rowCount).toBe(0);
  });
});
