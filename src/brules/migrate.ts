/**
 * legacy YAML / v0.4 → v0.5 IR 迁移器。
 *
 * Phase 2 的迁移对象是仓库中无文件头的 legacy YAML：
 *   - `BiddingRule` 已经是 v0.5 IR 的近似超集；
 *   - `balanced: true` 按 v0.4 `BAL` 语义改写为 `shapeClass: BAL_NO_5M`；
 *   - `balanced: false` 无损拆成两条规则（非均型 + 5 张高花的 5332）；
 *   - `nat_` 前缀改写为 `tags: ["natural", "forcing"]`；
 *   - `Pass` / `PASS` / `-` 统一为 IR `PASS`；
 *   - 每个源规则至少产生一条迁移报告项。
 *
 * 本模块不修改现有运行时、YAML 或 `src/engine/*`。迁移报告是主要交付物，
 * IR 只是可选输出；运行时切换仍属于 Phase 3。
 */

import yaml from 'js-yaml';
import { compileRules } from './compile';
import { parseDsl } from './parser';
import {
  CONDITION_KEYS,
  STYLE_PARAM_NAMES,
  isConditionKey,
  parseConditionValue,
  type ConditionValueContext,
} from './conditions';
import type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
  SourceLocation,
} from './diagnostics';
import { countSeverity, sortDiagnostics } from './diagnostics';
import { validateIr } from './validate';
import type {
  CallTokenIR,
  CompileResult,
  ConditionValueIR,
  RuleIR,
  RulesIR,
  WhenIR,
} from './types';
import { CALL_TOKEN_SET } from './types';

/** v0.4 条件键分类，来自 docs/brules-v0.5/conditions.md §6。 */
const V04_DIRECT = [
  'hcp',
  'controls',
  'spades',
  'hearts',
  'diamonds',
  'clubs',
  'balanced',
  'fourCardMajor',
  'noLongSuit',
  'noLongSuitExcept',
] as const;

const V04_PARTIAL = ['openingSeat', 'aces', 'lastBidSuit', 'lastBidLevel'] as const;

const V04_UNSUPPORTED = [
  'adjustedHcp',
  'stoppers',
  'solidSuit',
  'partnerOpened',
  'partnerCueBid',
  'myCueBid',
  'cueBidSuit',
  'cueBidSuitNot',
  'cueBidLevel',
  'partnerSuit',
  'mySuit',
  'partnerForcingNewSuit',
  'myForcingNewSuit',
  'partnerBlackwood',
  'myBlackwood',
  'agreedSuit',
  'opponentSuitFirstControl',
  'opponentSuitStopper',
  'opponentSuitNot',
  'cueSuitStopper',
  'combinedHcp',
  'combinedAces',
] as const;

const V04_CLASS = new Map<string, 'D' | 'P' | 'U' | '—'>();
for (const key of V04_DIRECT) V04_CLASS.set(key, 'D');
for (const key of V04_PARTIAL) V04_CLASS.set(key, 'P');
for (const key of V04_UNSUPPORTED) V04_CLASS.set(key, 'U');
for (const key of Object.keys(CONDITION_KEYS)) {
  if (!V04_CLASS.has(key)) V04_CLASS.set(key, '—');
}

const LEGACY_RULE_FIELDS = new Set([
  'id',
  'description',
  'sequence',
  'when',
  'action',
  'priority',
  'tags',
  'enabled',
]);

const MANUAL_REVIEW_CODES = new Set<DiagnosticCode>([
  'LHO_RHO_MANUAL_REVIEW',
  'LHO_RHO_UNRESOLVED',
  'LEGACY_LHO_RHO_CONFLICT',
  'LEGACY_ID_PREFIX_MISMATCH',
  'TAG_CONFLICT',
]);

const SUIT_BIDS = new Set([
  '1C',
  '1D',
  '1H',
  '1S',
  '2C',
  '2D',
  '2H',
  '2S',
  '3C',
  '3D',
  '3H',
  '3S',
  '4C',
  '4D',
  '4H',
  '4S',
  '5C',
  '5D',
  '5H',
  '5S',
  '6C',
  '6D',
  '6H',
  '6S',
  '7C',
  '7D',
  '7H',
  '7S',
]);

const REL_SEAT_ORDER = ['M', 'L', 'P', 'R'] as const;

export type InputVersionKind = 'legacy-yaml' | 'v0.4' | 'v0.5' | 'unsupported';

export interface DetectedVersion {
  kind: InputVersionKind;
  version?: string;
}

export type MigrationDisposition = 'executable' | 'manual-review' | 'unsupported';

export interface MigrationRuleResult {
  ruleId: string;
  line: number;
  order: number;
  status: MigrationDisposition;
  executable: boolean;
  exported: boolean;
  irRuleIds: string[];
  codes: DiagnosticCode[];
  reason: string;
}

export interface MigrationEntry {
  ruleId?: string;
  line?: number;
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  action: string;
  before?: string;
  after?: string;
  reason: string;
  changes?: string[];
  details?: Record<string, unknown>;
}

export interface MigrationCoverageKey {
  key: string;
  count: number;
  v04: 'D' | 'P' | 'U' | '—';
  disposition: 'direct' | 'shapeClass' | 'legacy-direct' | 'unused';
}

export interface MigrationCoverage {
  usedKeys: number;
  unknownKeys: string[];
  styleVars: string[];
  keys: MigrationCoverageKey[];
  shapeClass: { count: number; disposition: 'ir-only' };
  v04: {
    direct: string[];
    partial: string[];
    unsupported: string[];
    unused: string[];
  };
}

export interface MigrationSummary {
  rules: number;
  autoMigrated: number;
  manualReview: number;
  unsupported: number;
  executableSourceRules: number;
  executableIrRules: number;
  executableRate: number;
  entries: number;
  bySeverity: Record<DiagnosticSeverity, number>;
  byCode: Record<string, number>;
}

