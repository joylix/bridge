// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app';
import { InMemoryAccountRepository, InMemoryAuthSessionRepository } from '../../auth/memory';
import type { PasswordHasher } from '../../auth/password';
import { AuthService } from '../../auth/service';
import { InMemoryRoomRepository, RoomService } from '../../rooms/service';

const NOW = new Date('2026-10-28T12:00:00Z');

const testHasher: PasswordHasher = {
  async hash(password) {
    return `test$${password}`;
  },
  async verify(password, stored) {
    return stored === `test$${password}`;
  },
};

interface Harness {
  app: FastifyInstance;
  accounts: InMemoryAccountRepository;
  sessions: InMemoryAuthSessionRepository;
}

async function buildTestApp(cookieSecure = false): Promise<Harness> {
  const accounts = new InMemoryAccountRepository();
  const sessions = new InMemoryAuthSessionRepository();
  const auth = new AuthService({ accounts, sessions, hasher: testHasher, now: () => NOW });
  const rooms = new RoomService({
    rooms: new InMemoryRoomRepository(),
    hasher: testHasher,
  });
  const app = await buildApp({ auth, rooms, cookieSecure, now: () => NOW });
  return { app, accounts, sessions };
}

function sessionCookie(response: LightMyRequestResponse): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) throw new Error('响应没有 set-cookie');
  return header.split(';')[0];
}

async function register(
  app: FastifyInstance,
  overrides: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email: 'alice@example.com',
      username: 'Alice_01',
      nickname: '小明',
      password: 'password-1',
      ...overrides,
    },
  });
}

