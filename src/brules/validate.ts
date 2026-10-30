/**
 * BRULES v0.5 IR 校验器（JSON Schema 的语义补充）。
 *
 * 不引入第三方依赖：只覆盖 rules-ir.schema.json 的结构与语义约束。
 * 输入可以是 JSON.parse / YAML.load 的结果；校验器不修改原对象。
 */

import {
  isConditionKey,
  isStyleParam,
  validateIrConditionValue,
  type ConditionValueContext,
} from './conditions';
import type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
  SourceLocation,
} from './diagnostics';
import { sortDiagnostics } from './diagnostics';
import {
  CALL_TOKEN_SET,
  type ParseOptions,
  type ParseResult,
  type RulesIR,
} from './types';

const ROOT_FIELDS = new Set([
  'format',
  'formatVersion',
  'kind',
  'system',
  'systemVersion',
  'locale',
  'author',
  'source',
  'defaults',
  'styleParams',
  'rules',
  'ext',
]);

const RULE_FIELDS = new Set([
  'id',
  'sequence',
  'when',
  'action',
  'priority',
  'description',
  'tags',
  'enabled',
  'examples',
  'specificity',
  'source',
  'ext',
]);

const RULE_ID_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}(?:#[0-9]+)?$/;
const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const TAG_RE = /^[a-z][a-z0-9-]{0,31}$/;
const EXT_KEY_RE = /^ext\.[A-Za-z][A-Za-z0-9_.-]*$/;
const IR_SEQUENCE_TOKEN_RE = /^[MPLR]:(?:PASS|X|XX|[1-7](?:C|D|H|S|NT))$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function validateIr(value: unknown, options: ParseOptions = {}): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const report = (
    code: DiagnosticCode,
    severity: DiagnosticSeverity,
    message: string,
    location: SourceLocation,
    ruleId?: string,
    details?: Record<string, unknown>,
  ): void => {
    diagnostics.push({
      code,
      severity,
      message,
      location: { ...(options.file ? { file: options.file } : {}), ...location },
      ...(ruleId ? { ruleId } : {}),
      ...(details ? { details } : {}),
    });
  };

  if (!isPlainObject(value)) {
    report('INVALID_RULESET', 'error', 'IR 根节点必须是 JSON 对象', { line: 1 });
    return { ir: null, diagnostics: sortDiagnostics(diagnostics) };
  }

  for (const key of Object.keys(value)) {
    if (!ROOT_FIELDS.has(key)) {
      report('UNKNOWN_FIELD', 'error', `IR 根节点不允许字段 "${key}"`, { line: 1 });
    }
  }

  if (value.format !== 'bridge-rules-ir') {
    report('INVALID_HEADER_VALUE', 'error', 'format 必须是 "bridge-rules-ir"', { line: 1 });
  }
  if (value.formatVersion !== '0.5') {
    report('UNSUPPORTED_VERSION', 'error', 'formatVersion 必须是 "0.5"', { line: 1 });
  }
  if (value.kind !== 'bidding') {
    report('INVALID_HEADER_VALUE', 'error', 'kind 必须是 "bidding"', { line: 1 });
  }

  if (typeof value.system !== 'string' || !IDENTIFIER_RE.test(value.system)) {
    report('INVALID_HEADER_VALUE', 'error', 'system 必须是合法标识符', { line: 1 });
  }
  if (value.systemVersion !== undefined && (typeof value.systemVersion !== 'string' || value.systemVersion.length === 0)) {
    report('INVALID_SYSTEM_VERSION', 'error', 'systemVersion 必须是非空字符串', { line: 1 });
  }
  for (const field of ['locale', 'author', 'source'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') {
      report('INVALID_HEADER_VALUE', 'error', `${field} 必须是字符串`, { line: 1 });
    }
  }

  if (value.defaults !== undefined) {
    if (!isPlainObject(value.defaults)) {
      report('INVALID_DEFAULT_PRIORITY', 'error', 'defaults 必须是对象', { line: 1 });
    } else {
      for (const key of Object.keys(value.defaults)) {
        if (key !== 'priority') {
          report('UNKNOWN_FIELD', 'error', `defaults 不允许字段 "${key}"`, { line: 1 });
        }
      }
      if (value.defaults.priority !== undefined && !isInteger(value.defaults.priority)) {
        report('INVALID_DEFAULT_PRIORITY', 'error', 'defaults.priority 必须是整数', { line: 1 });
      }
    }
  }

  if (value.styleParams !== undefined) {
    if (!Array.isArray(value.styleParams)) {
      report('INVALID_STYLE_PARAM', 'error', 'styleParams 必须是数组', { line: 1 });
    } else {
      const seen = new Set<string>();
      for (const name of value.styleParams) {
        if (typeof name !== 'string' || !isStyleParam(name)) {
          report('INVALID_STYLE_PARAM', 'error', `未登记的风格变量 "${String(name)}"`, { line: 1 });
          continue;
        }
        if (seen.has(name)) {
          report('DUPLICATE_STYLE_PARAM', 'warning', `styleParams 重复声明 "${name}"`, { line: 1 });
        }
        seen.add(name);
      }
    }
  }

  if (value.ext !== undefined) {
    if (!isPlainObject(value.ext)) {
      report('UNKNOWN_FIELD', 'error', 'ext 必须是对象', { line: 1 });
    } else {
      for (const key of Object.keys(value.ext)) {
        if (!EXT_KEY_RE.test(key)) {
          report('UNKNOWN_FIELD', 'error', `ext 键 "${key}" 必须以 "ext." 开头`, { line: 1 });
        }
      }
    }
  }

  if (!Array.isArray(value.rules)) {
    report('INVALID_RULESET', 'error', 'rules 必须是数组', { line: 1 });
    return { ir: null, diagnostics: sortDiagnostics(diagnostics) };
  }
  if (value.rules.length === 0) {
    report('INVALID_RULESET', 'error', 'rules 至少需要一条规则', { line: 1 });
    return { ir: null, diagnostics: sortDiagnostics(diagnostics) };
  }

  const styleParams = new Set<string>(
    Array.isArray(value.styleParams)
      ? value.styleParams.filter((item): item is string => typeof item === 'string')
      : [],
  );

  const idLines = new Map<string, number>();
  value.rules.forEach((rawRule, index) => {
    const fallbackLine = index + 1;
    if (!isPlainObject(rawRule)) {
      report('INVALID_RULESET', 'error', `rules[${index}] 必须是对象`, { line: fallbackLine });
      return;
    }
    const source = isPlainObject(rawRule.source) ? rawRule.source : undefined;
    const line = isInteger(source?.line) ? source.line : fallbackLine;
    const file = typeof source?.file === 'string' ? source.file : undefined;
    const location: SourceLocation = { ...(file ? { file } : {}), line };
    const ruleId = typeof rawRule.id === 'string' ? rawRule.id : undefined;
    const valueContext: ConditionValueContext = {
      location,
      ...(ruleId ? { ruleId } : {}),
      styleParams,
      report: (code, severity, message, details) =>
        report(code, severity, message, location, ruleId, details),
    };

    for (const key of Object.keys(rawRule)) {
      if (!RULE_FIELDS.has(key)) {
        report('UNKNOWN_FIELD', 'error', `规则不允许字段 "${key}"`, location, ruleId);
      }
    }

    if (typeof rawRule.id !== 'string' || !RULE_ID_RE.test(rawRule.id)) {
      report('INVALID_ID', 'error', '规则 id 非法', location, ruleId);
    } else {
      const key = rawRule.id.toLowerCase();
      const previous = idLines.get(key);
      if (previous !== undefined) {
        report(
          'DUPLICATE_ID',
          'error',
          `规则 id "${rawRule.id}" 与第 ${previous} 条重复（大小写不敏感）`,
          location,
          rawRule.id,
        );
      } else {
        idLines.set(key, fallbackLine);
      }
    }

    if (typeof rawRule.sequence !== 'string' || !isCanonicalSequence(rawRule.sequence)) {
      report(
        'INVALID_SEQUENCE',
        'error',
        'sequence 必须是 "^$"、" .* " 或 Seat:CALL token；IR 中 Pass 写 PASS，不使用 "-" 或 Pass',
        location,
        ruleId,
      );
    }

    if (typeof rawRule.action !== 'string' || !CALL_TOKEN_SET.has(rawRule.action)) {
      report(
        'INVALID_CALL',
        'error',
        `action 必须是 IR 叫品（PASS/X/XX/1C…7NT），收到 "${String(rawRule.action)}"`,
        location,
        ruleId,
      );
    }

    if (!isInteger(rawRule.priority)) {
      report('INVALID_PRIORITY', 'error', 'priority 必须是整数', location, ruleId);
    }

    if (rawRule.description !== undefined && typeof rawRule.description !== 'string') {
      report('INVALID_RULESET', 'error', 'description 必须是字符串', location, ruleId);
    }

    if (rawRule.tags !== undefined) {
      if (!Array.isArray(rawRule.tags)) {
        report('INVALID_TAG', 'error', 'tags 必须是数组', location, ruleId);
      } else {
        const seen = new Set<string>();
        for (const tag of rawRule.tags) {
          if (typeof tag !== 'string' || !TAG_RE.test(tag)) {
            report('INVALID_TAG', 'error', `非法标签 "${String(tag)}"`, location, ruleId);
            continue;
          }
          if (seen.has(tag)) {
            report('INVALID_TAG', 'error', `标签 "${tag}" 重复`, location, ruleId);
          }
          seen.add(tag);
        }
      }
    }

    if (rawRule.enabled !== undefined && typeof rawRule.enabled !== 'boolean') {
      report('INVALID_BOOLEAN', 'error', 'enabled 必须是布尔', location, ruleId);
    }

    if (!isPlainObject(rawRule.when)) {
      report('INVALID_CONDITION_VALUE', 'error', 'when 必须是对象', location, ruleId);
    } else {
      for (const [key, conditionValue] of Object.entries(rawRule.when)) {
        if (!isConditionKey(key)) {
          report('INVALID_CONDITION_KEY', 'error', `未登记的条件键 "${key}"`, location, ruleId);
          continue;
        }
        validateIrConditionValue(key, conditionValue, valueContext);
      }
    }

    if (rawRule.specificity !== undefined) {
      if (!isInteger(rawRule.specificity) || rawRule.specificity < 0) {
        report('INVALID_RULESET', 'error', 'specificity 必须是非负整数', location, ruleId);
      } else if (isPlainObject(rawRule.when) && rawRule.specificity > Object.keys(rawRule.when).length) {
        report(
          'INVALID_RULESET',
          'error',
          `specificity=${rawRule.specificity} 大于 when 的键数 ${Object.keys(rawRule.when).length}`,
          location,
          ruleId,
        );
      }
    }

    if (rawRule.source !== undefined) {
      if (!isPlainObject(rawRule.source)) {
        report('INVALID_SOURCE', 'error', 'source 必须是对象', location, ruleId);
      } else {
        for (const key of Object.keys(rawRule.source)) {
          if (!['file', 'line', 'column'].includes(key)) {
            report('UNKNOWN_FIELD', 'error', `source 不允许字段 "${key}"`, location, ruleId);
          }
        }
        if (rawRule.source.file !== undefined && typeof rawRule.source.file !== 'string') {
          report('INVALID_SOURCE', 'error', 'source.file 必须是字符串', location, ruleId);
        }
        if (rawRule.source.line !== undefined && (!isInteger(rawRule.source.line) || rawRule.source.line < 1)) {
          report('INVALID_SOURCE', 'error', 'source.line 必须是正整数', location, ruleId);
        }
        if (
          rawRule.source.column !== undefined &&
          (!isInteger(rawRule.source.column) || rawRule.source.column < 1)
        ) {
          report('INVALID_SOURCE', 'error', 'source.column 必须是正整数', location, ruleId);
        }
      }
    }

    if (rawRule.examples !== undefined) {
      validateExamples(rawRule.examples, location, ruleId, report);
    }

    if (rawRule.ext !== undefined) {
      if (!isPlainObject(rawRule.ext)) {
        report('UNKNOWN_FIELD', 'error', '规则 ext 必须是对象', location, ruleId);
      } else {
        for (const key of Object.keys(rawRule.ext)) {
          if (!EXT_KEY_RE.test(key)) {
            report('UNKNOWN_FIELD', 'error', `规则 ext 键 "${key}" 必须以 "ext." 开头`, location, ruleId);
          }
        }
      }
    }
  });

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    return { ir: null, diagnostics: sortDiagnostics(diagnostics) };
  }
  return { ir: value as unknown as RulesIR, diagnostics: sortDiagnostics(diagnostics) };
}

