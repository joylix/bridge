/**
 * 国际比赛分（IMP / 点数）换算。
 *
 * 把某一副的分数差换算成“点数”，采用 WBF 2017 标准换算表。
 * 返回带符号点数：正数表示 NS 赢，负数表示 EW 赢。
 *
 * 表数据与纯函数见 `impTable.ts` / `wbf-2017.json`；本文件只保留
 * 单机贴点制等上层便捷封装。
 */

import { WBF_2017, impFromDiff, signedImpFromDiff } from './impTable';

export { WBF_2017, WBF_2017_VERSION, WBF_LAWS_VERSION, impFromDiff, signedImpFromDiff } from './impTable';
export type { ImpBand, ImpTable } from './impTable';

/** 分数差 → 点数绝对值（0..24） */
export function impAbsFromDiff(diff: number, table = WBF_2017): number {
  return impFromDiff(diff, table);
}

/** 分数差（NS − EW）→ 带符号点数（正=NS，负=EW） */
export function impsFromScoreDiff(diff: number, table = WBF_2017): number {
  return signedImpFromDiff(diff, table);
}

/** 一方联手大牌点（合计 40） */
export interface SideHcp {
  NS: number;
  EW: number;
}

/**
 * 经典“贴点制”：把标准 IMP 减去胜方自身大牌点上的“贴点数”。
 *
 * 本副最终点数 = IMP −（胜方联手大牌点 − 20）
 *
 * - “胜方”＝本副得分方（IMP 为正即 NS，为负即 EW）；
 * - 全副 40 点，故（胜方点 − 20）等于双方大牌点差的一半；
 * - 结果**可为负**：拿高牌方若只赢到少量 IMP，会被倒扣，鼓励低点进局进贯；
 * - **流局（四家 Pass，无得分方）**：改由大牌点多的一方贴点给少的一方，
 *   本副点数 = 20 − hcpNS（即大牌点少的一方得正、多的一方得负）。
 *
 * 返回带符号点数（正=NS，负=EW）。
 */
export function hcpAdjustedPoints(
  diff: number,
  hcpNS: number,
  hcpEW: number,
  table = WBF_2017,
): number {
  const imp = impsFromScoreDiff(diff, table);
  if (imp === 0) {
    // 流局：无得分方，仅按大牌点贴点（20 为平均点力）
    return 20 - hcpNS;
  }
  const winnerHcp = imp > 0 ? hcpNS : hcpEW;
  const points = Math.abs(imp) - (winnerHcp - 20);
  return imp > 0 ? points : -points;
}
