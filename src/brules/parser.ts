/**
 * BRULES v0.5 行式 DSL 解析器。
 *
 * 输入是 docs/brules-v0.5/grammar.ebnf 定义的表面语法；输出是 IR。
 * 解析器不依赖现有运行时，也不读取 YAML。
 *
 * 关键语义：
 * - 同一 RULE/COND 内条件是扁平 AND。
 * - ANY/ALL 在进入 IR 前展开：ANY(U,LEN>=5) 生成两条规则，
 *   ALL(U,LEN>=5) 生成一条含两个条件的规则。
 * - specificity 在展开前计算，展开产物共享源 specificity。
 * - SEMIBAL/UNBAL 保留在 IR，由编译器报告 UNSUPPORTED_CONDITION。
 */

import {
  CONDITION_KEYS,
  expandSuitSet,
  isStyleParam,
  parseConditionValue,
  quantifierRange,
  type CompareOp,
  type ConditionValueContext,
  type QuantifierPredicate,
  type SuitLetter,
} from './conditions';
import type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
} from './diagnostics';
import { sortDiagnostics } from './diagnostics';
import {
  CALL_TOKEN_SET,
  type CallTokenIR,
  type ConditionValueIR,
  type ParseOptions,
  type ParseResult,
  type RuleIR,
  type RulesIR,
  type WhenIR,
} from './types';

const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const VERSION_TOKEN_RE = /^\d+(?:\.\d+)*$/;
const VERSION_LINE_RE = /^VERSION:\s*BRULES\/(\d+\.\d+)$/i;
const KEYWORD_LINE_RE = /^([A-Za-z_]+):\s*(.*)$/;
const SIMPLE_CONDITION_RE = /^([A-Za-z][A-Za-z0-9_]*)\s+(.+)$/;
const QUANTIFIER_RE =
  /^(ALL|ANY)\s*\(\s*([A-Za-z])\s*,\s*(LEN|HCP|CTL)\s*(>=|<=|=|>|<)\s*(\d+)\s*\)$/i;
const TAG_RE = /^[a-z][a-z0-9-]{0,31}$/;
const STYLE_VAR_RE = /\$\{([A-Za-z][A-Za-z0-9_]*)\}/g;

interface SimpleTerm {
  kind: 'simple';
  key: string;
  value: ConditionValueIR;
  line: number;
  invalid?: boolean;
}

interface QuantifierTerm {
  kind: 'quantifier';
  quantifier: 'ALL' | 'ANY';
  suitSet: string;
  suits: SuitLetter[];
  predicate: QuantifierPredicate;
  op: CompareOp;
  value: number;
  line: number;
  raw: string;
  invalid?: boolean;
}

type Term = SimpleTerm | QuantifierTerm;

interface ParsedCond {
  id: string;
  line: number;
  terms: Term[];
  uses: string[];
  hasError: boolean;
  cached?: Term[] | null;
}

interface ParsedRule {
  id: string;
  line: number;
  sequence?: string;
  terms: Term[];
  uses: string[];
  action?: CallTokenIR;
  priority?: number;
  description?: string;
  tags?: string[];
  enabled?: boolean;
  hasError: boolean;
  seen: Set<string>;
}

interface Branch {
  when: WhenIR;
}

/** 去掉字符串外的 `#` 注释；字符串内的 `#` 保留。 */
export function stripComment(line: string): string {
  let inQuotes = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inQuotes = false;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === '#') return line.slice(0, index);
  }
  return line;
}

/** 解析带引号文本；支持 `\"` 与 `\\`。 */
export function parseQuoted(raw: string): string | null {
  const value = raw.trim();
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return null;
  let out = '';
  for (let index = 1; index < value.length - 1; index += 1) {
    const char = value[index];
    if (char === '\\') {
      const next = value[index + 1];
      if (next === '"' || next === '\\') {
        out += next;
        index += 1;
        continue;
      }
      out += char;
      continue;
    }
    if (char === '"') return null;
    out += char;
  }
  return out;
}

function isValidIdentifier(value: string): boolean {
  return IDENTIFIER_RE.test(value);
}

