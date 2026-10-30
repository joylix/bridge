import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { checkConditions, type ConditionContext } from '../engine/conditions';
import { STYLE_PARAMS, type BiddingRule, type ConditionSpec } from '../engine/types';
import { parseHand } from '../testing/testUtils';
import {
  canonicalSuitSet,
  completeAuction,
  detectInputVersion,
  filterMigrationEntries,
  migrateLegacyYaml,
  migrateText,
  type MigrationResult,
} from './index';

const NORMAL = STYLE_PARAMS[1];
const FIXED_TIME = '2026-10-27T00:00:00Z';

function loadRuleFile(name: 'precision.yml' | 'natural.yml'): string {
  return readFileSync(resolve(process.cwd(), 'src/rules/bidding', name), 'utf8');
}

function migratePrecision(): MigrationResult {
  return migrateLegacyYaml(loadRuleFile('precision.yml'), {
    file: 'src/rules/bidding/precision.yml',
    generatedAt: FIXED_TIME,
  });
}

function legacyRules(text: string): BiddingRule[] {
  return (yaml.load(text) as { rules: BiddingRule[] }).rules;
}

describe('legacy YAML 迁移：基础字段与序列', () => {
  const MINIMAL = `rules:
  - id: open_1c
    description: "精确 1C"
    sequence: "^$"
    when: { hcp: "16-40" }
    action: "1C"
    priority: 100
  - id: pass_after_1c
    description: "1C 后 Pass"
    sequence: "P:1C R:Pass"
    when: { balanced: true }
    action: "Pass"
    priority: 10
`;

  it('保留 id、动作、优先级、描述与声明顺序', () => {
    const result = migrateLegacyYaml(MINIMAL, { file: 'minimal.yml', generatedAt: FIXED_TIME });
    expect(result.report.summary.rules).toBe(2);
    expect(result.report.summary.autoMigrated).toBe(2);
    expect(result.report.summary.unsupported).toBe(0);
    expect(result.ir?.rules.map((rule) => rule.id)).toEqual(['open_1c', 'pass_after_1c']);
    expect(result.ir?.rules[0]).toMatchObject({
      sequence: '^$',
      action: '1C',
      priority: 100,
      description: '精确 1C',
      source: { file: 'minimal.yml', line: 2 },
    });
    expect(result.ir?.rules[1].action).toBe('PASS');
    expect(result.ir?.rules[1].sequence).toBe('P:1C R:PASS');
    expect(result.report.rules.map((rule) => rule.line)).toEqual([2, 8]);
    // 无法推断体系时写 legacy，不得伪装成 precision
    expect(result.ir?.system).toBe('legacy');
    expect(result.report.summary.byCode.SYSTEM_INFERRED).toBe(1);
  });

  it('把 balanced:true 改写为 BAL_NO_5M，并在编译时降解', () => {
    const result = migrateLegacyYaml(MINIMAL, { file: 'minimal.yml', generatedAt: FIXED_TIME });
    expect(result.ir?.rules[1].when).toEqual({ shapeClass: 'BAL_NO_5M' });
    const compiled = result.compiled?.rules.find((rule) => rule.id === 'pass_after_1c');
    expect(compiled?.when).toEqual({ balanced: true, fiveCardMajor: false });
    expect(compiled?.action).toBe('Pass');
    expect(compiled?.sequence).toBe('P:1C R:Pass');
    expect(filterMigrationEntries(result.report.entries, { code: 'LEGACY_BAL_MIGRATED' })).toHaveLength(1);
  });

  it('Pass / PASS / - 统一为 PASS，P 不当作 Pass', () => {
    const result = migrateLegacyYaml(
      `rules:
  - id: r_pass
    sequence: "M:PASS P:-"
    when: {}
    action: "Pass"
    priority: 1
  - id: r_bad_p
    sequence: "M:P"
    when: {}
    action: "P"
    priority: 1
`,
      { generatedAt: FIXED_TIME },
    );
    expect(result.ir?.rules[0]).toMatchObject({ sequence: 'M:PASS P:PASS', action: 'PASS' });
    expect(result.report.rules[0].codes).toContain('MIGRATED_RULE');
    expect(result.report.rules[1].status).toBe('unsupported');
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'PASS_ALIAS_REJECTED')).toBe(true);
  });

  it('PAR 映射为 P；LHO/RHO 进入人工确认且不导出', () => {
    const result = migrateLegacyYaml(
      `rules:
  - id: par_rule
    sequence: "PAR:1C R:Pass"
    when: {}
    action: "Pass"
    priority: 1
  - id: lho_rule
    sequence: "LHO:1S"
    when: {}
    action: "X"
    priority: 1
  - id: ok_rule
    sequence: "^$"
    when: { hcp: "16+" }
    action: "1C"
    priority: 100
`,
      { generatedAt: FIXED_TIME },
    );
    expect(result.ir?.rules.map((rule) => rule.id)).toEqual(['par_rule', 'ok_rule']);
    expect(result.ir?.rules[0].sequence).toBe('P:1C R:PASS');
    const manual = result.report.rules.find((rule) => rule.ruleId === 'lho_rule');
    expect(manual?.status).toBe('manual-review');
    expect(manual?.exported).toBe(false);
    expect(manual?.codes).toContain('LHO_RHO_MANUAL_REVIEW');
    expect(manual?.codes).toContain('LHO_RHO_UNRESOLVED');
  });
});

