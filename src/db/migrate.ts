/**
 * 最小迁移执行器：按文件名顺序执行 `src/db/migrations/*.sql`。
 *
 * 不引入迁移框架：M5 只有一个初始 Schema，显式 SQL 更利于审查唯一约束。
 * 每个文件在独立事务内执行，成功后才写入 `schema_migrations`。
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

export const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

export async function runMigrations(
  databaseUrl: string,
  directory: string = MIGRATIONS_DIR,
): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(directory))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [
        file,
      ]);
      if ((existing.rowCount ?? 0) > 0) continue;

      const sql = await readFile(join(directory, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return applied;
  } finally {
    await client.end();
  }
}
