/**
 * 执行数据库迁移：`npm run db:migrate`
 * 需要环境变量 `DATABASE_URL`。
 */

import { runMigrations } from '../src/db/migrate';
import { loadConfig } from '../src/server/config';

const config = loadConfig();
const applied = await runMigrations(config.databaseUrl);

if (applied.length === 0) {
  console.log('数据库已是最新，无迁移执行。');
} else {
  console.log(`已执行迁移：${applied.join(', ')}`);
}
