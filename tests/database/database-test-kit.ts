import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { Pool, type PoolClient } from "pg";

const execFileAsync = promisify(execFile);

export interface IsolatedDatabase {
  readonly name: string;
  readonly url: string;
  readonly pool: Pool;
  dispose(): Promise<void>;
}

function requireTestDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required and must point to a non-production PostgreSQL maintenance database",
    );
  }
  return databaseUrl;
}

function databaseUrlWithName(connectionString: string, name: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}

async function runPrisma(
  args: readonly string[],
  databaseUrl: string,
): Promise<void> {
  await execFileAsync("npm", ["exec", "prisma", "--", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

export async function createIsolatedDatabase(): Promise<IsolatedDatabase> {
  const adminUrl = requireTestDatabaseUrl();
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString: adminUrl, max: 1 });

  await adminPool.query(`CREATE DATABASE "${name}"`);
  const url = databaseUrlWithName(adminUrl, name);
  const pool = new Pool({ connectionString: url, max: 2 });

  try {
    await runPrisma(["migrate", "deploy"], url);
  } catch (error) {
    await pool.end();
    await adminPool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await adminPool.end();
    throw error;
  }

  return {
    name,
    url,
    pool,
    async dispose() {
      await pool.end();
      await adminPool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await adminPool.end();
    },
  };
}

export async function withRollback<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await operation(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

export async function runSeed(databaseUrl: string): Promise<void> {
  await execFileAsync("npm", ["run", "db:seed"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
