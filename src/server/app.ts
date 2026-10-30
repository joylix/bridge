/**
 * Fastify 应用骨架（M5）。
 *
 * 当前只提供健康检查、版本元数据与统一错误信封；业务命令通过 WS 进入，
 * HTTP 业务端点随 M6/M7 逐步加入。所有响应不得回显未授权字段。
 */

import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { WBF_2017_VERSION } from '../core/impTable';
import { RECORD_SCHEMA_VERSION } from '../exchange/record';
import type { AuthService } from '../auth/service';
import type { RoomService } from '../rooms/service';
import type { SessionService } from '../sessions/service';
import { AppError, ERROR_CODES, isAppError, toErrorEnvelope } from '../shared/errors';
import { PROTOCOL_VERSION } from '../shared/protocol';
import type { LogLevel } from './config';
import { registerAuthRoutes } from './routes/auth';
import { registerRoomRoutes } from './routes/rooms';
import { registerSessionRoutes } from './routes/sessions';

export const SERVER_NAME = 'bridge-server';
export const EVENT_SCHEMA_VERSION = '1.0';

export interface ReadinessResult {
  ok: boolean;
  checks: Record<string, string>;
}

export interface BuildAppOptions {
  logger?: boolean | { level: LogLevel };
  /** 生产环境注入数据库/依赖检查；缺省视为“无外部依赖”。 */
  readiness?: () => Promise<ReadinessResult>;
  version?: string;
  now?: () => Date;
  /** 账号服务；缺省时不注册账号/牌室 HTTP 端点。 */
  auth?: AuthService;
  /** 牌室服务；必须与 auth 同时提供。 */
  rooms?: RoomService;
  /** Session 服务；必须与 auth 同时提供。 */
  sessions?: SessionService;
  /** 生产环境应设为 true，Cookie 加 Secure。 */
  cookieSecure?: boolean;
}

function isSafeRequestId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const now = options.now ?? (() => new Date());
  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: (request) => {
      const header = request.headers['x-request-id'];
      if (typeof header === 'string' && isSafeRequestId(header)) return header;
      return randomUUID();
    },
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.get('/healthz', async () => ({
    status: 'ok',
    server: SERVER_NAME,
    serverTime: now().toISOString(),
  }));

  app.get('/readyz', async (_request, reply) => {
    if (!options.readiness) {
      return { status: 'ok', checks: {} };
    }
    const result = await options.readiness();
    reply.code(result.ok ? 200 : 503);
    return { status: result.ok ? 'ok' : 'degraded', checks: result.checks };
  });

  app.get('/api/v1/meta', async () => ({
    server: SERVER_NAME,
    version: options.version ?? '0.1.0',
    protocolVersion: PROTOCOL_VERSION,
    recordSchemaVersion: RECORD_SCHEMA_VERSION,
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    rulesVersion: 'wbf-laws-2017',
    impTableVersion: WBF_2017_VERSION,
    serverTime: now().toISOString(),
  }));

  if (options.auth) {
    registerAuthRoutes(app, {
      auth: options.auth,
      cookieSecure: options.cookieSecure ?? false,
      now,
    });
  }
  if (options.rooms) {
    if (!options.auth) {
      throw new Error('注册牌室路由需要 AuthService');
    }
    registerRoomRoutes(app, { auth: options.auth, rooms: options.rooms });
  }
  if (options.sessions) {
    if (!options.auth) {
      throw new Error('注册 Session 路由需要 AuthService');
    }
    registerSessionRoutes(app, { auth: options.auth, sessions: options.sessions });
  }

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: {
        code: ERROR_CODES.NOT_FOUND,
        message: '资源不存在',
        requestId: request.id,
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    let normalized: unknown = error;
    if (error instanceof ZodError) {
      normalized = new AppError(ERROR_CODES.VALIDATION_FAILED, '请求参数不合法');
    } else if (!isAppError(error) && (error as { validation?: unknown }).validation) {
      // Fastify 的 schema 校验错误统一收敛，不把原始值写进响应。
      normalized = new AppError(ERROR_CODES.VALIDATION_FAILED, '请求参数不合法');
    }
    const { status, body } = toErrorEnvelope(normalized, request.id);
    void reply.code(status).send(body);
  });

  return app;
}
