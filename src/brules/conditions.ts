/**
 * BRULES v0.5 条件词表与取值校验。
 *
 * 与 docs/brules-v0.5/conditions.md 一一对应：46 个运行时 ConditionSpec 键
 * 加 IR 专有的 shapeClass。这里只做语法/边界校验，不做手牌求值；
 * 手牌求值仍由现有 src/engine/conditions.ts 负责。
 */

import type { DiagnosticCode, DiagnosticSeverity, SourceLocation } from './diagnostics';
import type { ConditionValueIR } from './types';

export type ConditionValueKind =
  | 'numRange'
  | 'boolean'
  | 'suit'
  | 'suitSet'
  | 'suitOrNt'
  | 'shapeClass';

export interface ConditionDescriptor {
  kind: ConditionValueKind;
  /** 常量端点的文档域；风格变量无法静态检查，跳过。 */
  min?: number;
  max?: number;
}

export const SHAPE_CLASSES = ['BAL_ANY', 'BAL_NO_5M', 'SEMIBAL', 'UNBAL'] as const;
export type ShapeClass = (typeof SHAPE_CLASSES)[number];

export const STYLE_PARAM_NAMES = [
  'open1ntMin',
  'open1ntMax',
  'overcallMinHcp',
  'preemptMinLen',
  'inviteMinHcp',
  'aggression',
] as const;
export type StyleParamName = (typeof STYLE_PARAM_NAMES)[number];

export const SUIT_ORDER = ['C', 'D', 'H', 'S'] as const;
export type SuitLetter = (typeof SUIT_ORDER)[number];

const SUIT_INDEX: Record<string, number> = { C: 0, D: 1, H: 2, S: 3 };

/** 46 个运行时键 + shapeClass；顺序按语义分组，查表不依赖顺序。 */
export const CONDITION_KEYS: Readonly<Record<string, ConditionDescriptor>> = {
  // 手牌特征
  hcp: { kind: 'numRange', min: 0, max: 40 },
  adjustedHcp: { kind: 'numRange', min: 0, max: 47 },
  controls: { kind: 'numRange', min: 0, max: 12 },
  spades: { kind: 'numRange', min: 0, max: 13 },
  hearts: { kind: 'numRange', min: 0, max: 13 },
  diamonds: { kind: 'numRange', min: 0, max: 13 },
  clubs: { kind: 'numRange', min: 0, max: 13 },
  balanced: { kind: 'boolean' },
  losers: { kind: 'numRange', min: 0, max: 12 },
  voids: { kind: 'numRange', min: 0, max: 4 },
  singletons: { kind: 'numRange', min: 0, max: 4 },
  doubletons: { kind: 'numRange', min: 0, max: 4 },
  fourCardMajor: { kind: 'boolean' },
  fiveCardMajor: { kind: 'boolean' },
  aces: { kind: 'numRange', min: 0, max: 4 },
  kings: { kind: 'numRange', min: 0, max: 4 },
  stoppers: { kind: 'suitSet' },
  solidSuit: { kind: 'suitSet' },
  noLongSuit: { kind: 'boolean' },
  noLongSuitExcept: { kind: 'suitSet' },

  // 叫牌进程
  openingSeat: { kind: 'numRange', min: 1, max: 4 },
  partnerOpened: { kind: 'boolean' },
  lastBidSuit: { kind: 'suitOrNt' },
  lastBidLevel: { kind: 'numRange', min: 1, max: 7 },
  partnerCueBid: { kind: 'boolean' },
  myCueBid: { kind: 'boolean' },
  cueBidActive: { kind: 'boolean' },
  cueBidSuit: { kind: 'suit' },
  cueBidSuitNot: { kind: 'suit' },
  cueBidLevel: { kind: 'numRange', min: 1, max: 7 },
  partnerSuit: { kind: 'suit' },
  mySuit: { kind: 'suit' },
  partnerNaturalSuit: { kind: 'boolean' },
  myNaturalSuit: { kind: 'boolean' },
  partnerForcingNewSuit: { kind: 'boolean' },
  myForcingNewSuit: { kind: 'boolean' },
  partnerBlackwood: { kind: 'boolean' },
  myBlackwood: { kind: 'boolean' },
  agreedSuit: { kind: 'suit' },

  // 敌方花色
  opponentSuitFirstControl: { kind: 'boolean' },
  opponentSuitStopper: { kind: 'boolean' },
  opponentSuitNot: { kind: 'suit' },
  cueSuitStopper: { kind: 'boolean' },

  // 推断量
  partnerHcp: { kind: 'numRange', min: 0, max: 40 },
  combinedHcp: { kind: 'numRange', min: 0, max: 40 },
  combinedAces: { kind: 'numRange', min: 0, max: 8 },

  // IR 专有
  shapeClass: { kind: 'shapeClass' },
};

export function isConditionKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CONDITION_KEYS, key);
}

export function isStyleParam(name: string): name is StyleParamName {
  return (STYLE_PARAM_NAMES as readonly string[]).includes(name);
}

