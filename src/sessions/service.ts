/**
 * Session 创建、快照与开局前置校验
 * （SRS V0.7 3.5.3 / 5.1 / 5.2 / 5.5 / 6.10.1）。
 *
 * 当前切片边界：
 * - 只创建 `preparing` Session；不补 AI、不发牌、不锁定座位；
 * - `roomNature` 与房间配置在创建时固化；
 * - `scoringEligibility` 按房间性质写入初始值；
 * - `precheck` 只读校验，真正开局仍须在后续原子事务内重新校验。
 *
 * 并发约束：同一牌室同时最多一个活动 Session，由仓储层部分唯一索引裁决。
 */

import { randomUUID } from 'node:crypto';
import { AppError, ERROR_CODES } from '../shared/errors';
import type { RoomConfig, RoomNature, RoomRecord, RoomRepository } from '../rooms/types';
import { SEAT_POSITIONS } from '../rooms/types';
import {
  ActiveSessionExistsError,
  ACTIVE_SESSION_STATUSES,
  type NewSession,
  type PreStartCheck,
  type PreStartReport,
  type PreStartSeat,
  type ScoringEligibility,
  type SessionRecord,
  type SessionRepository,
  type SessionStatus,
  type SessionView,
  type SessionViewer,
} from './types';

export interface SessionServiceOptions {
  sessions: SessionRepository;
  rooms: RoomRepository;
  now?: () => Date;
}

export class SessionService {
  private readonly sessions: SessionRepository;
  private readonly rooms: RoomRepository;
  private readonly now: () => Date;

