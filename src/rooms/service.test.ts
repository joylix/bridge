import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES } from '../shared/errors';
import type { PasswordHasher } from '../auth/password';
import { InMemoryRoomRepository, RoomService, type CreateRoomInput } from './service';
import type { RoomActor } from './types';

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
const admin: RoomActor = { userId: 'admin-1', nickname: '管理员', role: 'admin' };

function setup() {
  const rooms = new InMemoryRoomRepository();
  const service = new RoomService({ rooms, hasher: testHasher });
  return { rooms, service };
}

function input(overrides: Partial<CreateRoomInput> = {}): CreateRoomInput {
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

describe('创建牌室', () => {
  it('练习房默认配置，室主自动进入等候区', async () => {
    const { service } = setup();
    const room = await service.create(owner, input());

    expect(room).toMatchObject({
      name: '周五练习房',
      roomNature: 'practice',
      ownerId: 'owner-1',
      status: 'waiting',
      isPrivate: false,
      hasPassword: false,
      memberCount: 1,
      seatedCount: 0,
    });
    expect(room.config).toEqual({
      gameplay: 'single',
      totalBoards: null,
      minHumans: 2,
      aiDifficulty: 'normal',
      disconnectPolicy: 'auto_ai',
      spectatorsEnabled: true,
      chatEnabled: true,
      waitingLimit: 20,
    });
    expect(room.members).toEqual([
      expect.objectContaining({
        userId: 'owner-1',
        nickname: '室主',
        seat: null,
        ready: false,
        isOwner: true,
      }),
    ]);
    expect(room).not.toHaveProperty('passwordHash');
  });

  it('提供房间密码即视为私有，且只暴露 hasPassword', async () => {
    const { service } = setup();
    const room = await service.create(
      owner,
      input({ roomNature: 'casual', gameplay: 'teams', password: 'room-pass' }),
    );
    expect(room.isPrivate).toBe(true);
    expect(room.hasPassword).toBe(true);
    expect(room.config.minHumans).toBe(1);
    expect(JSON.stringify(room)).not.toContain('room-pass');
  });

  it('拒绝非法名称、性质、副数、人数与密码', async () => {
    const { service } = setup();
    await expectCode(service.create(owner, input({ name: '  ' })), ERROR_CODES.VALIDATION_FAILED);
    await expectCode(
      service.create(owner, input({ roomNature: 'ranked' as never })),
      ERROR_CODES.VALIDATION_FAILED,
    );
    await expectCode(
      service.create(owner, input({ totalBoards: 0 })),
      ERROR_CODES.VALIDATION_FAILED,
    );
    await expectCode(
      service.create(owner, input({ minHumans: 5 })),
      ERROR_CODES.VALIDATION_FAILED,
    );
    await expectCode(
      service.create(owner, input({ waitingLimit: 101 })),
      ERROR_CODES.VALIDATION_FAILED,
    );
    await expectCode(
      service.create(owner, input({ password: '123' })),
      ERROR_CODES.VALIDATION_FAILED,
    );
    await expectCode(
      service.create(owner, input({ password: 'secret', isPrivate: false })),
      ERROR_CODES.VALIDATION_FAILED,
    );
  });
});

describe('牌室列表与详情', () => {
  it('大厅只列出公开牌室，并可按性质过滤，附带人数统计', async () => {
    const { service } = setup();
    const viewer = { userId: 'u1', role: 'user' as const };
    const practice = await service.create(owner, input({ name: '练习 A', roomNature: 'practice' }));
    await service.create(owner, input({ name: '休闲 B', roomNature: 'casual' }));
    await service.create(owner, input({ name: '私有 C', password: 'secret' }));
    await service.join(alice, practice.roomId);

    const all = await service.list(viewer);
    expect(all.map((room) => room.name).sort()).toEqual(['休闲 B', '练习 A']);
    const listedPractice = all.find((room) => room.name === '练习 A');
    expect(listedPractice).toMatchObject({ memberCount: 2, seatedCount: 0 });

    const casual = await service.list(viewer, { roomNature: 'casual' });
    expect(casual).toHaveLength(1);
    expect(casual[0].name).toBe('休闲 B');
  });

  it('私有牌室对非室主返回 404，室主、管理员与已加入成员可读', async () => {
    const { service } = setup();
    const room = await service.create(owner, input({ password: 'secret' }));

    await expectCode(
      service.get({ userId: 'other', role: 'user' }, room.roomId),
      ERROR_CODES.NOT_FOUND,
    );
    await expect(
      service.get({ userId: 'owner-1', role: 'user' }, room.roomId),
    ).resolves.toMatchObject({ roomId: room.roomId });
    await expect(
      service.get({ userId: 'admin-1', role: 'admin' }, room.roomId),
    ).resolves.toMatchObject({ roomId: room.roomId });

    await service.join(alice, room.roomId, 'secret');
    await expect(
      service.get({ userId: 'alice-1', role: 'user' }, room.roomId),
    ).resolves.toMatchObject({ roomId: room.roomId });
  });

  it('不存在的牌室返回 NOT_FOUND', async () => {
    const { service } = setup();
    await expectCode(
      service.get({ userId: 'u1', role: 'user' }, '00000000-0000-4000-8000-000000000000'),
      ERROR_CODES.NOT_FOUND,
    );
  });
});

describe('加入与离开等候区', () => {
  it('公开牌室可直接加入，重复加入幂等', async () => {
    const { service } = setup();
    const room = await service.create(owner, input());

    const joined = await service.join(alice, room.roomId);
    expect(joined.memberCount).toBe(2);
    expect(joined.members.map((member) => member.nickname)).toEqual(['室主', '小明']);

    const again = await service.join(alice, room.roomId);
    expect(again.memberCount).toBe(2);
  });

  it('等候区上限只统计未落座成员', async () => {
    const { service } = setup();
    const room = await service.create(owner, input({ waitingLimit: 2 }));

    await service.join(alice, room.roomId);
    // 室主 + 小明已占满 2 个等候位；小红加入失败。
    await expectCode(service.join(bob, room.roomId), ERROR_CODES.ROOM_FULL);

    // 小明落座后释放等候位，小红可以加入。
    await service.takeSeat(alice, room.roomId, 'N');
    await expect(service.join(bob, room.roomId)).resolves.toMatchObject({ memberCount: 3 });
  });

  it('私有牌室校验密码，室主与管理员可绕过', async () => {
    const { service } = setup();
    const room = await service.create(owner, input({ password: 'secret' }));

    await expectCode(service.join(alice, room.roomId), ERROR_CODES.ROOM_PASSWORD_INVALID);
    await expectCode(
      service.join(alice, room.roomId, 'wrong'),
      ERROR_CODES.ROOM_PASSWORD_INVALID,
    );
    await expect(service.join(alice, room.roomId, 'secret')).resolves.toMatchObject({
      memberCount: 2,
    });

    const adminRoom = await service.create(owner, input({ password: 'secret' }));
    await expect(service.join(admin, adminRoom.roomId)).resolves.toMatchObject({
      memberCount: 2,
    });
  });

  it('离开后释放成员与座位', async () => {
    const { service } = setup();
    const room = await service.create(owner, input());
    await service.join(alice, room.roomId);
    await service.takeSeat(alice, room.roomId, 'E');

    await service.leave(alice, room.roomId);
    const detail = await service.get(owner, room.roomId);
    expect(detail.memberCount).toBe(1);
    expect(detail.seatedCount).toBe(0);

    // 座位已释放，其他人可以落座。
    await service.join(bob, room.roomId);
    await expect(service.takeSeat(bob, room.roomId, 'E')).resolves.toMatchObject({
      seatedCount: 1,
    });
  });

  it('非 waiting 状态禁止加入、落座与离开', async () => {
    const { rooms, service } = setup();
    const room = await service.create(owner, input());
    await service.join(alice, room.roomId);

    const record = await rooms.findById(room.roomId);
    if (!record) throw new Error('牌室缺失');
    record.status = 'playing';

    await expectCode(service.join(bob, room.roomId), ERROR_CODES.ROOM_NOT_WAITING);
    await expectCode(service.takeSeat(alice, room.roomId, 'N'), ERROR_CODES.ROOM_NOT_WAITING);
    await expectCode(service.leave(alice, room.roomId), ERROR_CODES.ROOM_NOT_WAITING);
  });
});

describe('座位与举手', () => {
  it('自落座、换座，离座清除举手状态', async () => {
    const { service } = setup();
    const room = await service.create(owner, input());
    await service.join(alice, room.roomId);

    const seated = await service.takeSeat(alice, room.roomId, 'N');
    expect(seated.members.find((member) => member.userId === 'alice-1')).toMatchObject({
      seat: 'N',
      ready: false,
    });

    const ready = await service.setReady(alice, room.roomId, true);
    expect(ready.members.find((member) => member.userId === 'alice-1')?.ready).toBe(true);

    const moved = await service.takeSeat(alice, room.roomId, 'S');
    expect(moved.members.find((member) => member.userId === 'alice-1')).toMatchObject({
      seat: 'S',
      ready: false,
    });

    const stood = await service.stand(alice, room.roomId);
    expect(stood.members.find((member) => member.userId === 'alice-1')).toMatchObject({
      seat: null,
      ready: false,
    });
  });

  it('座位冲突返回 SEAT_TAKEN，换座释放旧座位', async () => {
    const { service } = setup();
    const room = await service.create(owner, input());
    await service.join(alice, room.roomId);
    await service.join(bob, room.roomId);

    await service.takeSeat(alice, room.roomId, 'N');
    await expectCode(service.takeSeat(bob, room.roomId, 'N'), ERROR_CODES.SEAT_TAKEN);

    await service.takeSeat(bob, room.roomId, 'E');
    await service.takeSeat(alice, room.roomId, 'S');
    await expect(service.takeSeat(bob, room.roomId, 'N')).resolves.toMatchObject({
      seatedCount: 2,
    });
    const detail = await service.get(owner, room.roomId);
    expect(detail.members.filter((member) => member.seat !== null)).toHaveLength(2);
  });

  it('室主可拖拽成员落座与拽起，普通成员不可操作他人', async () => {
    const { service } = setup();
    const room = await service.create(owner, input());
    await service.join(alice, room.roomId);
    await service.join(bob, room.roomId);

    await expectCode(
      service.takeSeat(alice, room.roomId, 'N', 'bob-1'),
      ERROR_CODES.FORBIDDEN,
    );

    const assigned = await service.takeSeat(owner, room.roomId, 'N', 'bob-1');
    expect(assigned.members.find((member) => member.userId === 'bob-1')?.seat).toBe('N');

    const removed = await service.stand(owner, room.roomId, 'bob-1');
    expect(removed.members.find((member) => member.userId === 'bob-1')?.seat).toBeNull();

    await expect(
      service.takeSeat(admin, room.roomId, 'E', 'alice-1'),
    ).resolves.toMatchObject({ seatedCount: 1 });
  });

  it('未加入不能落座，未落座不能举手', async () => {
    const { service } = setup();
    const room = await service.create(owner, input());

    await expectCode(service.takeSeat(alice, room.roomId, 'N'), ERROR_CODES.NOT_IN_ROOM);
    await expectCode(service.setReady(owner, room.roomId, true), ERROR_CODES.NOT_SEATED);

    await service.takeSeat(owner, room.roomId, 'N');
    await expect(service.setReady(owner, room.roomId, true)).resolves.toMatchObject({
      seatedCount: 1,
    });
  });

  it('非法座位方向返回 VALIDATION_FAILED', async () => {
    const { service } = setup();
    const room = await service.create(owner, input());
    await expectCode(
      service.takeSeat(owner, room.roomId, 'X' as never),
      ERROR_CODES.VALIDATION_FAILED,
    );
  });
});