function sortedWhen(entries: Iterable<[string, ConditionValueIR]>): WhenIR {
  const when: WhenIR = {};
  for (const [key, value] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    when[key] = value;
  }
  return when;
}

function stableWhenKey(when: WhenIR): string {
  return JSON.stringify(
    Object.entries(when).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/**
 * 解析 v0.5 DSL。
 * 有 error 级诊断时 ir 为 null；warning/info 不阻止产出。
 */
export function parseDsl(text: string, options: ParseOptions = {}): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const report = (
    code: DiagnosticCode,
    severity: DiagnosticSeverity,
    message: string,
    line: number,
    ruleId?: string,
    details?: Record<string, unknown>,
  ): void => {
    diagnostics.push({
      code,
      severity,
      message,
      location: { ...(options.file ? { file: options.file } : {}), line },
      ...(ruleId ? { ruleId } : {}),
      ...(details ? { details } : {}),
    });
  };

  const valueContext = (line: number, ruleId?: string): ConditionValueContext => ({
    location: { ...(options.file ? { file: options.file } : {}), line },
    ...(ruleId ? { ruleId } : {}),
    report: (code, severity, message, details) => report(code, severity, message, line, ruleId, details),
  });

  const conds = new Map<string, ParsedCond>();
  const rules: ParsedRule[] = [];
  const idLines = new Map<string, number>();
  const headers = new Map<string, string>();
  const headerLines = new Map<string, number>();
  let styleParams: string[] | undefined;
  let defaultPriority: number | undefined;
  let version: string | null = null;
  let versionLine = 1;
  let firstMeaningful = true;
  let missingVersionReported = false;
  let currentCond: ParsedCond | null = null;
  let currentRule: ParsedRule | null = null;

  const registerId = (id: string, line: number, ruleId?: string): boolean => {
    const key = id.toLowerCase();
    const previous = idLines.get(key);
    if (previous !== undefined) {
      report('DUPLICATE_ID', 'error', `id "${id}" 与第 ${previous} 行重复（大小写不敏感）`, line, ruleId);
      return false;
    }
    idLines.set(key, line);
    return true;
  };

  const pushCond = (cond: ParsedCond): void => {
    if (!conds.has(cond.id)) conds.set(cond.id, cond);
  };

  const pushRule = (rule: ParsedRule): void => {
    rules.push(rule);
  };

  const closeOpenBlock = (line: number): void => {
    if (currentCond) {
      report('MISSING_END', 'error', `COND ${currentCond.id} 在文件结尾或新块开始前缺少 END`, line, currentCond.id);
      currentCond.hasError = true;
      pushCond(currentCond);
      currentCond = null;
    }
    if (currentRule) {
      report('MISSING_END', 'error', `RULE ${currentRule.id} 在文件结尾或新块开始前缺少 END`, line, currentRule.id);
      currentRule.hasError = true;
      pushRule(currentRule);
      currentRule = null;
    }
  };

  const parseCallToken = (raw: string, line: number, ruleId?: string): CallTokenIR | null => {
    const trimmed = raw.trim();
    // 叫品令牌大小写不敏感，但 v0.5 明确退役小写 x：它不是加倍，而是旧通配符。
    if (trimmed === 'x' || trimmed === 'xx') {
      report(
        'LEGACY_WILDCARD_MIGRATED',
        'error',
        `v0.5 不接受小写 "${trimmed}"；加倍写作 X / XX。牌张通配符已退役`,
        line,
        ruleId,
      );
      return null;
    }
    const value = trimmed.toUpperCase();
    if (value === '-') return 'PASS';
    if (value === 'P' || value === 'PASS') {
      report(
        'PASS_ALIAS_REJECTED',
        'error',
        'v0.5 中 Pass 写作 "-"；单字母 P / PASS 不是合法叫品',
        line,
        ruleId,
      );
      return null;
    }
    if (CALL_TOKEN_SET.has(value)) return value as CallTokenIR;
    report('INVALID_CALL', 'error', `非法叫品 "${trimmed}"`, line, ruleId);
    return null;
  };

  const parseSequence = (raw: string, line: number, ruleId?: string): string | null => {
    const value = raw.trim();
    if (value === '^$' || value === '.*') return value;
    if (value === '^' || value === '*') {
      report(
        'INVALID_SEQUENCE',
        'error',
        `v0.5 序列通配只允许 "^$" 或 ".*"，收到 "${value}"`,
        line,
        ruleId,
      );
      return null;
    }
    const tokens = value.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      report('INVALID_SEQUENCE', 'error', '序列不能为空；无实质叫品写 "^$"，兜底写 ".*"', line, ruleId);
      return null;
    }
    const normalized: string[] = [];
    for (const token of tokens) {
      const match = /^([MPLR]):(.+)$/i.exec(token);
      if (!match) {
        report('INVALID_SEQUENCE', 'error', `序列 token 必须是 Seat:Call，收到 "${token}"`, line, ruleId);
        return null;
      }
      const seat = match[1].toUpperCase();
      const call = parseCallToken(match[2], line, ruleId);
      if (call === null) return null;
      normalized.push(`${seat}:${call}`);
    }
    return normalized.join(' ');
  };

  const parseTags = (raw: string, line: number, ruleId?: string): string[] | null => {
    const parts = raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      report('INVALID_TAG', 'error', 'TAGS 至少需要一个标签', line, ruleId);
      return null;
    }
    const tags: string[] = [];
    for (const part of parts) {
      const tag = part.toLowerCase();
      if (!TAG_RE.test(tag)) {
        report(
          'INVALID_TAG',
          'error',
          `非法标签 "${part}"；标签必须是 [a-z][a-z0-9-]{0,31}`,
          line,
          ruleId,
        );
        return null;
      }
      if (!tags.includes(tag)) tags.push(tag);
    }
    return tags;
  };

  const parseStyleParamsLine = (raw: string, line: number): string[] | null => {
    const names = raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (names.length === 0) {
      report('INVALID_STYLE_PARAM', 'error', 'STYLE_PARAMS 至少需要一个变量名', line);
      return null;
    }
    const out: string[] = [];
    for (const name of names) {
      if (!isValidIdentifier(name) || !isStyleParam(name)) {
        report('INVALID_STYLE_PARAM', 'error', `未登记的风格变量 "${name}"`, line);
        return null;
      }
      if (out.includes(name)) {
        report('DUPLICATE_STYLE_PARAM', 'warning', `STYLE_PARAMS 重复声明 "${name}"`, line);
      } else {
        out.push(name);
      }
    }
    return out;
  };

  const parseConditionTerm = (raw: string, line: number, ruleId?: string): Term | null => {
    const value = raw.trim();
    if (/^(ALL|ANY)\b/i.test(value)) {
      const match = QUANTIFIER_RE.exec(value);
      if (!match) {
        report(
          'INVALID_QUANTIFIER',
          'error',
          `非法量词 "${value}"；格式为 ANY(U, LEN>=5) / ALL(L, LEN<=3)`,
          line,
          ruleId,
        );
        return null;
      }
      const suits = expandSuitSet(match[2]);
      if (!suits) {
        report('INVALID_QUANTIFIER', 'error', `非法花色集合 "${match[2]}"`, line, ruleId);
        return null;
      }
      return {
        kind: 'quantifier',
        quantifier: match[1].toUpperCase() as 'ALL' | 'ANY',
        suitSet: match[2].toUpperCase(),
        suits,
        predicate: match[3].toUpperCase() as QuantifierPredicate,
        op: match[4] as CompareOp,
        value: Number(match[5]),
        line,
        raw: value,
      };
    }

    const match = SIMPLE_CONDITION_RE.exec(value);
    if (!match) {
      report('SYNTAX_ERROR', 'error', `无法解析条件 "${value}"；格式为 <key> <value>`, line, ruleId);
      return null;
    }
    const key = match[1];
    if (!Object.prototype.hasOwnProperty.call(CONDITION_KEYS, key)) {
      report('INVALID_CONDITION_KEY', 'error', `未登记的条件键 "${key}"`, line, ruleId);
      return null;
    }
    const parsed = parseConditionValue(key, match[2], valueContext(line, ruleId));
    if (parsed === null) return null;
    return { kind: 'simple', key, value: parsed, line };
  };

  const finalizeCond = (cond: ParsedCond): void => {
    if (cond.terms.length === 0 && cond.uses.length === 0) {
      report('MISSING_CONDITION', 'error', `COND ${cond.id} 至少需要一个 WHEN 或 USE`, cond.line, cond.id);
      cond.hasError = true;
    }
    pushCond(cond);
  };

  const finalizeRule = (rule: ParsedRule): void => {
    pushRule(rule);
  };

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const codeLine = stripComment(lines[index]).trim();
    if (!codeLine) continue;

    if (firstMeaningful) {
      firstMeaningful = false;
      const versionMatch = VERSION_LINE_RE.exec(codeLine);
      if (versionMatch) {
        version = versionMatch[1];
        versionLine = lineNumber;
        if (version !== '0.5') {
          report(
            'UNSUPPORTED_VERSION',
            'error',
            `不支持 BRULES/${version}；v0.5 解析器只接受 0.5，旧版本必须使用版本专用解析器`,
            lineNumber,
          );
          return { ir: null, diagnostics: sortDiagnostics(diagnostics) };
        }
        continue;
      }
      report(
        'MISSING_VERSION',
        'error',
        '第一条有效行必须是 "VERSION: BRULES/0.5"',
        lineNumber,
      );
      missingVersionReported = true;
      // 继续解析当前行，以便同时报告其他结构问题。
    }

    if (currentCond) {
      if (/^END$/i.test(codeLine)) {
        const cond = currentCond;
        currentCond = null;
        finalizeCond(cond);
        continue;
      }
      const keywordMatch = KEYWORD_LINE_RE.exec(codeLine);
      if (!keywordMatch) {
        report('SYNTAX_ERROR', 'error', `COND ${currentCond.id} 中无法识别的行`, lineNumber, currentCond.id);
        currentCond.hasError = true;
        continue;
      }
      const keyword = keywordMatch[1].toUpperCase();
      const rest = keywordMatch[2].trim();
      if (keyword === 'USE') {
        if (!isValidIdentifier(rest)) {
          report('INVALID_ID', 'error', `非法 COND 引用 "${rest}"`, lineNumber, currentCond.id);
          currentCond.hasError = true;
        } else {
          currentCond.uses.push(rest);
        }
        continue;
      }
      if (keyword === 'WHEN') {
        const term = parseConditionTerm(rest, lineNumber, currentCond.id);
        if (term === null) currentCond.hasError = true;
        else currentCond.terms.push(term);
        continue;
      }
      report(
        'SYNTAX_ERROR',
        'error',
        `COND ${currentCond.id} 中不允许 ${keyword}:；只允许 USE / WHEN / END`,
        lineNumber,
        currentCond.id,
      );
      currentCond.hasError = true;
      continue;
    }

    if (currentRule) {
      if (/^END$/i.test(codeLine)) {
        const rule = currentRule;
        currentRule = null;
        finalizeRule(rule);
        continue;
      }
      const keywordMatch = KEYWORD_LINE_RE.exec(codeLine);
      if (!keywordMatch) {
        report('SYNTAX_ERROR', 'error', `RULE ${currentRule.id} 中无法识别的行`, lineNumber, currentRule.id);
        currentRule.hasError = true;
        continue;
      }
      const keyword = keywordMatch[1].toUpperCase();
      const rest = keywordMatch[2].trim();
      switch (keyword) {
        case 'SEQ': {
          if (currentRule.seen.has('SEQ')) {
            report('SYNTAX_ERROR', 'error', 'RULE 中 SEQ 只能出现一次', lineNumber, currentRule.id);
            currentRule.hasError = true;
            break;
          }
          currentRule.seen.add('SEQ');
          const sequence = parseSequence(rest, lineNumber, currentRule.id);
          if (sequence === null) currentRule.hasError = true;
          else currentRule.sequence = sequence;
          break;
        }
        case 'USE': {
          if (!isValidIdentifier(rest)) {
            report('INVALID_ID', 'error', `非法 COND 引用 "${rest}"`, lineNumber, currentRule.id);
            currentRule.hasError = true;
          } else {
            currentRule.uses.push(rest);
          }
          break;
        }
        case 'WHEN': {
          const term = parseConditionTerm(rest, lineNumber, currentRule.id);
          if (term === null) currentRule.hasError = true;
          else currentRule.terms.push(term);
          break;
        }
        case 'BID': {
          if (currentRule.seen.has('BID')) {
            report('SYNTAX_ERROR', 'error', 'RULE 中 BID 只能出现一次', lineNumber, currentRule.id);
            currentRule.hasError = true;
            break;
          }
          currentRule.seen.add('BID');
          const action = parseCallToken(rest, lineNumber, currentRule.id);
          if (action === null) currentRule.hasError = true;
          else currentRule.action = action;
          break;
        }
        case 'PRIO': {
          if (currentRule.seen.has('PRIO')) {
            report('SYNTAX_ERROR', 'error', 'RULE 中 PRIO 只能出现一次', lineNumber, currentRule.id);
            currentRule.hasError = true;
            break;
          }
          currentRule.seen.add('PRIO');
          if (!/^\d+$/.test(rest)) {
            report('INVALID_PRIORITY', 'error', `PRIO 必须是整数，收到 "${rest}"`, lineNumber, currentRule.id);
            currentRule.hasError = true;
          } else {
            currentRule.priority = Number(rest);
          }
          break;
        }
        case 'DESC': {
          if (currentRule.seen.has('DESC')) {
            report('SYNTAX_ERROR', 'error', 'RULE 中 DESC 只能出现一次', lineNumber, currentRule.id);
            currentRule.hasError = true;
            break;
          }
          currentRule.seen.add('DESC');
          const description = parseQuoted(rest);
          if (description === null) {
            report('SYNTAX_ERROR', 'error', 'DESC 必须是双引号字符串', lineNumber, currentRule.id);
            currentRule.hasError = true;
          } else {
            currentRule.description = description;
          }
          break;
        }
        case 'TAGS': {
          if (currentRule.seen.has('TAGS')) {
            report('SYNTAX_ERROR', 'error', 'RULE 中 TAGS 只能出现一次', lineNumber, currentRule.id);
            currentRule.hasError = true;
            break;
          }
          currentRule.seen.add('TAGS');
          const tags = parseTags(rest, lineNumber, currentRule.id);
          if (tags === null) currentRule.hasError = true;
          else currentRule.tags = tags;
          break;
        }
        case 'ENABLED': {
          if (currentRule.seen.has('ENABLED')) {
            report('SYNTAX_ERROR', 'error', 'RULE 中 ENABLED 只能出现一次', lineNumber, currentRule.id);
            currentRule.hasError = true;
            break;
          }
          currentRule.seen.add('ENABLED');
          const enabled = rest.toLowerCase();
          if (enabled !== 'true' && enabled !== 'false') {
            report('INVALID_BOOLEAN', 'error', `ENABLED 只能是 true/false，收到 "${rest}"`, lineNumber, currentRule.id);
            currentRule.hasError = true;
          } else {
            currentRule.enabled = enabled === 'true';
          }
          break;
        }
        default:
          report(
            'SYNTAX_ERROR',
            'error',
            `RULE ${currentRule.id} 中不允许 ${keyword}:`,
            lineNumber,
            currentRule.id,
          );
          currentRule.hasError = true;
      }
      continue;
    }

    // 顶层：块或文件头。
    const keywordMatch = KEYWORD_LINE_RE.exec(codeLine);
    if (!keywordMatch) {
      report('SYNTAX_ERROR', 'error', `无法识别的行 "${codeLine}"`, lineNumber);
      continue;
    }
    const keyword = keywordMatch[1].toUpperCase();
    const rest = keywordMatch[2].trim();

    if (keyword === 'COND' || keyword === 'RULE') {
      closeOpenBlock(lineNumber);
      if (!isValidIdentifier(rest)) {
        report('INVALID_ID', 'error', `非法 ${keyword} id "${rest}"`, lineNumber);
      }
      const duplicate = isValidIdentifier(rest) ? !registerId(rest, lineNumber) : false;
      if (keyword === 'COND') {
        currentCond = {
          id: rest,
          line: lineNumber,
          terms: [],
          uses: [],
          hasError: !isValidIdentifier(rest) || duplicate,
        };
      } else {
        currentRule = {
          id: rest,
          line: lineNumber,
          terms: [],
          uses: [],
          hasError: !isValidIdentifier(rest) || duplicate,
          seen: new Set(),
        };
      }
      continue;
    }

    if (keyword === 'VERSION') {
      report('DUPLICATE_HEADER', 'error', 'VERSION 只能出现一次，且必须是第一条有效行', lineNumber);
      continue;
    }

    if (!['FORMAT', 'KIND', 'SYSTEM', 'SYSTEM_VERSION', 'LOCALE', 'AUTHOR', 'SOURCE', 'DEFAULT_PRIORITY', 'STYLE_PARAMS'].includes(keyword)) {
      report('SYNTAX_ERROR', 'error', `未知的文件头或语句 "${keyword}:"`, lineNumber);
      continue;
    }
    if (headers.has(keyword) || headerLines.has(keyword)) {
      report('DUPLICATE_HEADER', 'error', `文件头 ${keyword} 重复`, lineNumber);
      continue;
    }
    headerLines.set(keyword, lineNumber);

    switch (keyword) {
      case 'FORMAT': {
        if (rest.toLowerCase() !== 'bridge-rules') {
          report('INVALID_HEADER_VALUE', 'error', `FORMAT 必须是 bridge-rules，收到 "${rest}"`, lineNumber);
        } else {
          headers.set(keyword, 'bridge-rules');
        }
        break;
      }
      case 'KIND': {
        if (rest.toLowerCase() !== 'bidding') {
          report('INVALID_HEADER_VALUE', 'error', `KIND 必须是 bidding，收到 "${rest}"`, lineNumber);
        } else {
          headers.set(keyword, 'bidding');
        }
        break;
      }
      case 'SYSTEM': {
        if (!isValidIdentifier(rest)) {
          report('INVALID_HEADER_VALUE', 'error', `SYSTEM 必须是合法标识符，收到 "${rest}"`, lineNumber);
        } else {
          headers.set(keyword, rest);
        }
        break;
      }
      case 'SYSTEM_VERSION': {
        if (!VERSION_TOKEN_RE.test(rest)) {
          report('INVALID_SYSTEM_VERSION', 'error', `SYSTEM_VERSION 非法 "${rest}"`, lineNumber);
        } else {
          headers.set(keyword, rest);
        }
        break;
      }
      case 'LOCALE':
      case 'AUTHOR':
      case 'SOURCE': {
        const value = parseQuoted(rest);
        if (value === null) {
          report('SYNTAX_ERROR', 'error', `${keyword} 必须是双引号字符串`, lineNumber);
        } else {
          headers.set(keyword, value);
        }
        break;
      }
      case 'DEFAULT_PRIORITY': {
        if (!/^\d+$/.test(rest)) {
          report('INVALID_DEFAULT_PRIORITY', 'error', `DEFAULT_PRIORITY 必须是整数，收到 "${rest}"`, lineNumber);
        } else {
          defaultPriority = Number(rest);
        }
        break;
      }
      case 'STYLE_PARAMS': {
        const parsed = parseStyleParamsLine(rest, lineNumber);
        if (parsed !== null) styleParams = parsed;
        break;
      }
    }
  }

  if (firstMeaningful && !missingVersionReported) {
    report('MISSING_VERSION', 'error', '空文件：缺少 "VERSION: BRULES/0.5"', 1);
    missingVersionReported = true;
  }
  closeOpenBlock(Math.max(1, lines.length));
  if (version === null && !missingVersionReported) {
    report('MISSING_VERSION', 'error', '缺少 "VERSION: BRULES/0.5"', versionLine || 1);
  }

  // 必需文件头。
  for (const required of ['FORMAT', 'KIND', 'SYSTEM']) {
    if (!headers.has(required)) {
      report('MISSING_HEADER', 'error', `缺少必需文件头 ${required}:`, headerLines.get(required) ?? 1);
    }
  }

  const declaredStyleParams = new Set(styleParams ?? []);

  const markStyleVars = (term: Term, ruleId?: string): void => {
    if (term.kind !== 'simple' || typeof term.value !== 'string') return;
    for (const match of term.value.matchAll(STYLE_VAR_RE)) {
      const name = match[1];
      if (!declaredStyleParams.has(name)) {
        report(
          'UNRESOLVED_STYLE_VAR',
          'error',
          `风格变量 \${${name}} 未在 STYLE_PARAMS 中声明`,
          term.line,
          ruleId,
          { variable: name },
        );
        term.invalid = true;
      }
    }
  };

  for (const cond of conds.values()) {
    for (const term of cond.terms) markStyleVars(term, cond.id);
  }
  for (const rule of rules) {
    for (const term of rule.terms) markStyleVars(term, rule.id);
  }

  const resolveCond = (id: string, stack: string[], ruleId: string, line: number): Term[] | null => {
    const cond = conds.get(id);
    if (!cond) {
      report('UNRESOLVED_REFERENCE', 'error', `未定义的条件 ${id}`, line, ruleId);
      return null;
    }
    if (stack.includes(id)) {
      report(
        'CYCLIC_CONDITION',
        'error',
        `条件引用成环：${[...stack, id].join(' -> ')}`,
        line,
        ruleId,
      );
      return null;
    }
    if (cond.cached !== undefined) return cond.cached;
    if (cond.hasError) {
      cond.cached = null;
      return null;
    }
    const terms: Term[] = [...cond.terms];
    for (const use of cond.uses) {
      const sub = resolveCond(use, [...stack, id], ruleId, line);
      if (sub === null) {
        cond.cached = null;
        return null;
      }
      terms.push(...sub);
    }
    cond.cached = terms;
    return terms;
  };

  const expandQuantifier = (
    term: QuantifierTerm,
    ruleId: string,
  ): Array<Record<string, ConditionValueIR>> | null => {
    if (term.predicate !== 'LEN') {
      report(
        'UNSUPPORTED_FEATURE',
        'error',
        `${term.quantifier}(${term.suitSet}, ${term.predicate}...) 无法降解为扁平 IR 条件`,
        term.line,
        ruleId,
        { quantifier: term.raw },
      );
      return null;
    }
    const range = quantifierRange(term.op, term.value, term.predicate, valueContext(term.line, ruleId));
    if (range === null) return null;
    const keyFor = (suit: SuitLetter): string => {
      switch (suit) {
        case 'C':
          return 'clubs';
        case 'D':
          return 'diamonds';
        case 'H':
          return 'hearts';
        case 'S':
          return 'spades';
      }
    };
    const options = term.suits.map((suit) => ({ [keyFor(suit)]: range }));
    if (term.quantifier === 'ALL') {
      const merged: Record<string, ConditionValueIR> = {};
      for (const option of options) Object.assign(merged, option);
      return [merged];
    }
    return options;
  };

  const exportRules: RuleIR[] = [];

  for (const rule of rules) {
    let hasError = rule.hasError;

    if (!rule.sequence) {
      report('MISSING_RULE_FIELD', 'error', `RULE ${rule.id} 缺少 SEQ`, rule.line, rule.id);
      hasError = true;
    }
    if (!rule.action) {
      report('MISSING_RULE_FIELD', 'error', `RULE ${rule.id} 缺少 BID`, rule.line, rule.id);
      hasError = true;
    }

    let priority = rule.priority;
    if (priority === undefined) {
      if (defaultPriority === undefined) {
        report(
          'MISSING_PRIORITY',
          'error',
          `RULE ${rule.id} 没有 PRIO，且文件未声明 DEFAULT_PRIORITY`,
          rule.line,
          rule.id,
        );
        hasError = true;
      } else {
        priority = defaultPriority;
      }
    }

    const allTerms: Term[] = [...rule.terms];
    for (const use of rule.uses) {
      const resolved = resolveCond(use, [], rule.id, rule.line);
      if (resolved === null) {
        hasError = true;
      } else {
        allTerms.push(...resolved);
      }
    }

    const simple = new Map<string, ConditionValueIR>();
    const quantifiers: QuantifierTerm[] = [];
    for (const term of allTerms) {
      if (term.invalid) hasError = true;
      if (term.kind === 'quantifier') {
        quantifiers.push(term);
        continue;
      }
      const previous = simple.get(term.key);
      if (previous !== undefined) {
        if (previous !== term.value) {
          report(
            'DUPLICATE_CONDITION',
            'error',
            `条件 ${term.key} 同时出现为 "${String(previous)}" 和 "${String(term.value)}"`,
            term.line,
            rule.id,
          );
          hasError = true;
        }
        continue;
      }
      simple.set(term.key, term.value);
    }

    const specificity = simple.size + quantifiers.length;
    let branches: Branch[] = [
      { when: sortedWhen(simple.entries()) },
    ];

    for (const quantifier of quantifiers) {
      const options = expandQuantifier(quantifier, rule.id);
      if (options === null) {
        hasError = true;
        branches = [];
        break;
      }
      const next: Branch[] = [];
      for (const branch of branches) {
        for (const option of options) {
          const merged = new Map<string, ConditionValueIR>(Object.entries(branch.when));
          let conflict = false;
          for (const [key, value] of Object.entries(option)) {
            const previous = merged.get(key);
            if (previous !== undefined && previous !== value) {
              report(
                'DUPLICATE_CONDITION',
                'error',
                `量词展开后条件 ${key} 冲突："${String(previous)}" vs "${String(value)}"`,
                quantifier.line,
                rule.id,
              );
              conflict = true;
            } else {
              merged.set(key, value);
            }
          }
          if (!conflict) next.push({ when: sortedWhen(merged.entries()) });
        }
      }
      branches = next;
      if (branches.length === 0) break;
    }

    // 去重：不同量词组合可能产生同一组扁平条件。
    const seenBranches = new Set<string>();
    branches = branches.filter((branch) => {
      const key = stableWhenKey(branch.when);
      if (seenBranches.has(key)) return false;
      seenBranches.add(key);
      return true;
    });

    if (branches.length === 0) {
      hasError = true;
      continue;
    }
    if (hasError || !rule.sequence || !rule.action || priority === undefined) continue;

    if (branches.length > 1) {
      report(
        'EXPANDED_DISJUNCTION',
        'info',
        `规则 ${rule.id} 的量词展开为 ${branches.length} 条规则，共享 specificity=${specificity}`,
        rule.line,
        rule.id,
        { sourceId: rule.id, count: branches.length },
      );
    }

    branches.forEach((branch, branchIndex) => {
      const id = branches.length > 1 ? `${rule.id}#${branchIndex + 1}` : rule.id;
      const ruleIr: RuleIR = {
        id,
        sequence: rule.sequence as string,
        when: branch.when,
        action: rule.action as CallTokenIR,
        priority: priority as number,
        specificity,
        source: {
          ...(options.file ? { file: options.file } : {}),
          line: rule.line,
        },
      };
      if (rule.description !== undefined) ruleIr.description = rule.description;
      if (rule.tags !== undefined) ruleIr.tags = rule.tags;
      if (rule.enabled !== undefined) ruleIr.enabled = rule.enabled;
      exportRules.push(ruleIr);
    });
  }

  if (exportRules.length === 0 && !diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    report('INVALID_RULESET', 'error', '规则集至少需要一条可导出的 RULE', 1);
  }

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    return { ir: null, diagnostics: sortDiagnostics(diagnostics) };
  }

  const ir: RulesIR = {
    format: 'bridge-rules-ir',
    formatVersion: '0.5',
    kind: 'bidding',
    system: headers.get('SYSTEM') as string,
    rules: exportRules,
  };
  if (headers.has('SYSTEM_VERSION')) ir.systemVersion = headers.get('SYSTEM_VERSION');
  if (headers.has('LOCALE')) ir.locale = headers.get('LOCALE');
  if (headers.has('AUTHOR')) ir.author = headers.get('AUTHOR');
  if (headers.has('SOURCE')) ir.source = headers.get('SOURCE');
  if (defaultPriority !== undefined) ir.defaults = { priority: defaultPriority };
  if (styleParams !== undefined) ir.styleParams = styleParams;

  return { ir, diagnostics: sortDiagnostics(diagnostics) };
}
