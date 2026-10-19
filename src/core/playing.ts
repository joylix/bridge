import { getSuit, type SuitIndex } from '../models/card';
import type { Hand } from '../models/hand';

/**
 * 返回一手牌中所有合法的出牌。
 * 桥牌无“必须将吃”义务：有领出花色必须跟牌，缺门则任意出牌（含将吃/垫牌）。
 * @param hand 当前手牌
 * @param leadSuit 本墩领出花色，null 表示首攻/领出
 * @param trumpSuit 将牌花色（无将时 null）。MVP 中跟牌法律不依赖将牌，
 *                  此参数为未来“禁止/要求将吃”等地方约定预留，当前实现忽略。
 */
export function getLegalCards(hand: Hand, leadSuit: SuitIndex | null, _trumpSuit: SuitIndex | null = null): Hand {
  if (leadSuit === null) return [...hand];
  const sameSuit = hand.filter((c) => getSuit(c) === leadSuit);
  if (sameSuit.length > 0) return sameSuit;
  // 缺门：可以垫任何牌（含将吃）
  return [...hand];
}

/** 单张牌是否合法 */
export function isCardLegal(card: number, hand: Hand, leadSuit: SuitIndex | null): boolean {
  if (!hand.includes(card)) return false;
  if (leadSuit === null) return true;
  const sameSuit = hand.filter((c) => getSuit(c) === leadSuit);
  if (sameSuit.length > 0) return getSuit(card) === leadSuit;
  return true;
}
