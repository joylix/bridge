/**
 * PostgreSQL 连接池。应用启动时创建一次，关闭时释放。
 */

import { Pool } from 'pg';

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
