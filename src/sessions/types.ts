/**
 * Session 领域类型与仓储接口（SRS V0.7 3.5 / 5.1 / 5.2 / 5.5）。
 *
 * 当前切片只创建 `preparing` 状态的 Session，并固化：
 * - `roomNature`：整盘内改分、导出、排名、IMP 计入、聊天限制均按快照执行；
 * - `roomConfig`：玩法、最低真人数、总副数等开局参数；
 * - `scoringEligibility` 初始值：practice / casual = ineligible，
 *   competitive = pending（最终判定在 Session completed 时进行）。
 *
 * 开局事务（starting → playing、AI 补位、发牌、座位锁定）在后续切片实现。
 */

import type { AccountRole } from '../auth/types';
import type { RoomConfig, RoomNature, RoomStatus, SeatPosition } from '../rooms/types';

export type SessionStatus =
  | 'preparing'
  | 'starting'
  | 'playing'
  | 'paused'
  | 'completed'
  | 'aborted';

export type ScoringEligibility = 'pending' | 'eligible' | 'ineligible';

export type SessionGameplay = 'single' | 'teams';

export const ACTIVE_SESSION_STATUSES: readonly SessionStatus[] = [
  'preparing',
  'starting',
  'playing',
  'paused',
];

/** 成绩资格判定快照；创建时写入初始值，完成时补判定时点与依据。 */
export interface ScoringEligibilitySnapshot {
  roomNature: RoomNature;
  /** 创建时初始值。 */
  initial: ScoringEligibility;
  /** 最终判定值；未完成时为 null。 */
  decision: ScoringEligibility | null;
  /** 判定时点 ISO 字符串；未判定时为 null。 */
  decidedAt: string | null;
  reason: 'session_created' | 'session_completed' | 'session_aborted';
  /** competitive 完成时的真人有效动作计数（后续切片填充）。 */
  humanActionCount?: number;
}

export interface SessionRecord {
  sessionId: string;
  roomId: string;
  /** Session 快照；创建后不可改。 */
  roomNature: RoomNature;
  gameplay: SessionGameplay;
  /** 房间配置快照；创建后不可改。 */
  config: RoomConfig;
  sessionStatus: SessionStatus;
  scoringEligibility: ScoringEligibility;
  scoringEligibilitySnapshot: ScoringEligibilitySnapshot;
  /** 队式赛固定对位表；单桌为 null。 */
  teamTableMapping: Record<string, unknown> | null;
  lastSeq: number;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSession {
  roomId: string;
  roomNature: RoomNature;
  gameplay: SessionGameplay;
  config: RoomConfig;
  sessionStatus: SessionStatus;
  scoringEligibility: ScoringEligibility;
  scoringEligibilitySnapshot: ScoringEligibilitySnapshot;
}

/** 同一牌室已存在活动 Session；由数据库部分唯一索引裁决。 */
export class ActiveSessionExistsError extends Error {
  constructor() {
    super('该牌室已有进行中的 Session');
    this.name = 'ActiveSessionExistsError';
  }
}

export interface SessionRepository {
  /** 活动 Session 冲突时抛 `ActiveSessionExistsError`。 */
  create(input: NewSession): Promise<SessionRecord>;
  findById(sessionId: string): Promise<SessionRecord | null>;
  findActiveByRoom(roomId: string): Promise<SessionRecord | null>;
  listByRoom(roomId: string): Promise<SessionRecord[]>;
  /** 条件状态迁移；当前状态不等于 `from` 时返回 null。 */
  transition(
    sessionId: string,
    from: SessionStatus,
    to: SessionStatus,
    at: Date,
  ): Promise<SessionRecord | null>;
}

export interface SessionViewer {
  userId: string;
  role: AccountRole;
}

/** 对外投影：不包含内部事件游标等实现字段。 */
export interface SessionView {
  sessionId: string;
  roomId: string;
  roomNature: RoomNature;
  gameplay: SessionGameplay;
  config: RoomConfig;
  sessionStatus: SessionStatus;
  scoringEligibility: ScoringEligibility;
  scoringEligibilitySnapshot: ScoringEligibilitySnapshot;
  teamTableMapping: Record<string, unknown> | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PreStartCheckCode =
  | 'ROOM_NOT_WAITING'
  | 'SEATS_INCOMPLETE'
  | 'MIN_HUMANS_NOT_MET'
  | 'GAMEPLAY_UNSUPPORTED';

export interface PreStartCheck {
  code: PreStartCheckCode;
  ok: boolean;
  message: string;
  details?: Record<string, number | string | null>;
}

export interface PreStartSeat {
  seat: SeatPosition;
  userId: string | null;
  nickname: string | null;
  ready: boolean;
}

/**
 * 开局前置报告。`ready=true` 仅表示当前硬门槛全部通过；
 * 真正的开局仍在后续原子事务中重新校验，避免检查与提交之间的竞态。
 */
export interface PreStartReport {
  sessionId: string;
  roomId: string;
  sessionStatus: SessionStatus;
  roomStatus: RoomStatus;
  roomNature: RoomNature;
  gameplay: SessionGameplay;
  scoringEligibility: ScoringEligibility;
  ready: boolean;
  occupiedSeats: number;
  humanSeatedCount: number;
  readyHumanCount: number;
  minHumans: number;
  seats: PreStartSeat[];
  checks: PreStartCheck[];
}
