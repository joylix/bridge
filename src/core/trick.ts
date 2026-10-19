import { getRank, getSuit, type SuitIndex } from '../models/card';
import type { CardPlay, Position } from '../models/gameState';

/** 该牌是否为将牌 */
export function isTrump(card: number, trumpSuit: SuitIndex | null): boolean {
  return trumpSuit !== null && getSuit(card) === trumpSuit;
}

/**
 * candidate 是否击败 current（本墩已出牌中的当前赢张）。
 * leadSuit 为本墩首攻花色；trumpSuit 为 null 表示无将。
 */
export function beatsCard(
  candidate: number,
  current: number,
  leadSuit: SuitIndex,
  trumpSuit: SuitIndex | null,
): boolean {
  const cs = getSuit(candidate);
  const bs = getSuit(current);

  if (trumpSuit !== null) {
    const cTrump = cs === trumpSuit;
    const bTrump = bs === trumpSuit;
    if (cTrump && !bTrump) return true;
    if (!cTrump && bTrump) return false;
    if (cTrump && bTrump) return getRank(candidate) > getRank(current);
  }
  // 均非将牌：只比较引牌花色
  if (cs === leadSuit && bs !== leadSuit) return true;
  if (cs !== leadSuit && bs === leadSuit) return false;
  if (cs === leadSuit && bs === leadSuit) return getRank(candidate) > getRank(current);
  return false;
}

/** 返回本墩已出牌中“当前最大”的那张牌（供打牌启发式使用） */
export function getTrickWinnerCard(plays: CardPlay[], trumpSuit: SuitIndex | null): number {
  if (plays.length === 0) throw new Error('plays 不能为空');
  const leadSuit = getSuit(plays[0].card);
  let best = plays[0].card;
  for (let i = 1; i < plays.length; i++) {
    if (beatsCard(plays[i].card, best, leadSuit, trumpSuit)) best = plays[i].card;
  }
  return best;
}

/** 赢墩判定：将牌优先，其次比较引牌花色与点数 */
export function determineTrickWinner(plays: CardPlay[], trumpSuit: SuitIndex | null): Position {
  if (plays.length === 0) throw new Error('plays 不能为空');
  const leadSuit = getSuit(plays[0].card);
  let best = plays[0];
  for (let i = 1; i < plays.length; i++) {
    if (beatsCard(plays[i].card, best.card, leadSuit, trumpSuit)) best = plays[i];
  }
  return best.position;
}
