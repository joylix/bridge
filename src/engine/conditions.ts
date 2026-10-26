import type { Hand } from '../models/hand';
import {
  adjustedHcp,
  controls,
  distribution,
  hasSolidSuit,
  hcp,
  isBalanced,
  losers,
  suitLength,
  type AdjustmentContext,
} from '../core/evaluate';
import { getRank, getSuit } from '../models/card';
import type { ConditionSpec, StyleParams } from './types';

export interface ConditionContext {
  /** 当前叫牌为开叫时的座位序号（1=发牌人 … 4=第四家）；非开叫为 undefined */
  openingSeat?: number;
  /** 同伴是否是本副第一个实质叫牌人 */
  partnerOpened?: boolean;
  /** 同伴 HCP 估计下限（由叫牌序列推断） */
  partnerHcpMin?: number;
  /** 联手 HCP 估计下限（自己 HCP + 同伴下限） */
  combinedHcpMin?: number;
  /** 调整点上下文（将牌配合 / 敌方花色）；由 matcher 根据叫牌历史推断 */
  adjustment?: AdjustmentContext;

  // —— 叫牌进程上下文（由 matcher 推断）——
  partnerCueBid?: boolean;
  myCueBid?: boolean;
  cueBidActive?: boolean;
  cueBidSuit?: string;
  cueBidLevel?: number;
  partnerSuit?: string;
  mySuit?: string;
  partnerNaturalSuit?: boolean;
  myNaturalSuit?: boolean;
  partnerForcingNewSuit?: boolean;
  myForcingNewSuit?: boolean;
  lastBidSuit?: string;
  lastBidLevel?: number;
  partnerBlackwood?: boolean;
  myBlackwood?: boolean;
  /** Blackwood 约定将牌（4NT 前同伴最后自然花色） */
  agreedSuit?: string;
  /** 同伴 Blackwood 应答显示的 A 数；5C 时用 ambiguous 标记 0/4 */
  partnerAcesShown?: number;
  partnerAcesAmbiguous?: boolean;
}

/**
 * 检查手牌是否满足条件组合（扁平 AND）。
 * @param vars 当前座位的风格参数；条件中 "${name}" 会被替换为对应数值。
 * @param context 叫牌位置等非手牌上下文（如 openingSeat）。
 */
