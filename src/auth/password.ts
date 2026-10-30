/**
 * 密码哈希（SRS V0.7 2.1.1 第 4 条）。
 *
 * 使用 Node 内置 scrypt，避免额外原生依赖：
 * - 每个密码独立 16 字节盐；
 * - 参数随哈希一起保存，便于未来升级；
 * - 校验使用 timingSafeEqual，避免逐字节比较泄漏。
 *
 * 存储格式：`scrypt$N$r$p$saltBase64Url$keyBase64Url`。
 * 密码本身不做 NFKC 归一化，避免不同密码被折叠成同一个。
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_MEMORY = 64 * 1024 * 1024;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
}

async function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      { N: n, r, p, maxmem: MAX_MEMORY },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n <= 1 || r <= 0 || p <= 0) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], 'base64url');
    expected = Buffer.from(parts[5], 'base64url');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;

  try {
    const actual = await derive(password, salt, n, r, p);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export const defaultPasswordHasher: PasswordHasher = {
  hash: hashPassword,
  verify: verifyPassword,
};
