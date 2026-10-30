#!/usr/bin/env node
/**
 * Phase 0 完整性检查。
 *
 * 只做结构/一致性检查，不引入第三方依赖，也不替代 Phase 1 的语义测试：
 * - 46 个 ConditionSpec 键与 conditions.md、rules-ir.schema.json 对齐
 * - shapeClass 枚举对齐
 * - 示例 JSON 可解析，关键字段自洽
 * - 最小 DSL 满足规范的关键约束
 * - reproducibility.md / record 示例中的 rulesetId 与语义投影一致
 * - README 引用的文件存在
 * - package.json 已注册 check:phase0
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs', 'brules-v0.5');
const errors = [];
const warnings = [];
const checks = [];

function ok(name) {
  checks.push(name);
}

function fail(name, message) {
  errors.push(`${name}: ${message}`);
}

function warn(name, message) {
  warnings.push(`${name}: ${message}`);
}

function read(path) {
  if (!existsSync(path)) {
    fail('file', `缺少文件 ${path}`);
    return '';
  }
  return readFileSync(path, 'utf8');
}

function readJson(path) {
  const text = read(path);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    fail('json', `${path} 不是合法 JSON: ${error.message}`);
    return null;
  }
}

function unique(values) {
  return [...new Set(values)];
}

function sameSet(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const value of sa) if (!sb.has(value)) return false;
  return true;
}

function formatSetDiff(expected, actual) {
  const missing = expected.filter((value) => !actual.includes(value));
  const extra = actual.filter((value) => !expected.includes(value));
  return [
    missing.length ? `缺少 ${missing.join(', ')}` : '',
    extra.length ? `多出 ${extra.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('；');
}

// ---------------------------------------------------------------------------
// 1. 条件键：types.ts ↔ conditions.md ↔ rules-ir.schema.json
// ---------------------------------------------------------------------------

const typesText = read(join(ROOT, 'src', 'engine', 'types.ts'));
const conditionBlock = typesText.split('export interface ConditionSpec')[1]?.split('\n}')[0] ?? '';
const runtimeKeys = unique(
  [...conditionBlock.matchAll(/^\s{2}([A-Za-z0-9_]+)\?:/gm)].map((match) => match[1]),
);

if (runtimeKeys.length !== 46) {
  fail('ConditionSpec', `期望 46 个键，实际 ${runtimeKeys.length} 个`);
} else {
  ok('ConditionSpec 46 键');
}

const conditionsText = read(join(DOCS, 'conditions.md'));
const keysBlock = conditionsText.split('<!-- keys:start -->')[1]?.split('<!-- keys:end -->')[0] ?? '';
const documentedKeys = unique(
  [...keysBlock.matchAll(/^\| `([A-Za-z][A-Za-z0-9_]*)` \|/gm)].map((match) => match[1]),
);

if (!sameSet(runtimeKeys, documentedKeys)) {
  fail('conditions.md 键集合', formatSetDiff(runtimeKeys, documentedKeys));
} else {
  ok('conditions.md 46 键');
}

const conditionRows = [...keysBlock.matchAll(/^\| `([A-Za-z][A-Za-z0-9_]*)` \|(.+)$/gm)];
for (const row of conditionRows) {
  const cells = row[2].split('|').map((cell) => cell.trim());
  // 末尾会有一个空单元格，因为行以 | 结尾
  if (cells.length !== 6 || cells.slice(0, 5).some((cell) => cell.length === 0)) {
    fail('conditions.md 行', `键 ${row[1]} 的列不完整`);
  }
}

const shapeBlock =
  conditionsText.split('<!-- shape:start -->')[1]?.split('<!-- shape:end -->')[0] ?? '';
const documentedShapes = unique(
  [...shapeBlock.matchAll(/^\| `([A-Z0-9_]+)` \|/gm)].map((match) => match[1]),
);
const expectedShapes = ['BAL_ANY', 'BAL_NO_5M', 'SEMIBAL', 'UNBAL'];

if (!sameSet(expectedShapes, documentedShapes)) {
  fail('conditions.md shapeClass', formatSetDiff(expectedShapes, documentedShapes));
} else {
  ok('conditions.md shapeClass 4 值');
}

const irSchema = readJson(join(DOCS, 'rules-ir.schema.json'));
if (irSchema) {
  const conditionEnum = irSchema.$defs?.ConditionKey?.enum ?? [];
  const expectedConditionEnum = [...runtimeKeys, 'shapeClass'];
  if (!sameSet(expectedConditionEnum, conditionEnum)) {
    fail('rules-ir.schema.json ConditionKey', formatSetDiff(expectedConditionEnum, conditionEnum));
  } else {
    ok('rules-ir.schema.json 46 键 + shapeClass');
  }

  const shapeEnum = irSchema.$defs?.ShapeClass?.enum ?? [];
  if (!sameSet(expectedShapes, shapeEnum)) {
    fail('rules-ir.schema.json ShapeClass', formatSetDiff(expectedShapes, shapeEnum));
  } else {
    ok('rules-ir.schema.json shapeClass 4 值');
  }

  for (const field of ['format', 'formatVersion', 'kind', 'system', 'rules']) {
    if (!(irSchema.required ?? []).includes(field)) {
      fail('rules-ir.schema.json', `required 缺少 ${field}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. 记录 Schema 与示例
// ---------------------------------------------------------------------------

const recordSchema = readJson(join(DOCS, 'record.schema.json'));
if (recordSchema) {
  const required = recordSchema.required ?? [];
  for (const field of [
    'format',
    'schemaVersion',
    'profile',
    'recordType',
    'recordId',
    'createdAt',
    'deal',
    'status',
    'auction',
    'score',
    'hcp',
    'engine',
  ]) {
    if (!required.includes(field)) fail('record.schema.json', `required 缺少 ${field}`);
  }

  const engineRequired = recordSchema.$defs?.Engine?.required ?? [];
  for (const field of ['dealSource', 'ruleset', 'playRulesets', 'seats', 'inference']) {
    if (!engineRequired.includes(field)) {
      fail('record.schema.json Engine', `required 缺少 ${field}`);
    }
  }
  if (engineRequired.includes('rngSeed')) {
    fail('record.schema.json Engine', 'rngSeed 不应是强制字段（imported-pbn 可省略）');
  }

  const statuses = recordSchema.$defs?.Status?.enum ?? [];
  for (const status of [
    'IN_PROGRESS',
    'PLAYED',
    'PASSED_OUT',
    'CANCELLED',
    'ADJUSTED',
    'INCOMPLETE',
    'REOPENED',
  ]) {
    if (!statuses.includes(status)) fail('record.schema.json Status', `缺少 ${status}`);
  }
  if (recordSchema.properties?.schemaVersion?.const !== '1.1') {
    fail('record.schema.json', 'schemaVersion 必须冻结为 1.1');
  }
  if (recordSchema.$defs?.Score?.properties?.nsRaw?.type?.includes?.('null') !== true) {
    fail('record.schema.json Score', 'nsRaw 必须允许 null（取消/未完成不得写 0）');
  }
  if (!recordSchema.properties?.adjustment || !recordSchema.properties?.adjustHistory) {
    fail('record.schema.json', '1.1 必须提供 adjustment / adjustHistory');
  }

  if (!errors.some((error) => error.startsWith('record.schema.json'))) {
    ok('record.schema.json 必需字段');
  }
}

const irExample = readJson(join(DOCS, 'examples', 'minimal.rules.json'));
if (irExample) {
  const conditionEnum = new Set(irSchema?.$defs?.ConditionKey?.enum ?? []);
  const actionEnum = new Set(irSchema?.$defs?.Call?.enum ?? []);
  const shapeEnum = new Set(irSchema?.$defs?.ShapeClass?.enum ?? []);
  const styleEnum = new Set(irSchema?.$defs?.StyleParam?.enum ?? []);

  for (const field of ['format', 'formatVersion', 'kind', 'system', 'rules']) {
    if (irExample[field] === undefined) fail('minimal.rules.json', `缺少 ${field}`);
  }
  if (!Array.isArray(irExample.rules) || irExample.rules.length === 0) {
    fail('minimal.rules.json', 'rules 必须是非空数组');
  } else {
    for (const rule of irExample.rules) {
      for (const field of ['id', 'sequence', 'when', 'action', 'priority']) {
        if (rule[field] === undefined) fail('minimal.rules.json', `${rule.id ?? '?'} 缺少 ${field}`);
      }
      if (!actionEnum.has(rule.action)) {
        fail('minimal.rules.json', `${rule.id} 的 action ${rule.action} 不在 Call enum`);
      }
      if (!Array.isArray(rule.tags) && rule.tags !== undefined) {
        fail('minimal.rules.json', `${rule.id} 的 tags 必须是数组`);
      }
      if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') {
        fail('minimal.rules.json', `${rule.id} 的 enabled 必须是布尔`);
      }
      const whenKeys = Object.keys(rule.when ?? {});
      for (const key of whenKeys) {
        if (!conditionEnum.has(key)) {
          fail('minimal.rules.json', `${rule.id} 的条件键 ${key} 未登记`);
        }
      }
      if (typeof rule.specificity === 'number' && rule.specificity !== whenKeys.length) {
        fail(
          'minimal.rules.json',
          `${rule.id} 的 specificity=${rule.specificity}，但 when 有 ${whenKeys.length} 项`,
        );
      }
      if (typeof rule.when?.shapeClass === 'string' && !shapeEnum.has(rule.when.shapeClass)) {
        fail('minimal.rules.json', `${rule.id} 的 shapeClass ${rule.when.shapeClass} 非法`);
      }
    }
  }

  for (const style of irExample.styleParams ?? []) {
    if (!styleEnum.has(style)) fail('minimal.rules.json', `styleParams ${style} 未登记`);
  }

  ok('minimal.rules.json 结构');
}

// JCS（仅覆盖本文件用到的 JSON 类型；数组顺序保留，对象键排序）
function jcs(value) {
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function semanticProjection(ir) {
  const projection = {
    format: ir.format,
    formatVersion: ir.formatVersion,
    kind: ir.kind,
    system: ir.system,
    systemVersion: ir.systemVersion,
  };
  if (ir.defaults !== undefined) projection.defaults = ir.defaults;
  if (ir.styleParams !== undefined) projection.styleParams = ir.styleParams;
  projection.rules = (ir.rules ?? []).map((rule) => {
    const entry = {
      id: rule.id,
      sequence: rule.sequence,
      when: rule.when,
      action: rule.action,
      priority: rule.priority,
      tags: rule.tags ?? [],
      enabled: rule.enabled ?? true,
    };
    return entry;
  });
  return projection;
}

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

let expectedRulesetId = null;
if (irExample) {
  expectedRulesetId = `sha256:${sha256Hex(jcs(semanticProjection(irExample)))}`;
  const reproducibilityText = read(join(DOCS, 'reproducibility.md'));
  if (!reproducibilityText.includes(expectedRulesetId)) {
    fail('reproducibility.md', `未包含示例 rulesetId ${expectedRulesetId}`);
  } else {
    ok('reproducibility.md rulesetId 与示例一致');
  }
}

const recordExample = readJson(join(DOCS, 'examples', 'passed-out.record.json'));
if (recordExample) {
  for (const field of recordSchema?.required ?? []) {
    if (recordExample[field] === undefined) fail('passed-out.record.json', `缺少 ${field}`);
  }

  if (recordExample.format !== 'bridge-record') fail('passed-out.record.json', 'format 非法');
  if (recordExample.schemaVersion !== '1.1') fail('passed-out.record.json', 'schemaVersion 非法');
  if (recordExample.status !== 'PASSED_OUT') fail('passed-out.record.json', 'status 必须是 PASSED_OUT');
  if (recordExample.contract !== undefined) {
    fail('passed-out.record.json', 'PASSED_OUT 不得有 contract');
  }
  if (!recordExample.auction?.completed) fail('passed-out.record.json', 'auction.completed 必须为 true');
  if (!Array.isArray(recordExample.auction?.calls) || recordExample.auction.calls.length !== 4) {
    fail('passed-out.record.json', '流局 auction.calls 必须是四个 PASS');
  } else if (recordExample.auction.calls.some((call) => call !== 'PASS')) {
    fail('passed-out.record.json', '流局 auction.calls 必须全部是 PASS');
  }
  if (recordExample.score?.nsRaw !== 0) fail('passed-out.record.json', '流局 nsRaw 必须为 0');
  if (recordExample.score?.source !== 'computed') {
    fail('passed-out.record.json', '示例 score.source 应为 computed');
  }
  const hcpSum = (recordExample.hcp?.ns ?? 0) + (recordExample.hcp?.ew ?? 0);
  if (hcpSum !== 40) fail('passed-out.record.json', `hcp 合计 ${hcpSum}，应为 40`);

  const rulesetId = recordExample.engine?.ruleset?.rulesetId;
  if (!/^sha256:[0-9a-f]{64}$/.test(rulesetId ?? '')) {
    fail('passed-out.record.json', 'engine.ruleset.rulesetId 格式非法');
  } else if (expectedRulesetId && rulesetId !== expectedRulesetId) {
    fail(
      'passed-out.record.json',
      `rulesetId ${rulesetId} 与 minimal.rules.json 计算值 ${expectedRulesetId} 不一致`,
    );
  }

  const streamSeeds = recordExample.engine?.streams ?? {};
  const baseSeed = recordExample.engine?.dealSource?.baseSeed;
  const index = recordExample.engine?.dealSource?.index;
  if (
    recordExample.engine?.dealSource?.kind !== 'seeded' ||
    !Number.isInteger(baseSeed) ||
    !Number.isInteger(index)
  ) {
    fail('passed-out.record.json', '示例必须是 seeded，并含整数 baseSeed/index');
  } else {
    for (const stream of ['deal', 'bidding', 'play', 'dds']) {
      const expected = seedFor(baseSeed, index, stream);
      if (streamSeeds[stream] !== expected) {
        fail(
          'passed-out.record.json',
          `streams.${stream}=${streamSeeds[stream]}，按公式应为 ${expected}`,
        );
      }
    }
    if (recordExample.engine?.rngSeed !== streamSeeds.deal) {
      fail('passed-out.record.json', 'rngSeed 应等于 streams.deal（新记录兼容约定）');
    }
  }

  const pbn = recordExample.deal?.pbn;
  if (typeof pbn !== 'string') {
    fail('passed-out.record.json', 'deal.pbn 缺失');
  } else {
    const parsed = parsePbnDeal(pbn);
    if (parsed.error) {
      fail('passed-out.record.json', `deal.pbn 非法: ${parsed.error}`);
    } else if (parsed.dealer !== recordExample.deal.dealer) {
      fail('passed-out.record.json', 'deal.pbn 前缀应与 deal.dealer 一致');
    }
  }

  for (const seat of ['N', 'E', 'S', 'W']) {
    if (!recordExample.engine?.seats?.[seat]) {
      fail('passed-out.record.json', `engine.seats.${seat} 缺失`);
    }
  }

  if (!errors.some((error) => error.startsWith('passed-out.record.json'))) {
    ok('passed-out.record.json 结构与自洽');
  }
}

function seedFor(baseSeed, index, stream) {
  const digest = createHash('sha256')
    .update(`BRIDGE-RNG/1|${baseSeed}|${index}|${stream}`, 'ascii')
    .digest();
  return digest.readUInt32BE(0);
}

function parsePbnDeal(pbn) {
  const match = /^([NESW]):(.*)$/i.exec(pbn.trim());
  if (!match) return { error: '缺少座位前缀' };
  const order = ['N', 'E', 'S', 'W'];
  const dealer = match[1].toUpperCase();
  const start = order.indexOf(dealer);
  const chunks = match[2].trim().split(/\s+/).filter(Boolean);
  if (chunks.length !== 4) return { error: `应有 4 手牌，实际 ${chunks.length}` };

  const rankChars = '23456789TJQKA';
  const seen = new Set();
  const hands = {};
  for (let offset = 0; offset < 4; offset += 1) {
    const seat = order[(start + offset) % 4];
    const segments = chunks[offset].split('.');
    if (segments.length !== 4) return { error: `${seat} 家花色段不是 4 段` };
    let count = 0;
    for (let suitIndex = 0; suitIndex < 4; suitIndex += 1) {
      const segment = segments[suitIndex];
      const suit = 'SHDC'[suitIndex];
      if (segment === '-') continue;
      if (segment === '') return { error: `${seat} 家有空花色段（应写 -）` };
      let lastRank = 99;
      for (const char of segment.toUpperCase()) {
        const rank = rankChars.indexOf(char);
        if (rank < 0) return { error: `${seat} 家非法点数 ${char}` };
        if (rank >= lastRank) return { error: `${seat} 家点数未递减或重复` };
        lastRank = rank;
        const card = `${suit}${char}`;
        if (seen.has(card)) return { error: `重复牌 ${card}` };
        seen.add(card);
        count += 1;
      }
    }
    if (count !== 13) return { error: `${seat} 家 ${count} 张，应为 13` };
    hands[seat] = count;
  }
  if (seen.size !== 52) return { error: `总牌数 ${seen.size}，应为 52` };
  return { dealer, hands };
}

// ---------------------------------------------------------------------------
// 3. 最小 DSL
// ---------------------------------------------------------------------------

const dslText = read(join(DOCS, 'examples', 'minimal.brules'));
if (dslText) {
  const lines = dslText.split(/\r?\n/);
  const header = {};
  const condIds = new Set();
  const usedConds = new Set();
  let current = null;
  let versionSeen = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const versionMatch = /^VERSION:\s+BRULES\/(\d+\.\d+)$/.exec(line);
    if (versionMatch) {
      versionSeen = true;
      if (versionMatch[1] !== '0.5') fail('minimal.brules', `VERSION 应为 0.5，实际 ${versionMatch[1]}`);
      continue;
    }

    const headerMatch = /^(FORMAT|KIND|SYSTEM|SYSTEM_VERSION|DEFAULT_PRIORITY|STYLE_PARAMS):\s+(.+)$/.exec(
      line,
    );
    if (headerMatch) {
      header[headerMatch[1]] = headerMatch[2];
      continue;
    }

    const condMatch = /^COND:\s+([A-Za-z][A-Za-z0-9_.-]*)$/.exec(line);
    if (condMatch) {
      if (condIds.has(condMatch[1])) fail('minimal.brules', `重复 COND ${condMatch[1]}`);
      condIds.add(condMatch[1]);
      current = { kind: 'COND', id: condMatch[1], hasWhen: false };
      continue;
    }

    const ruleMatch = /^RULE:\s+([A-Za-z][A-Za-z0-9_.-]*)$/.exec(line);
    if (ruleMatch) {
      current = { kind: 'RULE', id: ruleMatch[1], hasSeq: false, hasBid: false };
      continue;
    }

    if (line === 'END') {
      if (!current) {
        fail('minimal.brules', '多余的 END');
      } else if (current.kind === 'COND' && !current.hasWhen) {
        fail('minimal.brules', `COND ${current.id} 没有 WHEN`);
      } else if (current.kind === 'RULE' && (!current.hasSeq || !current.hasBid)) {
        fail('minimal.brules', `RULE ${current.id} 缺 SEQ 或 BID`);
      }
      current = null;
      continue;
    }

    if (!current) {
      fail('minimal.brules', `无法识别的行: ${line}`);
      continue;
    }

    const whenMatch = /^WHEN:\s+([A-Za-z][A-Za-z0-9_]*)\s+(.+)$/.exec(line);
    if (whenMatch) {
      const key = whenMatch[1];
      const allowed = new Set([...runtimeKeys, 'shapeClass']);
      if (!allowed.has(key)) fail('minimal.brules', `未登记的条件键 ${key}`);
      if (key === 'shapeClass' && !expectedShapes.includes(whenMatch[2])) {
        fail('minimal.brules', `非法 shapeClass ${whenMatch[2]}`);
      }
      current.hasWhen = true;
      continue;
    }

    const useMatch = /^USE:\s+([A-Za-z][A-Za-z0-9_.-]*)$/.exec(line);
    if (useMatch) {
      usedConds.add(useMatch[1]);
      continue;
    }

    const seqMatch = /^SEQ:\s+(.+)$/.exec(line);
    if (seqMatch) {
      current.hasSeq = true;
      if (!['^$', '.*'].includes(seqMatch[1]) && !/^[MPLR]:[^ ]+(?:\s+[MPLR]:[^ ]+)*$/.test(seqMatch[1])) {
        fail('minimal.brules', `SEQ 语法可疑: ${seqMatch[1]}`);
      }
      continue;
    }

    const bidMatch = /^BID:\s+(.+)$/.exec(line);
    if (bidMatch) {
      current.hasBid = true;
      const call = bidMatch[1].trim();
      const valid =
        call === '-' ||
        call === 'X' ||
        call === 'XX' ||
        /^[1-7](C|D|H|S|NT)$/.test(call);
      if (!valid) fail('minimal.brules', `非法叫品 ${call}`);
      continue;
    }

    if (/^(PRIO|DESC|TAGS|ENABLED):/.test(line)) continue;
    fail('minimal.brules', `无法识别的行: ${line}`);
  }

  if (!versionSeen) fail('minimal.brules', '缺少 VERSION');
  for (const field of ['FORMAT', 'KIND', 'SYSTEM']) {
    if (!header[field]) fail('minimal.brules', `缺少 ${field}`);
  }
  for (const cond of usedConds) {
    if (!condIds.has(cond)) fail('minimal.brules', `USE 引用了不存在的 COND ${cond}`);
  }
  if (!errors.some((error) => error.startsWith('minimal.brules'))) {
    ok('minimal.brules 结构与文法关键约束');
  }
}

// ---------------------------------------------------------------------------
// 4. 文档存在性与关键内容
// ---------------------------------------------------------------------------

const requiredDocs = [
  'README.md',
  'grammar.ebnf',
  'rules-ir.schema.json',
  'record.schema.json',
  'conditions.md',
  'migration.md',
  'pbn.md',
  'reproducibility.md',
  'srs-board-model.md',
  'examples/minimal.brules',
  'examples/minimal.rules.json',
  'examples/passed-out.record.json',
];
for (const file of requiredDocs) {
  if (!existsSync(join(DOCS, file))) fail('文档', `缺少 ${file}`);
}
if (!errors.some((error) => error.startsWith('文档'))) ok('文档文件齐全');

const readmeText = read(join(DOCS, 'README.md'));
for (const file of requiredDocs) {
  if (file === 'README.md') continue;
  if (!readmeText.includes(file)) warn('README.md', `未在索引中看到 ${file}`);
}

const grammarText = read(join(DOCS, 'grammar.ebnf'));
for (const token of [
  'Version         = Digit , { Digit }',
  'CallToken       = "-" | "X" | "XX"',
  'ShapeClass      = "BAL_ANY"',
  'QuantifiedCondition',
  'StyleVar',
]) {
  if (!grammarText.includes(token)) fail('grammar.ebnf', `缺少关键片段 ${token}`);
}
if (!errors.some((error) => error.startsWith('grammar.ebnf'))) ok('grammar.ebnf 关键片段');

const migrationText = read(join(DOCS, 'migration.md'));
for (const token of ['LHO', 'RHO', 'allpass', 'AP', 'ALL', 'ANY', 'BAL_NO_5M', 'LEGACY_ID_PREFIX_SEMANTICS']) {
  if (!migrationText.includes(token)) fail('migration.md', `缺少 ${token}`);
}
if (!errors.some((error) => error.startsWith('migration.md'))) ok('migration.md 关键主题');

const pbnText = read(join(DOCS, 'pbn.md'));
for (const token of ['[Dealer]', 'DEALER_INFERRED_FROM_DEAL_PREFIX', 'NS 420', 'EW 620', 'AP', 'ISO 8859-1']) {
  if (!pbnText.includes(token)) fail('pbn.md', `缺少 ${token}`);
}
if (!errors.some((error) => error.startsWith('pbn.md'))) ok('pbn.md 关键主题');

const repoText = read(join(DOCS, 'reproducibility.md'));
for (const token of ['BRIDGE-RNG/1', 'rulesetId', 'JCS', 'deal', 'bidding', 'play', 'dds', 'legacy-shared']) {
  if (!repoText.includes(token)) fail('reproducibility.md', `缺少 ${token}`);
}
if (!errors.some((error) => error.startsWith('reproducibility.md'))) ok('reproducibility.md 关键主题');

const srsText = read(join(DOCS, 'srs-board-model.md'));
for (const token of ['Deal', 'TableBoard', 'SessionBoard', '派生']) {
  if (!srsText.includes(token)) fail('srs-board-model.md', `缺少 ${token}`);
}
if (!errors.some((error) => error.startsWith('srs-board-model.md'))) ok('srs-board-model.md 关键主题');

const packageJson = readJson(join(ROOT, 'package.json'));
if (packageJson && packageJson.scripts?.['check:phase0'] !== 'node scripts/checkPhase0.mjs') {
  fail('package.json', '缺少 check:phase0 脚本');
} else if (packageJson) {
  ok('package.json check:phase0');
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

for (const check of checks) {
  console.log(`✓ ${check}`);
}
for (const warning of warnings) {
  console.warn(`! ${warning}`);
}
for (const error of errors) {
  console.error(`✗ ${error}`);
}

console.log('');
console.log(`Phase 0 检查：${checks.length} 项通过，${warnings.length} 个警告，${errors.length} 个错误。`);

if (errors.length > 0) {
  process.exitCode = 1;
}
