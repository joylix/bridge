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

/** 调整点计算上下文：只影响叫牌估值，不参与计分/贴点。 */
export interface AdjustmentContext {
  /** 已确定的将牌花色；无将或尚未确定配合时不要加短套点 */
  trumpSuit?: SuitIndex;
  /** 同伴是否已显示支持（有将配合） */
  partnerSupported?: boolean;
  /** 敌方最后叫过的花色；用于识别敌方花色中的单张废点 */
  opponentSuit?: SuitIndex;
}

/** 单门坚固长套：7+ 张且 A/K/Q 齐全（赌博 3NT 与长套估值共用）。 */
export function isSolidSuit(hand: Hand, suit: SuitIndex): boolean {
  const cards = hand.filter((c) => getSuit(c) === suit);
  if (cards.length < 7) return false;
  const ranks = new Set(cards.map((c) => getRank(c)));
  return ranks.has(12) && ranks.has(11) && ranks.has(10); // A K Q
}

/** 指定花色中是否存在坚固长套；如 "CD" 表示梅花或方块任一坚固。 */
export function hasSolidSuit(hand: Hand, suits: string): boolean {
  const map: Record<string, SuitIndex> = { C: 0, D: 1, H: 2, S: 3 };
  for (const ch of suits.toUpperCase()) {
    const suit = map[ch];
    if (suit === undefined) continue;
    if (isSolidSuit(hand, suit)) return true;
  }
  return false;
}

/**
 * 调整点（Adjusted Points, AP）：仅用于叫牌门槛，不用于计分/贴点。
 *
 * AP = HCP
 *    + 长套点：最长花色第 5/6/7 张各 +1（最多 +3）
 *    + 短套点：将牌已配合时，旁门缺门 +3 / 单张 +2 / 双张 +1
 *    + 坚固套奖励：最长花色为 7+ 张且 A/K/Q 领衔时 +1
 *    - 敌方花色废点：敌方花色单张 K/Q/J 扣 1（最多扣 2）
 *
 * 调整量限制在 [-2, +7]，避免单凭牌型把点力估得过高。
 * 短套点只在 partnerSupported=true 且 trumpSuit 明确时计入；
 * 无将或尚未显示配合时，短套不增值。
 */
export function adjustedHcp(hand: Hand, context: AdjustmentContext = {}): number {
  const dist = distribution(hand);
  // 敌方花色里的长度通常不是进攻赢墩来源；除非它本身就是将牌。
  const scoringSuits = ([0, 1, 2, 3] as SuitIndex[]).filter(
    (suit) => suit !== context.opponentSuit || suit === context.trumpSuit,
  );
  const longest = Math.max(...scoringSuits.map((suit) => dist[suit]), 0);
  let adjustment = Math.max(0, Math.min(3, longest - 4));

  // 坚固套奖励只给最长套，避免多门长套重复奖励
  if (longest >= 7) {
    for (const suit of scoringSuits) {
      if (dist[suit] === longest && isSolidSuit(hand, suit)) {
        adjustment += 1;
        break;
      }
    }
  }

  // 短套点：有将配合时才算，且将牌本身不算短套
  if (context.partnerSupported && context.trumpSuit !== undefined) {
    for (const suit of [0, 1, 2, 3] as SuitIndex[]) {
      if (suit === context.trumpSuit) continue;
      if (dist[suit] === 0) adjustment += 3;
      else if (dist[suit] === 1) adjustment += 2;
      else if (dist[suit] === 2) adjustment += 1;
    }
  }

  // 敌方花色单张废点：单张 K/Q/J 往往被飞或被将吃，扣 1
  if (context.opponentSuit !== undefined && dist[context.opponentSuit] === 1) {
    const card = hand.find((c) => getSuit(c) === context.opponentSuit);
    if (card !== undefined) {
      const rank = getRank(card);
      if (rank >= 9 && rank <= 11) adjustment -= 1; // J/Q/K
    }
  }

  adjustment = Math.max(-2, Math.min(7, adjustment));
  return hcp(hand) + adjustment;
}
