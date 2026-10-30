/**
 * 字段级投影（M5，ADR-0007）。
 *
 * 这是服务端“谁能看到什么”的唯一实现点；HTTP、WS、回放、导出都必须调用它，
 * 不允许各端点自行裁剪，更不允许把完整记录发给客户端后再隐藏。
 *
 * 角色矩阵以 SRS V0.7 8.9 为准：
 * - 参赛玩家：仅本桌；仅本人暗手 + 已翻开明手；
 * - 旁观者/转播：仅释放后；无暗手，可见明手与叫牌/出牌；
 * - 室主：本桌可见，他桌不可见；
 * - 管理员/裁判：全量，但审计留痕由调用方负责。
 */

import { parsePbnDeal } from '../../core/pbn';
import type { Position } from '../../models/gameState';
import type { TableBoardRecord } from '../../exchange/types';
import { AppError, ERROR_CODES } from '../../shared/errors';

export type ViewerRole = 'player' | 'spectator' | 'room_owner' | 'director' | 'admin';

export interface ViewerContext {
  userId: string;
  role: ViewerRole;
  /** 玩家所在桌；仅 `role=player` 时使用。 */
  participantTableId?: string;
  /** 玩家座位；决定本人暗手。 */
  seat?: Position;
}

export interface ReleaseState {
  /** 本桌该副结束时间；未结束为 null。 */
  tableCompletedAt: string | null;
  /** 同一 Deal 所有桌完成时间；导出整副时使用；undefined 表示不适用。 */
  allTablesCompletedAt?: string | null;
  /** 该副完成后已结束的副数；转播要求至少延迟一副。 */
  delayedBoards: number;
  /** 至少等待毫秒数；SRS 默认 30s。 */
  minDelayMs: number;
}

export interface BoardProjectionInput {
  record: TableBoardRecord;
  tableId: string;
  viewer: ViewerContext;
  release: ReleaseState;
  now?: Date;
}

export interface ProjectedBoard {
  recordId: string;
  tableId: string;
  status: TableBoardRecord['status'];
  deal: Pick<TableBoardRecord['deal'], 'dealId' | 'boardNumber' | 'dealer' | 'vulnerability'>;
  hands: Partial<Record<Position, number[]>>;
  auction: TableBoardRecord['auction'];
  contract?: TableBoardRecord['contract'];
  declarer?: Position;
  tricksTaken?: number;
  play?: TableBoardRecord['play'];
  score: TableBoardRecord['score'];
  hcp?: TableBoardRecord['hcp'];
  adjustment?: TableBoardRecord['adjustment'];
  adjustHistory?: TableBoardRecord['adjustHistory'];
  projection: {
    version: '1.0';
    role: ViewerRole;
    /** 实际投影出的字段名，便于审计与测试。 */
    fields: string[];
  };
}

export function isReleased(release: ReleaseState, now: Date = new Date()): boolean {
  if (release.tableCompletedAt === null) return false;
  const completedAt = Date.parse(release.tableCompletedAt);
  if (Number.isNaN(completedAt)) return false;
  if (release.delayedBoards < 1) return false;
  return now.getTime() - completedAt >= release.minDelayMs;
}

/** 导出/回放门禁：未释放一律拒绝，错误信息不回显牌局内容。 */
export function assertExportReleased(release: ReleaseState, now: Date = new Date()): void {
  if (release.allTablesCompletedAt === null) {
    throw new AppError(ERROR_CODES.EXPORT_NOT_RELEASED, '该副尚未全部完成，暂不可导出');
  }
  if (!isReleased(release, now)) {
    throw new AppError(ERROR_CODES.EXPORT_NOT_RELEASED, '该副尚未释放，暂不可导出');
  }
}

function partnerOf(seat: Position): Position {
  switch (seat) {
    case 'N':
      return 'S';
    case 'S':
      return 'N';
    case 'E':
      return 'W';
    case 'W':
      return 'E';
  }
}

export function projectBoardForViewer(input: BoardProjectionInput): ProjectedBoard {
  const { record, tableId, viewer, release } = input;
  const now = input.now ?? new Date();
  const isDirector = viewer.role === 'director' || viewer.role === 'admin';
  const isPlayerAtTable =
    viewer.role === 'player' && viewer.participantTableId === tableId;
  const isAudience = viewer.role === 'spectator' || viewer.role === 'room_owner';

  if (viewer.role === 'player' && viewer.participantTableId !== tableId) {
    // 跨桌隔离：不区分“无权限”与“不存在”，避免泄漏他桌进度。
    throw new AppError(ERROR_CODES.EXPORT_FORBIDDEN, '无权查看该桌记录');
  }
  if (isPlayerAtTable && !viewer.seat) {
    throw new AppError(ERROR_CODES.FORBIDDEN, '玩家缺少座位信息');
  }
  if (isAudience && !isReleased(release, now)) {
    throw new AppError(ERROR_CODES.EXPORT_NOT_RELEASED, '该副尚未释放，暂不可查看');
  }

  const allHands = parsePbnDeal(record.deal.pbn).hands;
  const dummySeat = record.declarer ? partnerOf(record.declarer) : undefined;
  const dummyOpen = record.play !== undefined;

  const hands: Partial<Record<Position, number[]>> = {};
  if (isDirector) {
    for (const seat of ['N', 'E', 'S', 'W'] as Position[]) {
      hands[seat] = allHands[seat];
    }
  } else if (isPlayerAtTable) {
    hands[viewer.seat!] = allHands[viewer.seat!];
    if (dummySeat && dummyOpen) hands[dummySeat] = allHands[dummySeat];
  } else if (dummySeat && dummyOpen) {
    // 旁观者可见明手，但不可见四家暗手。
    hands[dummySeat] = allHands[dummySeat];
  }

  const fields = ['recordId', 'tableId', 'status', 'deal', 'hands', 'auction', 'score'];
  if (record.contract) fields.push('contract');
  if (record.declarer) fields.push('declarer');
  if (record.tricksTaken !== undefined) fields.push('tricksTaken');
  if (record.play) fields.push('play');

  const projected: ProjectedBoard = {
    recordId: record.recordId,
    tableId,
    status: record.status,
    deal: {
      dealId: record.deal.dealId,
      boardNumber: record.deal.boardNumber,
      dealer: record.deal.dealer,
      vulnerability: record.deal.vulnerability,
    },
    hands,
    auction: record.auction,
    score: record.score,
    projection: {
      version: '1.0',
      role: viewer.role,
      fields,
    },
  };

  if (record.contract) projected.contract = record.contract;
  if (record.declarer) projected.declarer = record.declarer;
  if (record.tricksTaken !== undefined) projected.tricksTaken = record.tricksTaken;
  if (record.play) projected.play = record.play;

  // 大牌点可由本人+明手推导，参赛者可见；旁观者不额外提供。
  if (isDirector || isPlayerAtTable) {
    projected.hcp = record.hcp;
    fields.push('hcp');
  }

  // 审计字段只对裁判/管理员开放；参赛者只看调整后的分数。
  if (isDirector) {
    if (record.adjustment) {
      projected.adjustment = record.adjustment;
      fields.push('adjustment');
    }
    if (record.adjustHistory) {
      projected.adjustHistory = record.adjustHistory;
      fields.push('adjustHistory');
    }
  }

  return projected;
}
