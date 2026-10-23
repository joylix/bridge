import yaml from 'js-yaml';
import type { BiddingRule, LeadRule, SignalRule, SignalRuleSet, SignalSettings } from './types';

/** 解析叫牌规则 YAML 文本（按 priority 降序稳定排序） */
export function parseBiddingRules(text: string): BiddingRule[] {
  const data = yaml.load(text) as { rules?: BiddingRule[] } | undefined;
  if (!data?.rules) throw new Error('叫牌规则文件缺少 rules 段');
  return [...data.rules].sort((a, b) => b.priority - a.priority);
}

/** 解析首攻规则 YAML 文本（按 priority 降序稳定排序） */
export function parseLeadRules(text: string): LeadRule[] {
  const data = yaml.load(text) as { rules?: LeadRule[] } | undefined;
  if (!data?.rules) throw new Error('首攻规则文件缺少 rules 段');
  return [...data.rules].sort((a, b) => b.priority - a.priority);
}

/** 解析跟牌/垫牌细则 YAML（规则按 priority 降序；settings 供 AI 直接使用） */
export function parseSignalRules(text: string): SignalRuleSet {
  const data = yaml.load(text) as
    | { rules?: SignalRule[]; settings?: SignalSettings }
    | undefined;
  if (!data?.rules) throw new Error('打牌细则文件缺少 rules 段');
  const rules = [...data.rules].sort((a, b) => b.priority - a.priority);
  return { rules, settings: { ...(data.settings ?? {}) } };
}

/* ------------------------------------------------------------------ *
 * 规则文件注册表：以 Vite `?raw` 构建期内联加载，支持多套文件热替换
 * （验收用例 19：换用备选叫牌规则文件后，AI 行为改变）。
 * ------------------------------------------------------------------ */

const biddingModules = import.meta.glob('../rules/bidding/*.yml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const leadModules = import.meta.glob('../rules/play/leads*.yml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const signalModules = import.meta.glob('../rules/play/signals*.yml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const DEFAULT_BIDDING_FILE = 'precision';
const DEFAULT_LEAD_FILE = 'leads';
const DEFAULT_SIGNAL_FILE = 'signals';

export interface RuleFileInfo {
  /** 逻辑名（不含扩展名），用于切换规则文件 */
  name: string;
  /** 原始模块路径 */
  key: string;
}

/** 规则类别：叫牌 / 打牌（首攻） / 打牌（跟牌垫牌细则） */
export type RuleKind = 'bidding' | 'lead' | 'signal';

function toName(key: string): string {
  const base = key.split('/').pop() ?? key;
  return base.replace(/\.ya?ml$/, '');
}

function pickModule(modules: Record<string, string>, name: string): string {
  const entry = Object.entries(modules).find(([key]) => toName(key) === name);
  if (!entry) throw new Error(`未找到名为 "${name}" 的规则文件`);
  return entry[1];
}

function listFiles(modules: Record<string, string>): RuleFileInfo[] {
  return Object.keys(modules)
    .map((key) => ({ name: toName(key), key }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listBiddingRuleFiles(): RuleFileInfo[] {
  return listFiles(biddingModules);
}

export function listLeadRuleFiles(): RuleFileInfo[] {
  return listFiles(leadModules);
}

export function listSignalRuleFiles(): RuleFileInfo[] {
  return listFiles(signalModules);
}

/* ------------------------------------------------------------------ *
 * 本地规则覆盖（浏览器 localStorage）
 *
 * 浏览器环境无法直接改写构建期内联的 YAML 文件，因此“修改规则”以
 * 覆盖层形式保存：优先读取本地覆盖文本，没有覆盖时回退到内置文件。
 * 这样刷新页面后修改仍然生效，且可随时“恢复默认”。
 * ------------------------------------------------------------------ */

const OVERRIDES_KEY = 'bridge.ruleOverrides.v1';

interface RuleOverrideState {
  bidding: Record<string, string>;
  lead: Record<string, string>;
  signal: Record<string, string>;
}

/** 内存中的权威覆盖状态（localStorage 仅作持久化副本，便于无 storage 环境使用） */
let memoryOverrides: RuleOverrideState | null = null;

function emptyOverrides(): RuleOverrideState {
  return { bidding: {}, lead: {}, signal: {} };
}

function readOverrides(): RuleOverrideState {
  if (memoryOverrides) return memoryOverrides;
  memoryOverrides = emptyOverrides();
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(OVERRIDES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<RuleOverrideState>;
        memoryOverrides = {
          bidding: { ...(parsed.bidding ?? {}) },
          lead: { ...(parsed.lead ?? {}) },
          signal: { ...(parsed.signal ?? {}) },
        };
      }
    }
  } catch {
    // 存储不可用或被禁用时，退回纯内存模式
  }
  return memoryOverrides;
}

function writeOverrides(state: RuleOverrideState): void {
  memoryOverrides = state;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(state));
    }
  } catch {
    // 忽略持久化失败，内存中的修改仍然生效
  }
}