describe('balanced:false 的无损拆分', () => {
  const SOURCE = `rules:
  - id: strong_double
    sequence: "R:1C"
    when: { hcp: "16+", balanced: false }
    action: "X"
    priority: 52
`;

  it('拆成两条规则并保留源 specificity', () => {
    const result = migrateLegacyYaml(SOURCE, { generatedAt: FIXED_TIME });
    expect(result.ir?.rules.map((rule) => rule.id)).toEqual(['strong_double#1', 'strong_double#2']);
    expect(result.ir?.rules[0]).toMatchObject({
      when: { balanced: false, hcp: '16+' },
      specificity: 2,
    });
    expect(result.ir?.rules[1]).toMatchObject({
      when: { balanced: true, fiveCardMajor: true, hcp: '16+' },
      specificity: 2,
    });
    expect(result.report.rules[0]).toMatchObject({
      ruleId: 'strong_double',
      status: 'executable',
      exported: true,
      irRuleIds: ['strong_double#1', 'strong_double#2'],
    });
    expect(result.compiled?.rules).toHaveLength(2);
  });

  it('两条规则的并集等于 v0.4 NOT BAL_NO_5M', () => {
    const result = migrateLegacyYaml(SOURCE, { generatedAt: FIXED_TIME });
    const rules = result.compiled!.rules;
    const matches = (handSpec: string): boolean => {
      const hand = parseHand(handSpec);
      return rules.some((rule) => checkConditions(hand, rule.when, NORMAL));
    };
    // 5 张高花的 5332：v0.4 balanced:false 为真（当前运行时 isBalanced 会判为均型）
    expect(matches('SAKQJ HAK D543 C876')).toBe(true);
    // 5422 / 5242：非均型，真
    expect(matches('SAKQ32 HAK98 D54 C87')).toBe(true);
    expect(matches('SAKQJ2 HAK D5432 C87')).toBe(true);
    // 4333：BAL_NO_5M，假
    expect(matches('SAKQ2 HAKJ D543 C876')).toBe(false);
  });
});

describe('nat_ 标签与条件规范化', () => {
  it('nat_ 前缀写入 natural/forcing，保留 id', () => {
    const result = migrateLegacyYaml(
      `rules:
  - id: nat_test
    sequence: "R:1C"
    when: { hcp: "16+", clubs: "5+" }
    action: "2C"
    priority: 10
`,
      { generatedAt: FIXED_TIME },
    );
    expect(result.ir?.rules[0]).toMatchObject({
      id: 'nat_test',
      tags: ['natural', 'forcing'],
      action: '2C',
    });
    expect(result.report.summary.autoMigrated).toBe(1);
    expect(result.report.summary.byCode.LEGACY_ID_PREFIX_SEMANTICS).toBe(1);
  });

  it('nat_ 前缀与非自然动作冲突时进入人工确认', () => {
    const result = migrateLegacyYaml(
      `rules:
  - id: nat_bad
    sequence: "R:1C"
    when: { hcp: "16-18", balanced: true }
    action: "1NT"
    priority: 10
`,
      { generatedAt: FIXED_TIME },
    );
    expect(result.report.rules[0].status).toBe('manual-review');
    expect(result.report.rules[0].codes).toContain('LEGACY_ID_PREFIX_MISMATCH');
    expect(result.ir?.rules[0].tags).toBeUndefined();
  });

  it('花色集合按 C→D→H→S 规范化', () => {
    const result = migrateLegacyYaml(
      `rules:
  - id: stopper_order
    sequence: ".*"
    when: { stoppers: "SDC" }
    action: "3NT"
    priority: 1
`,
      { generatedAt: FIXED_TIME },
    );
    expect(result.ir?.rules[0].when.stoppers).toBe('CDS');
    expect(result.report.summary.byCode.LEGACY_CONDITION_NORMALIZED).toBe(1);
  });
});