/** 花色集合规范化：去重检查后按 C→D→H→S 排序；非法返回 null。 */
export function canonicalSuitSet(value: string): string | null {
  const upper = value.trim().toUpperCase();
  if (!/^[CDHS]+$/.test(upper)) return null;
  const seen = new Set<string>();
  for (const letter of upper) {
    if (seen.has(letter)) return null;
    seen.add(letter);
  }
  return [...upper].sort((a, b) => SUIT_INDEX[a] - SUIT_INDEX[b]).join('');
}

export function suitConditionKey(letter: SuitLetter): string {
  switch (letter) {
    case 'C':
      return 'clubs';
    case 'D':
      return 'diamonds';
    case 'H':
      return 'hearts';
    case 'S':
      return 'spades';
  }
}

/** 复合花色集合：U=高花、L=低花；单花色原样。顺序按 C,D,H,S 规范化。 */
export function expandSuitSet(letter: string): SuitLetter[] | null {
  const upper = letter.trim().toUpperCase();
  if (upper === 'U') return ['H', 'S'];
  if (upper === 'L') return ['C', 'D'];
  if (upper === 'C' || upper === 'D' || upper === 'H' || upper === 'S') return [upper];
  return null;
}

export interface ConditionValueContext {
  location: SourceLocation;
  ruleId?: string;
  /** 省略表示“延迟校验”；DSL 解析时文件头可能出现在规则之后。 */
  styleParams?: ReadonlySet<string>;
  report: (
    code: DiagnosticCode,
    severity: DiagnosticSeverity,
    message: string,
    details?: Record<string, unknown>,
  ) => void;
}

const ATOM = String.raw`(?:\d+|\$\{[A-Za-z][A-Za-z0-9_]*\})`;
const NUM_RANGE_RE = new RegExp(`^(${ATOM})(?:-(${ATOM}))?(\\+)?$`);
const STYLE_VAR_RE = /\$\{([A-Za-z][A-Za-z0-9_]*)\}/g;

function reportStyleVars(raw: string, ctx: ConditionValueContext): void {
  if (!ctx.styleParams) return;
  for (const match of raw.matchAll(STYLE_VAR_RE)) {
    const name = match[1];
    if (!ctx.styleParams.has(name)) {
      ctx.report(
        'UNRESOLVED_STYLE_VAR',
        'error',
        `风格变量 \${${name}} 未在 STYLE_PARAMS 中声明`,
        { variable: name },
      );
    }
  }
}

function checkBounds(atom: string, descriptor: ConditionDescriptor, ctx: ConditionValueContext): void {
  if (!/^\d+$/.test(atom)) return;
  const value = Number(atom);
  if (descriptor.min !== undefined && value < descriptor.min) {
    ctx.report(
      'CONDITION_RANGE_OUT_OF_BOUNDS',
      'warning',
      `取值 ${value} 小于文档下界 ${descriptor.min}`,
      { value, min: descriptor.min, max: descriptor.max },
    );
  }
  if (descriptor.max !== undefined && value > descriptor.max) {
    ctx.report(
      'CONDITION_RANGE_OUT_OF_BOUNDS',
      'warning',
      `取值 ${value} 大于文档上界 ${descriptor.max}`,
      { value, min: descriptor.min, max: descriptor.max },
    );
  }
}

function parseNumRange(
  raw: string,
  descriptor: ConditionDescriptor,
  ctx: ConditionValueContext,
): string | null {
  const value = raw.trim();
  const match = NUM_RANGE_RE.exec(value);
  if (!match) {
    ctx.report(
      'INVALID_RANGE',
      'error',
      `非法区间 "${value}"；只允许 N、N-M、N+，端点为整数或 \${styleVar}`,
    );
    return null;
  }
  const [, first, second, plus] = match;
  if (second !== undefined && plus !== undefined) {
    ctx.report('INVALID_RANGE', 'error', `区间 "${value}" 不得同时使用 "-" 和 "+"`);
    return null;
  }
  reportStyleVars(value, ctx);
  if (second !== undefined && /^\d+$/.test(first) && /^\d+$/.test(second)) {
    if (Number(first) > Number(second)) {
      ctx.report('INVALID_RANGE', 'error', `区间 "${value}" 的下界大于上界`);
      return null;
    }
  }
  checkBounds(first, descriptor, ctx);
  if (second !== undefined) checkBounds(second, descriptor, ctx);
  return value;
}

function parseBoolean(raw: string, ctx: ConditionValueContext): boolean | null {
  const value = raw.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  ctx.report('INVALID_BOOLEAN', 'error', `布尔值只能是 true/false，收到 "${raw.trim()}"`);
  return null;
}

function parseSuit(raw: string, allowNt: boolean, ctx: ConditionValueContext): string | null {
  const value = raw.trim().toUpperCase();
  if (value === 'NT') {
    if (allowNt) return value;
    ctx.report('INVALID_CONDITION_VALUE', 'error', 'NT 只允许用于 lastBidSuit');
    return null;
  }
  if (!/^[CDHS]$/.test(value)) {
    ctx.report('INVALID_CONDITION_VALUE', 'error', `花色必须是 C/D/H/S，收到 "${raw.trim()}"`);
    return null;
  }
  return value;
}