export function checkConditions(
  hand: Hand,
  spec: ConditionSpec,
  vars: StyleParams,
  context?: ConditionContext,
): boolean {
  if (spec.hcp !== undefined && !inRange(hcp(hand), spec.hcp, vars)) return false;
  if (spec.adjustedHcp !== undefined && !inRange(adjustedHcp(hand, context?.adjustment), spec.adjustedHcp, vars)) {
    return false;
  }
  if (spec.controls !== undefined && !inRange(controls(hand), spec.controls, vars)) return false;
  if (spec.spades !== undefined && !inRange(suitLength(hand, 3), spec.spades, vars)) return false;
  if (spec.hearts !== undefined && !inRange(suitLength(hand, 2), spec.hearts, vars)) return false;
  if (spec.diamonds !== undefined && !inRange(suitLength(hand, 1), spec.diamonds, vars)) return false;
  if (spec.clubs !== undefined && !inRange(suitLength(hand, 0), spec.clubs, vars)) return false;
  if (spec.balanced !== undefined && isBalanced(distribution(hand)) !== spec.balanced) return false;
  if (spec.openingSeat !== undefined) {
    if (context?.openingSeat === undefined) return false;
    if (!inRange(context.openingSeat, spec.openingSeat, vars)) return false;
  }
  if (spec.losers !== undefined && !inRange(losers(hand), spec.losers, vars)) return false;
  if (spec.voids !== undefined && !inRange(countShape(hand, 0), spec.voids, vars)) return false;
  if (spec.singletons !== undefined && !inRange(countShape(hand, 1), spec.singletons, vars)) return false;
  if (spec.doubletons !== undefined && !inRange(countShape(hand, 2), spec.doubletons, vars)) return false;
  if (spec.fourCardMajor !== undefined && hasMajor(hand, 4) !== spec.fourCardMajor) return false;
  if (spec.fiveCardMajor !== undefined && hasMajor(hand, 5) !== spec.fiveCardMajor) return false;
  if (spec.aces !== undefined && !inRange(countRank(hand, 12), spec.aces, vars)) return false;
  if (spec.kings !== undefined && !inRange(countRank(hand, 11), spec.kings, vars)) return false;
  if (spec.stoppers !== undefined && !hasStoppers(hand, spec.stoppers)) return false;
  if (spec.solidSuit !== undefined && !hasSolidSuit(hand, spec.solidSuit)) return false;
  if (spec.noLongSuit !== undefined && hasLongSuit(hand) === spec.noLongSuit) return false;
  if (spec.noLongSuitExcept !== undefined && !hasNoLongSuitExcept(hand, spec.noLongSuitExcept)) return false;
  if (spec.opponentSuitFirstControl !== undefined) {
    const opponentSuit = context?.adjustment?.opponentSuit;
    if (opponentSuit === undefined) return false;
    if (hasFirstRoundControl(hand, opponentSuit) !== spec.opponentSuitFirstControl) return false;
  }
  if (spec.opponentSuitStopper !== undefined) {
    const opponentSuit = context?.adjustment?.opponentSuit;
    if (opponentSuit === undefined) return false;
    if (hasStopper(hand, opponentSuit) !== spec.opponentSuitStopper) return false;
  }
  if (spec.opponentSuitNot !== undefined) {
    const opponentSuit = context?.adjustment?.opponentSuit;
    const excludedSuit = suitLetterToIndex(spec.opponentSuitNot);
    if (opponentSuit === undefined || excludedSuit === undefined) return false;
    if (opponentSuit === excludedSuit) return false;
  }
  if (spec.cueSuitStopper !== undefined) {
    const cueSuit = suitLetterToIndex(context?.cueBidSuit);
    if (cueSuit === undefined) return false;
    if (hasStopper(hand, cueSuit) !== spec.cueSuitStopper) return false;
  }
  if (spec.partnerCueBid !== undefined && contextBool(context?.partnerCueBid) !== spec.partnerCueBid) return false;
  if (spec.myCueBid !== undefined && contextBool(context?.myCueBid) !== spec.myCueBid) return false;
  if (spec.cueBidActive !== undefined && contextBool(context?.cueBidActive) !== spec.cueBidActive) return false;
  if (spec.cueBidSuit !== undefined && normalizeSuit(context?.cueBidSuit) !== normalizeSuit(spec.cueBidSuit)) {
    return false;
  }
  if (spec.cueBidSuitNot !== undefined) {
    if (context?.cueBidSuit === undefined) return false;
    if (normalizeSuit(context.cueBidSuit) === normalizeSuit(spec.cueBidSuitNot)) return false;
  }
  if (spec.cueBidLevel !== undefined) {
    if (context?.cueBidLevel === undefined) return false;
    if (!inRange(context.cueBidLevel, spec.cueBidLevel, vars)) return false;
  }
  if (spec.partnerSuit !== undefined && normalizeSuit(context?.partnerSuit) !== normalizeSuit(spec.partnerSuit)) {
    return false;
  }
  if (spec.mySuit !== undefined && normalizeSuit(context?.mySuit) !== normalizeSuit(spec.mySuit)) {
    return false;
  }
  if (spec.partnerNaturalSuit !== undefined && contextBool(context?.partnerNaturalSuit) !== spec.partnerNaturalSuit) {
    return false;
  }
  if (spec.myNaturalSuit !== undefined && contextBool(context?.myNaturalSuit) !== spec.myNaturalSuit) return false;
  if (
    spec.partnerForcingNewSuit !== undefined &&
    contextBool(context?.partnerForcingNewSuit) !== spec.partnerForcingNewSuit
  ) {
    return false;
  }
  if (spec.myForcingNewSuit !== undefined && contextBool(context?.myForcingNewSuit) !== spec.myForcingNewSuit) {
    return false;
  }
  if (spec.lastBidSuit !== undefined && normalizeSuit(context?.lastBidSuit) !== normalizeSuit(spec.lastBidSuit)) {
    return false;
  }
  if (spec.lastBidLevel !== undefined) {
    if (context?.lastBidLevel === undefined) return false;
    if (!inRange(context.lastBidLevel, spec.lastBidLevel, vars)) return false;
  }
  if (spec.partnerBlackwood !== undefined && contextBool(context?.partnerBlackwood) !== spec.partnerBlackwood) {
    return false;
  }
  if (spec.myBlackwood !== undefined && contextBool(context?.myBlackwood) !== spec.myBlackwood) return false;
  if (spec.agreedSuit !== undefined && normalizeSuit(context?.agreedSuit) !== normalizeSuit(spec.agreedSuit)) {
    return false;
  }
  if (spec.combinedAces !== undefined) {
    if (context?.partnerAcesShown === undefined) return false;
    const ownAces = countRank(hand, 12);
    const shownAces =
      context.partnerAcesAmbiguous === true && ownAces === 0 ? 4 : context.partnerAcesShown;
    if (!inRange(ownAces + shownAces, spec.combinedAces, vars)) return false;
  }
  if (spec.partnerOpened !== undefined) {
    if (context?.partnerOpened === undefined) return false;
    if (context.partnerOpened !== spec.partnerOpened) return false;
  }
  if (spec.partnerHcp !== undefined) {
    if (context?.partnerHcpMin === undefined) return false;
    if (!inRange(context.partnerHcpMin, spec.partnerHcp, vars)) return false;
  }
  if (spec.combinedHcp !== undefined) {
    if (context?.combinedHcpMin === undefined) return false;
    if (!inRange(context.combinedHcpMin, spec.combinedHcp, vars)) return false;
  }
  return true;
}

