/**
 * v0.5 运行时适配层。
 *
 * Phase 3 起，叫牌运行时不再直接消费 legacy YAML，而是统一经过：
 *
 *   legacy YAML ──migrate──┐
 *   v0.5 DSL ─────parse────┼──IR──compile──> CompiledRule[]
 *   v0.5 IR JSON/YAML ─────┘
 *
 * 编译器产出的 `specificity` / `sourceIndex` 是裁决顺序的一部分：
 * 具体度取**源条件项数量**，声明顺序取 IR 顺序，二者都不因
 * `BAL_NO_5M` 降解或 `balanced:false` 拆分而改变。
 */

import yaml from 'js-yaml';
import { compileRules } from './compile';
import type { Diagnostic } from './diagnostics';
import { sortDiagnostics } from './diagnostics';
import { detectInputVersion, migrateLegacyYaml } from './migrate';
import { parseDsl } from './parser';
import type { CompiledRule, ParseOptions, RulesIR } from './types';
import { parseIrJson, parseIrYaml } from './yaml';

export type BiddingRuleInputFormat =
  | 'legacy-yaml'
  | 'v0.5-dsl'
  | 'v0.5-ir-json'
  | 'v0.5-ir-yaml'
  | 'unsupported';

/** 一次运行时加载的完整结果。 */
export interface BiddingRuleSet {
  /** 输入来源（文件名或 `<input>`）；只用于诊断与快照。 */
  source: string;
  /** 实际识别的表面语法。 */
  format: BiddingRuleInputFormat;
  /** 体系名，来自 IR 的 SYSTEM；迁移失败时为 `unknown`。 */
  system: string;
  systemVersion?: string;
  /** 可执行规则；顺序 = IR 声明顺序，携带 specificity / sourceIndex。 */
  rules: CompiledRule[];
  diagnostics: Diagnostic[];
  /** 语义身份；没有可用 IR 时为 null。 */
  rulesetId: string | null;
  /** 解析后的 IR；迁移失败时为 null。 */
  ir: RulesIR | null;
}

export interface BiddingRuleRuntimeOptions extends ParseOptions {
  /** 快照/报告中的来源；缺省等于 file，再缺省为 `<input>`。 */
  source?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 识别表面语法。
 *
 * 顺序很重要：JSON 先于 YAML；带 `VERSION: BRULES/0.5` 的走 DSL；
 * 含 `format: bridge-rules-ir` 的 YAML 走 IR；其余含 `rules` 数组的
 * YAML 视为 legacy。
 */
export function detectBiddingRuleFormat(text: string): BiddingRuleInputFormat {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'v0.5-ir-json';

  const version = detectInputVersion(text);
  if (version.kind === 'v0.5') return 'v0.5-dsl';
  if (version.kind === 'v0.4' || version.kind === 'unsupported') return 'unsupported';

  try {
    const doc = yaml.load(text);
    if (
      isPlainObject(doc) &&
      doc.format === 'bridge-rules-ir' &&
      doc.formatVersion === '0.5'
    ) {
      return 'v0.5-ir-yaml';
    }
  } catch {
    // YAML 错误交给具体加载器给出诊断。
  }
  return 'legacy-yaml';
}

function emptySet(
  source: string,
  format: BiddingRuleInputFormat,
  diagnostics: Diagnostic[],
  system = 'unknown',
): BiddingRuleSet {
  return {
    source,
    format,
    system,
    rules: [],
    diagnostics: sortDiagnostics(diagnostics),
    rulesetId: null,
    ir: null,
  };
}

function unsupportedDiagnostic(source: string, message: string): Diagnostic {
  return {
    code: 'UNSUPPORTED_VERSION',
    severity: 'error',
    message,
    location: { file: source, line: 1 },
  };
}

/**
 * 把任意受支持的叫牌规则文本编译为运行时规则集。
 *
 * 输入含 error 时仍返回结果对象；`rules` 可能为空，`rulesetId` 为 null。
 * 调用方（loader / store）决定是抛错还是降级展示。
 */
export function compileBiddingRules(
  text: string,
  options: BiddingRuleRuntimeOptions = {},
): BiddingRuleSet {
  const source = options.source ?? options.file ?? '<input>';
  const format = detectBiddingRuleFormat(text);
  const parseOptions: ParseOptions = { ...(options.file ? { file: options.file } : {}) };

  switch (format) {
    case 'legacy-yaml': {
      const migrated = migrateLegacyYaml(text, {
        ...(options.file ? { file: options.file } : {}),
      });
      const ir = migrated.ir;
      return {
        source,
        format,
        system: ir?.system ?? 'unknown',
        ...(ir?.systemVersion ? { systemVersion: ir.systemVersion } : {}),
        rules: migrated.compiled?.rules ?? [],
        diagnostics: migrated.diagnostics,
        rulesetId: migrated.compiled?.rulesetId ?? null,
        ir,
      };
    }
    case 'v0.5-dsl': {
      const parsed = parseDsl(text, parseOptions);
      if (!parsed.ir) return emptySet(source, format, parsed.diagnostics);
      const compiled = compileRules(parsed.ir, parseOptions);
      return {
        source,
        format,
        system: parsed.ir.system,
        ...(parsed.ir.systemVersion ? { systemVersion: parsed.ir.systemVersion } : {}),
        rules: compiled.rules,
        diagnostics: sortDiagnostics([...parsed.diagnostics, ...compiled.diagnostics]),
        rulesetId: compiled.rulesetId,
        ir: parsed.ir,
      };
    }
    case 'v0.5-ir-json':
    case 'v0.5-ir-yaml': {
      const parsed =
        format === 'v0.5-ir-json' ? parseIrJson(text, parseOptions) : parseIrYaml(text, parseOptions);
      if (!parsed.ir) return emptySet(source, format, parsed.diagnostics);
      const compiled = compileRules(parsed.ir, parseOptions);
      return {
        source,
        format,
        system: parsed.ir.system,
        ...(parsed.ir.systemVersion ? { systemVersion: parsed.ir.systemVersion } : {}),
        rules: compiled.rules,
        diagnostics: sortDiagnostics([...parsed.diagnostics, ...compiled.diagnostics]),
        rulesetId: compiled.rulesetId,
        ir: parsed.ir,
      };
    }
    default:
      return emptySet(
        source,
        format,
        [
          unsupportedDiagnostic(
            source,
            '无法识别叫牌规则格式：只支持 legacy YAML、BRULES/0.5 DSL 与 v0.5 IR JSON/YAML',
          ),
        ],
      );
  }
}

/** 结果是否含阻止运行时使用的 error。 */
export function hasBiddingRuleErrors(set: BiddingRuleSet): boolean {
  return set.diagnostics.some((item) => item.severity === 'error');
}