describe('账号 HTTP 端点', () => {
  it('注册返回账号与 HttpOnly Cookie，/me 可读取本人资料', async () => {
    const { app } = await buildTestApp();
    const response = await register(app);
    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body.account).toMatchObject({
      username: 'Alice_01',
      nickname: '小明',
      email: 'alice@example.com',
      role: 'user',
      status: 'active',
    });
    expect(body.account).not.toHaveProperty('passwordHash');

    const cookieHeader = response.headers['set-cookie'];
    const header = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
    expect(header).toContain('bridge_session=');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Max-Age=604800');

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: sessionCookie(response) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().account.username).toBe('Alice_01');
    await app.close();
  });

  it('未登录访问 /me 返回 AUTH_REQUIRED', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTH_REQUIRED');
    await app.close();
  });

  it('重复用户名返回 409 USERNAME_TAKEN', async () => {
    const { app } = await buildTestApp();
    await register(app);
    const duplicate = await register(app, {
      email: 'other@example.com',
      nickname: '小红',
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('USERNAME_TAKEN');
    await app.close();
  });

  it('登录失败统一 401，记住我返回 30 天 Cookie', async () => {
    const { app } = await buildTestApp();
    await register(app);

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'Alice_01', password: 'wrong-pass' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('INVALID_CREDENTIALS');

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'alice_01', password: 'password-1', rememberMe: true },
    });
    expect(login.statusCode).toBe(200);
    const cookieHeader = login.headers['set-cookie'];
    const header = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
    expect(header).toContain('Max-Age=2592000');

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${sessionCookie(login).split('=')[1]}` },
    });
    expect(me.statusCode).toBe(200);
    await app.close();
  });

  it('登出撤销会话并清除 Cookie', async () => {
    const { app } = await buildTestApp();
    const registered = await register(app);
    const cookie = sessionCookie(registered);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers['set-cookie']).toContain('Max-Age=0');

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie },
    });
    expect(me.statusCode).toBe(401);
    await app.close();
  });

  it('cookieSecure 开启时 Cookie 带 Secure', async () => {
    const { app } = await buildTestApp(true);
    const response = await register(app);
    const cookieHeader = response.headers['set-cookie'];
    const header = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
    expect(header).toContain('Secure');
    await app.close();
  });
});

describe('牌室 HTTP 端点', () => {
  it('未登录不能创建牌室', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      payload: { name: '练习房', roomNature: 'practice', gameplay: 'single' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTH_REQUIRED');
    await app.close();
  });

  it('创建牌室并出现在公开列表', async () => {
    const { app } = await buildTestApp();
    const cookie = sessionCookie(await register(app));

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      headers: { cookie },
      payload: { name: '周五练习房', roomNature: 'practice', gameplay: 'single' },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room;
    expect(room).toMatchObject({
      name: '周五练习房',
      roomNature: 'practice',
      status: 'waiting',
      isPrivate: false,
      hasPassword: false,
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/rooms',
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().rooms.map((item: { roomId: string }) => item.roomId)).toContain(room.roomId);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/rooms/${room.roomId}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().room.roomId).toBe(room.roomId);
    await app.close();
  });

  it('私有牌室不进入列表，非室主读取返回 404', async () => {
    const { app } = await buildTestApp();
    const ownerCookie = sessionCookie(await register(app));
    const otherCookie = sessionCookie(
      await register(app, {
        email: 'bob@example.com',
        username: 'Bob_01',
        nickname: '小红',
      }),
    );

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      headers: { cookie: ownerCookie },
      payload: {
        name: '私有房',
        roomNature: 'competitive',
        gameplay: 'teams',
        password: 'room-pass',
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room;
    expect(room.isPrivate).toBe(true);
    expect(room.hasPassword).toBe(true);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/rooms',
      headers: { cookie: otherCookie },
    });
    expect(list.json().rooms).toHaveLength(0);

    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/v1/rooms/${room.roomId}`,
      headers: { cookie: otherCookie },
    });
    expect(forbidden.statusCode).toBe(404);

    const owner = await app.inject({
      method: 'GET',
      url: `/api/v1/rooms/${room.roomId}`,
      headers: { cookie: ownerCookie },
    });
    expect(owner.statusCode).toBe(200);
    await app.close();
  });

  it('非法房间性质与非法 roomId 返回 400 VALIDATION_FAILED', async () => {
    const { app } = await buildTestApp();
    const cookie = sessionCookie(await register(app));

    const badNature = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      headers: { cookie },
      payload: { name: '练习房', roomNature: 'ranked', gameplay: 'single' },
    });
    expect(badNature.statusCode).toBe(400);
    expect(badNature.json().error.code).toBe('VALIDATION_FAILED');

    const badId = await app.inject({
      method: 'GET',
      url: '/api/v1/rooms/not-a-uuid',
      headers: { cookie },
    });
    expect(badId.statusCode).toBe(400);
    await app.close();
  });
});

