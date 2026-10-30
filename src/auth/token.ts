/**
 * 不透明会话令牌（SRS V0.7 2.1.5）。
 *
 * 客户端只持有随机令牌；服务端只保存 SHA-256 摘要。
 * 这样数据库泄漏不会直接得到可用会话，撤销时删除/标记摘要即可。
 */

import { createHash, randomBytes } from 'node:crypto';

export const SESSION_TOKEN_BYTES = 32;
export const SESSION_COOKIE_NAME = 'bridge_session';
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REMEMBER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface IssuedToken {
  token: string;
  tokenHash: string;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateSessionToken(): IssuedToken {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
}
