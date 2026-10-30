/**
 * 账号 HTTP 端点（SRS V0.7 2.1）。
 *
 * - 注册成功即建立会话（7 天），并返回 HttpOnly Cookie；
 * - 登录支持“记住我”（30 天）；
 * - 登出撤销当前令牌；
 * - `/me` 只返回本人可见字段。
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { toAccountView } from '../../auth/view';
import type { AuthService } from '../../auth/service';
import { clearSessionCookie, serializeSessionCookie } from '../cookies';
import { readSessionToken, requireUser } from './authGuard';

export interface AuthRouteDeps {
  auth: AuthService;
  cookieSecure: boolean;
  now?: () => Date;
}

const registerBody = z
  .object({
    email: z.string().min(1).max(254),
    username: z.string().min(1).max(64),
    nickname: z.string().min(1).max(128),
    password: z.string().min(1).max(256),
  })
  .strict();

const loginBody = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(256),
    rememberMe: z.boolean().optional(),
  })
  .strict();

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const now = deps.now ?? (() => new Date());

  app.post('/api/v1/auth/register', async (request, reply) => {
    const body = registerBody.parse(request.body);
    const result = await deps.auth.register(body);
    const maxAge = Math.max(0, Math.floor((result.expiresAt.getTime() - now().getTime()) / 1000));
    reply
      .code(201)
      .header('set-cookie', serializeSessionCookie(result.token, maxAge, deps.cookieSecure));
    return { account: toAccountView(result.account), expiresAt: result.expiresAt.toISOString() };
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = loginBody.parse(request.body);
    const result = await deps.auth.login(body);
    const maxAge = Math.max(0, Math.floor((result.expiresAt.getTime() - now().getTime()) / 1000));
    reply
      .code(200)
      .header('set-cookie', serializeSessionCookie(result.token, maxAge, deps.cookieSecure));
    return { account: toAccountView(result.account), expiresAt: result.expiresAt.toISOString() };
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    await deps.auth.logout(readSessionToken(request));
    reply.code(204).header('set-cookie', clearSessionCookie(deps.cookieSecure));
    return undefined;
  });

  app.get('/api/v1/auth/me', async (request) => {
    const { account } = await requireUser(request, deps.auth);
    return { account: toAccountView(account) };
  });
}