describe('错误隔离与报告', () => {
  it('未知条件键只影响当前规则，其余规则继续迁移', () => {
    const result = migrateLegacyYaml(
      `rules:
  - id: good_rule
    sequence: "^$"
    when: { hcp: "16-40" }
    action: "1C"
    priority: 100
  - id: bad_rule
    sequence: "^$"
    when: { hcp: "16+", notACondition: true }
    action: "1D"
    priority: 90
  - id: after_bad
    sequence: "R:1C"
    when: { spades: "5+" }
    action: "1S"
    priority: 80
`,
      { generatedAt: FIXED_TIME },
    );
    expect(result.ir?.rules.map((rule) => rule.id)).toEqual(['good_rule', 'after_bad']);
    expect(result.report.summary).toMatchObject({
      rules: 3,
      autoMigrated: 2,
      unsupported: 1,
      executableSourceRules: 2,
    });
    expect(result.report.unsupportedRules.map((rule) => rule.ruleId)).toEqual(['bad_rule']);
    expect(result.report.rules[1].codes).toContain('INVALID_CONDITION_KEY');
  });

  it('大小写不敏感的重复 id 被拒绝', () => {
    const result = migrateLegacyYaml(
      `rules:
  - id: dup
    sequence: "^$"
    when: {}
    action: "1C"
    priority: 1
  - id: DUP
    sequence: "^$"
    when: {}
    action: "1D"
    priority: 1
`,
      { generatedAt: FIXED_TIME },
    );
    expect(result.ir?.rules.map((rule) => rule.id)).toEqual(['dup']);
    expect(result.report.unsupportedRules).toHaveLength(1);
    expect(result.report.unsupportedRules[0].codes).toContain('DUPLICATE_ID');
  });

  it('每条源规则至少有一个报告项，summary 可由 rules/entries 重算', () => {
    const result = migratePrecision();
    expect(result.report.entries.filter((entry) => entry.code === 'MIGRATED_RULE')).toHaveLength(1074);
    expect(result.report.summary.entries).toBe(result.report.entries.length);
    expect(result.report.summary.byCode.MIGRATED_RULE).toBe(1074);
    expect(
      result.report.summary.autoMigrated +
        result.report.summary.manualReview +
        result.report.summary.unsupported,
    ).toBe(result.report.summary.rules);
    const warnings = result.report.entries.filter((entry) => entry.severity === 'warning').length;
    const infos = result.report.entries.filter((entry) => entry.severity === 'info').length;
    const errors = result.report.entries.filter((entry) => entry.severity === 'error').length;
    expect(result.report.summary.bySeverity).toEqual({ error: errors, warning: warnings, info: infos });
  });
});

describe('allpass 展开', () => {
  it('completeAuction 覆盖规范中的三个示例', () => {
    expect(
      completeAuction(['1NT', 'PASS', '2C', 'PASS', '2H', 'PASS', '3NT', 'PASS']),
    ).toMatchObject({ appended: 2, valid: true });
    expect(completeAuction(['PASS', 'PASS', 'PASS', 'PASS'])).toMatchObject({
      appended: 0,
      valid: true,
    });
    expect(
      completeAuction(['1NT', 'PASS', '2C', 'PASS', '2H', 'PASS', '3NT']),
    ).toMatchObject({ appended: 3, valid: true });
  });

  it('规则序列中的 allpass 补足 PASS 并可结束', () => {
    const result = migrateLegacyYaml(
      `rules:
  - id: allpass_after_bid
    sequence: "M:1NT P:PASS R:PASS allpass"
    when: {}
    action: "Pass"
    priority: 1
  - id: allpass_only
    sequence: "allpass"
    when: {}
    action: "Pass"
    priority: 1
`,
      { generatedAt: FIXED_TIME },
    );
    expect(result.ir?.rules[0].sequence).toBe('M:1NT P:PASS R:PASS M:PASS');
    expect(result.ir?.rules[1].sequence).toBe('M:PASS L:PASS P:PASS R:PASS');
    expect(result.report.summary.byCode.ALLPASS_NORMALIZED).toBe(2);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'ALLPASS_NORMALIZED')).toHaveLength(2);
  });

  it('allpass 不在末尾时报 ALLPASS_INVALID', () => {
    const result = migrateLegacyYaml(
      `rules:
  - id: bad_allpass
    sequence: "allpass M:PASS"
    when: {}
    action: "Pass"
    priority: 1
`,
      { generatedAt: FIXED_TIME },
    );
    expect(result.report.summary.unsupported).toBe(1);
    expect(result.report.rules[0].codes).toContain('ALLPASS_INVALID');
  });
});

