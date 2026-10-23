import type { Hand } from '../models/hand';
import { controls, distribution, hcp, isBalanced, losers, suitLength } from '../core/evaluate';
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
