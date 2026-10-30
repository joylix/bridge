import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES } from '../shared/errors';
import { InMemoryAccountRepository, InMemoryAuthSessionRepository } from './memory';
import type { PasswordHasher } from './password';
import { AuthService, type RegisterInput } from './service';
import { DEFAULT_SESSION_TTL_MS, REMEMBER_SESSION_TTL_MS } from './token';

/** 测试用快速哈希：真实 scrypt 行为由 password.test.ts 覆盖。 */
const testHasher: PasswordHasher = {
  async hash(password) {
    return `test$${password}`;
  },
  async verify(password, stored) {
    return stored === `test$${password}`;
  },
};

const START = new Date('2026-10-28T00:00:00Z');

function setup() {
  let current = START;
  const accounts = new InMemoryAccountRepository();
  const sessions = new InMemoryAuthSessionRepository();
  const service = new AuthService({
    accounts,
    sessions,
    hasher: testHasher,
    now: () => current,
  });
  return {
    accounts,
    sessions,
    service,
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };
}

function registration(overrides: Partial<RegisterInput> = {}): RegisterInput {
  return {
    email: 'alice@example.com',
    username: 'Alice_01',
    nickname: '小明',
    password: 'password-1',
    ...overrides,
  };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe('注册', () => {
  it('创建账号、归一化命名并建立 7 天会话', async () => {
    const { service } = setup();
    const result = await service.register(registration());

    expect(result.account).toMatchObject({
      email: 'alice@example.com',
      username: 'Alice_01',
      usernameNormalized: 'alice_01',
      nickname: '小明',
      nicknameNormalized: '小明',
      role: 'user',
      status: 'active',
    });
    expect(result.token).toHaveLength(43);
    expect(result.expiresAt.getTime()).toBe(START.getTime() + DEFAULT_SESSION_TTL_MS);
  });

  it('邮箱、用户名、昵称分别由唯一约束裁决', async () => {
    const { service } = setup();
    await service.register(registration());

    await expectCode(
      service.register(registration({ email: 'other@example.com' })),
      ERROR_CODES.USERNAME_TAKEN,
    );
    await expectCode(
      service.register(registration({ username: 'Alice_02' })),
      ERROR_CODES.EMAIL_TAKEN,
    );
    await expectCode(
      service.register(
        registration({ username: 'Alice_03', email: 'third@example.com', nickname: '小明' }),
      ),
      ERROR_CODES.NICKNAME_TAKEN,
    );
  });

  it('拒绝非法字段并返回 SRS 错误码', async () => {
    const { service } = setup();
    await expectCode(
      service.register(registration({ username: 'ab' })),
      ERROR_CODES.USERNAME_INVALID,
    );
    await expectCode(
      service.register(registration({ username: 'admin' })),
      ERROR_CODES.USERNAME_RESERVED,
    );
    await expectCode(
      service.register(registration({ nickname: '桥牌😀' })),
      ERROR_CODES.NICKNAME_INVALID,
    );
    await expectCode(
      service.register(registration({ nickname: 'admin' })),
      ERROR_CODES.NICKNAME_RESERVED,
    );
    await expectCode(
      service.register(registration({ password: 'short' })),
      ERROR_CODES.PASSWORD_INVALID,
    );
    await expectCode(
      service.register(registration({ email: 'bad-email' })),
      ERROR_CODES.EMAIL_INVALID,
    );
  });
});

describe('登录与会话', () => {
  it('用户名大小写不敏感，记住我延长到 30 天', async () => {
    const { service } = setup();
    await service.register(registration());

    const normal = await service.login({ username: 'alice_01', password: 'password-1' });
    expect(normal.expiresAt.getTime()).toBe(START.getTime() + DEFAULT_SESSION_TTL_MS);

    const remembered = await service.login({
      username: 'ALICE_01',
      password: 'password-1',
      rememberMe: true,
    });
    expect(remembered.expiresAt.getTime()).toBe(START.getTime() + REMEMBER_SESSION_TTL_MS);
  });

  it('未知用户与错误密码统一返回 INVALID_CREDENTIALS', async () => {
    const { service } = setup();
    await service.register(registration());

    await expectCode(
      service.login({ username: 'nobody', password: 'password-1' }),
      ERROR_CODES.INVALID_CREDENTIALS,
    );
    await expectCode(
      service.login({ username: 'Alice_01', password: 'wrong-pass' }),
      ERROR_CODES.INVALID_CREDENTIALS,
    );
  });

  it('封禁与删除账号按状态拒绝', async () => {
    const { service } = setup();
    const { account } = await service.register(registration());

    account.status = 'suspended';
    await expectCode(
      service.login({ username: 'Alice_01', password: 'password-1' }),
      ERROR_CODES.ACCOUNT_SUSPENDED,
    );

    account.status = 'deleted';
    await expectCode(
      service.login({ username: 'Alice_01', password: 'password-1' }),
      ERROR_CODES.INVALID_CREDENTIALS,
    );
  });

  it('会话可校验、登出后失效、过期后失效', async () => {
    const { service, advance } = setup();
    const { token } = await service.register(registration());

    const authenticated = await service.authenticate(token);
    expect(authenticated.account.username).toBe('Alice_01');

    await service.logout(token);
    await expectCode(service.authenticate(token), ERROR_CODES.AUTH_REQUIRED);

    const second = await service.login({ username: 'Alice_01', password: 'password-1' });
    advance(DEFAULT_SESSION_TTL_MS + 1);
    await expectCode(service.authenticate(second.token), ERROR_CODES.AUTH_REQUIRED);
  });

  it('缺少令牌返回 AUTH_REQUIRED', async () => {
    const { service } = setup();
    await expectCode(service.authenticate(undefined), ERROR_CODES.AUTH_REQUIRED);
    await expectCode(service.authenticate('not-a-token'), ERROR_CODES.AUTH_REQUIRED);
  });
});