export interface MigrationReport {
  source: string;
  sourceVersion: string;
  targetVersion: '0.5';
  generatedAt: string;
  summary: MigrationSummary;
  entries: MigrationEntry[];
  rules: MigrationRuleResult[];
  unsupportedRules: Array<{
    ruleId: string;
    line: number;
    reason: string;
    codes: DiagnosticCode[];
  }>;
  coverage: MigrationCoverage;
  rulesetId: string | null;
}

export interface MigrationOptions {
  /** 诊断与 IR `source.file` 使用的文件名。 */
  file?: string;
  /** 报告中的 source；缺省等于 file。 */
  source?: string;
  /** SYSTEM 文件头；缺省从文件名推断，推断失败写 legacy。 */
  system?: string;
  systemVersion?: string;
  /** 报告 generatedAt；缺省为当前时间。 */
  generatedAt?: string;
  /** 覆盖自动推导的 STYLE_PARAMS。 */
  styleParams?: string[];
}

export interface MigrationResult {
  ir: RulesIR | null;
  report: MigrationReport;
  diagnostics: Diagnostic[];
  compiled: CompileResult | null;
}

export interface MigrationFilter {
  code?: DiagnosticCode;
  ruleId?: string;
  severity?: DiagnosticSeverity;
  status?: MigrationDisposition;
}

/** 识别输入版本。无 VERSION 头的 YAML 视为 legacy-yaml。 */
export function detectInputVersion(text: string): DetectedVersion {
  const header = /^\s*VERSION\s*:\s*BRULES\/([0-9]+(?:\.[0-9]+)*)\s*$/m.exec(text);
  if (header) {
    const version = header[1];
    if (version === '0.5') return { kind: 'v0.5', version };
    if (version === '0.4') return { kind: 'v0.4', version };
    return { kind: 'unsupported', version };
  }
  try {
    const doc = yaml.load(text) as unknown;
    if (isPlainObject(doc) && Array.isArray(doc.rules)) {
      return { kind: 'legacy-yaml' };
    }
  } catch {
    // 交给具体迁移函数给出 YAML_PARSE_ERROR。
  }
  return { kind: 'unsupported' };
}

/** 迁移入口：legacy YAML / v0.5 IR 走不同路径，v0.4 行式 DSL 明确拒绝。 */
export function migrateText(text: string, options: MigrationOptions = {}): MigrationResult {
  const detected = detectInputVersion(text);
  switch (detected.kind) {
    case 'legacy-yaml':
      return migrateLegacyYaml(text, options);
    case 'v0.5':
      return passThroughV05(text, options);
    case 'v0.4':
      return failureResult(
        'UNSUPPORTED_FEATURE',
        'v0.4 行式 DSL 解析器未在 Phase 2 实现；本阶段迁移对象是仓库内的 legacy YAML。',
        options,
        '0.4',
      );
    case 'unsupported':
      return failureResult(
        'UNSUPPORTED_VERSION',
        detected.version
          ? `不支持的 BRULES 版本 ${detected.version}`
          : '既不是 BRULES 0.4/0.5 文件，也不是含 rules 数组的 legacy YAML',
        options,
        detected.version ?? 'unknown',
      );
  }
}

/* ------------------------------------------------------------------ *
 * legacy YAML → IR
 * ------------------------------------------------------------------ */

