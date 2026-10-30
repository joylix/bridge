/**
 * Session HTTP 端点（SRS V0.7 3.5 / 5.1 / 5.2 / 5.5）。
 *
 * 当前切片：
 * - 创建 / 复用准备中的 Session；
 * - 读取 Session 与开局前置报告；
 * - 取消准备中的 Session。
 *
 * 真正的开局（starting → playing、AI 补位、发牌）在后续切片实现。
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../../auth/service';
import type { SessionService } from '../../sessions/service';
import { requireUser } from './authGuard';

export interface SessionRouteDeps {
  auth: AuthService;
  sessions: SessionService;
}

const roomIdParams = z.object({ roomId: z.uuid() }).strict();
const sessionIdParams = z.object({ sessionId: z.uuid() }).strict();

export function registerSessionRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  app.post('/api/v1/rooms/:roomId/sessions', async (request, reply) => {
    const { account } = await requireUser(request, deps.auth);
    const { roomId } = roomIdParams.parse(request.params);
    const session = await deps.sessions.create(
      { userId: account.userId, role: account.role },
      roomId,
    );
    reply.code(201);
    return { session };
  });

  app.get('/api/v1/rooms/:roomId/sessions', async (request) => {
    const { account } = await requireUser(request, deps.auth);
    const { roomId } = roomIdParams.parse(request.params);
    const sessions = await deps.sessions.list(
      { userId: account.userId, role: account.role },
      roomId,
    );
    return { sessions };
  });

  app.get('/api/v1/sessions/:sessionId', async (request) => {
    const { account } = await requireUser(request, deps.auth);
    const { sessionId } = sessionIdParams.parse(request.params);
    const session = await deps.sessions.get(
      { userId: account.userId, role: account.role },
      sessionId,
    );
    return { session };
  });

  app.get('/api/v1/sessions/:sessionId/precheck', async (request) => {
    const { account } = await requireUser(request, deps.auth);
    const { sessionId } = sessionIdParams.parse(request.params);
    const report = await deps.sessions.precheck(
      { userId: account.userId, role: account.role },
      sessionId,
    );
    return { report };
  });

  app.post('/api/v1/sessions/:sessionId/abort', async (request) => {
    const { account } = await requireUser(request, deps.auth);
    const { sessionId } = sessionIdParams.parse(request.params);
    const session = await deps.sessions.abort(
      { userId: account.userId, role: account.role },
      sessionId,
    );
    return { session };
  });
}
