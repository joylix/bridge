/**
 * BRULES v0.5 公共入口。
 *
 * Phase 1 只新增独立解析器/编译器；现有 src/engine、src/core、YAML 与
 * 447 个基线用例不受影响。运行时切换留到 Phase 3。
 */

export { parseDsl, parseQuoted, stripComment } from './parser';
export { validateIr } from './validate';
export { parseIrJson, parseIrYaml } from './yaml';
export {
  completeAuction,
  detectInputVersion,
  filterMigrationEntries,
  filterMigrationRules,
  migrateLegacyYaml,
  migrateText,
  type DetectedVersion,
  type InputVersionKind,
  type MigrationCoverage,
  type MigrationCoverageKey,
  type MigrationDisposition,
  type MigrationEntry,
  type MigrationFilter,
  type MigrationOptions,
  type MigrationReport,
  type MigrationResult,
  type MigrationRuleResult,
  type MigrationSummary,
} from './migrate';
export {
  compileRules,
  sourceRuleId,
  toBiddingRules,
  toRuntimeAction,
  toRuntimeSequence,
} from './compile';
export {
  compileBiddingRules,
  detectBiddingRuleFormat,
  hasBiddingRuleErrors,
  type BiddingRuleInputFormat,
  type BiddingRuleRuntimeOptions,
  type BiddingRuleSet,
} from './runtime';
export { semanticProjection, computeRulesetId, type SemanticProjection } from './ruleset';
export { jcs } from './jcs';
export { sha256Hex, sha256BytesHex } from './sha256';
export {
  CONDITION_KEYS,
  SHAPE_CLASSES,
  STYLE_PARAM_NAMES,
  SUIT_ORDER,
  canonicalSuitSet,
  isConditionKey,
  isStyleParam,
  parseConditionValue,
  quantifierRange,
  suitConditionKey,
  validateIrConditionValue,
  type CompareOp,
  type ConditionDescriptor,
  type ConditionValueKind,
  type QuantifierPredicate,
  type ShapeClass,
  type StyleParamName,
  type SuitLetter,
} from './conditions';
export {
  countSeverity,
  formatDiagnostic,
  sortDiagnostics,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticSeverity,
  type SourceLocation,
} from './diagnostics';
export {
  CALL_TOKENS,
  CALL_TOKEN_SET,
  type CallTokenIR,
  type CompileResult,
  type CompiledRule,
  type ConditionValueIR,
  type ParseOptions,
  type ParseResult,
  type PipelineResult,
  type RuleExampleIR,
  type RuleIR,
  type RuleSource,
  type RulesIR,
  type WhenIR,
} from './types';

import { compileRules } from './compile';
import { sortDiagnostics } from './diagnostics';
import { parseDsl } from './parser';
import type { ParseOptions, PipelineResult } from './types';

/** DSL → IR → 可执行规则的便捷管道；任一步有 error 时 rules 为空。 */
export function compileDsl(text: string, options: ParseOptions = {}): PipelineResult {
  const parsed = parseDsl(text, options);
  if (!parsed.ir) {
    return { ir: null, rules: [], diagnostics: parsed.diagnostics, rulesetId: null };
  }
  const compiled = compileRules(parsed.ir, options);
  return {
    ir: parsed.ir,
    rules: compiled.rules,
    diagnostics: sortDiagnostics([...parsed.diagnostics, ...compiled.diagnostics]),
    rulesetId: compiled.rulesetId,
  };
}
