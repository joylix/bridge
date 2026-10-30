// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app';
import { InMemoryAccountRepository, InMemoryAuthSessionRepository } from '../../auth/memory';
import type { PasswordHasher } from '../../auth/password';
import { AuthService } from '../../auth/service';
import { InMemoryRoomRepository, RoomService } from '../../rooms/service';
import { InMemorySessionRepository, SessionService } from '../../sessions/service';

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
  rooms: InMemoryRoomRepository;
  sessions: InMemorySessionRepository;
}

async function buildTestApp(): Promise<Harness> {
  const accounts = new InMemoryAccountRepository();
  const authSessions = new InMemoryAuthSessionRepository();
  const auth = new AuthService({ accounts, sessions: authSessions, hasher: testHasher, now: () => NOW });
  const rooms = new InMemoryRoomRepository();
  const roomService = new RoomService({ rooms, hasher: testHasher });
  const sessionRepository = new InMemorySessionRepository();
  const sessionService = new SessionService({ sessions: sessionRepository, rooms });
  const app = await buildApp({
    auth,
    rooms: roomService,
    sessions: sessionService,
    now: () => NOW,
  });
  return { app, rooms, sessions: sessionRepository };
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
): Promise<string> {
  const response = await app.inject({
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
  expect(response.statusCode).toBe(201);
  return sessionCookie(response);
}

async function createRoom(
  app: FastifyInstance,
  cookie: string,
  payload: Record<string, unknown> = {},
): Promise<{ roomId: string; ownerId: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/rooms',
    headers: { cookie },
    payload: { name: '周五练习房', roomNature: 'practice', gameplay: 'single', ...payload },
  });
  expect(response.statusCode).toBe(201);
  return response.json().room;
}

async function createSession(
  app: FastifyInstance,
  cookie: string,
  roomId: string,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: `/api/v1/rooms/${roomId}/sessions`,
    headers: { cookie },
  });
}

describe('Session HTTP 端点', () => {
  it('创建、读取、前置校验与取消完整流程', async () => {
    const { app } = await buildTestApp();
    const ownerCookie = await register(app);
    const room = await createRoom(app, ownerCookie);

    const created = await createSession(app, ownerCookie, room.roomId);
    expect(created.statusCode).toBe(201);
    const session = created.json().session;
    expect(session).toMatchObject({
      roomId: room.roomId,
      roomNature: 'practice',
      gameplay: 'single',
      sessionStatus: 'preparing',
      scoringEligibility: 'ineligible',
    });
    expect(session.scoringEligibilitySnapshot).toMatchObject({
      initial: 'ineligible',
      decision: null,
      decidedAt: null,
    });

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${session.sessionId}`,
      headers: { cookie: ownerCookie },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().session.sessionId).toBe(session.sessionId);

    const precheck = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${session.sessionId}/precheck`,
      headers: { cookie: ownerCookie },
    });
    expect(precheck.statusCode).toBe(200);
    const report = precheck.json().report;
    expect(report.ready).toBe(false);
    expect(report.occupiedSeats).toBe(0);
    expect(report.minHumans).toBe(2);
    expect(report.seats).toHaveLength(4);

    const aborted = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${session.sessionId}/abort`,
      headers: { cookie: ownerCookie },
    });
    expect(aborted.statusCode).toBe(200);
    expect(aborted.json().session.sessionStatus).toBe('aborted');

    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/rooms/${room.roomId}/sessions`,
      headers: { cookie: ownerCookie },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().sessions).toHaveLength(1);
  });

  it('重复创建返回同一活动 Session', async () => {
    const { app } = await buildTestApp();
    const cookie = await register(app);
    const room = await createRoom(app, cookie);

    const first = await createSession(app, cookie, room.roomId);
    const second = await createSession(app, cookie, room.roomId);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().session.sessionId).toBe(first.json().session.sessionId);
  });

  it('非室主不能创建，普通成员不能取消', async () => {
    const { app } = await buildTestApp();
    const ownerCookie = await register(app);
    const bobCookie = await register(app, {
      email: 'bob@example.com',
      username: 'Bob_01',
      nickname: '小红',
    });
    const room = await createRoom(app, ownerCookie);

    const forbidden = await createSession(app, bobCookie, room.roomId);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('FORBIDDEN');

    const created = await createSession(app, ownerCookie, room.roomId);
    const sessionId = created.json().session.sessionId;
    await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.roomId}/join`,
      headers: { cookie: bobCookie },
    });
    const abort = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/abort`,
      headers: { cookie: bobCookie },
    });
    expect(abort.statusCode).toBe(403);
  });

  it('私有牌室非成员读取 Session 返回 404，加入后可读', async () => {
    const { app } = await buildTestApp();
    const ownerCookie = await register(app);
    const bobCookie = await register(app, {
      email: 'bob@example.com',
      username: 'Bob_01',
      nickname: '小红',
    });
    const room = await createRoom(app, ownerCookie, { password: 'room-pass' });
    const created = await createSession(app, ownerCookie, room.roomId);
    const sessionId = created.json().session.sessionId;

    const hidden = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { cookie: bobCookie },
    });
    expect(hidden.statusCode).toBe(404);

    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.roomId}/join`,
      headers: { cookie: bobCookie },
      payload: { password: 'room-pass' },
    });
    expect(joined.statusCode).toBe(200);

    const visible = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { cookie: bobCookie },
    });
    expect(visible.statusCode).toBe(200);
    expect(visible.json().session.sessionId).toBe(sessionId);
  });

  it('未登录返回 401，非法 UUID 返回 400', async () => {
    const { app } = await buildTestApp();
    const cookie = await register(app);
    const room = await createRoom(app, cookie);
    const created = await createSession(app, cookie, room.roomId);
    const sessionId = created.json().session.sessionId;

    for (const [method, url] of [
      ['GET', `/api/v1/sessions/${sessionId}`],
      ['GET', `/api/v1/sessions/${sessionId}/precheck`],
      ['POST', `/api/v1/sessions/${sessionId}/abort`],
      ['POST', `/api/v1/rooms/${room.roomId}/sessions`],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_REQUIRED');
    }

    const badId = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/not-a-uuid',
      headers: { cookie },
    });
    expect(badId.statusCode).toBe(400);
    expect(badId.json().error.code).toBe('VALIDATION_FAILED');
  });
});