export function migrateLegacyYaml(text: string, options: MigrationOptions = {}): MigrationResult {
  const file = options.file;
  const source = options.source ?? file ?? '<input>';
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const systemInfo = inferSystem(source, options.system);

  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch (error) {
    return failureResult(
      'YAML_PARSE_ERROR',
      `YAML 解析失败：${error instanceof Error ? error.message : String(error)}`,
      options,
      'legacy-yaml',
    );
  }
  if (!isPlainObject(doc) || !Array.isArray(doc.rules)) {
    return failureResult(
      'INVALID_RULESET',
      'legacy YAML 缺少 rules 数组',
      options,
      'legacy-yaml',
    );
  }

  const rawRules = doc.rules as unknown[];
  const lineIndex = scanRuleIdLines(text);
  const styleParams = collectStyleParams(rawRules, options.styleParams);
  const allEntries: MigrationEntry[] = [];
  const allDiagnostics: Diagnostic[] = [];
  const results: MigrationRuleResult[] = [];
  const irRules: RuleIR[] = [];
  const irOrigin = new Map<string, string>();
  const seenIds = new Map<string, number>();
  const conditionUsage = new Map<string, number>();
  let usedShapeClass = 0;

  if (systemInfo.inferred) {
    allEntries.push({
      code: 'SYSTEM_INFERRED',
      severity: 'warning',
      action: 'infer-system',
      reason: `无法从输入推断体系，SYSTEM 写为 ${systemInfo.system}`,
      after: systemInfo.system,
    });
    allDiagnostics.push({
      code: 'SYSTEM_INFERRED',
      severity: 'warning',
      message: `无法从输入推断体系，SYSTEM 写为 ${systemInfo.system}`,
      location: location(file, 1),
    });
  }

  rawRules.forEach((raw, order) => {
    const line = lineIndex[order] ?? order + 1;
    const rawId =
      isPlainObject(raw) && typeof raw.id === 'string' && raw.id.length > 0
        ? raw.id
        : `rules[${order}]`;
    const entries: MigrationEntry[] = [];
    const diagnostics: Diagnostic[] = [];
    const emit = (entry: Omit<MigrationEntry, 'ruleId' | 'line'>): void => {
      entries.push({ ruleId: rawId, line, ...entry });
      diagnostics.push({
        code: entry.code,
        severity: entry.severity,
        message: entry.reason,
        location: location(file, line),
        ruleId: rawId,
        ...(entry.details ? { details: entry.details } : {}),
      });
    };
    const report = (
      code: DiagnosticCode,
      severity: DiagnosticSeverity,
      message: string,
      details?: Record<string, unknown>,
    ): void => {
      emit({
        code,
        severity,
        action: severity === 'error' ? 'reject' : 'report',
        reason: message,
        ...(details ? { details } : {}),
      });
    };

    const reject = (reason: string, code: DiagnosticCode = 'INVALID_RULESET'): void => {
      report(code, 'error', reason);
      results.push({
        ruleId: rawId,
        line,
        order,
        status: 'unsupported',
        executable: false,
        exported: false,
        irRuleIds: [],
        codes: uniqueCodes(entries),
        reason,
      });
      allEntries.push(...entries);
      allDiagnostics.push(...diagnostics);
    };

    if (!isPlainObject(raw)) {
      reject('规则必须是 YAML 对象');
      return;
    }

    for (const key of Object.keys(raw)) {
      if (!LEGACY_RULE_FIELDS.has(key)) {
        reject(`legacy 规则不允许字段 "${key}"；迁移器不会静默丢弃`, 'UNKNOWN_FIELD');
        return;
      }
    }

    if (typeof raw.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(raw.id)) {
      reject(`规则 id 非法：${String(raw.id)}`, 'INVALID_ID');
      return;
    }
    const id = raw.id;
    const duplicateLine = seenIds.get(id.toLowerCase());
    if (duplicateLine !== undefined) {
      reject(`规则 id "${id}" 与第 ${duplicateLine} 条重复（大小写不敏感）`, 'DUPLICATE_ID');
      return;
    }
    seenIds.set(id.toLowerCase(), line);

    const priority = raw.priority;
    if (typeof priority !== 'number' || !Number.isInteger(priority)) {
      reject('priority 必须是整数', 'INVALID_PRIORITY');
      return;
    }
    if (typeof raw.sequence !== 'string') {
      reject('sequence 必须是字符串', 'INVALID_SEQUENCE');
      return;
    }
    if (typeof raw.action !== 'string') {
      reject('action 必须是字符串', 'INVALID_CALL');
      return;
    }
    if (raw.when !== undefined && !isPlainObject(raw.when)) {
      reject('when 必须是对象', 'INVALID_CONDITION_VALUE');
      return;
    }

    const changes: string[] = [];
    const sequence = normalizeSequence(raw.sequence, report, changes);
    if (sequence === null) {
      const manual = uniqueCodes(entries).some((code) => MANUAL_REVIEW_CODES.has(code));
      results.push({
        ruleId: id,
        line,
        order,
        status: manual ? 'manual-review' : 'unsupported',
        executable: false,
        exported: false,
        irRuleIds: [],
        codes: uniqueCodes(entries),
        reason: manual
          ? '序列含 LHO/RHO 等需人工确认的座位 token；规则保留在报告中，不导出 IR'
          : '叫牌序列无法规范化为 v0.5 IR；规则保留在报告中，不导出 IR',
      });
      allEntries.push(...entries);
      allDiagnostics.push(...diagnostics);
      return;
    }

    const action = normalizeCall(raw.action, report, changes, 'action');
    if (action === null) {
      results.push({
        ruleId: id,
        line,
        order,
        status: 'unsupported',
        executable: false,
        exported: false,
        irRuleIds: [],
        codes: uniqueCodes(entries),
        reason: '动作不是合法 IR 叫品',
      });
      allEntries.push(...entries);
      allDiagnostics.push(...diagnostics);
      return;
    }

    const whenResult = migrateConditions(raw.when ?? {}, {
      ruleId: id,
      line,
      file,
      styleParams,
      report,
      conditionUsage,
      changes,
    });
    usedShapeClass += whenResult.shapeClassCount;

    if (whenResult.errors > 0) {
      reject(`有 ${whenResult.errors} 个条件无法迁移`, 'UNSUPPORTED_CONDITION');
      return;
    }

    const baseWhen = sortWhen(whenResult.when);
    const sourceSpecificity = Object.keys(raw.when ?? {}).length;
    const tagResult = migrateTags(id, action, raw.tags, report, changes);
    if (tagResult.errors > 0) {
      reject('tags 无法迁移', 'INVALID_TAG');
      return;
    }
    const tags = tagResult.tags;
    const common: Omit<RuleIR, 'id' | 'when' | 'specificity'> = {
      sequence,
      action,
      priority,
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
      source: { ...(file ? { file } : {}), line },
    };

    let exportedRules: RuleIR[];
    if (whenResult.balancedFalseSplit) {
      const specificity = sourceSpecificity;
      const first: RuleIR = {
        ...common,
        id: `${id}#1`,
        when: sortWhen({ ...baseWhen, balanced: false }),
        specificity,
      };
      const second: RuleIR = {
        ...common,
        id: `${id}#2`,
        when: sortWhen({ ...baseWhen, balanced: true, fiveCardMajor: true }),
        specificity,
      };
      exportedRules = [first, second];
      changes.push('balanced:false -> #1 balanced:false + #2 balanced:true/fiveCardMajor:true');
      entries.push({
        ruleId: id,
        line,
        code: 'LEGACY_BAL_MIGRATED',
        severity: 'info',
        action: 'split-rule',
        before: 'balanced: false',
        after: `#1 ${JSON.stringify(first.when)}；#2 ${JSON.stringify(second.when)}`,
        reason: 'v0.4 balanced:false 覆盖 5 张高花的 5332；拆成两条可执行规则以无损表达',
        changes: ['balanced:false'],
      });
    } else {
      const shape = whenResult.shapeClass;
      const when = sortWhen({ ...baseWhen, ...(shape ? { shapeClass: shape } : {}) });
      exportedRules = [
        {
          ...common,
          id,
          when,
          specificity: sourceSpecificity,
        },
      ];
    }

    for (const rule of exportedRules) {
      irRules.push(rule);
      irOrigin.set(rule.id, id);
    }
    const changed = changes.length > 0;
    entries.unshift({
      ruleId: id,
      line,
      code: 'MIGRATED_RULE',
      severity: 'info',
      action: changed ? 'transform' : 'unchanged',
      before: `${raw.sequence} | ${raw.action} | ${JSON.stringify(raw.when ?? {})}`,
      after: exportedRules.map((rule) => `${rule.id} ${rule.sequence} ${rule.action}`).join('；'),
      reason: changed
        ? `已迁移；变更：${changes.join('；')}`
        : '字段已逐项等价映射，无需改写',
      ...(changes.length > 0 ? { changes } : {}),
    });

    results.push({
      ruleId: id,
      line,
      order,
      status: 'executable',
      executable: false,
      exported: true,
      irRuleIds: exportedRules.map((rule) => rule.id),
      codes: uniqueCodes(entries),
      reason: changed ? changes.join('；') : '未改写',
    });
    allEntries.push(...entries);
    allDiagnostics.push(...diagnostics);
  });

  // 先构造 IR，再跑正式校验与编译；编译器是“可执行”的唯一判据。
  const ir: RulesIR = {
    format: 'bridge-rules-ir',
    formatVersion: '0.5',
    kind: 'bidding',
    system: systemInfo.system,
    systemVersion: options.systemVersion ?? '0.5.0',
    ...(styleParams.length > 0 ? { styleParams } : {}),
    source,
    rules: irRules,
  };

  if (irRules.length === 0) {
    return finishResult({
      ir: null,
      compiled: null,
      report: buildReport({
        source,
        sourceVersion: 'legacy-yaml',
        generatedAt,
        results,
        entries: allEntries,
        diagnostics: allDiagnostics,
        coverage: buildCoverage(conditionUsage, usedShapeClass, styleParams),
        rulesetId: null,
        executableIrRules: 0,
      }),
      diagnostics: allDiagnostics,
    });
  }

  const validated = validateMigratedIr(ir, file);
  allDiagnostics.push(...validated.diagnostics);
  if (validated.errors > 0 || !validated.ir) {
    const fatal: MigrationEntry = {
      code: 'INVALID_RULESET',
      severity: 'error',
      action: 'reject',
      reason: `迁移后的 IR 未通过校验：${validated.errors} 个 error`,
    };
    allEntries.push(fatal);
    return finishResult({
      ir: null,
      compiled: null,
      report: buildReport({
        source,
        sourceVersion: 'legacy-yaml',
        generatedAt,
        results,
        entries: allEntries,
        diagnostics: allDiagnostics,
        coverage: buildCoverage(conditionUsage, usedShapeClass, styleParams),
        rulesetId: null,
        executableIrRules: 0,
      }),
      diagnostics: allDiagnostics,
    });
  }

  const compiled = compileRules(validated.ir, { ...(file ? { file } : {}) });
  allDiagnostics.push(...compiled.diagnostics);
  appendCompileEntries(compiled, results, allEntries, irOrigin);

  for (const result of results) {
    if (!result.exported) continue;
    const compiledForSource = compiled.rules.some((rule) => rule.sourceId === result.ruleId);
    result.executable = compiledForSource;
    if (!compiledForSource) {
      result.status = 'unsupported';
      result.reason = '编译器未产出可执行规则';
      continue;
    }
    const manual = result.codes.some((code) => MANUAL_REVIEW_CODES.has(code));
    if (manual) {
      result.status = 'manual-review';
      result.reason = '可执行，但含需人工确认的迁移项';
    } else {
      result.status = 'executable';
    }
  }

  return finishResult({
    ir: validated.ir,
    compiled,
    report: buildReport({
      source,
      sourceVersion: 'legacy-yaml',
      generatedAt,
      results,
      entries: allEntries,
      diagnostics: allDiagnostics,
      coverage: buildCoverage(conditionUsage, usedShapeClass, styleParams),
      rulesetId: compiled.rulesetId,
      executableIrRules: compiled.rules.length,
    }),
    diagnostics: allDiagnostics,
  });
}

