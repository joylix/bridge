/**
 * 账号命名规则（SRS V0.7 2.1.2 / 2.1.3）。
 *
 * 约束：
 * - 用户名是登录标识，公开不可见；3–12 位，`^[A-Za-z][A-Za-z0-9_]{2,11}$`；
 * - 昵称是公开显示名；显示宽度 2–12（ASCII=1，汉字/全角=2）；
 * - 两者都用 NFKC 归一化后查重，但保留显示大小写；
 * - 保留名大小写不敏感。
 *
 * 本模块只做纯校验，不查数据库；唯一性由仓储层唯一约束裁决。
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 12;
export const NICKNAME_MIN_WIDTH = 2;
export const NICKNAME_MAX_WIDTH = 12;
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{2,11}$/;
const NICKNAME_PATTERN = /^[\p{L}\p{M}\p{N}_\- ]+$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 保留名与 SRS 附录 B 保持一致；部署时可扩展。 */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'support',
  'system',
  'root',
  'bridge',
  'null',
  'undefined',
]);

export type NameIssue = 'format' | 'reserved';

export type NameCheck =
  | { ok: true; value: string; normalized: string }
  | { ok: false; issue: NameIssue; message: string };

export function normalizeUsername(input: string): string {
  return input.normalize('NFKC').trim().toLowerCase();
}

export function normalizeNickname(input: string): string {
  return input
    .normalize('NFKC')
    .trim()
    .replace(/ {2,}/g, ' ')
    .toLowerCase();
}

export function normalizeEmail(input: string): string {
  return input.normalize('NFKC').trim().toLowerCase();
}

/** 显示宽度：ASCII 1，汉字/全角/其他非 ASCII 2。 */
export function displayWidth(input: string): number {
  let width = 0;
  for (const char of input) {
    width += (char.codePointAt(0) ?? 0) <= 0x7f ? 1 : 2;
  }
  return width;
}

export function validateUsername(input: string): NameCheck {
  const value = input.normalize('NFKC').trim();
  if (!USERNAME_PATTERN.test(value)) {
    return {
      ok: false,
      issue: 'format',
      message: '用户名需为 3–12 位，以字母开头，仅含字母、数字与下划线',
    };
  }
  const normalized = value.toLowerCase();
  if (RESERVED_NAMES.has(normalized)) {
    return { ok: false, issue: 'reserved', message: '该用户名不可用' };
  }
  return { ok: true, value, normalized };
}

export function validateNickname(input: string): NameCheck {
  const value = input.normalize('NFKC').trim().replace(/ {2,}/g, ' ');
  const normalized = value.toLowerCase();

  if (value.length === 0) {
    return { ok: false, issue: 'format', message: '昵称不能为空' };
  }
  if (!NICKNAME_PATTERN.test(value)) {
    return {
      ok: false,
      issue: 'format',
      message: '昵称仅允许中文、字母、数字、下划线、连字符与单个空格',
    };
  }
  if (value.startsWith(' ') || value.endsWith(' ') || value.includes('  ')) {
    return { ok: false, issue: 'format', message: '昵称不允许首尾或连续空格' };
  }
  const width = displayWidth(value);
  if (width < NICKNAME_MIN_WIDTH || width > NICKNAME_MAX_WIDTH) {
    return {
      ok: false,
      issue: 'format',
      message: `昵称显示宽度需为 ${NICKNAME_MIN_WIDTH}–${NICKNAME_MAX_WIDTH}`,
    };
  }
  if (RESERVED_NAMES.has(normalized)) {
    return { ok: false, issue: 'reserved', message: '该昵称不可用' };
  }
  return { ok: true, value, normalized };
}

export function validateEmail(input: string): { ok: true; value: string } | { ok: false; message: string } {
  const value = normalizeEmail(input);
  if (value.length === 0 || value.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(value)) {
    return { ok: false, message: '邮箱格式不合法' };
  }
  return { ok: true, value };
}

export function validatePassword(
  password: string,
  identity: { username?: string; nickname?: string },
): { ok: true } | { ok: false; message: string } {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, message: `密码长度需为 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 位` };
  }
  const folded = password.toLowerCase();
  if (identity.username && folded === identity.username.toLowerCase()) {
    return { ok: false, message: '密码不能与用户名相同' };
  }
  if (identity.nickname && folded === identity.nickname.toLowerCase()) {
    return { ok: false, message: '密码不能与昵称相同' };
  }
  return { ok: true };
}
