/** 双明手（DDS）分析相关类型与纯函数。 */

import type { BidSuit, GameState, Position } from '../../models/gameState';
import type { SuitIndex } from '../../models/card';

/** DDS 结果表行顺序：♠ ♥ ♦ ♣ NT */
export type DdStrain = 'S' | 'H' | 'D' | 'C' | 'NT';

export const DD_STRAINS: readonly DdStrain[] = ['S', 'H', 'D', 'C', 'NT'];

/** DDS 结果表列顺序：N E S W */
export const DD_SEATS: readonly Position[] = ['N', 'E', 'S', 'W'];

export interface DdsParResult {
  /** Par 分数（从 NS 视角；负数表示 EW 得分） */
  score: number;
  /** DDS 原始 Par 定约字符串，如 `4H*-NS-1` */
  contracts: string[];
}

export interface DdsAnalysis {
  /** [5][4]：行=将牌（♠♥♦♣NT），列=庄家（NESW），值为可赢墩数 */
  table: number[][];
  par: DdsParResult | null;
  elapsedMs: number;
}

export interface DdsAnalyzeRequest {
  id: number;
  type: 'analyze';
  pbn: string;
  dealer: Position;
  vulnerability: GameState['vulnerability'];
}

export interface DdsAnalyzeSuccess {
  id: number;
  ok: true;
  table: number[][];
  par: DdsParResult | null;
  elapsedMs: number;
}

export interface DdsAnalyzeFailure {
  id: number;
  ok: false;
  error: string;
}

export type DdsAnalyzeResponse = DdsAnalyzeSuccess | DdsAnalyzeFailure;

/* ------------------------------------------------------------------ *
 * 打牌求解（残局 SolveBoardPBN）
 * ------------------------------------------------------------------ */

/** 单个残局样本的 DDS 输入（剩余牌不含本墩已出的牌）。 */
export interface DdsPlaySample {
  remainCards: string;
  trump: number;
  first: number;
  /** 本墩已出牌的花色（DDS 编码），未用位置填 0 */
  currentTrickSuit: number[];
  /** 本墩已出牌的点数（2..14），未用位置填 0 */
  currentTrickRank: number[];
}

export interface DdsPlayCard {
  suit: number;
  rank: number;
  /** 等值低牌位图 */
  equals: number;
  /** 该牌可取得的墩数（从出牌方视角；用于同一残局内比较） */
  score: number;
}

export interface DdsPlaySampleResult {
  cards: DdsPlayCard[];
}

export interface DdsPlayRequest {
  id: number;
  type: 'play';
  samples: DdsPlaySample[];
}

export interface DdsPlaySuccess {
  id: number;
  ok: true;
  samples: DdsPlaySampleResult[];
  elapsedMs: number;
}

export interface DdsPlayFailure {
  id: number;
  ok: false;
  error: string;
}

export type DdsPlayResponse = DdsPlaySuccess | DdsPlayFailure;

export type DdsWorkerResponse = DdsAnalyzeResponse | DdsPlayResponse;

export function dealerToDds(dealer: Position): number {
  return DD_SEATS.indexOf(dealer);
}

/** 内部花色（C=0,D=1,H=2,S=3）→ DDS 花色（S=0,H=1,D=2,C=3） */
export function suitToDds(suit: SuitIndex): number {
  return 3 - suit;
}

/** DDS 花色 → 内部花色 */
export function ddsToSuit(ddsSuit: number): SuitIndex {
  return (3 - ddsSuit) as SuitIndex;
}

/** 叫牌花色 → DDS 将牌编码（S=0,H=1,D=2,C=3,NT=4） */
export function bidSuitToDds(suit: BidSuit): number {
  switch (suit) {
    case 'S':
      return 0;
    case 'H':
      return 1;
    case 'D':
      return 2;
    case 'C':
      return 3;
    case 'NT':
      return 4;
  }
}

/** 内部点数（0=2 ... 12=A）→ DDS 点数（2..14） */
export function rankToDds(rank: number): number {
  return rank + 2;
}

/** DDS 点数 → 内部点数 */
export function ddsToRank(rank: number): number {
  return rank - 2;
}

/** DDS 的局况枚举：0=None, 1=Both, 2=NS, 3=EW */
export function vulnerabilityToDds(vulnerability: GameState['vulnerability']): number {
  switch (vulnerability) {
    case 'both':
      return 1;
    case 'NS':
      return 2;
    case 'EW':
      return 3;
    case 'none':
    default:
      return 0;
  }
}

/** Par 分数从 NS 视角显示。 */
export function formatParScore(score: number): string {
  if (score === 0) return '平';
  return score > 0 ? `NS +${score}` : `EW +${-score}`;
}

export interface MakeableContract {
  strain: DdStrain;
  tricks: number;
  seats: Position[];
}

/**
 * 从 DD 表提取“能拿到 7 墩及以上”的定约（按行取该行最高墩数）。
 * 只用于展示摘要，不参与裁决。
 */
export function makeableContracts(table: number[][]): MakeableContract[] {
  const result: MakeableContract[] = [];
  DD_STRAINS.forEach((strain, row) => {
    const values = table[row] ?? [];
    const tricks = Math.max(0, ...values);
    if (tricks < 7) return;
    const seats = DD_SEATS.filter((_, col) => values[col] === tricks);
    result.push({ strain, tricks, seats });
  });
  return result;
}
