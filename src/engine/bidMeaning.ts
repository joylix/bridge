import type { Hand } from '../models/hand';
import type { BidCall, BidRecord, BidSuit, Position, StyleLevel } from '../models/gameState';
import type { BidCandidate, BiddingRule } from './types';
import { findBidCandidates } from './matcher';

const SUIT_SYMBOL: Record<BidSuit, string> = { C: '♣', D: '♦', H: '♥', S: '♠', NT: 'NT' };

/** 叫牌含义浮层展示的一条记录 */
export interface BidMeaningRow {
  position: Position;
  call: BidCall;
  meaning: string;
}

/** 两个叫品是否完全相同（供 UI 推荐高亮与预览匹配使用） */
export function sameBidCall(a: BidCall, b: BidCall): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'bid' && b.type === 'bid') return a.level === b.level && a.suit === b.suit;
  return true;
}

/**
 * 从历史记录中取得某条叫牌发生前的“当前叫品”。
 * 含义浮窗按历史前缀重算规则时使用。
 */
export function currentBidBefore(
  history: BidRecord[],
  index: number,
): { level: number; suit: BidSuit } | null {
  for (let i = index - 1; i >= 0; i--) {
    const call = history[i]?.call;
    if (call?.type === 'bid') return { level: call.level, suit: call.suit };
  }
  return null;
}

/** 无匹配规则时的自然叫品说明 */
export function genericCallMeaning(call: BidCall): string {
  switch (call.type) {
    case 'pass':
      return '不叫（Pass）';
    case 'double':
      return '加倍（X）';
    case 'redouble':
      return '再加倍（XX）';
    case 'bid':
      return `自然叫品 ${call.level}${SUIT_SYMBOL[call.suit]}（当前规则库没有更具体的约定）`;
  }
}

/** 推荐叫品：规则引擎的最高优先级候选（不含随机探索，便于人类参考） */
export function recommendedBidCandidate(
  hand: Hand,
  history: BidRecord[],
  position: Position,
  currentBid: { level: number; suit: BidSuit } | null,
  style: StyleLevel,
  rules: BiddingRule[],
): BidCandidate | null {
  return findBidCandidates(hand, history, position, currentBid, style, rules)[0] ?? null;
}

/** 在候选规则中找出与指定叫品一致的最高优先级候选 */
export function findCandidateForCall(
  hand: Hand,
  history: BidRecord[],
  position: Position,
  currentBid: { level: number; suit: BidSuit } | null,
  style: StyleLevel,
  rules: BiddingRule[],
  call: BidCall,
): BidCandidate | null {
  return (
    findBidCandidates(hand, history, position, currentBid, style, rules).find((candidate) =>
      sameBidCall(candidate.call, call),
    ) ?? null
  );
}

/** 规则候选的展示说明；纯兜底 Pass 用更自然的“不叫（Pass）” */
export function meaningForCandidate(
  candidate: { rule: BiddingRule } | null,
  call: BidCall,
): string {
  if (candidate && !(call.type === 'pass' && candidate.rule.id.startsWith('fallback'))) {
    return candidate.rule.description;
  }
  return genericCallMeaning(call);
}

/** 某条历史叫牌的规则说明；优先使用记录中保存的规则 id。 */
export function meaningForBidRecord(
  record: BidRecord,
  index: number,
  history: BidRecord[],
  hand: Hand | undefined,
  style: StyleLevel,
  rules: BiddingRule[],
): string {
  const byId = record.ruleId
    ? rules.find((rule) => rule.id === record.ruleId)
    : undefined;
  if (byId) {
    return meaningForCandidate({ rule: byId }, record.call);
  }

  if (hand) {
    const prefix = history.slice(0, index);
    const candidate = findCandidateForCall(
      hand,
      prefix,
      record.position,
      currentBidBefore(history, index),
      style,
      rules,
      record.call,
    );
    if (candidate) return meaningForCandidate(candidate, record.call);
  }
  return genericCallMeaning(record.call);
}
