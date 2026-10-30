/**
 * 账号与会话的领域类型及仓储接口。
 *
 * 服务层只依赖接口；测试使用内存实现，生产使用 PostgreSQL 实现。
 * 唯一性由仓储层（数据库唯一约束）裁决，服务层不得“先查后写”。
 */

export type AccountRole = 'user' | 'admin';
export type AccountStatus = 'active' | 'suspended' | 'deleted';

export interface AccountRecord {
  userId: string;
  email: string;
  username: string;
  usernameNormalized: string;
  nickname: string;
  nicknameNormalized: string;
  passwordHash: string;
  role: AccountRole;
  status: AccountStatus;
  nicknameChangeCount: number;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface NewAccount {
  email: string;
  username: string;
  usernameNormalized: string;
  nickname: string;
  nicknameNormalized: string;
  passwordHash: string;
  role?: AccountRole;
}

export type DuplicateAccountField = 'email' | 'username' | 'nickname';

export class DuplicateAccountError extends Error {
  readonly field: DuplicateAccountField;

  constructor(field: DuplicateAccountField) {
    super(`账号字段重复: ${field}`);
    this.name = 'DuplicateAccountError';
    this.field = field;
  }
}

export interface AccountRepository {
  findById(userId: string): Promise<AccountRecord | null>;
  findByUsernameNormalized(usernameNormalized: string): Promise<AccountRecord | null>;
  findByEmailNormalized(emailNormalized: string): Promise<AccountRecord | null>;
  findByNicknameNormalized(nicknameNormalized: string): Promise<AccountRecord | null>;
  /** 唯一约束冲突时抛出 `DuplicateAccountError`。 */
  create(input: NewAccount): Promise<AccountRecord>;
  recordLogin(userId: string, at: Date): Promise<void>;
}

export interface AuthSessionRecord {
  tokenHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
}

export interface NewAuthSession {
  tokenHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface AuthSessionRepository {
  create(input: NewAuthSession): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null>;
  revoke(tokenHash: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<void>;
  touch(tokenHash: string, at: Date): Promise<void>;
}