/** 指定长度的花色数（0=缺门，1=单张，2=双张） */
function countShape(hand: Hand, length: number): number {
  return [0, 1, 2, 3].filter((suit) => suitLength(hand, suit as 0 | 1 | 2 | 3) === length).length;
}

function hasMajor(hand: Hand, minLength: number): boolean {
  return suitLength(hand, 2) >= minLength || suitLength(hand, 3) >= minLength;
}

/** 是否至少有一门 5+ 张花色 */
function hasLongSuit(hand: Hand): boolean {
  return ([0, 1, 2, 3] as const).some((suit) => suitLength(hand, suit) >= 5);
}

/** 除指定花色外，其余花色均不超过 4 张 */
function hasNoLongSuitExcept(hand: Hand, except: string): boolean {
  const allowed = new Set(
    except
      .toUpperCase()
      .split('')
      .map((ch) => suitLetterToIndex(ch))
      .filter((suit): suit is 0 | 1 | 2 | 3 => suit !== undefined),
  );
  return ([0, 1, 2, 3] as const).every((suit) => allowed.has(suit) || suitLength(hand, suit) <= 4);
}

function suitLetterToIndex(letter: string | undefined): 0 | 1 | 2 | 3 | undefined {
  if (letter === undefined) return undefined;
  const map: Record<string, 0 | 1 | 2 | 3> = { C: 0, D: 1, H: 2, S: 3 };
  return map[letter.trim().toUpperCase()];
}

function normalizeSuit(letter: string | undefined): string | undefined {
  return letter?.trim().toUpperCase();
}

function contextBool(value: boolean | undefined): boolean {
  return value === true;
}

function countRank(hand: Hand, rank: number): number {
  return hand.filter((card) => getRank(card) === rank).length;
}

/**
 * 单手挡张（用于无将叫牌）：A/K/Q，或带护张的 J，或 Txx+。
 * 这是规则引擎的近似判断，不追求双明手意义上的绝对挡张。
 */
function hasStopper(hand: Hand, suit: 0 | 1 | 2 | 3): boolean {
  const cards = hand.filter((card) => getSuit(card) === suit);
  if (cards.some((card) => getRank(card) >= 10)) return true; // Q/K/A
  if (cards.some((card) => getRank(card) === 9) && cards.length >= 2) return true; // Jx
  if (cards.some((card) => getRank(card) === 8) && cards.length >= 3) return true; // Txx
  return false;
}

/** 第一轮控制：缺门 / 单张，或 Ax（双张且含 A）。 */
function hasFirstRoundControl(hand: Hand, suit: 0 | 1 | 2 | 3): boolean {
  const cards = hand.filter((card) => getSuit(card) === suit);
  if (cards.length <= 1) return true;
  if (cards.length === 2 && cards.some((card) => getRank(card) === 12)) return true; // Ax
  return false;
}

function hasStoppers(hand: Hand, suits: string): boolean {
  const map: Record<string, 0 | 1 | 2 | 3> = { C: 0, D: 1, H: 2, S: 3 };
  for (const ch of suits.toUpperCase()) {
    const suit = map[ch];
    if (suit === undefined) continue;
    if (!hasStopper(hand, suit)) return false;
  }
  return true;
}

/** 约束项数量：越多越具体，用于平局裁决 */
export function conditionSpecificity(spec: ConditionSpec): number {
  return Object.values(spec).filter((v) => v !== undefined).length;
}

/** 解析区间字符串："16-40" / "5+" / "12"，支持风格变量替换 */
export function inRange(value: number, rangeStr: string, vars: StyleParams): boolean {
  const s = resolveVars(rangeStr, vars).trim();
  if (s.endsWith('+')) return value >= parseInt(s, 10);
  if (s.includes('-')) {
    const [min, max] = s.split('-').map((x) => parseInt(x, 10));
    return value >= min && value <= max;
  }
  return value === parseInt(s, 10);
}

/** 将 "${name}" 替换为风格参数值，未定义时按 0 处理 */
export function resolveVars(s: string, vars: Partial<StyleParams>): string {
  return s.replace(/\$\{(\w+)\}/g, (_, name: string) => String((vars as Record<string, unknown>)[name] ?? 0));
}
