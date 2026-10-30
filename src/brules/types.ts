/**
 * BRULES v0.5 IR 类型。
 *
 * 语义权威是 IR（见 docs/brules-v0.5/rules-ir.schema.json）；
 * DSL 与 YAML 都只是表面语法。本模块不依赖现有运行时，也不修改
 * src/engine/types.ts 的冻结接口。
 */

import type { BiddingRule } from '../engine/types';

/** IR 叫品：PASS / X / XX / 1C…7NT（大写机器令牌） */
export const CALL_TOKENS = [
  'PASS',
  'X',
  'XX',
  '1C',
  '1D',
  '1H',
  '1S',
  '1NT',
  '2C',
  '2D',
  '2H',
  '2S',
  '2NT',
  '3C',
  '3D',
  '3H',
  '3S',
  '3NT',
  '4C',
  '4D',
  '4H',
  '4S',
  '4NT',
  '5C',
  '5D',
  '5H',
  '5S',
  '5NT',
  '6C',
  '6D',
  '6H',
  '6S',
  '6NT',
  '7C',
  '7D',
  '7H',
  '7S',
  '7NT',
] as const;

export type CallTokenIR = (typeof CALL_TOKENS)[number];

export const CALL_TOKEN_SET: ReadonlySet<string> = new Set(CALL_TOKENS);

/** 条件值：IR 只允许字符串或布尔；数字区间用字符串表达。 */
export type ConditionValueIR = string | boolean;

export type WhenIR = Record<string, ConditionValueIR>;

export interface RuleSource {
  file?: string;
  line?: number;
  column?: number;
}

export interface RuleIR {
  id: string;
  sequence: string;
  when: WhenIR;
  action: CallTokenIR;
  priority: number;
  description?: string;
  tags?: string[];
  enabled?: boolean;
  examples?: RuleExampleIR[];
  /** 源条件项数量，在 ANY/ALL、BAL_NO_5M 等展开前计算。 */
  specificity?: number;
  source?: RuleSource;
  ext?: Record<string, unknown>;
}

export interface RuleExampleIR {
  hand: string;
  auction?: CallTokenIR[];
  expected?: CallTokenIR;
}

export interface RulesIR {
  format: 'bridge-rules-ir';
  formatVersion: '0.5';
  kind: 'bidding';
  system: string;
  systemVersion?: string;
  locale?: string;
  author?: string;
  source?: string;
  defaults?: { priority?: number };
  styleParams?: string[];
  rules: RuleIR[];
  ext?: Record<string, unknown>;
}

export interface ParseOptions {
  /** 写入诊断与规则 source 的文件名；不参与语义投影。 */
  file?: string;
}

export interface ParseResult {
  /** 有 error 级诊断时为 null；warning 不阻止产出 IR。 */
  ir: RulesIR | null;
  diagnostics: import('./diagnostics').Diagnostic[];
}

/**
 * 编译器输出：在现有 BiddingRule 上附加源信息。
 *
 * `specificity` 是源条件项数量；Phase 3 起 matcher 优先读取该字段，
 * 缺省时才回退到扁平 `when` 计数。`sourceIndex` 保留 IR 声明顺序。
 */
export interface CompiledRule extends BiddingRule {
  specificity: number;
  sourceIndex: number;
  sourceId: string;
  /**
   * IR 语义标签。运行时用于 `partnerForcingNewSuit` / `myForcingNewSuit`，
   * 不再依赖规则 id 的 `nat_` 前缀。`toBiddingRules()` 会剥离此字段。
   */
  tags?: string[];
  /** IR 源位置；用于诊断，不进入 BiddingRule。 */
  source?: RuleSource;
}

export interface CompileResult {
  /** 可执行规则；顺序 = IR 声明顺序（展开产物按展开顺序插入）。 */
  rules: CompiledRule[];
  diagnostics: import('./diagnostics').Diagnostic[];
  /** 对完整 IR 计算的语义身份，与是否可执行无关。 */
  rulesetId: string;
}

export interface PipelineResult {
  ir: RulesIR | null;
  rules: CompiledRule[];
  diagnostics: import('./diagnostics').Diagnostic[];
  rulesetId: string | null;
}
