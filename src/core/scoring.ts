import type { Contract } from '../models/gameState';
import { getSide } from '../models/gameState';

export interface ScoreResult {
  NS: number;
  EW: number;
}

/**
 * 标准桥牌计分（标准复式计分）。
 *
 * 计分约定（冻结）：doubled 与 redoubled 互斥——某定约只可能处于
 * “未加倍 / 加倍 / 再加倍”三态之一，不会同时为 true。
 *
 * 返回约定：得分归“赢分方”，另一方为 0。
 * - 完成定约：定约方获得 墩分 + 超墩分 + 奖分，防守方 0；
 * - 宕墩：防守方获得罚分，定约方 0；
 * - 流局（无定约）：双方 0（由调用方处理）。
 */
export function computeScore(contract: Contract, tricksWon: number, vulnerability: string): ScoreResult {
  const { level, suit, doubled, redoubled } = contract;
  const declSide = getSide(contract.declarer);
  const isVul = (declSide === 'NS' && (vulnerability === 'NS' || vulnerability === 'both')) ||
    (declSide === 'EW' && (vulnerability === 'EW' || vulnerability === 'both'));

  const neededTricks = level + 6;
  const overUnder = tricksWon - neededTricks;

  if (overUnder < 0) {
    return applySide(declSide, 0, undertrickPenalty(-overUnder, isVul, doubled, redoubled));
  }

  // 墩分（含加倍/再加倍倍数）
  const perTrick = suit === 'C' || suit === 'D' ? 20 : suit === 'H' || suit === 'S' ? 30 : 0;
  let trickScore = suit === 'NT' ? 40 + 30 * (level - 1) : perTrick * level;
  if (doubled) trickScore *= 2;
  if (redoubled) trickScore *= 4;

  // 超墩分
  let overtrickScore = 0;
  if (overUnder > 0) {
    if (doubled) overtrickScore = (isVul ? 200 : 100) * overUnder;
    else if (redoubled) overtrickScore = (isVul ? 400 : 200) * overUnder;
    else overtrickScore = (suit === 'C' || suit === 'D' ? 20 : 30) * overUnder;
  }

  // 奖分
  let bonus = 0;
  if (trickScore >= 100) bonus += isVul ? 500 : 300; // 成局
  else bonus += 50; // 部分定约
  if (level === 6) bonus += isVul ? 750 : 500; // 小满贯
  if (level === 7) bonus += isVul ? 1500 : 1000; // 大满贯
  if (doubled) bonus += 50; // 加倍“礼貌奖分”
  if (redoubled) bonus += 100; // 再加倍“礼貌奖分”

  const declarerTotal = trickScore + overtrickScore + bonus;
  return applySide(declSide, declarerTotal, 0);
}

/** 宕墩罚分（返回正数） */
function undertrickPenalty(down: number, isVul: boolean, doubled: boolean, redoubled: boolean): number {
  if (!doubled && !redoubled) {
    return down * (isVul ? 100 : 50);
  }
  let base: number;
  if (isVul) {
    base = 200 + 300 * (down - 1);
  } else {
    // 非局：第 1 墩 100，第 2、3 墩各 200，之后每墩 300
    base = 100 + 200 * Math.min(down - 1, 2) + 300 * Math.max(down - 3, 0);
  }
  return redoubled ? base * 2 : base;
}

/** 把分数归到相应一方 */
function applySide(declSide: 'NS' | 'EW', declarerPoints: number, defenderPoints: number): ScoreResult {
  if (declSide === 'NS') {
    return { NS: declarerPoints, EW: defenderPoints };
  }
  return { NS: defenderPoints, EW: declarerPoints };
}