  constructor(options: SessionServiceOptions) {
    this.sessions = options.sessions;
    this.rooms = options.rooms;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * 创建（或返回已存在的）活动 Session。
   *
   * 仅室主 / 管理员可创建；牌室必须处于 `waiting`。重复调用幂等返回同一
   * 活动 Session，避免双击创建多个盘。
   */
  async create(actor: SessionViewer, roomId: string): Promise<SessionView> {
    const room = await this.loadRoom(roomId);
    await this.assertRoomVisible(room, actor);
    this.assertManage(room, actor);

    if (room.status !== 'waiting') {
      throw new AppError(ERROR_CODES.ROOM_NOT_WAITING, '牌室当前不可创建 Session');
    }

    const existing = await this.sessions.findActiveByRoom(roomId);
    if (existing) return toSessionView(existing);

    const initial = initialEligibility(room.roomNature);
    const input: NewSession = {
      roomId,
      roomNature: room.roomNature,
      gameplay: room.config.gameplay,
      config: snapshotConfig(room.config),
      sessionStatus: 'preparing',
      scoringEligibility: initial,
      scoringEligibilitySnapshot: {
        roomNature: room.roomNature,
        initial,
        decision: null,
        decidedAt: null,
        reason: 'session_created',
      },
    };

    try {
      return toSessionView(await this.sessions.create(input));
    } catch (error) {
      if (error instanceof ActiveSessionExistsError) {
        // 并发创建：另一请求已写入，返回先创建的活动 Session。
        const concurrent = await this.sessions.findActiveByRoom(roomId);
        if (concurrent) return toSessionView(concurrent);
      }
      throw error;
    }
  }

  /** 读取 Session；私有牌室对非成员 / 非室主 / 非管理员统一 404。 */
  async get(viewer: SessionViewer, sessionId: string): Promise<SessionView> {
    const { session, room } = await this.loadSessionWithRoom(sessionId);
    await this.assertRoomVisible(room, viewer);
    return toSessionView(session);
  }

  /**
   * 开局前置校验。
   *
   * 硬门槛：
   * - 牌室仍为 `waiting`；
   * - 四个座位齐全（AI 补位前的真人数校验在后续切片接入）；
   * - 已落座真人数 ≥ 配置的最低真人数；
   * - 队式赛开局尚未实现，返回 `GAMEPLAY_UNSUPPORTED`。
   */
  async precheck(viewer: SessionViewer, sessionId: string): Promise<PreStartReport> {
    const { session, room } = await this.loadSessionWithRoom(sessionId);
    await this.assertRoomVisible(room, viewer);
    if (session.sessionStatus !== 'preparing') {
      throw new AppError(ERROR_CODES.SESSION_NOT_PREPARING, 'Session 不在准备阶段');
    }

    const members = await this.rooms.listMembers(session.roomId);
    const seats: PreStartSeat[] = SEAT_POSITIONS.map((seat) => {
      const member = members.find((candidate) => candidate.seat === seat);
      return {
        seat,
        userId: member?.userId ?? null,
        nickname: member?.nickname ?? null,
        ready: member?.ready ?? false,
      };
    });

    const seated = members.filter((member) => member.seat !== null);
    const occupiedSeats = seated.length;
    const humanSeatedCount = occupiedSeats;
    const readyHumanCount = seated.filter((member) => member.ready).length;
    // 兼容 M5 遗留 Session：配置快照为空时回退到牌室当前配置。
    const minHumans = session.config.minHumans ?? room.config.minHumans;

    const checks: PreStartCheck[] = [];

    if (room.status !== 'waiting') {
      checks.push({
        code: 'ROOM_NOT_WAITING',
        ok: false,
        message: '牌室不在等待状态',
        details: { roomStatus: room.status },
      });
    }

    if (session.gameplay === 'teams') {
      checks.push({
        code: 'GAMEPLAY_UNSUPPORTED',
        ok: false,
        message: '队式赛开局尚未实现',
        details: { gameplay: session.gameplay },
      });
    }

    if (occupiedSeats < 4) {
      checks.push({
        code: 'SEATS_INCOMPLETE',
        ok: false,
        message: '四个座位尚未坐满',
        details: { occupiedSeats, requiredSeats: 4 },
      });
    } else {
      checks.push({
        code: 'SEATS_INCOMPLETE',
        ok: true,
        message: '四个座位已坐满',
        details: { occupiedSeats, requiredSeats: 4 },
      });
    }

    if (humanSeatedCount < minHumans) {
      checks.push({
        code: 'MIN_HUMANS_NOT_MET',
        ok: false,
        message: '已落座真人数低于最低要求',
        details: { humanSeatedCount, minHumans },
      });
    } else {
      checks.push({
        code: 'MIN_HUMANS_NOT_MET',
        ok: true,
        message: '已落座真人数满足最低要求',
        details: { humanSeatedCount, minHumans },
      });
    }

    return {
      sessionId: session.sessionId,
      roomId: session.roomId,
      sessionStatus: session.sessionStatus,
      roomStatus: room.status,
      roomNature: session.roomNature,
      gameplay: session.gameplay,
      scoringEligibility: session.scoringEligibility,
      ready: checks.every((check) => check.ok),
      occupiedSeats,
      humanSeatedCount,
      readyHumanCount,
      minHumans,
      seats,
      checks,
    };
  }

  /**
   * 取消准备中的 Session（`preparing → aborted`）。
   * 重复取消幂等；已进入 starting / playing 等状态返回 `SESSION_NOT_PREPARING`。
   */
  async abort(actor: SessionViewer, sessionId: string): Promise<SessionView> {
    const { session, room } = await this.loadSessionWithRoom(sessionId);
    await this.assertRoomVisible(room, actor);
    this.assertManage(room, actor);

    if (session.sessionStatus === 'aborted') return toSessionView(session);
    if (session.sessionStatus !== 'preparing') {
      throw new AppError(ERROR_CODES.SESSION_NOT_PREPARING, 'Session 不在准备阶段');
    }

    const aborted = await this.sessions.transition(
      sessionId,
      'preparing',
      'aborted',
      this.now(),
    );
    if (aborted) return toSessionView(aborted);

    const current = await this.sessions.findById(sessionId);
    if (current?.sessionStatus === 'aborted') return toSessionView(current);
    throw new AppError(ERROR_CODES.SESSION_NOT_PREPARING, 'Session 状态已变化');
  }

  /** 列出某牌室的 Session 历史；仅室主 / 管理员。 */
  async list(actor: SessionViewer, roomId: string): Promise<SessionView[]> {
    const room = await this.loadRoom(roomId);
    await this.assertRoomVisible(room, actor);
    this.assertManage(room, actor);
    const sessions = await this.sessions.listByRoom(roomId);
    return sessions.map(toSessionView);
  }

  private async loadRoom(roomId: string): Promise<RoomRecord> {
    const room = await this.rooms.findById(roomId);
    if (!room) throw new AppError(ERROR_CODES.NOT_FOUND, '牌室不存在');
    return room;
  }

  private async loadSessionWithRoom(
    sessionId: string,
  ): Promise<{ session: SessionRecord; room: RoomRecord }> {
    const session = await this.sessions.findById(sessionId);
    if (!session) throw new AppError(ERROR_CODES.NOT_FOUND, 'Session 不存在');
    const room = await this.loadRoom(session.roomId);
    return { session, room };
  }

  private async assertRoomVisible(room: RoomRecord, actor: SessionViewer): Promise<void> {
    if (!room.isPrivate || room.ownerId === actor.userId || actor.role === 'admin') return;
    const member = await this.rooms.findMember(room.roomId, actor.userId);
    if (!member) throw new AppError(ERROR_CODES.NOT_FOUND, 'Session 不存在');
  }

  private assertManage(room: RoomRecord, actor: SessionViewer): void {
    if (room.ownerId !== actor.userId && actor.role !== 'admin') {
      throw new AppError(ERROR_CODES.FORBIDDEN, '只有室主或管理员可以管理 Session');
    }
  }
}

/** 初始成绩资格：练习 / 休闲盘不计排名；竞技盘待整盘结束判定。 */
export function initialEligibility(roomNature: RoomNature): ScoringEligibility {
  return roomNature === 'competitive' ? 'pending' : 'ineligible';
}

/** 浅拷贝配置，确保 Session 快照不受牌室对象后续修改影响。 */
export function snapshotConfig(config: RoomConfig): RoomConfig {
  return { ...config };
}

export function toSessionView(session: SessionRecord): SessionView {
  return {
    sessionId: session.sessionId,
    roomId: session.roomId,
    roomNature: session.roomNature,
    gameplay: session.gameplay,
    config: session.config,
    sessionStatus: session.sessionStatus,
    scoringEligibility: session.scoringEligibility,
    scoringEligibilitySnapshot: session.scoringEligibilitySnapshot,
    teamTableMapping: session.teamTableMapping,
    startedAt: session.startedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

/** 仅供测试与本地开发：内存 Session 仓储。 */
export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, SessionRecord>();

  async create(input: NewSession): Promise<SessionRecord> {
    if (await this.findActiveByRoom(input.roomId)) {
      throw new ActiveSessionExistsError();
    }
    const now = new Date();
    const session: SessionRecord = {
      sessionId: randomUUID(),
      roomId: input.roomId,
      roomNature: input.roomNature,
      gameplay: input.gameplay,
      config: input.config,
      sessionStatus: input.sessionStatus,
      scoringEligibility: input.scoringEligibility,
      scoringEligibilitySnapshot: input.scoringEligibilitySnapshot,
      teamTableMapping: null,
      lastSeq: 0,
      startedAt: null,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async findById(sessionId: string): Promise<SessionRecord | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async findActiveByRoom(roomId: string): Promise<SessionRecord | null> {
    return (
      [...this.sessions.values()].find(
        (session) =>
          session.roomId === roomId && ACTIVE_SESSION_STATUSES.includes(session.sessionStatus),
      ) ?? null
    );
  }

  async listByRoom(roomId: string): Promise<SessionRecord[]> {
    return [...this.sessions.values()]
      .filter((session) => session.roomId === roomId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async transition(
    sessionId: string,
    from: SessionStatus,
    to: SessionStatus,
    at: Date,
  ): Promise<SessionRecord | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.sessionStatus !== from) return null;
    session.sessionStatus = to;
    session.updatedAt = at;
    if (to === 'starting') session.startedAt = at;
    if (to === 'completed' || to === 'aborted') session.endedAt = at;
    return session;
  }
}