describe('牌室成员与座位 HTTP 端点', () => {
  async function createRoom(app: FastifyInstance, cookie: string, payload: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      headers: { cookie },
      payload: { name: '周五练习房', roomNature: 'practice', gameplay: 'single', ...payload },
    });
    expect(response.statusCode).toBe(201);
    return response.json().room;
  }

  async function secondUser(app: FastifyInstance): Promise<string> {
    return sessionCookie(
      await register(app, {
        email: 'bob@example.com',
        username: 'Bob_01',
        nickname: '小红',
      }),
    );
  }

  it('加入、落座、举手、离座、离开完整流程', async () => {
    const { app } = await buildTestApp();
    const ownerCookie = sessionCookie(await register(app));
    const room = await createRoom(app, ownerCookie);
    const bobCookie = await secondUser(app);

    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.roomId}/join`,
      headers: { cookie: bobCookie },
    });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().room.memberCount).toBe(2);

    const seated = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.roomId}/seat`,
      headers: { cookie: bobCookie },
      payload: { position: 'N' },
    });
    expect(seated.statusCode).toBe(200);
    const bob = seated.json().room.members.find((member: { nickname: string }) => member.nickname === '小红');
    expect(bob).toMatchObject({ seat: 'N', ready: false });

    const ready = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.roomId}/ready`,
      headers: { cookie: bobCookie },
      payload: { ready: true },
    });
    expect(ready.statusCode).toBe(200);
    expect(
      ready.json().room.members.find((member: { nickname: string }) => member.nickname === '小红').ready,
    ).toBe(true);

    const stood = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.roomId}/stand`,
      headers: { cookie: bobCookie },
      payload: {},
    });
    expect(stood.statusCode).toBe(200);
    expect(
      stood.json().room.members.find((member: { nickname: string }) => member.nickname === '小红'),
    ).toMatchObject({ seat: null, ready: false });

    const left = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.roomId}/leave`,
      headers: { cookie: bobCookie },
    });
    expect(left.statusCode).toBe(204);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/rooms/${room.roomId}`,
      headers: { cookie: ownerCookie },
    });
    expect(detail.json().room.memberCount).toBe(1);
    await app.close();
  });

  it('私有牌室密码错误返回 403，正确后加入', async () => {
    const { app } = await buildTestApp();
    const ownerCookie = sessionCookie(await register(app));
    const room = await createRoom(app, ownerCookie, { password: 'room-pass' });
    const bobCookie = await secondUser(app);

    const wrong = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.roomId}/join`,
      headers: { cookie: bobCookie },
      payload: { password: 'wrong-pass' },
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error.code).toBe('ROOM_PASSWORD_INVALID');

    const ok = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.roomId}/join`,
      headers: { cookie: bobCookie },
      payload: { password: 'room-pass' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().room.memberCount).toBe(2);
    await app.close();
  });

  it('座位冲突与越权操作返回 409 / 403', async () => {
    const { app } = await buildTestApp();
    const ownerCookie = sessionCookie(await register(app));
    const room = await createRoom(app, ownerCookie);
    const bobCookie = await secondUser(app);
    await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.roomId}/join`,
      headers: { cookie: bobCookie },
    });

    const ownerSeat = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.roomId}/seat`,
      headers: { cookie: ownerCookie },
      payload: { position: 'N' },
    });
    expect(ownerSeat.statusCode).toBe(200);

    const taken = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.roomId}/seat`,
      headers: { cookie: bobCookie },
      payload: { position: 'N' },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('SEAT_TAKEN');

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.roomId}/seat`,
      headers: { cookie: bobCookie },
      payload: { position: 'E', userId: room.ownerId },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('FORBIDDEN');

    const ownerDrags = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.roomId}/seat`,
      headers: { cookie: ownerCookie },
      payload: { position: 'E', userId: room.ownerId },
    });
    expect(ownerDrags.statusCode).toBe(200);
    await app.close();
  });

  it('未加入不能落座，未落座不能举手', async () => {
    const { app } = await buildTestApp();
    const ownerCookie = sessionCookie(await register(app));
    const room = await createRoom(app, ownerCookie);
    const bobCookie = await secondUser(app);

    const notInRoom = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.roomId}/seat`,
      headers: { cookie: bobCookie },
      payload: { position: 'N' },
    });
    expect(notInRoom.statusCode).toBe(403);
    expect(notInRoom.json().error.code).toBe('NOT_IN_ROOM');

    const notSeated = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.roomId}/ready`,
      headers: { cookie: ownerCookie },
      payload: { ready: true },
    });
    expect(notSeated.statusCode).toBe(409);
    expect(notSeated.json().error.code).toBe('NOT_SEATED');
    await app.close();
  });

  it('未登录不能加入或落座', async () => {
    const { app } = await buildTestApp();
    const ownerCookie = sessionCookie(await register(app));
    const room = await createRoom(app, ownerCookie);

    for (const url of [
      `/api/v1/rooms/${room.roomId}/join`,
      `/api/v1/rooms/${room.roomId}/seat`,
      `/api/v1/rooms/${room.roomId}/ready`,
    ]) {
      const response = await app.inject({ method: 'POST', url, payload: { position: 'N', ready: true } });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_REQUIRED');
    }
    await app.close();
  });
});
