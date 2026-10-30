/** 账号对外投影：只返回本人可见字段，绝不包含密码哈希。 */

import type { AccountRecord } from './types';

export interface AccountView {
  userId: string;
  username: string;
  nickname: string;
  email: string;
  role: AccountRecord['role'];
  status: AccountRecord['status'];
  createdAt: string;
  lastLoginAt: string | null;
}

export function toAccountView(account: AccountRecord): AccountView {
  return {
    userId: account.userId,
    username: account.username,
    nickname: account.nickname,
    email: account.email,
    role: account.role,
    status: account.status,
    createdAt: account.createdAt.toISOString(),
    lastLoginAt: account.lastLoginAt ? account.lastLoginAt.toISOString() : null,
  };
}
