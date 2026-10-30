/**
 * 牌室创建、加入、等候区、座位与举手准备
 * （SRS V0.7 3.1 / 3.2 / 3.3 / 4.1 / 4.3 / 5.1）。
 *
 * 当前切片只处理 `status=waiting` 的牌室；Session 创建、AI 补位与发牌在
 * 后续切片实现。`roomNature` 创建后固化，因此没有 update 方法。
 *
 * 并发裁决：
 * - 座位唯一性由仓储层唯一约束决定，服务层不“先查后写”；
 * - 等候区上限由仓储层在锁内计数，避免并发加入超限。
 */

import { randomUUID } from 'node:crypto';
import { AppError, ERROR_CODES } from '../shared/errors';
import { defaultPasswordHasher, type PasswordHasher } from '../auth/password';
import {
  RoomFullError,
  SeatTakenError,
  SEAT_POSITIONS,
  type AiDifficulty,
  type DisconnectPolicy,
  type NewRoom,
  type NewRoomMember,
  type RoomActor,
  type RoomConfig,
  type RoomDetailView,
  type RoomGameplay,
  type RoomListFilter,
  type RoomMemberRecord,
  type RoomNature,
  type RoomRecord,
  type RoomRepository,
  type RoomView,
  type RoomViewer,
  type SeatPosition,
} from './types';

export const ROOM_NAME_MAX_LENGTH = 64;
export const ROOM_PASSWORD_MIN_LENGTH = 4;
export const ROOM_PASSWORD_MAX_LENGTH = 64;
export const DEFAULT_WAITING_LIMIT = 20;
export const MAX_WAITING_LIMIT = 100;
export const MAX_TOTAL_BOARDS = 200;

const ROOM_NATURES: readonly RoomNature[] = ['practice', 'casual', 'competitive'];
const GAMEPLAYS: readonly RoomGameplay[] = ['single', 'teams'];
const AI_DIFFICULTIES: readonly AiDifficulty[] = ['easy', 'normal', 'expert'];
const DISCONNECT_POLICIES: readonly DisconnectPolicy[] = ['auto_ai', 'wait_owner'];

export interface CreateRoomInput {
  name: string;
  roomNature: RoomNature;
  gameplay: RoomGameplay;
  totalBoards?: number | null;
  minHumans?: number;
  aiDifficulty?: AiDifficulty;
  disconnectPolicy?: DisconnectPolicy;
  spectatorsEnabled?: boolean;
  chatEnabled?: boolean;
  waitingLimit?: number;
  isPrivate?: boolean;
  password?: string;
}

export interface RoomServiceOptions {
  rooms: RoomRepository;
  hasher?: PasswordHasher;
  now?: () => Date;
}

export class RoomService {
  private readonly rooms: RoomRepository;
  private readonly hasher: PasswordHasher;
  private readonly now: () => Date;

  constructor(options: RoomServiceOptions) {
    this.rooms = options.rooms;
    this.hasher = options.hasher ?? defaultPasswordHasher;
    this.now = options.now ?? (() => new Date());
  }

