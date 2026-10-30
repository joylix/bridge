/**
 * 内部牌号（0-51）与记录/PBN 规范牌张（如 AS、TD、2C）互转。
 */

import { getCard, getRank, getSuit } from '../models/card';

const RANK_CHARS = '23456789TJQKA';
const SUIT_CHARS = 'CDHS';

/** 牌号 → 规范牌张（点数 + 花色）。 */
export function cardToToken(card: number): string {
  if (!Number.isInteger(card) || card < 0 || card > 51) {
    throw new Error(`非法牌号: ${card}`);
  }
  return `${RANK_CHARS[getRank(card)]}${SUIT_CHARS[getSuit(card)]}`;
}

/** 规范牌张 → 牌号；大小写不敏感。 */
export function tokenToCard(token: string): number {
  const text = token.trim().toUpperCase();
  if (!/^[2-9TJQKA][CDHS]$/.test(text)) {
    throw new Error(`非法牌张: "${token}"`);
  }
  const rank = RANK_CHARS.indexOf(text[0]);
  const suit = SUIT_CHARS.indexOf(text[1]);
  return getCard(suit as 0 | 1 | 2 | 3, rank);
}