/* ------------------------------------------------------------------ *
 * v0.5 直通
 * ------------------------------------------------------------------ */

function passThroughV05(text: string, options: MigrationOptions): MigrationResult {
  const file = options.file;
  const source = options.source ?? file ?? '<input>';
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const parsed = parseDsl(text, { ...(file ? { file } : {}) });
  if (!parsed.ir) {
    return failureResult(
      'INVALID_RULESET',
      `v0.5 DSL 解析/校验失败：${countSeverity(parsed.diagnostics, 'error')} 个 error`,
      options,
      '0.5',
      parsed.diagnostics,
    );
  }
  const compiled = compileRules(parsed.ir, { ...(file ? { file } : {}) });
  const results: MigrationRuleResult[] = parsed.ir.rules.map((rule, order) => ({
    ruleId: rule.id,
    line: rule.source?.line ?? order + 1,
    order,
    status: 'executable',
    executable: compiled.rules.some((item) => item.sourceId === rule.id),
    exported: true,
    irRuleIds: [rule.id],
    codes: [],
    reason: 'v0.5 DSL 直通，无迁移改写',
  }));
  for (const result of results) {
    if (!result.executable) {
      result.status = 'unsupported';
      result.reason = '编译器未产出可执行规则';
    }
  }
  const entries: MigrationEntry[] = results.map((result) => ({
    ruleId: result.ruleId,
    line: result.line,
    code: 'MIGRATED_RULE',
    severity: 'info',
    action: 'unchanged',
    reason: 'v0.5 DSL 直通，无迁移改写',
  }));
  const usage = new Map<string, number>();
  let shapeClassCount = 0;
  for (const rule of parsed.ir.rules) {
    for (const key of Object.keys(rule.when)) {
      usage.set(key, (usage.get(key) ?? 0) + 1);
      if (key === 'shapeClass') shapeClassCount += 1;
    }
  }
  return finishResult({
    ir: parsed.ir,
    compiled,
    report: buildReport({
      source,
      sourceVersion: '0.5',
      generatedAt,
      results,
      entries,
      diagnostics: [...parsed.diagnostics, ...compiled.diagnostics],
      coverage: buildCoverage(usage, shapeClassCount, parsed.ir.styleParams ?? []),
      rulesetId: compiled.rulesetId,
      executableIrRules: compiled.rules.length,
    }),
    diagnostics: [...parsed.diagnostics, ...compiled.diagnostics],
  });
}

