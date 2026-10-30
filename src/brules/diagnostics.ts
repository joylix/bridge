/**
 * BRULES v0.5 统一诊断对象。
 *
 * 诊断码来自 docs/brules-v0.5/README.md、migration.md 的稳定清单；
 * Phase 1 新增的语法/IR 校验码在此集中声明，避免散落字符串。
 */

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
  // Phase 0 已冻结
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_FEATURE'
  | 'UNSUPPORTED_CONDITION'
  | 'DUPLICATE_ID'
  | 'UNRESOLVED_REFERENCE'
  | 'INVALID_RANGE'
  | 'UNRESOLVED_STYLE_VAR'
  | 'AMBIGUOUS_RULES'
  | 'EXPANDED_DISJUNCTION'
  | 'LEGACY_WILDCARD_MIGRATED'
  | 'LEGACY_ID_PREFIX_SEMANTICS'
  | 'CONTRADICTORY_CONDITION'
  // v0.4 迁移诊断码（Phase 2 使用，先登记）
  | 'LEGACY_LHO_RHO_CONFLICT'
  | 'LHO_RHO_MANUAL_REVIEW'
  | 'LHO_RHO_UNRESOLVED'
  | 'ALLPASS_NORMALIZED'
  | 'ALLPASS_INVALID'
  | 'PASS_ALIAS_REJECTED'
  | 'INVALID_QUANTIFIER'
  | 'QUANTIFIER_REPAIRED'
  | 'SYSTEM_INFERRED'
  // Phase 2 迁移报告专用
  | 'MIGRATED_RULE'
  | 'LEGACY_BAL_MIGRATED'
  | 'LEGACY_SEAT_TOKEN'
  | 'LEGACY_CALL_TOKEN'
  | 'LEGACY_CONDITION_NORMALIZED'
  | 'LEGACY_ID_PREFIX_MISMATCH'
  | 'TAG_CONFLICT'
  // Phase 1 语法 / 语义校验
  | 'SYNTAX_ERROR'
  | 'MISSING_VERSION'
  | 'MISSING_HEADER'
  | 'DUPLICATE_HEADER'
  | 'INVALID_HEADER_VALUE'
  | 'INVALID_ID'
  | 'INVALID_CALL'
  | 'INVALID_SEQUENCE'
  | 'INVALID_CONDITION_KEY'
  | 'INVALID_CONDITION_VALUE'
  | 'INVALID_BOOLEAN'
  | 'INVALID_TAG'
  | 'INVALID_STYLE_PARAM'
  | 'DUPLICATE_STYLE_PARAM'
  | 'DUPLICATE_CONDITION'
  | 'MISSING_END'
  | 'MISSING_CONDITION'
  | 'MISSING_RULE_FIELD'
  | 'MISSING_PRIORITY'
  | 'CYCLIC_CONDITION'
  | 'CONDITION_RANGE_OUT_OF_BOUNDS'
  | 'RULE_DISABLED'
  | 'UNKNOWN_FIELD'
  | 'INVALID_SOURCE'
  | 'INVALID_RULESET'
  | 'INVALID_PRIORITY'
  | 'INVALID_DEFAULT_PRIORITY'
  | 'INVALID_SYSTEM_VERSION'
  | 'INVALID_RULE_EXAMPLE'
  | 'NORMALIZED_CALL'
  | 'YAML_PARSE_ERROR'
  | 'JSON_PARSE_ERROR';

export interface SourceLocation {
  file?: string;
  line?: number;
  column?: number;
}

export interface Diagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  location: SourceLocation;
  /** 相关规则 id（含展开后缀） */
  ruleId?: string;
  details?: Record<string, unknown>;
}

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/** 稳定排序：error → warning → info；同严重度按文件/行/列/码。 */
export function sortDiagnostics(list: Diagnostic[]): Diagnostic[] {
  return [...list].sort((a, b) => {
    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severity !== 0) return severity;
    const file = (a.location.file ?? '').localeCompare(b.location.file ?? '');
    if (file !== 0) return file;
    const line = (a.location.line ?? 0) - (b.location.line ?? 0);
    if (line !== 0) return line;
    const column = (a.location.column ?? 0) - (b.location.column ?? 0);
    if (column !== 0) return column;
    return a.code.localeCompare(b.code);
  });
}

export function countSeverity(list: Diagnostic[], severity: DiagnosticSeverity): number {
  return list.filter((item) => item.severity === severity).length;
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const location = diagnostic.location;
  const where = [
    location.file ?? '<input>',
    location.line !== undefined ? `:${location.line}` : '',
    location.column !== undefined ? `:${location.column}` : '',
  ].join('');
  const rule = diagnostic.ruleId ? ` [${diagnostic.ruleId}]` : '';
  return `${where}: ${diagnostic.severity} ${diagnostic.code}${rule}: ${diagnostic.message}`;
}
