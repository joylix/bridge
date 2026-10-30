import { describe, expect, it } from 'vitest';
import type { PasswordHasher } from '../auth/password';
import { InMemoryRoomRepository, RoomService, type CreateRoomInput } from '../rooms/service';
import type { RoomActor } from '../rooms/types';
import { AppError, ERROR_CODES } from '../shared/errors';
import { InMemorySessionRepository, SessionService } from './service';

const testHasher: PasswordHasher = {
  async hash(password) {
    return `test$${password}`;
  },
  async verify(password, stored) {
    return stored === `test$${password}`;
  },
};

const owner: RoomActor = { userId: 'owner-1', nickname: '室主', role: 'user' };
const alice: RoomActor = { userId: 'alice-1', nickname: '小明', role: 'user' };
const bob: RoomActor = { userId: 'bob-1', nickname: '小红', role: 'user' };
const carol: RoomActor = { userId: 'carol-1', nickname: '小刚', role: 'user' };
const admin: RoomActor = { userId: 'admin-1', nickname: '管理员', role: 'admin' };

function setup() {
  const rooms = new InMemoryRoomRepository();
  const roomService = new RoomService({ rooms, hasher: testHasher });
  const sessionRepository = new InMemorySessionRepository();
  const service = new SessionService({ sessions: sessionRepository, rooms });
  return { rooms, roomService, sessionRepository, service };
}

function roomInput(overrides: Partial<CreateRoomInput> = {}): CreateRoomInput {
  return {
    name: '周五练习房',
    roomNature: 'practice',
    gameplay: 'single',
    ...overrides,
  };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await expect(promise).rejects.toMatchObject({ code });
}

async function joinAndSeat(
  roomService: RoomService,
  roomId: string,
  actor: RoomActor,
  position: 'N' | 'E' | 'S' | 'W',
): Promise<void> {
  await roomService.join(actor, roomId);
  await roomService.takeSeat(actor, roomId, position);
}

describe('Session 创建与快照', () => {
  it('创建 preparing Session，固化 roomNature 与房间配置', async () => {
    const { roomService, service } = setup();
    const room = await roomService.create(
      owner,
      roomInput({ roomNature: 'competitive', totalBoards: 8, minHumans: 2 }),
    );

    const session = await service.create(owner, room.roomId);
    expect(session).toMatchObject({
      roomId: room.roomId,
      roomNature: 'competitive',
      gameplay: 'single',
      sessionStatus: 'preparing',
      scoringEligibility: 'pending',
      teamTableMapping: null,
      startedAt: null,
      endedAt: null,
    });
    expect(session.config).toEqual(room.config);
    expect(session.scoringEligibilitySnapshot).toEqual({
      roomNature: 'competitive',
      initial: 'pending',
      decision: null,
      decidedAt: null,
      reason: 'session_created',
    });
  });

  it('练习房与休闲房初始成绩资格为 ineligible', async () => {
    const { roomService, service } = setup();
    for (const roomNature of ['practice', 'casual'] as const) {
      const room = await roomService.create(owner, roomInput({ roomNature }));
      const session = await service.create(owner, room.roomId);
      expect(session.roomNature).toBe(roomNature);
      expect(session.scoringEligibility).toBe('ineligible');
      expect(session.scoringEligibilitySnapshot.initial).toBe('ineligible');
    }
  });

  it('重复创建返回同一活动 Session，取消后可再开一盘', async () => {
    const { roomService, service } = setup();
    const room = await roomService.create(owner, roomInput());

    const first = await service.create(owner, room.roomId);
    const again = await service.create(owner, room.roomId);
    expect(again.sessionId).toBe(first.sessionId);

    const aborted = await service.abort(owner, first.sessionId);
    expect(aborted.sessionStatus).toBe('aborted');
    expect(aborted.endedAt).not.toBeNull();

    const next = await service.create(owner, room.roomId);
    expect(next.sessionId).not.toBe(first.sessionId);
    expect(next.sessionStatus).toBe('preparing');

    const history = await service.list(owner, room.roomId);
    expect(history.map((session) => session.sessionStatus).sort()).toEqual([
      'aborted',
      'preparing',
    ]);
  });

  it('只有室主或管理员可创建；牌室必须处于 waiting', async () => {
    const { rooms, roomService, service } = setup();
    const room = await roomService.create(owner, roomInput());

    await expectCode(service.create(alice, room.roomId), ERROR_CODES.FORBIDDEN);
    await expect(service.create(admin, room.roomId)).resolves.toMatchObject({
      roomId: room.roomId,
    });

    const record = await rooms.findById(room.roomId);
    if (!record) throw new Error('牌室缺失');
    record.status = 'playing';
    await expectCode(service.create(owner, room.roomId), ERROR_CODES.ROOM_NOT_WAITING);
  });

  it('私有牌室对非成员返回 NOT_FOUND，成员可读取 Session', async () => {
    const { roomService, service } = setup();
    const room = await roomService.create(owner, roomInput({ password: 'secret' }));
    const session = await service.create(owner, room.roomId);

    await expectCode(
      service.get({ userId: 'alice-1', role: 'user' }, session.sessionId),
      ERROR_CODES.NOT_FOUND,
    );

    await roomService.join(alice, room.roomId, 'secret');
    await expect(
      service.get({ userId: 'alice-1', role: 'user' }, session.sessionId),
    ).resolves.toMatchObject({ sessionId: session.sessionId });

    await expect(
      service.get({ userId: 'admin-1', role: 'admin' }, session.sessionId),
    ).resolves.toMatchObject({ sessionId: session.sessionId });
  });

  it('公开牌室的其他登录用户可读取 Session', async () => {
    const { roomService, service } = setup();
    const room = await roomService.create(owner, roomInput());
    const session = await service.create(owner, room.roomId);

    await expect(
      service.get({ userId: 'spectator-1', role: 'user' }, session.sessionId),
    ).resolves.toMatchObject({ sessionId: session.sessionId });
  });
});