/* ------------------------------------------------------------------ *
 * 序列、叫品与座位
 * ------------------------------------------------------------------ */

function normalizeSequence(
  raw: string,
  report: (
    code: DiagnosticCode,
    severity: DiagnosticSeverity,
    message: string,
    details?: Record<string, unknown>,
  ) => void,
  changes: string[],
): string | null {
  const value = raw.trim();
  if (value === '') {
    report('INVALID_SEQUENCE', 'error', 'sequence 不能为空');
    return null;
  }
  if (value === '^$' || value === '.*') return value;

  const tokens = value.split(/\s+/).filter(Boolean);
  const parsed: Array<{ seat: string; call: CallTokenIR }> = [];
  let allpassIndex = -1;
  let changed = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (/^(allpass|ap)$/i.test(token)) {
      if (allpassIndex !== -1) {
        report('ALLPASS_INVALID', 'error', 'allpass 只能出现一次');
        return null;
      }
      allpassIndex = index;
      continue;
    }
    const colon = token.indexOf(':');
    if (colon === -1) {
      report(
        'INVALID_SEQUENCE',
        'error',
        `序列 token "${token}" 缺少座位前缀；IR 只接受 M/P/L/R:CALL`,
      );
      return null;
    }
    const rawSeat = token.slice(0, colon).trim();
    const rawCall = token.slice(colon + 1).trim();
    const seat = normalizeSeat(rawSeat, report, changes);
    if (seat === null) return null;
    const call = normalizeCall(rawCall, report, changes, 'sequence');
    if (call === null) return null;
    if (seat !== rawSeat.toUpperCase() || call !== rawCall) changed = true;
    parsed.push({ seat, call });
  }

  if (allpassIndex !== -1 && allpassIndex !== tokens.length - 1) {
    report('ALLPASS_INVALID', 'error', 'allpass 必须是序列的最后一个 token');
    return null;
  }

  if (allpassIndex !== -1) {
    const completed = completeAuction(parsed.map((item) => item.call));
    if (!completed.valid) {
      report('ALLPASS_INVALID', 'error', 'allpass 展开后仍不能结束叫牌');
      return null;
    }
    const lastSeat = parsed.at(-1)?.seat;
    let seatIndex = lastSeat ? REL_SEAT_ORDER.indexOf(lastSeat as (typeof REL_SEAT_ORDER)[number]) : -1;
    for (let i = 0; i < completed.appended; i += 1) {
      seatIndex = (seatIndex + 1) % REL_SEAT_ORDER.length;
      parsed.push({ seat: REL_SEAT_ORDER[seatIndex], call: 'PASS' });
    }
    report(
      'ALLPASS_NORMALIZED',
      'info',
      `allpass 已规范化为 ${completed.appended} 个 PASS`,
      { appended: completed.appended },
    );
    changes.push(`allpass -> +${completed.appended} PASS`);
    changed = true;
  }

  const sequence = parsed.map((item) => `${item.seat}:${item.call}`).join(' ');
  if (changed) changes.push('序列 token 规范化');
  return sequence;
}

function normalizeSeat(
  raw: string,
  report: (
    code: DiagnosticCode,
    severity: DiagnosticSeverity,
    message: string,
    details?: Record<string, unknown>,
  ) => void,
  changes: string[],
): string | null {
  const value = raw.toUpperCase();
  if (value === 'M' || value === 'P' || value === 'L' || value === 'R') return value;
  if (value === 'PAR' || value === 'PARTNER') {
    report('LEGACY_SEAT_TOKEN', 'info', `座位 token ${raw} 改写为 P（同伴）`, {
      before: raw,
      after: 'P',
    });
    changes.push(`${raw} -> P`);
    return 'P';
  }
  if (value === 'LHO' || value === 'RHO' || value === 'ME') {
    report(
      'LHO_RHO_UNRESOLVED',
      'error',
      `座位 token ${raw} 无法在没有完整叫牌序列/发牌人的情况下重建为 M/P/L/R；规则不自动导出`,
      { before: raw },
    );
    report(
      'LHO_RHO_MANUAL_REVIEW',
      'warning',
      `v0.4 ${raw} 与 v0.5 相对座位定义不同，必须逐条人工确认`,
      { before: raw },
    );
    return null;
  }
  if (value === 'N' || value === 'E' || value === 'S' || value === 'W') {
    report(
      'UNSUPPORTED_FEATURE',
      'error',
      `绝对座位 token ${raw} 需要发牌人与当前叫牌人上下文；legacy 规则序列不自动转换`,
      { before: raw },
    );
    return null;
  }
  report('INVALID_SEQUENCE', 'error', `未知座位 token "${raw}"；只接受 M/P/L/R`);
  return null;
}

