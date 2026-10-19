import { getRank, getSuit, type SuitIndex } from '../models/card';
import type { Hand } from '../models/hand';

/** 大牌点：J=1 Q=2 K=3 A=4 */
export function hcp(hand: Hand): number {
  return hand.reduce((sum, card) => {
    const r = getRank(card);
    if (r === 9) return sum + 1; // J
    if (r === 10) return sum + 2; // Q
    if (r === 11) return sum + 3; // K
    if (r === 12) return sum + 4; // A
    return sum;
  }, 0);
}

/** 控制点：A=2，K=1 */
export function controls(hand: Hand): number {
  return hand.reduce((sum, card) => {
    const r = getRank(card);
    if (r === 12) return sum + 2; // A
    if (r === 11) return sum + 1; // K
    return sum;
  }, 0);
}

/** 花色长度分布 */
export function distribution(hand: Hand): Record<SuitIndex, number> {
  const dist: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  hand.forEach((c) => {
    dist[getSuit(c)]++;
  });
  return dist as Record<SuitIndex, number>;
}

/**
 * 均型判定：仅 4-3-3-3、4-4-3-2、5-3-3-2 为均型。
 * 用显式形状串判定，避免“5-4-2-2 / 5-4-3-1”被误判（设计文档订正点 5）。
 */
export function isBalanced(dist: Record<SuitIndex, number>): boolean {
  const shape = Object.values(dist)
    .sort((a, b) => b - a)
    .join('');
  return shape === '4333' || shape === '4432' || shape === '5332';
}

/** 指定花色长度 */
export function suitLength(hand: Hand, suit: SuitIndex): number {
  return hand.filter((c) => getSuit(c) === suit).length;
}

/** 失张数（LTC，简单版：每门 A/K/Q 减 1，最少 0）——供后续扩展使用 */
export function losers(hand: Hand): number {
  let total = 0;
  for (const suit of [0, 1, 2, 3] as SuitIndex[]) {
    const cards = hand.filter((c) => getSuit(c) === suit);
    if (cards.length === 0) continue;
    const top = cards.filter((c) => getRank(c) >= 10).length; // Q/K/A
    total += Math.max(0, Math.min(3, cards.length) - Math.min(top, 3));
  }
  return total;
}