describe('开局前置校验', () => {
  it('座位不完整与最低真人数不足时 ready=false', async () => {
    const { roomService, service } = setup();
    const room = await roomService.create(owner, roomInput({ minHumans: 2 }));
    const session = await service.create(owner, room.roomId);

    const empty = await service.precheck(owner, session.sessionId);
    expect(empty.ready).toBe(false);
    expect(empty.occupiedSeats).toBe(0);
    expect(empty.humanSeatedCount).toBe(0);
    expect(empty.minHumans).toBe(2);
    expect(empty.seats.map((seat) => seat.seat)).toEqual(['N', 'E', 'S', 'W']);
    expect(empty.seats.every((seat) => seat.userId === null)).toBe(true);
    expect(checkOf(empty, 'SEATS_INCOMPLETE')).toMatchObject({ ok: false });
    expect(checkOf(empty, 'MIN_HUMANS_NOT_MET')).toMatchObject({ ok: false });

    await joinAndSeat(roomService, room.roomId, alice, 'N');
    await joinAndSeat(roomService, room.roomId, bob, 'E');

    const partial = await service.precheck(owner, session.sessionId);
    expect(partial.ready).toBe(false);
    expect(partial.occupiedSeats).toBe(2);
    expect(partial.humanSeatedCount).toBe(2);
    expect(checkOf(partial, 'SEATS_INCOMPLETE')).toMatchObject({ ok: false });
    expect(checkOf(partial, 'MIN_HUMANS_NOT_MET')).toMatchObject({ ok: true });
  });

  it('四席齐全且满足最低真人数时 ready=true，并返回座位快照', async () => {
    const { roomService, service } = setup();
    const room = await roomService.create(owner, roomInput({ minHumans: 2 }));
    const session = await service.create(owner, room.roomId);

    await joinAndSeat(roomService, room.roomId, owner, 'N');
    await joinAndSeat(roomService, room.roomId, alice, 'E');
    await joinAndSeat(roomService, room.roomId, bob, 'S');
    await joinAndSeat(roomService, room.roomId, carol, 'W');
    await roomService.setReady(owner, room.roomId, true);
    await roomService.setReady(alice, room.roomId, true);

    const report = await service.precheck(owner, session.sessionId);
    expect(report.ready).toBe(true);
    expect(report.occupiedSeats).toBe(4);
    expect(report.humanSeatedCount).toBe(4);
    expect(report.readyHumanCount).toBe(2);
    expect(report.seats).toEqual([
      { seat: 'N', userId: 'owner-1', nickname: '室主', ready: true },
      { seat: 'E', userId: 'alice-1', nickname: '小明', ready: true },
      { seat: 'S', userId: 'bob-1', nickname: '小红', ready: false },
      { seat: 'W', userId: 'carol-1', nickname: '小刚', ready: false },
    ]);
    expect(report.checks.every((check) => check.ok)).toBe(true);
  });

  it('最低真人数按配置裁决，四席齐全也可能不满足', async () => {
    const { roomService, service } = setup();
    const room = await roomService.create(owner, roomInput({ minHumans: 4 }));
    const session = await service.create(owner, room.roomId);

    await joinAndSeat(roomService, room.roomId, owner, 'N');
    await joinAndSeat(roomService, room.roomId, alice, 'E');
    await joinAndSeat(roomService, room.roomId, bob, 'S');

    const three = await service.precheck(owner, session.sessionId);
    expect(three.ready).toBe(false);
    expect(checkOf(three, 'SEATS_INCOMPLETE')).toMatchObject({ ok: false });
    expect(checkOf(three, 'MIN_HUMANS_NOT_MET')).toMatchObject({ ok: false });

    await joinAndSeat(roomService, room.roomId, carol, 'W');
    const four = await service.precheck(owner, session.sessionId);
    expect(four.ready).toBe(true);
    expect(checkOf(four, 'MIN_HUMANS_NOT_MET')).toMatchObject({ ok: true });
  });

  it('队式赛开局尚未实现，precheck 返回 GAMEPLAY_UNSUPPORTED', async () => {
    const { roomService, service } = setup();
    const room = await roomService.create(owner, roomInput({ gameplay: 'teams' }));
    const session = await service.create(owner, room.roomId);
    expect(session.gameplay).toBe('teams');

    const report = await service.precheck(owner, session.sessionId);
    expect(report.ready).toBe(false);
    expect(checkOf(report, 'GAMEPLAY_UNSUPPORTED')).toMatchObject({ ok: false });
  });

  it('非 preparing 的 Session 拒绝 precheck', async () => {
    const { roomService, service, sessionRepository } = setup();
    const room = await roomService.create(owner, roomInput());
    const session = await service.create(owner, room.roomId);
    await sessionRepository.transition(session.sessionId, 'preparing', 'playing', new Date());

    await expectCode(
      service.precheck(owner, session.sessionId),
      ERROR_CODES.SESSION_NOT_PREPARING,
    );
  });
});

