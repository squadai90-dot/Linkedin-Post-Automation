/* Postgres pool + a minimal migration runner. Plain SQL — the surface is
   seven tables; an ORM would outweigh the whole server. */

import { Pool } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  // Railway Postgres requires TLS from outside its private network.
  ssl: process.env.DATABASE_URL?.includes("railway") ? { rejectUnauthorized: false } : undefined,
});

export const q = <T = any>(text: string, params?: unknown[]) =>
  pool.query(text, params as any[]).then((r) => r.rows as T[]);

export async function migrate(dir: string) {
  await pool.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const applied = new Set(
    (await q<{ name: string }>("select name from schema_migrations")).map((r) => r.name),
  );
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(path.join(dir, f), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [f]);
      await client.query("commit");
      console.log(`migrated: ${f}`);
    } catch (err) {
      await client.query("rollback");
      throw new Error(`migration ${f} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
}