function parseSuitSet(raw: string, ctx: ConditionValueContext): string | null {
  const value = raw.trim();
  if (!/^[CDHS]+$/i.test(value)) {
    ctx.report('INVALID_CONDITION_VALUE', 'error', `花色集合只能由 C/D/H/S 组成，收到 "${value}"`);
    return null;
  }
  const canonical = canonicalSuitSet(value);
  if (canonical === null) {
    ctx.report('INVALID_CONDITION_VALUE', 'error', `花色集合不得包含重复字母："${value}"`);
    return null;
  }
  return canonical;
}

function parseShapeClass(raw: string, ctx: ConditionValueContext): ShapeClass | null {
  const value = raw.trim().toUpperCase();
  if ((SHAPE_CLASSES as readonly string[]).includes(value)) return value as ShapeClass;
  ctx.report(
    'INVALID_CONDITION_VALUE',
    'error',
    `shapeClass 只能是 ${SHAPE_CLASSES.join(' / ')}，收到 "${raw.trim()}"`,
  );
  return null;
}

/**
 * 解析并规范化一个 DSL 条件值。
 * 返回 null 表示已报告 error，调用方应丢弃该规则。
 */
export function parseConditionValue(
  key: string,
  raw: string,
  ctx: ConditionValueContext,
): ConditionValueIR | null {
  const descriptor = CONDITION_KEYS[key];
  if (!descriptor) {
    ctx.report('INVALID_CONDITION_KEY', 'error', `未登记的条件键 "${key}"`);
    return null;
  }
  switch (descriptor.kind) {
    case 'numRange':
      return parseNumRange(raw, descriptor, ctx);
    case 'boolean':
      return parseBoolean(raw, ctx);
    case 'suit':
      return parseSuit(raw, false, ctx);
    case 'suitOrNt':
      return parseSuit(raw, true, ctx);
    case 'suitSet':
      return parseSuitSet(raw, ctx);
    case 'shapeClass':
      return parseShapeClass(raw, ctx);
  }
}

/**
 * IR 校验：值已经是字符串/布尔，要求它等于规范化结果。
 * 返回 null 表示非法（可能同时报告诊断）。
 */
export function validateIrConditionValue(
  key: string,
  value: unknown,
  ctx: ConditionValueContext,
): ConditionValueIR | null {
  const descriptor = CONDITION_KEYS[key];
  if (!descriptor) {
    ctx.report('INVALID_CONDITION_KEY', 'error', `未登记的条件键 "${key}"`);
    return null;
  }
  if (descriptor.kind === 'boolean') {
    if (typeof value !== 'boolean') {
      ctx.report('INVALID_CONDITION_VALUE', 'error', `条件 ${key} 的值必须是布尔`);
      return null;
    }
    return value;
  }
  if (typeof value !== 'string') {
    ctx.report('INVALID_CONDITION_VALUE', 'error', `条件 ${key} 的值必须是字符串`);
    return null;
  }
  const parsed = parseConditionValue(key, value, ctx);
  if (parsed === null) return null;
  if (typeof parsed === 'string' && parsed !== value) {
    ctx.report(
      'INVALID_CONDITION_VALUE',
      'error',
      `条件 ${key} 的值 "${value}" 不是规范形式；应写作 "${parsed}"`,
    );
    return null;
  }
  return parsed;
}

export type CompareOp = '>=' | '<=' | '=' | '>' | '<';
export type QuantifierPredicate = 'LEN' | 'HCP' | 'CTL';

/** 量词谓词 → 扁平区间；LEN 域 0..13，HCP 0..40，CTL 0..12。 */
export function quantifierRange(
  op: CompareOp,
  value: number,
  predicate: QuantifierPredicate,
  ctx: ConditionValueContext,
): string | null {
  const max = predicate === 'LEN' ? 13 : predicate === 'HCP' ? 40 : 12;
  if (!Number.isInteger(value) || value < 0 || value > max) {
    ctx.report(
      'INVALID_QUANTIFIER',
      'error',
      `${predicate} 的量词阈值 ${value} 超出 0-${max}`,
      { predicate, value, max },
    );
    return null;
  }
  switch (op) {
    case '>=':
      return `${value}+`;
    case '<=':
      return `0-${value}`;
    case '=':
      return `${value}`;
    case '>':
      if (value + 1 > max) {
        ctx.report('INVALID_QUANTIFIER', 'error', `${predicate}>${value} 不可能成立`);
        return null;
      }
      return `${value + 1}+`;
    case '<':
      if (value - 1 < 0) {
        ctx.report('INVALID_QUANTIFIER', 'error', `${predicate}<${value} 不可能成立`);
        return null;
      }
      return `0-${value - 1}`;
  }
}
