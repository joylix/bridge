/**
 * 国际比赛分（IMP / 点数）换算。
 *
 * 把某一副的分数差换算成“点数”，采用 WBF 标准换算表。
 * 返回带符号点数：正数表示 NS 赢，负数表示 EW 赢。
 */

/** 标准 IMP 换算表：[分数差上界, 点数]（按升序排列） */
const IMP_TABLE: ReadonlyArray<readonly [limit: number, imp: number]> = [
  [10, 0],
  [40, 1],
  [80, 2],
  [120, 3],
  [160, 4],
  [210, 5],
  [260, 6],
  [310, 7],
  [360, 8],
  [420, 9],
  [490, 10],
  [590, 11],
  [740, 12],
  [890, 13],
  [1090, 14],
  [1290, 15],
  [1490, 16],
  [1740, 17],
  [1990, 18],
  [2240, 19],
  [2490, 20],
  [2990, 21],
  [3490, 22],
  [3990, 23],
  [Infinity, 24],
];

/** 分数差 → 点数绝对值（0..24） */
export function impAbsFromDiff(diff: number): number {
  const abs = Math.abs(diff);
  for (const [limit, imp] of IMP_TABLE) {
    if (abs <= limit) return imp;
  }
  return 24;
}

/** 分数差（NS − EW）→ 带符号点数（正=NS，负=EW） */
export function impsFromScoreDiff(diff: number): number {
  if (diff === 0) return 0;
  const imp = impAbsFromDiff(diff);
  return diff > 0 ? imp : -imp;
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
export function hcpAdjustedPoints(diff: number, hcpNS: number, hcpEW: number): number {
  const imp = impsFromScoreDiff(diff);
  if (imp === 0) {
    // 流局：无得分方，仅按大牌点贴点（20 为平均点力）
    return 20 - hcpNS;
  }
  const winnerHcp = imp > 0 ? hcpNS : hcpEW;
  const points = Math.abs(imp) - (winnerHcp - 20);
  return imp > 0 ? points : -points;
}
