/**
 * 服务端配置。
 *
 * 所有值来自环境变量，缺省值只适用于本机开发；生产部署必须显式注入
 * `DATABASE_URL` 与 `WS_ALLOWED_ORIGINS`。
 */

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface ServerConfig {
  host: string;
  port: number;
  databaseUrl: string;
  logLevel: LogLevel;
  /** 转播释放：副结束后至少等待的毫秒数（SRS 6.7.4 默认 30s）。 */
  spectatorDelayMs: number;
  /** 允许的 WS Origin；为空表示本机开发放行。 */
  wsAllowedOrigins: string[];
  /** 生产环境应开启；本地 HTTP 开发关闭。 */
  cookieSecure: boolean;
}

const LOG_LEVELS: readonly LogLevel[] = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
];

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 3000;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error('PORT 必须是 0–65535 的整数');
  }
  return value;
}

function parseDelay(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 30_000;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('SPECTATOR_DELAY_MS 必须是非负整数');
  }
  return value;
}

function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined || raw === '') return 'info';
  if (!LOG_LEVELS.includes(raw as LogLevel)) {
    throw new Error(`LOG_LEVEL 必须是 ${LOG_LEVELS.join(' / ')}`);
  }
  return raw as LogLevel;
}

function parseOrigins(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error('COOKIE_SECURE 必须是 true/false/1/0');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.HOST ?? '127.0.0.1',
    port: parsePort(env.PORT),
    databaseUrl: env.DATABASE_URL ?? 'postgres://bridge:bridge@localhost:5432/bridge',
    logLevel: parseLogLevel(env.LOG_LEVEL),
    spectatorDelayMs: parseDelay(env.SPECTATOR_DELAY_MS),
    wsAllowedOrigins: parseOrigins(env.WS_ALLOWED_ORIGINS),
    cookieSecure: parseBoolean(env.COOKIE_SECURE, env.NODE_ENV === 'production'),
  };
}