describe('1074 条 precision.yml 全量迁移', () => {
  const result = migratePrecision();
  const report = result.report;
  const ir = result.ir!;
  const compiled = result.compiled!;

  it('100% 源规则可执行，IR 展开到 1078 条', () => {
    expect(report.summary).toMatchObject({
      rules: 1074,
      autoMigrated: 1074,
      manualReview: 0,
      unsupported: 0,
      executableSourceRules: 1074,
      executableIrRules: 1078,
      executableRate: 1,
    });
    expect(report.unsupportedRules).toEqual([]);
    expect(ir.rules).toHaveLength(1078);
    expect(compiled.rules).toHaveLength(1078);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(report.rulesetId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(report.summary.byCode.LEGACY_BAL_MIGRATED).toBe(219);
    expect(report.summary.byCode.LEGACY_ID_PREFIX_SEMANTICS).toBe(35);
    expect(report.summary.byCode.LEGACY_CONDITION_NORMALIZED).toBe(21);
    expect(report.summary.bySeverity.error).toBe(0);
    expect(report.summary.bySeverity.warning).toBe(88);
  });

  it('保留声明顺序、源 id 与行号', () => {
    const source = legacyRules(loadRuleFile('precision.yml'));
    expect(ir.rules[0].id).toBe(source[0].id);
    expect(ir.rules[0].source?.line).toBe(17);
    expect(report.rules[0]).toMatchObject({ ruleId: source[0].id, line: 17, order: 0 });
    expect(new Set(ir.rules.map((rule) => rule.id.toLowerCase())).size).toBe(ir.rules.length);
    for (const sourceRule of source) {
      expect(report.rules.some((item) => item.ruleId === sourceRule.id)).toBe(true);
    }
  });

  it('balanced:true 全部改写为 shapeClass，4 条 false 拆成 8 条', () => {
    expect(ir.rules.filter((rule) => rule.when.shapeClass === 'BAL_NO_5M')).toHaveLength(215);
    const split = ir.rules.filter((rule) => /^strong_takeout_double_1[cdhs]#[12]$/.test(rule.id));
    expect(split).toHaveLength(8);
    expect(ir.rules.some((rule) => rule.id === 'strong_takeout_double_1c')).toBe(false);
    expect(ir.rules.some((rule) => rule.when.balanced !== undefined && rule.when.shapeClass !== undefined)).toBe(false);
    expect(report.coverage.shapeClass).toEqual({ count: 215, disposition: 'ir-only' });
  });

  it('条件键覆盖与 22 个 legacy-direct 键逐项关闭', () => {
    expect(report.coverage.usedKeys).toBe(36);
    expect(report.coverage.unknownKeys).toEqual([]);
    expect(report.coverage.keys).toHaveLength(46);
    expect(report.coverage.v04.unsupported).toHaveLength(22);
    expect(report.coverage.v04.partial).toHaveLength(4);
    expect(report.coverage.v04.direct).toHaveLength(10);
    expect(report.coverage.v04.unused).toHaveLength(10);
    const balanced = report.coverage.keys.find((item) => item.key === 'balanced');
    expect(balanced).toMatchObject({ count: 219, disposition: 'shapeClass' });
    const partnerOpened = report.coverage.keys.find((item) => item.key === 'partnerOpened');
    expect(partnerOpened).toMatchObject({ count: 484, v04: 'U', disposition: 'legacy-direct' });
    const aces = report.coverage.keys.find((item) => item.key === 'aces');
    expect(aces).toMatchObject({ count: 52, v04: 'P', disposition: 'legacy-direct' });
    const fiveCardMajor = report.coverage.keys.find((item) => item.key === 'fiveCardMajor');
    expect(fiveCardMajor).toMatchObject({ count: 0, disposition: 'unused' });
    expect(report.coverage.styleVars).toEqual(['overcallMinHcp', 'preemptMinLen']);
  });

  it('nat_、Pass 与花色集合全部规范化', () => {
    const nat = ir.rules.filter((rule) => rule.id.startsWith('nat_'));
    expect(nat).toHaveLength(35);
    expect(nat.every((rule) => rule.tags?.includes('natural') && rule.tags?.includes('forcing'))).toBe(true);
    expect(ir.rules.some((rule) => (rule.action as string) === 'Pass')).toBe(false);
    expect(ir.rules.some((rule) => rule.sequence.includes('Pass'))).toBe(false);
    for (const rule of ir.rules) {
      if (typeof rule.when.stoppers === 'string') {
        expect(rule.when.stoppers).toBe(canonicalSuitSet(rule.when.stoppers));
      }
    }
  });

  it('报告可按 code / severity / ruleId 过滤', () => {
    expect(filterMigrationEntries(report.entries, { code: 'LEGACY_ID_PREFIX_SEMANTICS' })).toHaveLength(35);
    expect(filterMigrationEntries(report.entries, { severity: 'warning' })).toHaveLength(88);
    expect(filterMigrationEntries(report.entries, { ruleId: 'open_1c' })).toHaveLength(1);
  });
});

describe('natural.yml 与版本识别', () => {
  it('natural.yml 23 条全部可执行', () => {
    const result = migrateLegacyYaml(loadRuleFile('natural.yml'), {
      file: 'src/rules/bidding/natural.yml',
      generatedAt: FIXED_TIME,
    });
    expect(result.report.summary).toMatchObject({
      rules: 23,
      autoMigrated: 23,
      unsupported: 0,
      executableSourceRules: 23,
      executableIrRules: 23,
      executableRate: 1,
    });
    expect(result.ir?.system).toBe('natural');
    expect(result.ir?.styleParams).toEqual(['open1ntMin', 'open1ntMax', 'overcallMinHcp']);
    expect(result.ir?.rules.filter((rule) => rule.when.shapeClass === 'BAL_NO_5M')).toHaveLength(2);
    expect(result.ir?.rules.find((rule) => rule.id === 'natural_fallback_pass')).toMatchObject({
      action: 'PASS',
      sequence: '.*',
    });
    expect(result.report.summary.bySeverity.warning).toBe(0);
    expect(result.report.summary.bySeverity.error).toBe(0);
  });

  it('detectInputVersion 识别 legacy / 0.4 / 0.5 / 未知版本', () => {
    expect(detectInputVersion('rules:\n  - id: x\n')).toEqual({ kind: 'legacy-yaml' });
    expect(detectInputVersion('VERSION: BRULES/0.4\nCOND: x\n')).toEqual({ kind: 'v0.4', version: '0.4' });
    expect(detectInputVersion('VERSION: BRULES/0.5\nFORMAT: bridge-rules\n')).toEqual({
      kind: 'v0.5',
      version: '0.5',
    });
    expect(detectInputVersion('VERSION: BRULES/0.10\n')).toEqual({
      kind: 'unsupported',
      version: '0.10',
    });
    expect(detectInputVersion('hello')).toEqual({ kind: 'unsupported' });
  });

  it('v0.4 DSL 明确拒绝，v0.5 DSL 直通', () => {
    const v04 = migrateText('VERSION: BRULES/0.4\nFORMAT: bridge-rules\nKIND: bidding\n', {
      generatedAt: FIXED_TIME,
    });
    expect(v04.report.sourceVersion).toBe('0.4');
    expect(v04.diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_FEATURE')).toBe(true);

    const minimal = readFileSync(
      resolve(process.cwd(), 'docs/brules-v0.5/examples/minimal.brules'),
      'utf8',
    );
    const v05 = migrateText(minimal, { generatedAt: FIXED_TIME });
    expect(v05.report.sourceVersion).toBe('0.5');
    expect(v05.report.summary.rules).toBeGreaterThan(0);
    expect(v05.report.summary.unsupported).toBe(0);
    expect(v05.report.summary.executableRate).toBe(1);
  });
});

describe('可重复迁移', () => {
  it('除 generatedAt 外逐字节一致', () => {
    const first = migratePrecision();
    const second = migratePrecision();
    expect(JSON.stringify(first.report)).toBe(JSON.stringify(second.report));
    expect(JSON.stringify(first.ir)).toBe(JSON.stringify(second.ir));
    expect(first.report.rulesetId).toBe(second.report.rulesetId);

    const other = migrateLegacyYaml(loadRuleFile('precision.yml'), {
      file: 'src/rules/bidding/precision.yml',
      generatedAt: '2027-01-01T00:00:00Z',
    });
    const strip = (value: MigrationResult): string =>
      JSON.stringify({ ...value.report, generatedAt: '<fixed>' });
    expect(strip(other)).toBe(strip(first));
  });
});

describe('20 条代表规则的固定牌例比对', () => {
  // 这些规则不使用 balanced，因此迁移前后条件求值应完全一致。
  const REPRESENTATIVE = [
    'open_1c',
    'open_1h',
    'open_1s',
    'open_1d',
    'open_2c_precision',
    'open_2d_precision',
    'open_weak2_s',
    'resp_1nt_2c_stayman',
    'resp_1nt_2d_transfer_h',
    'resp_1h_raise_limit',
    'comp_raise_1h_over_1s_invite',
    'overcall_1s_after_1c',
    'takeout_double_1h',
    'cue_1h_over_1s',
    'cue_1c_over_1d',
    'cue_reply_h5_3h',
    'blackwood_1h_3h',
    'blackwood_1h_3h_0_4',
    'blackwood_5d_1',
    'opener_stayman_2s',
  ] as const;

  const HANDS = [
    'SAKQ2 HJT9 D543 C876',
    'SAKQJ HT9 D543 C876',
    'SAKQ32 HJT98 D54 C87',
    'SAKQJ2 H2 D5432 C876',
    'S32 H32 D32 CAKQJ432',
    'SAK2 HQJ3 D876 C5432',
    'S2 HAKQJ D5432 C9876',
    'SA2 HKQJ D5432 C9876',
    'SAKQ2 HAK3 DQJ4 C876',
    'SAKQ2 HJT9 DQJ4 C876',
    'SAKQ2 HAKQ DQJ4 CJ76',
    'SAKQJ2 HAK3 DQJ4 C87',
    'SAKQ2 HAKQ3 D2 CQ876',
    'S32 HKQJT98 D54 C876',
    'S432 H432 D432 C5432',
    'S2 HAKQJ DAKQ2 CA76',
    'SKQJ2 HJT9 DQJ4 C876',
    'SA2 HAKQ DAKQJ CAK',
  ];

  function contextFor(id: string): ConditionContext {
    if (id === 'open_1d') return { openingSeat: 1 };
    if (id.startsWith('resp_') || id.startsWith('comp_')) return { partnerOpened: true };
    if (id === 'cue_1h_over_1s') return { partnerOpened: true, adjustment: { opponentSuit: 3 } };
    if (id.startsWith('cue_reply')) {
      return { partnerCueBid: true, cueBidLevel: 2, cueBidSuit: 'S', partnerOpened: true };
    }
    if (id === 'blackwood_5d_1') return { partnerBlackwood: true };
    return {};
  }

  it('逐条比对条件、动作、序列与优先级', () => {
    const result = migratePrecision();
    const sourceById = new Map(
      legacyRules(loadRuleFile('precision.yml')).map((rule) => [rule.id, rule]),
    );
    const compiledById = new Map(result.compiled!.rules.map((rule) => [rule.id, rule]));
    const irById = new Map(result.ir!.rules.map((rule) => [rule.id, rule]));
    let checks = 0;

    for (const id of REPRESENTATIVE) {
      const source = sourceById.get(id);
      const migrated = result.report.rules.find((rule) => rule.ruleId === id);
      expect(source, `缺少源规则 ${id}`).toBeDefined();
      expect(migrated, `缺少迁移结果 ${id}`).toBeDefined();
      expect(migrated!.status).toBe('executable');
      expect(migrated!.irRuleIds).toHaveLength(1);
      const irId = migrated!.irRuleIds[0];
      const irRule = irById.get(irId)!;
      const compiled = compiledById.get(irId)!;
      expect(compiled).toBeDefined();
      expect(irRule.priority).toBe(source!.priority);
      expect(compiled.priority).toBe(source!.priority);
      expect(compiled.action).toBe(source!.action);
      expect(compiled.sequence).toBe(source!.sequence);

      for (const handSpec of HANDS) {
        const hand = parseHand(handSpec);
        for (const context of [contextFor(id), undefined]) {
          const before = checkConditions(hand, source!.when as ConditionSpec, NORMAL, context);
          const after = checkConditions(hand, compiled.when, NORMAL, context);
          expect(after, `${id} / ${handSpec} / ${JSON.stringify(context)}`).toBe(before);
          checks += 1;
        }
      }
    }
    expect(checks).toBe(REPRESENTATIVE.length * HANDS.length * 2);
  });
});
