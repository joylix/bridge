/**
 * 服务端入口。
 *
 * 启动：`npm run server:dev`（tsx watch）或 `npm run server:start`。
 * 数据库迁移：`npm run db:migrate`。
 */

import { PgAccountRepository, PgAuthSessionRepository } from '../auth/pgRepository';
import { AuthService } from '../auth/service';
import { createPool } from '../db/client';
import { PgRoomRepository } from '../rooms/pgRepository';
import { RoomService } from '../rooms/service';
import { PgSessionRepository } from '../sessions/pgRepository';
import { SessionService } from '../sessions/service';
import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const pool = createPool(config.databaseUrl);

const auth = new AuthService({
  accounts: new PgAccountRepository(pool),
  sessions: new PgAuthSessionRepository(pool),
});
const roomRepository = new PgRoomRepository(pool);
const rooms = new RoomService({ rooms: roomRepository });
const sessions = new SessionService({
  sessions: new PgSessionRepository(pool),
  rooms: roomRepository,
});

const app = await buildApp({
  logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
  auth,
  rooms,
  sessions,
  cookieSecure: config.cookieSecure,
  readiness: async () => {
    try {
      await pool.query('SELECT 1');
      return { ok: true, checks: { database: 'ok' } };
    } catch {
      return { ok: false, checks: { database: 'unreachable' } };
    }
  },
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