  async create(actor: RoomActor, input: CreateRoomInput): Promise<RoomDetailView> {
    const name = this.validateName(input.name);
    if (!ROOM_NATURES.includes(input.roomNature)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, '房间性质不合法');
    }
    if (!GAMEPLAYS.includes(input.gameplay)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, '玩法类型不合法');
    }

    const config = this.buildConfig(input);
    const passwordHash = await this.hashRoomPassword(input.password);
    if (passwordHash !== null && input.isPrivate === false) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, '设置房间密码时必须为私有牌室');
    }
    const isPrivate = input.isPrivate ?? passwordHash !== null;

    const room = await this.rooms.create({
      name,
      roomNature: input.roomNature,
      ownerId: actor.userId,
      ownerNickname: actor.nickname,
      status: 'waiting',
      config,
      isPrivate,
      passwordHash,
    });
    return this.detail(room);
  }

  async list(_viewer: RoomViewer, filter: RoomListFilter = {}): Promise<RoomView[]> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100);
    const rooms = await this.rooms.listPublic({
      ...(filter.roomNature ? { roomNature: filter.roomNature } : {}),
      limit,
    });
    // 大厅只展示公开牌室；管理员也通过管理接口查看私有牌室，不走大厅列表。
    return rooms.filter((room) => !room.isPrivate).map((room) => toRoomView(room, room));
  }

  async get(viewer: RoomViewer, roomId: string): Promise<RoomDetailView> {
    const room = await this.loadRoom(roomId);
    const member = await this.rooms.findMember(roomId, viewer.userId);
    if (
      room.isPrivate &&
      room.ownerId !== viewer.userId &&
      viewer.role !== 'admin' &&
      !member
    ) {
      throw new AppError(ERROR_CODES.NOT_FOUND, '牌室不存在');
    }
    return this.detail(room);
  }

  /**
   * 加入牌室等候区。已是成员时幂等返回详情。
   * 私有牌室需密码；室主与管理员可绕过。
   */
  async join(actor: RoomActor, roomId: string, password?: string): Promise<RoomDetailView> {
    const room = await this.loadRoom(roomId);
    const existing = await this.rooms.findMember(roomId, actor.userId);
    if (existing) return this.detail(room);

    if (room.status !== 'waiting') {
      throw new AppError(ERROR_CODES.ROOM_NOT_WAITING, '牌室当前不可加入');
    }

    if (room.ownerId !== actor.userId && actor.role !== 'admin') {
      if (room.passwordHash) {
        if (!password) {
          throw new AppError(ERROR_CODES.ROOM_PASSWORD_INVALID, '房间密码错误');
        }
        const ok = await this.hasher.verify(password, room.passwordHash);
        if (!ok) {
          throw new AppError(ERROR_CODES.ROOM_PASSWORD_INVALID, '房间密码错误');
        }
      } else if (room.isPrivate) {
        // 没有密码的私有牌室需要邀请码，当前切片尚未实现。
        throw new AppError(ERROR_CODES.NOT_FOUND, '牌室不存在');
      }
    }

    try {
      await this.rooms.addMember({
        roomId,
        userId: actor.userId,
        nickname: actor.nickname,
        waitingLimit: room.config.waitingLimit,
        joinedAt: this.now(),
      });
    } catch (error) {
      if (error instanceof RoomFullError) {
        throw new AppError(ERROR_CODES.ROOM_FULL, '等候区已满');
      }
      throw error;
    }
    return this.detail(room);
  }

  /** 离开牌室；非成员也按成功处理，保持幂等。 */
  async leave(actor: RoomActor, roomId: string): Promise<void> {
    const room = await this.loadRoom(roomId);
    if (room.status !== 'waiting') {
      throw new AppError(ERROR_CODES.ROOM_NOT_WAITING, '牌室当前不可离开');
    }
    await this.rooms.removeMember(roomId, actor.userId);
  }

  /**
   * 落座。默认给自己落座；室主/管理员可传 `targetUserId` 拖拽他人。
   * 同一成员换座直接覆盖旧座位。
   */
  async takeSeat(
    actor: RoomActor,
    roomId: string,
    position: SeatPosition,
    targetUserId?: string,
  ): Promise<RoomDetailView> {
    const room = await this.loadRoom(roomId);
    this.assertWaiting(room);
    if (!SEAT_POSITIONS.includes(position)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, '座位方向不合法');
    }

    const targetId = targetUserId ?? actor.userId;
    if (targetId !== actor.userId) this.assertManage(room, actor);

    const member = await this.rooms.findMember(roomId, targetId);
    if (!member) {
      throw new AppError(ERROR_CODES.NOT_IN_ROOM, '目标用户不在该牌室');
    }
    if (member.seat === position) return this.detail(room);

    try {
      await this.rooms.setSeat(roomId, targetId, position);
    } catch (error) {
      if (error instanceof SeatTakenError) {
        throw new AppError(ERROR_CODES.SEAT_TAKEN, '座位已被占用');
      }
      throw error;
    }
    return this.detail(room);
  }

  /** 离座并清除举手状态。默认给自己离座；室主/管理员可拽起他人。 */
  async stand(actor: RoomActor, roomId: string, targetUserId?: string): Promise<RoomDetailView> {
    const room = await this.loadRoom(roomId);
    this.assertWaiting(room);

    const targetId = targetUserId ?? actor.userId;
    if (targetId !== actor.userId) this.assertManage(room, actor);

    const member = await this.rooms.findMember(roomId, targetId);
    if (!member) {
      throw new AppError(ERROR_CODES.NOT_IN_ROOM, '目标用户不在该牌室');
    }
    if (member.seat === null) return this.detail(room);

    await this.rooms.setSeat(roomId, targetId, null);
    return this.detail(room);
  }

  /** 举手 / 取消举手；必须已落座。 */
  async setReady(actor: RoomActor, roomId: string, ready: boolean): Promise<RoomDetailView> {
    const room = await this.loadRoom(roomId);
    this.assertWaiting(room);

    const member = await this.rooms.findMember(roomId, actor.userId);
    if (!member) {
      throw new AppError(ERROR_CODES.NOT_IN_ROOM, '你不在该牌室');
    }
    if (member.seat === null) {
      throw new AppError(ERROR_CODES.NOT_SEATED, '请先落座');
    }

    await this.rooms.setReady(roomId, actor.userId, ready);
    return this.detail(room);
  }

  private async loadRoom(roomId: string): Promise<RoomRecord> {
    const room = await this.rooms.findById(roomId);
    if (!room) throw new AppError(ERROR_CODES.NOT_FOUND, '牌室不存在');
    return room;
  }

  private assertWaiting(room: RoomRecord): void {
    if (room.status !== 'waiting') {
      throw new AppError(ERROR_CODES.ROOM_NOT_WAITING, '牌室当前不可调整座位');
    }
  }

  private assertManage(room: RoomRecord, actor: RoomActor): void {
    if (room.ownerId !== actor.userId && actor.role !== 'admin') {
      throw new AppError(ERROR_CODES.FORBIDDEN, '只有室主或管理员可以管理座位');
    }
  }

  private async detail(room: RoomRecord): Promise<RoomDetailView> {
    const members = await this.rooms.listMembers(room.roomId);
    return toRoomDetailView(room, members);
  }

  private validateName(raw: string): string {
    const name = raw.normalize('NFKC').trim();
    if (name.length === 0 || name.length > ROOM_NAME_MAX_LENGTH) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `牌室名称需为 1–${ROOM_NAME_MAX_LENGTH} 个字符`,
      );
    }
    if (/[\p{Cc}\p{Cf}]/u.test(name)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, '牌室名称包含非法字符');
    }
    return name;
  }

  private buildConfig(input: CreateRoomInput): RoomConfig {
    const totalBoards = input.totalBoards ?? null;
    if (
      totalBoards !== null &&
      (!Number.isInteger(totalBoards) || totalBoards < 1 || totalBoards > MAX_TOTAL_BOARDS)
    ) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `总副数需为 1–${MAX_TOTAL_BOARDS} 或留空表示不限`,
      );
    }

    const defaultMinHumans = input.gameplay === 'single' ? 2 : 1;
    const minHumans = input.minHumans ?? defaultMinHumans;
    if (!Number.isInteger(minHumans) || minHumans < 1 || minHumans > 4) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, '最低真人数需为 1–4');
    }

    const aiDifficulty = input.aiDifficulty ?? 'normal';
    if (!AI_DIFFICULTIES.includes(aiDifficulty)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'AI 难度不合法');
    }

    const disconnectPolicy = input.disconnectPolicy ?? 'auto_ai';
    if (!DISCONNECT_POLICIES.includes(disconnectPolicy)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, '断线接管策略不合法');
    }

    const waitingLimit = input.waitingLimit ?? DEFAULT_WAITING_LIMIT;
    if (!Number.isInteger(waitingLimit) || waitingLimit < 1 || waitingLimit > MAX_WAITING_LIMIT) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `等候区上限需为 1–${MAX_WAITING_LIMIT}`,
      );
    }

    return {
      gameplay: input.gameplay,
      totalBoards,
      minHumans,
      aiDifficulty,
      disconnectPolicy,
      spectatorsEnabled: input.spectatorsEnabled ?? true,
      chatEnabled: input.chatEnabled ?? true,
      waitingLimit,
    };
  }

  private async hashRoomPassword(password: string | undefined): Promise<string | null> {
    if (password === undefined || password === '') return null;
    if (password.length < ROOM_PASSWORD_MIN_LENGTH || password.length > ROOM_PASSWORD_MAX_LENGTH) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `房间密码长度需为 ${ROOM_PASSWORD_MIN_LENGTH}–${ROOM_PASSWORD_MAX_LENGTH}`,
      );
    }
    return this.hasher.hash(password);
  }
}

