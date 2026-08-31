import "dotenv/config";

import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed the database");
}

const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(
    `INSERT INTO app_metadata (key, value)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = CURRENT_TIMESTAMP`,
    ["seed_status", JSON.stringify({ initialized: true })],
  );
} finally {
  await pool.end();
}
