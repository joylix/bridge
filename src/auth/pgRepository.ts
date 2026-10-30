/**
 * 账号与会话的 PostgreSQL 仓储。
 *
 * 唯一约束是并发注册的最终裁决：捕获 23505 并按约束名映射为字段，
 * 不先查询再插入，避免竞态。
 */

import type { Pool } from 'pg';
import {
  DuplicateAccountError,
  type AccountRecord,
  type AccountRepository,
  type AccountRole,
  type AccountStatus,
  type AuthSessionRecord,
  type AuthSessionRepository,
  type DuplicateAccountField,
  type NewAccount,
  type NewAuthSession,
} from './types';

interface AccountRow {
  user_id: string;
  email: string;
  username: string;
  username_normalized: string;
  nickname: string;
  nickname_normalized: string;
  password_hash: string;
  role: string;
  status: string;
  nickname_change_count: number;
  created_at: Date;
  last_login_at: Date | null;
}

interface AuthSessionRow {
  token_hash: string;
  user_id: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  last_seen_at: Date | null;
}

const ACCOUNT_COLUMNS = `
  user_id, email, username, username_normalized, nickname, nickname_normalized,
  password_hash, role, status, nickname_change_count, created_at, last_login_at
`;

function toAccount(row: AccountRow): AccountRecord {
  return {
    userId: row.user_id,
    email: row.email,
    username: row.username,
    usernameNormalized: row.username_normalized,
    nickname: row.nickname,
    nicknameNormalized: row.nickname_normalized,
    passwordHash: row.password_hash,
    role: row.role as AccountRole,
    status: row.status as AccountStatus,
    nicknameChangeCount: row.nickname_change_count,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function toSession(row: AuthSessionRow): AuthSessionRecord {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastSeenAt: row.last_seen_at,
  };
}

function duplicateField(error: unknown): DuplicateAccountField | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as { code?: string; constraint?: string };
  if (code !== '23505' || typeof constraint !== 'string') return null;
  if (constraint.includes('email')) return 'email';
  if (constraint.includes('username')) return 'username';
  if (constraint.includes('nickname')) return 'nickname';
  return null;
}

export class PgAccountRepository implements AccountRepository {
  constructor(private readonly pool: Pool) {}

  async findById(userId: string): Promise<AccountRecord | null> {
    const result = await this.pool.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0] ? toAccount(result.rows[0]) : null;
  }

  async findByUsernameNormalized(usernameNormalized: string): Promise<AccountRecord | null> {
    const result = await this.pool.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE username_normalized = $1`,
      [usernameNormalized],
    );
    return result.rows[0] ? toAccount(result.rows[0]) : null;
  }

  async findByEmailNormalized(emailNormalized: string): Promise<AccountRecord | null> {
    const result = await this.pool.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE email = $1`,
      [emailNormalized],
    );
    return result.rows[0] ? toAccount(result.rows[0]) : null;
  }

  async findByNicknameNormalized(nicknameNormalized: string): Promise<AccountRecord | null> {
    const result = await this.pool.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE nickname_normalized = $1`,
      [nicknameNormalized],
    );
    return result.rows[0] ? toAccount(result.rows[0]) : null;
  }

  async create(input: NewAccount): Promise<AccountRecord> {
    try {
      const result = await this.pool.query<AccountRow>(
        `INSERT INTO accounts (
           email, username, username_normalized, nickname, nickname_normalized,
           password_hash, role
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${ACCOUNT_COLUMNS}`,
        [
          input.email,
          input.username,
          input.usernameNormalized,
          input.nickname,
          input.nicknameNormalized,
          input.passwordHash,
          input.role ?? 'user',
        ],
      );
      return toAccount(result.rows[0]);
    } catch (error) {
      const field = duplicateField(error);
      if (field) throw new DuplicateAccountError(field);
      throw error;
    }
  }

  async recordLogin(userId: string, at: Date): Promise<void> {
    await this.pool.query('UPDATE accounts SET last_login_at = $2, updated_at = now() WHERE user_id = $1', [
      userId,
      at,
    ]);
  }
}

export class PgAuthSessionRepository implements AuthSessionRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: NewAuthSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [input.tokenHash, input.userId, input.createdAt, input.expiresAt],
    );
  }

  async findByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> {
    const result = await this.pool.query<AuthSessionRow>(
      `SELECT token_hash, user_id, created_at, expires_at, revoked_at, last_seen_at
       FROM auth_sessions WHERE token_hash = $1`,
      [tokenHash],
    );
    return result.rows[0] ? toSession(result.rows[0]) : null;
  }

  async revoke(tokenHash: string, at: Date): Promise<void> {
    await this.pool.query(
      'UPDATE auth_sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL',
      [tokenHash, at],
    );
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await this.pool.query(
      'UPDATE auth_sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL',
      [userId, at],
    );
  }

  async touch(tokenHash: string, at: Date): Promise<void> {
    await this.pool.query('UPDATE auth_sessions SET last_seen_at = $2 WHERE token_hash = $1', [
      tokenHash,
      at,
    ]);
  }
}
