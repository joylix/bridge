import type { Hand } from '../models/hand';
import { controls, distribution, hcp, isBalanced, suitLength } from '../core/evaluate';
import type { ConditionSpec, StyleParams } from './types';

export interface ConditionContext {
  /** 当前叫牌为开叫时的座位序号（1=发牌人 … 4=第四家）；非开叫为 undefined */
  openingSeat?: number;
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
