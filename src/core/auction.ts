/**
 * 叫牌结束判定与定约确立（纯函数）。
 *
 * 从 store 中抽出，供正式对局与无界面基准测试共用，避免两套流程产生偏差。
 */

import type { BidRecord, Contract, GameState, Position } from '../models/gameState';
import { getPartner, getSide } from '../models/gameState';

export type AuctionOutcome = 'none' | 'contract' | 'passed_out';

/**
 * 判定叫牌是否结束：
 * - 无任何叫品且已累积 4 个 Pass → 流局；
 * - 已有叫品且出现连续 3 个 Pass → 正常结束；
 * - 否则未结束。
 */
export function auctionOutcome(
  history: BidRecord[],
  currentBid: GameState['currentBid'],
): AuctionOutcome {
  if (currentBid === null) {
    if (history.length >= 4 && history.slice(-4).every((r) => r.call.type === 'pass')) {
      return 'passed_out';
    }
    return 'none';
  }
  const last3 = history.slice(-3);
  return last3.length === 3 && last3.every((r) => r.call.type === 'pass') ? 'contract' : 'none';
}

/**
 * 找庄家：最终定约花色最早叫出的定约方成员。
 * 调用前应确保 currentBid 非空且叫牌已结束。
 */
export function findDeclarer(history: BidRecord[], currentBid: NonNullable<GameState['currentBid']>): Position {
  const lastBidder = [...history]
    .reverse()
    .find((r) => r.call.type === 'bid' && r.call.level === currentBid.level && r.call.suit === currentBid.suit);
  if (!lastBidder) {
    throw new Error('叫牌记录中找不到最终定约的叫品');
  }
  const declSide = getSide(lastBidder.position);
  for (const rec of history) {
    if (rec.call.type === 'bid' && rec.call.suit === currentBid.suit && getSide(rec.position) === declSide) {
      return rec.position;
    }
  }
  return lastBidder.position;
}

/** 由叫牌记录构造最终定约；流局时返回 null。 */
export function contractFromAuction(
  history: BidRecord[],
  currentBid: GameState['currentBid'],
  doubleState: GameState['doubleState'],
): Contract | null {
  if (!currentBid) return null;
  const declarer = findDeclarer(history, currentBid);
  return {
    level: currentBid.level,
    suit: currentBid.suit,
    doubled: doubleState === 'double',
    redoubled: doubleState === 'redouble',
    declarer,
    dummy: getPartner(declarer),
  };
}
