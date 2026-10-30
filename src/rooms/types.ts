/**
 * 牌室领域类型与仓储接口（SRS V0.7 3.1 / 3.2 / 4.1 / 4.3）。
 *
 * `roomNature` 在创建时固化；本模块不提供修改入口。
 * 私有牌室不出现在大厅列表；访问时对非室主/非管理员/非成员统一返回 NOT_FOUND，
 * 避免泄漏“房间是否存在”。
 *
 * 成员与座位：
 * - 同一用户在同一牌室只能有一条成员记录、最多一个座位；
 * - 座位唯一性由仓储层（数据库部分唯一索引）裁决；
 * - 等候区上限只统计未落座成员；
 * - 举手（ready）仅对已落座成员有效，离座自动清除。
 */

import type { AccountRole } from '../auth/types';

export type RoomNature = 'practice' | 'casual' | 'competitive';
export type RoomGameplay = 'single' | 'teams';
export type RoomStatus = 'waiting' | 'playing' | 'frozen';
export type AiDifficulty = 'easy' | 'normal' | 'expert';
export type DisconnectPolicy = 'auto_ai' | 'wait_owner';
export type SeatPosition = 'N' | 'E' | 'S' | 'W';

export const SEAT_POSITIONS: readonly SeatPosition[] = ['N', 'E', 'S', 'W'];

export interface RoomConfig {
  gameplay: RoomGameplay;
  /** null 表示“不限副数，手动结束”。 */
  totalBoards: number | null;
  minHumans: number;
  aiDifficulty: AiDifficulty;
  disconnectPolicy: DisconnectPolicy;
  spectatorsEnabled: boolean;
  chatEnabled: boolean;
  waitingLimit: number;
}

export interface RoomRecord {
  roomId: string;
  name: string;
  roomNature: RoomNature;
  ownerId: string;
  status: RoomStatus;
  config: RoomConfig;
  isPrivate: boolean;
  passwordHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewRoom {
  name: string;
  roomNature: RoomNature;
  ownerId: string;
  /** 室主加入成员表时保存的显示名快照。 */
  ownerNickname: string;
  status: RoomStatus;
  config: RoomConfig;
  isPrivate: boolean;
  passwordHash: string | null;
}

export interface RoomCounts {
  memberCount: number;
  seatedCount: number;
}

export type RoomWithCounts = RoomRecord & RoomCounts;

export interface RoomListFilter {
  roomNature?: RoomNature;
  limit?: number;
}

export interface RoomMemberRecord {
  roomId: string;
  userId: string;
  /** 加入时的昵称快照；改名功能落地后需同步刷新或改为实时解析。 */
  nickname: string;
  seat: SeatPosition | null;
  ready: boolean;
  joinedAt: Date;
}

export interface NewRoomMember {
  roomId: string;
  userId: string;
  nickname: string;
  waitingLimit: number;
  joinedAt: Date;
}

/** 座位已被其他成员占用。 */
export class SeatTakenError extends Error {
  constructor() {
    super('座位已被占用');
    this.name = 'SeatTakenError';
  }
}

/** 等候区达到上限。 */
export class RoomFullError extends Error {
  constructor() {
    super('等候区已满');
    this.name = 'RoomFullError';
  }
}

export interface RoomRepository {
  /** 创建牌室并在同一事务内把室主加入成员表。 */
  create(input: NewRoom): Promise<RoomRecord>;
  findById(roomId: string): Promise<RoomRecord | null>;
  listPublic(filter: RoomListFilter): Promise<RoomWithCounts[]>;
  countMembers(roomId: string): Promise<RoomCounts>;
  findMember(roomId: string, userId: string): Promise<RoomMemberRecord | null>;
  listMembers(roomId: string): Promise<RoomMemberRecord[]>;
  /** 幂等：已是成员时返回现有记录；等候区满时抛 `RoomFullError`。 */
  addMember(input: NewRoomMember): Promise<RoomMemberRecord>;
  /** 返回是否实际删除。 */
  removeMember(roomId: string, userId: string): Promise<boolean>;
  /** 座位冲突抛 `SeatTakenError`；成员不存在返回 null。 */
  setSeat(
    roomId: string,
    userId: string,
    seat: SeatPosition | null,
  ): Promise<RoomMemberRecord | null>;
  /** 成员不存在返回 null。 */
  setReady(roomId: string, userId: string, ready: boolean): Promise<RoomMemberRecord | null>;
}

export interface RoomViewer {
  userId: string;
  role: AccountRole;
}

/** 可执行写操作的账号；昵称用于成员快照。 */
export interface RoomActor extends RoomViewer {
  nickname: string;
}

/** 对外投影：不返回密码哈希。 */
export interface RoomView {
  roomId: string;
  name: string;
  roomNature: RoomNature;
  ownerId: string;
  status: RoomStatus;
  config: RoomConfig;
  isPrivate: boolean;
  hasPassword: boolean;
  memberCount: number;
  seatedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoomMemberView {
  userId: string;
  nickname: string;
  seat: SeatPosition | null;
  ready: boolean;
  isOwner: boolean;
  joinedAt: string;
}

/** 牌室详情：在大厅投影基础上附带等候区与座位成员。 */
export interface RoomDetailView extends RoomView {
  members: RoomMemberView[];
}