function normalizeCall(
  raw: string,
  report: (
    code: DiagnosticCode,
    severity: DiagnosticSeverity,
    message: string,
    details?: Record<string, unknown>,
  ) => void,
  changes: string[],
  where: 'action' | 'sequence',
): CallTokenIR | null {
  const value = raw.trim();
  if (value === '') {
    report('INVALID_CALL', 'error', `${where} 中的叫品为空`);
    return null;
  }
  const upper = value.toUpperCase();
  if (value === '-' || upper === 'PASS') {
    if (value !== 'PASS') changes.push(`${value} -> PASS`);
    return 'PASS';
  }
  if (value === 'P') {
    report(
      'PASS_ALIAS_REJECTED',
      'error',
      '叫品位置的单个 P 不是 Pass；Pass 必须写 - 或 PASS',
      { before: value },
    );
    return null;
  }
  if (value === 'x' || value === 'xx') {
    report(
      'INVALID_CALL',
      'error',
      `叫品 ${value} 必须大写；v0.5 中 x 不是加倍，X/XX 才是`,
      { before: value },
    );
    return null;
  }
  if (CALL_TOKEN_SET.has(upper)) {
    if (upper !== value) changes.push(`${value} -> ${upper}`);
    return upper as CallTokenIR;
  }
  report('INVALID_CALL', 'error', `非法叫品 "${value}"`, { before: value });
  return null;
}

/**
 * 补足叫牌结束所需的 PASS。
 *
 * 只处理扁平叫品列表（v0.4 BIDSEQ / allpass 展开），不把规则序列当成
 * 完整牌局。返回追加的 PASS 数，便于报告与测试。
 */
export function completeAuction(calls: readonly CallTokenIR[]): {
  calls: CallTokenIR[];
  appended: number;
  valid: boolean;
} {
  const out = [...calls];
  let bidMade = false;
  let passes = 0;
  for (const call of out) {
    if (call === 'PASS') {
      passes += 1;
    } else {
      bidMade = true;
      passes = 0;
    }
  }
  const isComplete = (): boolean => (bidMade ? passes >= 3 : out.length >= 4 && passes >= 4);
  if (isComplete()) return { calls: out, appended: 0, valid: true };
  const needed = bidMade ? 3 - passes : 4 - passes;
  if (needed < 0 || needed > 4) return { calls: out, appended: 0, valid: false };
  for (let i = 0; i < needed; i += 1) {
    out.push('PASS');
    passes += 1;
  }
  return { calls: out, appended: needed, valid: isComplete() };
}

/* ------------------------------------------------------------------ *
 * 条件与标签
 * ------------------------------------------------------------------ */

interface ConditionMigration {
  when: WhenIR;
  shapeClass: 'BAL_NO_5M' | undefined;
  shapeClassCount: number;
  balancedFalseSplit: boolean;
  errors: number;
}

function migrateConditions(
  rawWhen: Record<string, unknown>,
  context: {
    ruleId: string;
    line: number;
    file: string | undefined;
    styleParams: string[];
    conditionUsage: Map<string, number>;
    report: (
      code: DiagnosticCode,
      severity: DiagnosticSeverity,
      message: string,
      details?: Record<string, unknown>,
    ) => void;
    changes: string[];
  },
): ConditionMigration {
  const when: WhenIR = {};
  let shapeClass: 'BAL_NO_5M' | undefined;
  let shapeClassCount = 0;
  let balancedFalseSplit = false;
  let errors = 0;

  const valueContext: ConditionValueContext = {
    location: location(context.file, context.line),
    ruleId: context.ruleId,
    styleParams: new Set(context.styleParams),
    report: (code, severity, message, details) => {
      context.report(code, severity, message, details);
      if (severity === 'error') errors += 1;
    },
  };

  for (const [key, rawValue] of Object.entries(rawWhen)) {
    context.conditionUsage.set(key, (context.conditionUsage.get(key) ?? 0) + 1);

    if (key === 'balanced') {
      if (rawValue === true) {
        shapeClass = 'BAL_NO_5M';
        shapeClassCount += 1;
        context.report(
          'LEGACY_BAL_MIGRATED',
          'info',
          'v0.4 BAL（排除 5 张高花的 5332）改写为 shapeClass: BAL_NO_5M',
          { before: 'balanced: true', after: 'shapeClass: BAL_NO_5M' },
        );
        context.changes.push('balanced:true -> shapeClass:BAL_NO_5M');
      } else if (rawValue === false) {
        balancedFalseSplit = true;
      } else {
        context.report('INVALID_BOOLEAN', 'error', 'balanced 只能是 true/false', {
          value: rawValue,
        });
        errors += 1;
      }
      continue;
    }

    if (!isConditionKey(key)) {
      context.report('INVALID_CONDITION_KEY', 'error', `未登记的条件键 "${key}"`);
      errors += 1;
      continue;
    }
    if (key === 'shapeClass') {
      context.report(
        'CONTRADICTORY_CONDITION',
        'error',
        'legacy YAML 不应直接出现 shapeClass；请改写 balanced 或明确迁移意图',
      );
      errors += 1;
      continue;
    }

    const textValue = toConditionText(rawValue);
    if (textValue === null) {
      context.report('INVALID_CONDITION_VALUE', 'error', `条件 ${key} 的值类型非法`, {
        value: rawValue,
      });
      errors += 1;
      continue;
    }
    const parsed = parseConditionValue(key, textValue, valueContext);
    if (parsed === null) continue;
    when[key] = parsed;
    if (String(parsed) !== textValue) {
      context.report(
        'LEGACY_CONDITION_NORMALIZED',
        'info',
        `条件 ${key} 规范化为 "${String(parsed)}"`,
        { before: textValue, after: String(parsed) },
      );
      context.changes.push(`${key}:${textValue} -> ${String(parsed)}`);
    }
  }

  return { when, shapeClass, shapeClassCount, balancedFalseSplit, errors };
}