function isCanonicalSequence(sequence: string): boolean {
  const value = sequence.trim();
  if (value === '^$' || value === '.*') return true;
  if (value.length === 0) return false;
  const tokens = value.split(/\s+/);
  return tokens.every((token) => IR_SEQUENCE_TOKEN_RE.test(token));
}

function validateExamples(
  examples: unknown,
  location: SourceLocation,
  ruleId: string | undefined,
  report: (
    code: DiagnosticCode,
    severity: DiagnosticSeverity,
    message: string,
    location: SourceLocation,
    ruleId?: string,
    details?: Record<string, unknown>,
  ) => void,
): void {
  if (!Array.isArray(examples)) {
    report('INVALID_RULE_EXAMPLE', 'error', 'examples 必须是数组', location, ruleId);
    return;
  }
  examples.forEach((example, index) => {
    if (!isPlainObject(example)) {
      report('INVALID_RULE_EXAMPLE', 'error', `examples[${index}] 必须是对象`, location, ruleId);
      return;
    }
    for (const key of Object.keys(example)) {
      if (!['hand', 'auction', 'expected'].includes(key)) {
        report('INVALID_RULE_EXAMPLE', 'error', `examples[${index}] 不允许字段 "${key}"`, location, ruleId);
      }
    }
    if (typeof example.hand !== 'string' || example.hand.length === 0) {
      report('INVALID_RULE_EXAMPLE', 'error', `examples[${index}].hand 必须是非空字符串`, location, ruleId);
    }
    if (example.auction !== undefined) {
      if (!Array.isArray(example.auction) || !example.auction.every((call) => typeof call === 'string' && CALL_TOKEN_SET.has(call))) {
        report('INVALID_RULE_EXAMPLE', 'error', `examples[${index}].auction 必须是 IR 叫品数组`, location, ruleId);
      }
    }
    if (example.expected !== undefined && (typeof example.expected !== 'string' || !CALL_TOKEN_SET.has(example.expected))) {
      report('INVALID_RULE_EXAMPLE', 'error', `examples[${index}].expected 必须是 IR 叫品`, location, ruleId);
    }
  });
}
