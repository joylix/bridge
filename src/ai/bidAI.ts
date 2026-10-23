import type { Hand } from '../models/hand';
import type { BidCall, BidRecord, BidSuit, Position, StyleLevel } from '../models/gameState';
import type { BidCandidate, BiddingRule } from '../engine/types';
import { findBidCandidates } from '../engine/matcher';
import { makeRng, selectBidCandidate } from '../engine/arbiter';

export interface BidAIOptions {
  style: StyleLevel;
  randomness: number;
  /** 与 store 的 rngSeed 对应，保证可复现 */
  rng: () => number;
  /** 探索时参与的次优候选数量，默认 2 */
  altPool?: number;
}

export interface BidAIResult {
  call: BidCall;
  /** 实际选中的候选；兜底 Pass 时为 null */
  candidate: BidCandidate | null;
}

/**
 * 叫牌 AI：引擎产出候选 → 裁决/探索选出 → 终极兜底 Pass（永远合法）。
 * 同时返回被选中的候选，供调用方记录叫牌含义。
 */
export function bidAIResult(
  hand: Hand,
  history: BidRecord[],
  position: Position,
  currentBid: { level: number; suit: BidSuit } | null,
  rules: BiddingRule[],
  opts: BidAIOptions,
): BidAIResult {
  const candidates = findBidCandidates(hand, history, position, currentBid, opts.style, rules);
  const picked = selectBidCandidate(candidates, {
    randomness: opts.randomness,
    rng: opts.rng,
    altPool: opts.altPool,
  });
  return {
    call: picked ? picked.call : { type: 'pass' },
    candidate: picked,
  };
}

/**
 * 叫牌 AI：引擎产出候选 → 裁决/探索选出 → 终极兜底 Pass（永远合法）。
 */
export function bidAI(
  hand: Hand,
  history: BidRecord[],
  position: Position,
  currentBid: { level: number; suit: BidSuit } | null,
  rules: BiddingRule[],
  opts: BidAIOptions,
): BidCall {
  return bidAIResult(hand, history, position, currentBid, rules, opts).call;
}

/** 便捷构造：给定种子创建可复现随机源（供外部调试） */
export { makeRng };
