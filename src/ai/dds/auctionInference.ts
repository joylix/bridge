/**
 * 从叫牌历史与规则文件推断“某座位可能持有的完整 13 张牌”。
 *
 * AI 的叫牌来自规则引擎：一条规则被选中，说明叫牌人的手牌满足该规则的 when。
 * 这里反过来利用这个承诺：对每条实际叫品，收集所有能产生该叫品的规则，
 * 用它们的 when 条件作为该座位的必要约束。人类叫牌可能不遵守规则，
 * 因此调用方可以通过 trustedSeats 排除人类座位。
 *
 * 约束作用在“完整初始手牌”上：残局剩余牌 + 该座位已经打出的牌。
 */

import type { Hand } from '../../models/hand';
import type { BidRecord, Position, StyleLevel } from '../../models/gameState';
import { getPartner } from '../../models/gameState';
import type { BiddingRule, StyleParams } from '../../engine/types';
import { STYLE_PARAMS } from '../../engine/types';
import { checkConditions, conditionSpecificity, type ConditionContext } from '../../engine/conditions';
import { buildAdjustmentContext, matchSequence } from '../../engine/matcher';
import { isCallLegal, parseAction } from '../../core/bidding/validator';
import type { BidCall } from '../../models/gameState';

export interface AuctionInferenceOptions {
  rules: BiddingRule[];
  /** 各座位当前风格；用于解析规则中的风格变量 */
  styles?: Partial<Record<Position, StyleLevel>>;
  /** 只对这些座位应用约束（通常是 AI 座位） */
  trustedSeats?: Position[];
  /** 只使用条件数不少于该值的规则，避免过宽的兜底规则误伤 */
  minSpecificity?: number;
}

export type HandPredicate = (hand: Hand) => boolean;

function sameCall(a: BidCall, b: BidCall): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'bid' && b.type === 'bid') {
    return a.level === b.level && a.suit === b.suit;
  }
  return true;
}

/** 从某个叫牌前缀还原 currentBid / doubleState，用于过滤不合法的规则动作。 */
function stateBefore(prefix: BidRecord[]): {
  currentBid: { level: number; suit: import('../../models/gameState').BidSuit } | null;
  doubleState: 'none' | 'double' | 'redouble';
} {
  let currentBid: { level: number; suit: import('../../models/gameState').BidSuit } | null = null;
  let doubleState: 'none' | 'double' | 'redouble' = 'none';
  for (const record of prefix) {
    if (record.call.type === 'bid') {
      currentBid = { level: record.call.level, suit: record.call.suit };
      doubleState = 'none';
    } else if (record.call.type === 'double') {
      doubleState = 'double';
    } else if (record.call.type === 'redouble') {
      doubleState = 'redouble';
    }
  }
  return { currentBid, doubleState };
}

function conditionContext(prefix: BidRecord[], position: Position): ConditionContext {
  const openingSeat = prefix.every((r) => r.call.type === 'pass') ? prefix.length + 1 : undefined;
  const firstBid = prefix.find((r) => r.call.type === 'bid');
  return {
    openingSeat,
    partnerOpened: firstBid ? firstBid.position === getPartner(position) : false,
    adjustment: buildAdjustmentContext(prefix, position),
  };
}

/**
 * 为每条实际叫品建立“至少一条同动作规则成立”的谓词。
 * 返回每个座位的谓词列表（每条叫品一个），便于调用方做软加权。
 */
export function buildAuctionConstraintList(
  history: BidRecord[],
  options: AuctionInferenceOptions,
): Partial<Record<Position, HandPredicate[]>> {
  const {
    rules,
    styles,
    trustedSeats,
    // 必须包含所有同动作规则：漏掉“宽规则”会让实际由宽规则产生的叫品
    // 被更具体但不适用的规则错误排除。条件越宽，约束只会越弱，不会误伤。
    minSpecificity = 0,
  } = options;
  const trusted = new Set(trustedSeats ?? (['N', 'E', 'S', 'W'] as Position[]));
  const perSeat = new Map<Position, HandPredicate[]>();

  for (let index = 0; index < history.length; index++) {
    const record = history[index];
    const { call, position } = record;
    // Pass 常常是“无候选时兜底”，不能反推手牌。
    if (call.type === 'pass' || !trusted.has(position)) continue;

    const prefix = history.slice(0, index);
    const { currentBid } = stateBefore(prefix);
    const context = conditionContext(prefix, position);
    const style = styles?.[position] ?? 1;

    const predicates: HandPredicate[] = [];
    for (const rule of rules) {
      const action = parseAction(rule.action);
      if (!sameCall(action, call)) continue;
      if (!matchSequence(prefix, rule.sequence, position)) continue;
      if (!isCallLegal(prefix, currentBid, position, call)) continue;
      if (conditionSpecificity(rule.when) < minSpecificity) continue;

      const vars: StyleParams = { ...STYLE_PARAMS[style], ...(rule.style ?? {}) };
      predicates.push((hand: Hand) => checkConditions(hand, rule.when, vars, context));
    }

    if (predicates.length === 0) continue;
    // 一次叫品可能由多条同动作规则产生，取 OR。
    const predicate: HandPredicate = (hand) => predicates.some((test) => test(hand));
    const list = perSeat.get(position) ?? [];
    list.push(predicate);
    perSeat.set(position, list);
  }

  const result: Partial<Record<Position, HandPredicate[]>> = {};
  for (const [position, predicates] of perSeat) {
    result[position] = predicates;
  }
  return result;
}

/** 为每条实际叫品建立“至少一条同动作规则成立”的谓词，再按座位取 AND。 */
export function buildAuctionConstraints(
  history: BidRecord[],
  options: AuctionInferenceOptions,
): Partial<Record<Position, HandPredicate>> {
  const list = buildAuctionConstraintList(history, options);
  const result: Partial<Record<Position, HandPredicate>> = {};
  for (const [position, predicates] of Object.entries(list) as Array<
    [Position, HandPredicate[]]
  >) {
    // 同一座位的多次叫牌都必须成立，取 AND。
    result[position] = (hand) => predicates.every((test) => test(hand));
  }
  return result;
}
