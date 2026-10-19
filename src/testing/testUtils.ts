import { getCard, type SuitIndex } from '../models/card';
import type { BidRecord, Position } from '../models/gameState';
import { parseAction } from '../core/bidding/validator';

const SUIT_MAP: Record<string, SuitIndex> = { C: 0, D: 1, H: 2, S: 3 };
const RANK_MAP: Record<string, number> = {
  '2': 0,
  '3': 1,
  '4': 2,
  '5': 3,
  '6': 4,
  '7': 5,
  '8': 6,
  '9': 7,
  T: 8,
  J: 9,
  Q: 10,
  K: 11,
  A: 12,
};

/**
 * 解析手牌字符串，格式：`"SAKQ HJT9 D2 C3"`（首字符为花色，其余为点数）。
 * 例：parseHand('SAKQ HJT D9 C3')。
 */
export function parseHand(spec: string): number[] {
  const cards: number[] = [];
  for (const token of spec.trim().split(/\s+/).filter(Boolean)) {
    const suit = SUIT_MAP[token[0].toUpperCase()];
    if (suit === undefined) throw new Error(`未知花色: ${token}`);
    for (const ch of token.slice(1)) {
      const rank = RANK_MAP[ch.toUpperCase()];
      if (rank === undefined) throw new Error(`未知点数: ${ch}`);
      cards.push(getCard(suit, rank));
    }
  }
  return cards;
}

/** 构造叫牌记录 */
export function rec(position: Position, callStr: string): BidRecord {
  return { position, call: parseAction(callStr) };
}

/** 构造叫牌历史 */
export function history(...items: [Position, string][]): BidRecord[] {
  return items.map(([p, c]) => rec(p, c));
}
