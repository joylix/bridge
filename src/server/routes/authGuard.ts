/**
 * HTTP 鉴权守卫。
 *
 * 优先读取 `Authorization: Bearer`，其次读取会话 Cookie；两者都走同一个
 * `AuthService.authenticate`，不信任客户端自报的 userId/role。
 */

import type { FastifyRequest } from 'fastify';
import { SESSION_COOKIE_NAME } from '../../auth/token';
import type { AuthService, AuthenticatedUser } from '../../auth/service';
import { parseCookieHeader } from '../cookies';

export function readSessionToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    if (token) return token;
  }
  return parseCookieHeader(request.headers.cookie)[SESSION_COOKIE_NAME];
}

export async function requireUser(
  request: FastifyRequest,
  auth: AuthService,
): Promise<AuthenticatedUser> {
  return auth.authenticate(readSessionToken(request));
}
