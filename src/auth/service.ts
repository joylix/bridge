/**
 * 注册、登录、登出与会话校验（SRS V0.7 2.1）。
 *
 * 安全约定：
 * - 登录失败统一返回 `INVALID_CREDENTIALS`，不区分“用户不存在”与“密码错误”；
 * - 用户不存在时也执行一次密码哈希，降低时序侧信道；
 * - 数据库只保存会话令牌摘要；
 * - 所有状态判断以服务端持久化数据为准。
 */

import {
  validateEmail,
  validateNickname,
  validatePassword,
  validateUsername,
  normalizeUsername,
} from '../domain/account/naming';
import { AppError, ERROR_CODES } from '../shared/errors';
import { defaultPasswordHasher, type PasswordHasher } from './password';
import {
  DEFAULT_SESSION_TTL_MS,
  REMEMBER_SESSION_TTL_MS,
  generateSessionToken,
  hashSessionToken,
} from './token';
import {
  DuplicateAccountError,
  type AccountRecord,
  type AccountRepository,
  type AuthSessionRecord,
  type AuthSessionRepository,
} from './types';

export interface AuthServiceOptions {
  accounts: AccountRepository;
  sessions: AuthSessionRepository;
  hasher?: PasswordHasher;
  now?: () => Date;
  sessionTtlMs?: number;
  rememberTtlMs?: number;
}

export interface RegisterInput {
  email: string;
  username: string;
  nickname: string;
  password: string;
}

export interface LoginInput {
  username: string;
  password: string;
  rememberMe?: boolean;
}

export interface AuthResult {
  account: AccountRecord;
  token: string;
  expiresAt: Date;
}

export interface AuthenticatedUser {
  account: AccountRecord;
  session: AuthSessionRecord;
}

export class AuthService {
  private readonly accounts: AccountRepository;
  private readonly sessions: AuthSessionRepository;
  private readonly hasher: PasswordHasher;
  private readonly now: () => Date;
  private readonly sessionTtlMs: number;
  private readonly rememberTtlMs: number;

  constructor(options: AuthServiceOptions) {
    this.accounts = options.accounts;
    this.sessions = options.sessions;
    this.hasher = options.hasher ?? defaultPasswordHasher;
    this.now = options.now ?? (() => new Date());
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.rememberTtlMs = options.rememberTtlMs ?? REMEMBER_SESSION_TTL_MS;
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const email = validateEmail(input.email);
    if (!email.ok) throw new AppError(ERROR_CODES.EMAIL_INVALID, email.message);

    const username = validateUsername(input.username);
    if (!username.ok) {
      throw new AppError(
        username.issue === 'reserved' ? ERROR_CODES.USERNAME_RESERVED : ERROR_CODES.USERNAME_INVALID,
        username.message,
      );
    }

    const nickname = validateNickname(input.nickname);
    if (!nickname.ok) {
      throw new AppError(
        nickname.issue === 'reserved' ? ERROR_CODES.NICKNAME_RESERVED : ERROR_CODES.NICKNAME_INVALID,
        nickname.message,
      );
    }

    const password = validatePassword(input.password, {
      username: username.value,
      nickname: nickname.value,
    });
    if (!password.ok) throw new AppError(ERROR_CODES.PASSWORD_INVALID, password.message);

    const passwordHash = await this.hasher.hash(input.password);

    let account: AccountRecord;
    try {
      account = await this.accounts.create({
        email: email.value,
        username: username.value,
        usernameNormalized: username.normalized,
        nickname: nickname.value,
        nicknameNormalized: nickname.normalized,
        passwordHash,
      });
    } catch (error) {
      if (error instanceof DuplicateAccountError) {
        const code =
          error.field === 'email'
            ? ERROR_CODES.EMAIL_TAKEN
            : error.field === 'username'
              ? ERROR_CODES.USERNAME_TAKEN
              : ERROR_CODES.NICKNAME_TAKEN;
        throw new AppError(code, '该名称或邮箱已被使用');
      }
      throw error;
    }

    const issued = await this.issueSession(account, false);
    return { account, ...issued };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const normalized = normalizeUsername(input.username);
    const account = normalized
      ? await this.accounts.findByUsernameNormalized(normalized)
      : null;

    if (!account) {
      // 与真实校验保持近似耗时，避免通过响应时间枚举用户名。
      await this.hasher.hash(input.password);
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, '用户名或密码错误');
    }

    const passwordOk = await this.hasher.verify(input.password, account.passwordHash);
    if (!passwordOk) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, '用户名或密码错误');
    }
    if (account.status === 'deleted') {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, '用户名或密码错误');
    }
    if (account.status === 'suspended') {
      throw new AppError(ERROR_CODES.ACCOUNT_SUSPENDED, '账号已被封禁');
    }

    const issued = await this.issueSession(account, input.rememberMe === true);
    await this.accounts.recordLogin(account.userId, this.now());
    return { account, ...issued };
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.sessions.revoke(hashSessionToken(token), this.now());
  }

  async authenticate(token: string | undefined): Promise<AuthenticatedUser> {
    if (!token) throw new AppError(ERROR_CODES.AUTH_REQUIRED, '请先登录');

    const tokenHash = hashSessionToken(token);
    const session = await this.sessions.findByTokenHash(tokenHash);
    if (!session || session.revokedAt !== null) {
      throw new AppError(ERROR_CODES.AUTH_REQUIRED, '登录状态已失效');
    }
    if (session.expiresAt.getTime() <= this.now().getTime()) {
      throw new AppError(ERROR_CODES.AUTH_REQUIRED, '登录状态已失效');
    }

    const account = await this.accounts.findById(session.userId);
    if (!account || account.status === 'deleted') {
      throw new AppError(ERROR_CODES.AUTH_REQUIRED, '登录状态已失效');
    }
    if (account.status === 'suspended') {
      throw new AppError(ERROR_CODES.ACCOUNT_SUSPENDED, '账号已被封禁');
    }

    return { account, session };
  }

  private async issueSession(
    account: AccountRecord,
    rememberMe: boolean,
  ): Promise<{ token: string; expiresAt: Date }> {
    const now = this.now();
    const ttl = rememberMe ? this.rememberTtlMs : this.sessionTtlMs;
    const expiresAt = new Date(now.getTime() + ttl);
    const { token, tokenHash } = generateSessionToken();
    await this.sessions.create({
      tokenHash,
      userId: account.userId,
      createdAt: now,
      expiresAt,
    });
    return { token, expiresAt };
  }
}