export function toRoomView(room: RoomRecord, counts: { memberCount: number; seatedCount: number }): RoomView {
  return {
    roomId: room.roomId,
    name: room.name,
    roomNature: room.roomNature,
    ownerId: room.ownerId,
    status: room.status,
    config: room.config,
    isPrivate: room.isPrivate,
    hasPassword: room.passwordHash !== null,
    memberCount: counts.memberCount,
    seatedCount: counts.seatedCount,
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
  };
}

export function toRoomDetailView(room: RoomRecord, members: RoomMemberRecord[]): RoomDetailView {
  const seatedCount = members.filter((member) => member.seat !== null).length;
  return {
    ...toRoomView(room, { memberCount: members.length, seatedCount }),
    members: members
      .slice()
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
      .map((member) => ({
        userId: member.userId,
        nickname: member.nickname,
        seat: member.seat,
        ready: member.ready,
        isOwner: member.userId === room.ownerId,
        joinedAt: member.joinedAt.toISOString(),
      })),
  };
}

/** 内存仓储：用于单元测试与本地无数据库开发。 */
export class InMemoryRoomRepository implements RoomRepository {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly members = new Map<string, RoomMemberRecord>();
  private readonly seats = new Map<string, string>();

  async create(input: NewRoom): Promise<RoomRecord> {
    const now = new Date();
    const room: RoomRecord = {
      roomId: randomUUID(),
      name: input.name,
      roomNature: input.roomNature,
      ownerId: input.ownerId,
      status: input.status,
      config: input.config,
      isPrivate: input.isPrivate,
      passwordHash: input.passwordHash,
      createdAt: now,
      updatedAt: now,
    };
    this.rooms.set(room.roomId, room);
    const member: RoomMemberRecord = {
      roomId: room.roomId,
      userId: input.ownerId,
      nickname: input.ownerNickname,
      seat: null,
      ready: false,
      joinedAt: now,
    };
    this.members.set(this.memberKey(room.roomId, input.ownerId), member);
    return room;
  }