function toConditionText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return null;
}

function sortWhen(when: WhenIR): WhenIR {
  const out: WhenIR = {};
  for (const key of Object.keys(when).sort()) out[key] = when[key] as ConditionValueIR;
  return out;
}

function migrateTags(
  id: string,
  action: CallTokenIR,
  rawTags: unknown,
  report: (
    code: DiagnosticCode,
    severity: DiagnosticSeverity,
    message: string,
    details?: Record<string, unknown>,
  ) => void,
  changes: string[],
): { tags: string[]; errors: number } {
  const tags = Array.isArray(rawTags)
    ? rawTags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  if (rawTags !== undefined && (!Array.isArray(rawTags) || tags.length !== rawTags.length)) {
    report('INVALID_TAG', 'error', 'tags 必须是字符串数组');
    return { tags, errors: 1 };
  }
  if (!id.startsWith('nat_')) return { tags, errors: 0 };

  if (!SUIT_BIDS.has(action)) {
    report(
      'LEGACY_ID_PREFIX_MISMATCH',
      'warning',
      `nat_ 规则的动作为 ${action}，不是自然花色叫品；需人工确认，未自动加 natural/forcing`,
      { id, action },
    );
    return { tags, errors: 0 };
  }

  const conflicts = tags.filter((tag) => tag !== 'natural' && tag !== 'forcing');
  if (conflicts.length > 0) {
    report(
      'TAG_CONFLICT',
      'warning',
      `nat_ 规则已有冲突标签：${conflicts.join(', ')}；未自动改写`,
      { tags },
    );
    return { tags, errors: 0 };
  }

  const next = [...new Set([...tags, 'natural', 'forcing'])];
  report(
    'LEGACY_ID_PREFIX_SEMANTICS',
    'warning',
    'nat_ 前缀语义改写为 tags: ["natural", "forcing"]；保留原 id 便于追溯',
    { before: `id: ${id}`, after: 'tags: ["natural", "forcing"]' },
  );
  changes.push('nat_ -> tags:[natural,forcing]');
  return { tags: next, errors: 0 };
}

function collectStyleParams(rawRules: unknown[], override?: string[]): string[] {
  const used = new Set<string>();
  if (override) {
    for (const name of override) used.add(name);
  } else {
    for (const raw of rawRules) {
      if (!isPlainObject(raw) || !isPlainObject(raw.when)) continue;
      for (const value of Object.values(raw.when)) {
        if (typeof value !== 'string') continue;
        for (const match of value.matchAll(/\$\{([A-Za-z][A-Za-z0-9_]*)\}/g)) {
          used.add(match[1]);
        }
      }
    }
  }
  return STYLE_PARAM_NAMES.filter((name) => used.has(name));
}

/* ------------------------------------------------------------------ *
 * 覆盖率与报告
 * ------------------------------------------------------------------ */

function buildCoverage(
  usage: Map<string, number>,
  shapeClassCount: number,
  styleParams: string[],
): MigrationCoverage {
  const keys: MigrationCoverageKey[] = Object.keys(CONDITION_KEYS)
    .filter((key) => key !== 'shapeClass')
    .sort()
    .map((key) => {
      const count = usage.get(key) ?? 0;
      const v04 = V04_CLASS.get(key) ?? '—';
      const disposition: MigrationCoverageKey['disposition'] =
        count === 0
          ? 'unused'
          : key === 'balanced'
            ? 'shapeClass'
            : v04 === 'D'
              ? 'direct'
              : 'legacy-direct';
      return { key, count, v04, disposition };
    });
  const unknownKeys = [...usage.keys()].filter(
    (key) => key !== 'shapeClass' && !isConditionKey(key),
  );
  return {
    usedKeys: keys.filter((item) => item.count > 0).length,
    unknownKeys: unknownKeys.sort(),
    styleVars: [...styleParams],
    keys,
    shapeClass: { count: shapeClassCount, disposition: 'ir-only' },
    v04: {
      direct: [...V04_DIRECT],
      partial: [...V04_PARTIAL],
      unsupported: [...V04_UNSUPPORTED],
      unused: Object.keys(CONDITION_KEYS)
        .filter((key) => key !== 'shapeClass' && V04_CLASS.get(key) === '—')
        .sort(),
    },
  };
}

function buildReport(input: {
  source: string;
  sourceVersion: string;
  generatedAt: string;
  results: MigrationRuleResult[];
  entries: MigrationEntry[];
  diagnostics: Diagnostic[];
  coverage: MigrationCoverage;
  rulesetId: string | null;
  executableIrRules: number;
}): MigrationReport {
  const entries = stableEntries(input.entries);
  const summary = buildSummary(input.results, entries, input.executableIrRules);
  return {
    source: input.source,
    sourceVersion: input.sourceVersion,
    targetVersion: '0.5',
    generatedAt: input.generatedAt,
    summary,
    entries,
    rules: input.results,
    unsupportedRules: input.results
      .filter((result) => !result.executable)
      .map((result) => ({
        ruleId: result.ruleId,
        line: result.line,
        reason: result.reason,
        codes: result.codes,
      })),
    coverage: input.coverage,
    rulesetId: input.rulesetId,
  };
}

