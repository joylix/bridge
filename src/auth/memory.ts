/**
 * 内存仓储：用于单元测试与本地无数据库开发。
 *
 * 行为必须与 PostgreSQL 实现保持一致，尤其是唯一约束冲突要抛
 * `DuplicateAccountError`，不能静默覆盖。
 */

import { randomUUID } from 'node:crypto';
import {
  DuplicateAccountError,
  type AccountRecord,
  type AccountRepository,
  type AuthSessionRecord,
  type AuthSessionRepository,
  type NewAccount,
  type NewAuthSession,
} from './types';

export class InMemoryAccountRepository implements AccountRepository {
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly byUsername = new Map<string, string>();
  private readonly byEmail = new Map<string, string>();
  private readonly byNickname = new Map<string, string>();

  async findById(userId: string): Promise<AccountRecord | null> {
    return this.accounts.get(userId) ?? null;
  }

  async findByUsernameNormalized(usernameNormalized: string): Promise<AccountRecord | null> {
    const userId = this.byUsername.get(usernameNormalized);
    return userId ? (this.accounts.get(userId) ?? null) : null;
  }

  async findByEmailNormalized(emailNormalized: string): Promise<AccountRecord | null> {
    const userId = this.byEmail.get(emailNormalized);
    return userId ? (this.accounts.get(userId) ?? null) : null;
  }

  async findByNicknameNormalized(nicknameNormalized: string): Promise<AccountRecord | null> {
    const userId = this.byNickname.get(nicknameNormalized);
    return userId ? (this.accounts.get(userId) ?? null) : null;
  }

  async create(input: NewAccount): Promise<AccountRecord> {
    const emailKey = input.email.toLowerCase();
    if (this.byEmail.has(emailKey)) throw new DuplicateAccountError('email');
    if (this.byUsername.has(input.usernameNormalized)) throw new DuplicateAccountError('username');
    if (this.byNickname.has(input.nicknameNormalized)) throw new DuplicateAccountError('nickname');

    const account: AccountRecord = {
      userId: randomUUID(),
      email: input.email,
      username: input.username,
      usernameNormalized: input.usernameNormalized,
      nickname: input.nickname,
      nicknameNormalized: input.nicknameNormalized,
      passwordHash: input.passwordHash,
      role: input.role ?? 'user',
      status: 'active',
      nicknameChangeCount: 0,
      createdAt: new Date(),
      lastLoginAt: null,
    };
    this.accounts.set(account.userId, account);
    this.byEmail.set(emailKey, account.userId);
    this.byUsername.set(account.usernameNormalized, account.userId);
    this.byNickname.set(account.nicknameNormalized, account.userId);
    return account;
  }

  async recordLogin(userId: string, at: Date): Promise<void> {
    const account = this.accounts.get(userId);
    if (account) account.lastLoginAt = at;
  }
}

export class InMemoryAuthSessionRepository implements AuthSessionRepository {
  private readonly sessions = new Map<string, AuthSessionRecord>();

  async create(input: NewAuthSession): Promise<void> {
    this.sessions.set(input.tokenHash, {
      tokenHash: input.tokenHash,
      userId: input.userId,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      revokedAt: null,
      lastSeenAt: null,
    });
  }

  async findByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> {
    return this.sessions.get(tokenHash) ?? null;
  }

  async revoke(tokenHash: string, at: Date): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session && session.revokedAt === null) session.revokedAt = at;
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.revokedAt === null) session.revokedAt = at;
    }
  }

  async touch(tokenHash: string, at: Date): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session) session.lastSeenAt = at;
  }
}