describe('取消 Session', () => {
  it('重复取消幂等；进入对局后拒绝取消', async () => {
    const { roomService, service, sessionRepository } = setup();
    const room = await roomService.create(owner, roomInput());
    const session = await service.create(owner, room.roomId);

    const first = await service.abort(owner, session.sessionId);
    expect(first.sessionStatus).toBe('aborted');
    const again = await service.abort(owner, session.sessionId);
    expect(again.sessionId).toBe(first.sessionId);
    expect(again.sessionStatus).toBe('aborted');

    const next = await service.create(owner, room.roomId);
    await sessionRepository.transition(next.sessionId, 'preparing', 'playing', new Date());
    await expectCode(service.abort(owner, next.sessionId), ERROR_CODES.SESSION_NOT_PREPARING);
  });

  it('普通成员不能取消 Session', async () => {
    const { roomService, service } = setup();
    const room = await roomService.create(owner, roomInput());
    await roomService.join(alice, room.roomId);
    const session = await service.create(owner, room.roomId);

    await expectCode(service.abort(alice, session.sessionId), ERROR_CODES.FORBIDDEN);
  });
});

function checkOf(
  report: Awaited<ReturnType<SessionService['precheck']>>,
  code: string,
) {
  return report.checks.find((check) => check.code === code);
}