function buildSummary(
  results: MigrationRuleResult[],
  entries: MigrationEntry[],
  executableIrRules: number,
): MigrationSummary {
  const autoMigrated = results.filter((result) => result.status === 'executable').length;
  const manualReview = results.filter((result) => result.status === 'manual-review').length;
  const unsupported = results.filter((result) => result.status === 'unsupported').length;
  const executableSourceRules = results.filter((result) => result.executable).length;
  const byCode: Record<string, number> = {};
  const bySeverity: Record<DiagnosticSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const entry of entries) {
    byCode[entry.code] = (byCode[entry.code] ?? 0) + 1;
    bySeverity[entry.severity] += 1;
  }
  const sortedByCode: Record<string, number> = {};
  for (const code of Object.keys(byCode).sort()) sortedByCode[code] = byCode[code];
  return {
    rules: results.length,
    autoMigrated,
    manualReview,
    unsupported,
    executableSourceRules,
    executableIrRules,
    executableRate: results.length === 0 ? 0 : executableSourceRules / results.length,
    entries: entries.length,
    bySeverity,
    byCode: sortedByCode,
  };
}

/** 报告过滤：按 code / ruleId / severity / status。 */
export function filterMigrationEntries(
  entries: readonly MigrationEntry[],
  filter: MigrationFilter,
): MigrationEntry[] {
  return entries.filter((entry) => {
    if (filter.code && entry.code !== filter.code) return false;
    if (filter.severity && entry.severity !== filter.severity) return false;
    if (filter.ruleId && entry.ruleId !== filter.ruleId) return false;
    return true;
  });
}

/** 过滤规则结果；status 只作用于 per-rule 结果。 */
export function filterMigrationRules(
  rules: readonly MigrationRuleResult[],
  filter: MigrationFilter,
): MigrationRuleResult[] {
  return rules.filter((rule) => {
    if (filter.ruleId && rule.ruleId !== filter.ruleId) return false;
    if (filter.status && rule.status !== filter.status) return false;
    return true;
  });
}

function stableEntries(entries: MigrationEntry[]): MigrationEntry[] {
  const severityRank: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };
  return [...entries].sort((a, b) => {
    const line = (a.line ?? 0) - (b.line ?? 0);
    if (line !== 0) return line;
    const rule = (a.ruleId ?? '').localeCompare(b.ruleId ?? '');
    if (rule !== 0) return rule;
    const severity = severityRank[a.severity] - severityRank[b.severity];
    if (severity !== 0) return severity;
    return a.code.localeCompare(b.code);
  });
}

function appendCompileEntries(
  compiled: CompileResult,
  results: MigrationRuleResult[],
  entries: MigrationEntry[],
  irOrigin: Map<string, string>,
): void {
  for (const diagnostic of compiled.diagnostics) {
    const id = diagnostic.ruleId;
    if (!id) continue;
    const sourceId = id.replace(/#\d+$/, '');
    if (!irOrigin.has(id) && !results.some((result) => result.ruleId === sourceId)) continue;
    const result = results.find((item) => item.ruleId === sourceId);
    if (result && !result.codes.includes(diagnostic.code)) result.codes.push(diagnostic.code);
    entries.push({
      ruleId: sourceId,
      line: result?.line ?? diagnostic.location.line ?? 1,
      code: diagnostic.code,
      severity: diagnostic.severity,
      action: 'compile',
      reason: diagnostic.message,
      ...(diagnostic.details ? { details: diagnostic.details } : {}),
    });
  }
}

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

function validateMigratedIr(value: unknown, file: string | undefined): {
  ir: RulesIR | null;
  diagnostics: Diagnostic[];
  errors: number;
} {
  const result = validateIr(value, file ? { file } : {});
  return {
    ir: result.ir,
    diagnostics: result.diagnostics,
    errors: countSeverity(result.diagnostics, 'error'),
  };
}

function failureResult(
  code: DiagnosticCode,
  message: string,
  options: MigrationOptions,
  sourceVersion: string,
  extraDiagnostics: Diagnostic[] = [],
): MigrationResult {
  const source = options.source ?? options.file ?? '<input>';
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const diagnostics: Diagnostic[] = [
    ...extraDiagnostics,
    {
      code,
      severity: 'error',
      message,
      location: location(options.file, 1),
    },
  ];
  const entries: MigrationEntry[] = [
    {
      code,
      severity: 'error',
      action: 'reject',
      reason: message,
    },
  ];
  return finishResult({
    ir: null,
    compiled: null,
    report: buildReport({
      source,
      sourceVersion,
      generatedAt,
      results: [],
      entries,
      diagnostics,
      coverage: buildCoverage(new Map(), 0, []),
      rulesetId: null,
      executableIrRules: 0,
    }),
    diagnostics,
  });
}

function finishResult(result: MigrationResult): MigrationResult {
  result.diagnostics = sortDiagnostics(result.diagnostics);
  result.report.summary = buildSummary(
    result.report.rules,
    result.report.entries,
    result.report.summary.executableIrRules,
  );
  return result;
}

function inferSystem(source: string, override?: string): { system: string; inferred: boolean } {
  if (override) return { system: override, inferred: false };
  const base = (source.split(/[\\/]/).pop() ?? source).replace(/\.[^.]+$/, '');
  const cleaned = base
    .replace(/[^A-Za-z0-9_.-]/g, '-')
    .replace(/^[^A-Za-z]+/, '');
  if (/precision/i.test(cleaned)) return { system: 'precision', inferred: false };
  if (/natural/i.test(cleaned)) return { system: 'natural', inferred: false };
  return { system: 'legacy', inferred: true };
}

function scanRuleIdLines(text: string): number[] {
  const lines = text.split(/\r?\n/);
  const result: number[] = [];
  const re = /^\s*-\s+id\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/;
  for (let index = 0; index < lines.length; index += 1) {
    if (re.test(lines[index])) result.push(index + 1);
  }
  return result;
}

function uniqueCodes(entries: readonly MigrationEntry[]): DiagnosticCode[] {
  return [...new Set(entries.map((entry) => entry.code))].sort();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function location(file: string | undefined, line: number): SourceLocation {
  return { ...(file ? { file } : {}), line };
}