  async findById(roomId: string): Promise<RoomRecord | null> {
    return this.rooms.get(roomId) ?? null;
  }

  async listPublic(filter: RoomListFilter): Promise<Array<RoomRecord & { memberCount: number; seatedCount: number }>> {
    return [...this.rooms.values()]
      .filter((room) => !room.isPrivate)
      .filter((room) => !filter.roomNature || room.roomNature === filter.roomNature)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, filter.limit ?? 50)
      .map((room) => ({ ...room, ...this.counts(room.roomId) }));
  }

  async countMembers(roomId: string): Promise<{ memberCount: number; seatedCount: number }> {
    return this.counts(roomId);
  }

  async findMember(roomId: string, userId: string): Promise<RoomMemberRecord | null> {
    return this.members.get(this.memberKey(roomId, userId)) ?? null;
  }

  async listMembers(roomId: string): Promise<RoomMemberRecord[]> {
    return [...this.members.values()].filter((member) => member.roomId === roomId);
  }

  async addMember(input: NewRoomMember): Promise<RoomMemberRecord> {
    const key = this.memberKey(input.roomId, input.userId);
    const existing = this.members.get(key);
    if (existing) return existing;

    const waiting = (await this.listMembers(input.roomId)).filter(
      (member) => member.seat === null,
    ).length;
    if (waiting >= input.waitingLimit) throw new RoomFullError();

    const member: RoomMemberRecord = {
      roomId: input.roomId,
      userId: input.userId,
      nickname: input.nickname,
      seat: null,
      ready: false,
      joinedAt: input.joinedAt,
    };
    this.members.set(key, member);
    return member;
  }

  async removeMember(roomId: string, userId: string): Promise<boolean> {
    const key = this.memberKey(roomId, userId);
    const member = this.members.get(key);
    if (!member) return false;
    this.members.delete(key);
    if (member.seat) this.seats.delete(this.seatKey(roomId, member.seat));
    return true;
  }

  async setSeat(
    roomId: string,
    userId: string,
    seat: SeatPosition | null,
  ): Promise<RoomMemberRecord | null> {
    const key = this.memberKey(roomId, userId);
    const member = this.members.get(key);
    if (!member) return null;

    if (seat !== null) {
      const occupant = this.seats.get(this.seatKey(roomId, seat));
      if (occupant && occupant !== userId) throw new SeatTakenError();
    }

    if (member.seat) this.seats.delete(this.seatKey(roomId, member.seat));
    member.seat = seat;
    member.ready = false;
    if (seat !== null) {
      this.seats.set(this.seatKey(roomId, seat), userId);
    }
    return member;
  }

  async setReady(
    roomId: string,
    userId: string,
    ready: boolean,
  ): Promise<RoomMemberRecord | null> {
    const member = this.members.get(this.memberKey(roomId, userId));
    if (!member) return null;
    member.ready = member.seat !== null && ready;
    return member;
  }

  private counts(roomId: string): { memberCount: number; seatedCount: number } {
    const members = [...this.members.values()].filter((member) => member.roomId === roomId);
    return {
      memberCount: members.length,
      seatedCount: members.filter((member) => member.seat !== null).length,
    };
  }

  private memberKey(roomId: string, userId: string): string {
    return `${roomId}:${userId}`;
  }

  private seatKey(roomId: string, seat: SeatPosition): string {
    return `${roomId}:${seat}`;
  }
}
