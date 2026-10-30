/**
 * 队式赛跨桌结算（纯函数，无 I/O）。
 *
 * 口径固定为 SRS V0.7 7.3：
 *   redTeamRaw = Σ(红队各桌红队视角原始分)   // 代数和
 *   teamImp    = impTable(redTeamRaw)         // 不得再减 blueTeamRaw
 *   逐副换算、逐副累加
 *
 * 异常结算按 SRS 6.11：取消副不计算；缺桌/重开不计算；调整后按新原始分重算。
 */

import { signedImpFromDiff, WBF_2017, WBF_2017_VERSION, type ImpTable } from '../../core/impTable';

export type TeamBoardStatus =
  | 'IN_PROGRESS'
  | 'PLAYED'
  | 'PASSED_OUT'
  | 'CANCELLED'
  | 'ADJUSTED'
  | 'INCOMPLETE'
  | 'REOPENED';

export type SessionBoardStatus =
  | 'PENDING'
  | 'COMPLETE'
  | 'INCOMPLETE'
  | 'CANCELLED'
  | 'ADJUSTED'
  | 'REOPENED';

/** 一张桌在某副的红队视角结果。`redTeamRaw` 已含正负号。 */
export interface TeamBoardInput {
  tableBoardId: string;
  status: TeamBoardStatus;
  /** 红队视角原始分；取消/未完成/重开时必须为 null。 */
  redTeamRaw: number | null;
}

export interface TeamSettlement {
  status: SessionBoardStatus;
  /** 红队各桌代数和；不计算时为 null。 */
  redTeamRaw: number | null;
  /** 蓝队视角 = −redTeamRaw；仅展示，不参与换算。 */
  blueTeamRaw: number | null;
  /** 队式 IMP；不计算时为 null。 */
  teamImp: number | null;
  impTableVersion: typeof WBF_2017_VERSION;
  /** 人类可读的原因/错误码；正常计算时省略。 */
  reason?: string;
  /** 参与聚合的 TableBoard 版本键，供重算快照使用。 */
  inputs: string[];
}

function result(
  status: SessionBoardStatus,
  inputs: string[],
  reason?: string,
): TeamSettlement {
  return {
    status,
    redTeamRaw: null,
    blueTeamRaw: null,
    teamImp: null,
    impTableVersion: WBF_2017_VERSION,
    ...(reason ? { reason } : {}),
    inputs,
  };
}

/**
 * 聚合同一 Deal 的各桌结果。
 *
 * - 任一桌 CANCELLED → CANCELLED，不计算；
 * - 任一桌 INCOMPLETE / REOPENED / IN_PROGRESS → INCOMPLETE（或 REOPENED），不计算；
 * - 全部有原始分 → 求和并换算；有 ADJUSTED 时状态为 ADJUSTED。
 */
export function settleTeamBoards(
  boards: readonly TeamBoardInput[],
  table: ImpTable = WBF_2017,
): TeamSettlement {
  if (boards.length === 0) return result('PENDING', [], 'NO_TABLE_BOARDS');
  const inputs = boards.map((board) => board.tableBoardId);

  if (boards.some((board) => board.status === 'CANCELLED')) {
    return result('CANCELLED', inputs, 'BOARD_CANCELLED');
  }
  if (boards.some((board) => board.status === 'REOPENED')) {
    return result('REOPENED', inputs, 'BOARD_REOPENED');
  }
  if (
    boards.some(
      (board) =>
        board.status === 'INCOMPLETE' ||
        board.status === 'IN_PROGRESS' ||
        board.redTeamRaw === null,
    )
  ) {
    return result('INCOMPLETE', inputs, 'BOARD_INCOMPLETE');
  }

  const redTeamRaw = boards.reduce((sum, board) => sum + (board.redTeamRaw ?? 0), 0);
  const blueTeamRaw = -redTeamRaw;
  const teamImp = signedImpFromDiff(redTeamRaw, table);
  return {
    status: boards.some((board) => board.status === 'ADJUSTED') ? 'ADJUSTED' : 'COMPLETE',
    redTeamRaw,
    blueTeamRaw,
    teamImp,
    impTableVersion: WBF_2017_VERSION,
    inputs,
  };
}

export type AdjustGuardCode =
  | 'BOARD_CANCELLED_ADJUST_FORBIDDEN'
  | 'BOARD_STATUS_ADJUST_FORBIDDEN';

export type AdjustGuard = { allowed: true } | { allowed: false; code: AdjustGuardCode };

/**
 * 裁判调整分前置检查。
 *
 * `CANCELLED` 默认拒绝；只有先写入 `REOPENED` 审计（`hasReopenAudit`）后才允许改判。
 * 已 `ADJUSTED` 可再次调整并保留历史；`PLAYED` / `PASSED_OUT` 可直接调整。
 */
export function canAdjustBoard(input: {
  status: TeamBoardStatus;
  hasReopenAudit?: boolean;
}): AdjustGuard {
  switch (input.status) {
    case 'PLAYED':
    case 'PASSED_OUT':
    case 'ADJUSTED':
      return { allowed: true };
    case 'CANCELLED':
      return input.hasReopenAudit
        ? { allowed: true }
        : { allowed: false, code: 'BOARD_CANCELLED_ADJUST_FORBIDDEN' };
    default:
      return { allowed: false, code: 'BOARD_STATUS_ADJUST_FORBIDDEN' };
  }
}