/** 清除全部本地规则覆盖（测试/重置用） */
export function clearRuleOverrides(): void {
  memoryOverrides = emptyOverrides();
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(OVERRIDES_KEY);
  } catch {
    // 忽略
  }
}

/** 读取叫牌规则原始 YAML（优先返回本地覆盖版本） */
export function getBiddingRuleText(name: string): string {
  return readOverrides().bidding[name] ?? pickModule(biddingModules, name);
}

/** 读取首攻规则原始 YAML（优先返回本地覆盖版本） */
export function getLeadRuleText(name: string): string {
  return readOverrides().lead[name] ?? pickModule(leadModules, name);
}

/** 读取跟牌/垫牌细则原始 YAML（优先返回本地覆盖版本） */
export function getSignalRuleText(name: string): string {
  return readOverrides().signal[name] ?? pickModule(signalModules, name);
}

export function isBiddingRuleOverridden(name: string): boolean {
  return readOverrides().bidding[name] !== undefined;
}

export function isLeadRuleOverridden(name: string): boolean {
  return readOverrides().lead[name] !== undefined;
}

export function isSignalRuleOverridden(name: string): boolean {
  return readOverrides().signal[name] !== undefined;
}

export interface RuleValidationResult {
  ok: boolean;
  errors: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 校验叫牌规则文本：YAML 语法 + 必备字段 */
export function validateBiddingRuleText(text: string): RuleValidationResult {
  let rules: BiddingRule[];
  try {
    rules = parseBiddingRules(text);
  } catch (error) {
    return { ok: false, errors: [errorMessage(error)] };
  }
  const errors: string[] = [];
  rules.forEach((rule, index) => {
    const label = rule.id ? `规则 ${rule.id}` : `第 ${index + 1} 条规则`;
    if (!rule.id) errors.push(`${label}缺少 id`);
    if (!rule.sequence) errors.push(`${label}缺少 sequence`);
    if (!rule.action) errors.push(`${label}缺少 action`);
    if (typeof rule.priority !== 'number') errors.push(`${label}的 priority 必须是数字`);
  });
  return { ok: errors.length === 0, errors };
}

/** 校验首攻规则文本：YAML 语法 + 必备字段 */
export function validateLeadRuleText(text: string): RuleValidationResult {
  let rules: LeadRule[];
  try {
    rules = parseLeadRules(text);
  } catch (error) {
    return { ok: false, errors: [errorMessage(error)] };
  }
  const errors: string[] = [];
  rules.forEach((rule, index) => {
    const label = rule.id ? `规则 ${rule.id}` : `第 ${index + 1} 条规则`;
    if (!rule.id) errors.push(`${label}缺少 id`);
    if (!rule.context?.contract_type) errors.push(`${label}缺少 context.contract_type`);
    if (!rule.lead) errors.push(`${label}缺少 lead`);
    if (typeof rule.priority !== 'number') errors.push(`${label}的 priority 必须是数字`);
    if (rule.role !== undefined && !['defender', 'declarer', 'any'].includes(rule.role)) {
      errors.push(`${label}的 role 只能是 defender / declarer / any`);
    }
  });
  return { ok: errors.length === 0, errors };
}

/** 校验跟牌/垫牌细则文本：YAML 语法 + 必备字段 */
export function validateSignalRuleText(text: string): RuleValidationResult {
  let parsed: SignalRuleSet;
  try {
    parsed = parseSignalRules(text);
  } catch (error) {
    return { ok: false, errors: [errorMessage(error)] };
  }
  const errors: string[] = [];
  parsed.rules.forEach((rule, index) => {
    const label = rule.id ? `细则 ${rule.id}` : `第 ${index + 1} 条细则`;
    if (!rule.id) errors.push(`${label}缺少 id`);
    if (!rule.description) errors.push(`${label}缺少 description`);
    if (!['follow', 'discard', 'signal'].includes(rule.phase)) {
      errors.push(`${label}的 phase 只能是 follow / discard / signal`);
    }
    if (!rule.action) errors.push(`${label}缺少 action`);
    if (typeof rule.priority !== 'number') errors.push(`${label}的 priority 必须是数字`);
  });
  for (const [key, value] of Object.entries(parsed.settings)) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
      errors.push(`settings.${key} 必须是数字`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** 保存叫牌规则覆盖（校验失败时抛错，不写入） */
export function saveBiddingRuleText(name: string, text: string): void {
  const result = validateBiddingRuleText(text);
  if (!result.ok) throw new Error(result.errors.join('；'));
  const state = readOverrides();
  state.bidding[name] = text;
  writeOverrides(state);
}

/** 保存首攻规则覆盖（校验失败时抛错，不写入） */
export function saveLeadRuleText(name: string, text: string): void {
  const result = validateLeadRuleText(text);
  if (!result.ok) throw new Error(result.errors.join('；'));
  const state = readOverrides();
  state.lead[name] = text;
  writeOverrides(state);
}

/** 保存跟牌/垫牌细则覆盖（校验失败时抛错，不写入） */
export function saveSignalRuleText(name: string, text: string): void {
  const result = validateSignalRuleText(text);
  if (!result.ok) throw new Error(result.errors.join('；'));
  const state = readOverrides();
  state.signal[name] = text;
  writeOverrides(state);
}

/** 清除某个叫牌规则文件的本地覆盖，恢复内置默认 */
export function resetBiddingRuleText(name: string): void {
  const state = readOverrides();
  delete state.bidding[name];
  writeOverrides(state);
}

/** 清除某个首攻规则文件的本地覆盖，恢复内置默认 */
export function resetLeadRuleText(name: string): void {
  const state = readOverrides();
  delete state.lead[name];
  writeOverrides(state);
}

/** 清除某个跟牌/垫牌细则文件的本地覆盖，恢复内置默认 */
export function resetSignalRuleText(name: string): void {
  const state = readOverrides();
  delete state.signal[name];
  writeOverrides(state);
}

/** 加载叫牌规则；name 省略时使用默认文件 */
export function loadBiddingRules(name: string = DEFAULT_BIDDING_FILE): BiddingRule[] {
  return parseBiddingRules(getBiddingRuleText(name));
}

/** 加载首攻规则；name 省略时使用默认文件 */
export function loadLeadRules(name: string = DEFAULT_LEAD_FILE): LeadRule[] {
  return parseLeadRules(getLeadRuleText(name));
}

/** 加载跟牌/垫牌细则；name 省略时使用默认文件 */
export function loadSignalRules(name: string = DEFAULT_SIGNAL_FILE): SignalRuleSet {
  return parseSignalRules(getSignalRuleText(name));
}

/**
 * 加载所有叫牌规则文件（键 = 逻辑名）。
 * 供规则配置面板枚举可选叫牌体系。
 */
export function loadAllBiddingRuleSets(): Record<string, BiddingRule[]> {
  const out: Record<string, BiddingRule[]> = {};
  for (const [key] of Object.entries(biddingModules)) {
    const name = toName(key);
    out[name] = parseBiddingRules(getBiddingRuleText(name));
  }
  return out;
}
