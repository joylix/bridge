import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { findBidCandidates } from '../engine/matcher';
import { parseBiddingRules } from '../engine/loader';
import { parseHand } from '../testing/testUtils';
import { compileBiddingRules, detectBiddingRuleFormat, hasBiddingRuleErrors } from './runtime';

const PRECISION_ID =
  'sha256:4aae938c5141298c8fea714d03092cbed504f7a97cb7351a709f4d814365a55a';

function ruleFile(name: string): string {
  return readFileSync(resolve(process.cwd(), 'src/rules/bidding', name), 'utf8');
}

function example(name: string): string {
  return readFileSync(resolve(process.cwd(), 'docs/brules-v0.5/examples', name), 'utf8');
}

function legacy(yamlText: string, file = 'test.yml') {
  return compileBiddingRules(yamlText, { file });
}

describe('运行时格式识别', () => {
  it('区分 legacy YAML、v0.5 DSL、IR JSON、IR YAML', () => {
    expect(detectBiddingRuleFormat(ruleFile('precision.yml'))).toBe('legacy-yaml');
    expect(detectBiddingRuleFormat(example('minimal.brules'))).toBe('v0.5-dsl');
    expect(detectBiddingRuleFormat(example('minimal.rules.json'))).toBe('v0.5-ir-json');
    const irYaml = yaml.dump(JSON.parse(example('minimal.rules.json')));
    expect(detectBiddingRuleFormat(irYaml)).toBe('v0.5-ir-yaml');
    expect(detectBiddingRuleFormat('VERSION: BRULES/0.4\nFORMAT: bridge-rules\n')).toBe(
      'unsupported',
    );
  });
});

describe('legacy precision / natural 运行时编译', () => {
  it('precision 1074 条迁移为 1078 条可执行规则，rulesetId 稳定', () => {
    const set = legacy(ruleFile('precision.yml'), 'src/rules/bidding/precision.yml');
    expect(set.format).toBe('legacy-yaml');
    expect(set.system).toBe('precision');
    expect(hasBiddingRuleErrors(set)).toBe(false);
    expect(set.rules).toHaveLength(1078);
    expect(set.rulesetId).toBe(PRECISION_ID);
    expect(set.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
  });

  it('natural 23 条保持可执行', () => {
    const set = legacy(ruleFile('natural.yml'), 'src/rules/bidding/natural.yml');
    expect(set.system).toBe('natural');
    expect(hasBiddingRuleErrors(set)).toBe(false);
    expect(set.rules).toHaveLength(23);
    expect(set.rulesetId).toBe(
      'sha256:5cb5c98da9dcc86120f5b4861346002571fce5344b372bc63d1b29e7c6570314',
    );
  });

  it('precision 的 nat_ 规则保留 natural + forcing 编译标签', () => {
    const set = legacy(ruleFile('precision.yml'), 'src/rules/bidding/precision.yml');
    const naturalForcing = set.rules.filter((rule) => rule.id.startsWith('nat_'));
    expect(naturalForcing).toHaveLength(35);
    expect(
      naturalForcing.every(
        (rule) => rule.tags?.includes('natural') && rule.tags?.includes('forcing'),
      ),
    ).toBe(true);
  });

  it('v0.5 DSL 与 IR JSON/YAML 产出相同规则与 rulesetId', () => {
    const dsl = compileBiddingRules(example('minimal.brules'), { file: 'minimal.brules' });
    const json = compileBiddingRules(example('minimal.rules.json'), {
      file: 'minimal.rules.json',
    });
    const irYaml = compileBiddingRules(yaml.dump(JSON.parse(example('minimal.rules.json'))), {
      file: 'minimal.rules.json',
    });

    expect(dsl.rules.map((rule) => rule.id)).toEqual(['open_1nt', 'open_1c']);
    expect(json.rules.map((rule) => rule.id)).toEqual(['open_1nt', 'open_1c']);
    expect(irYaml.rules.map((rule) => rule.id)).toEqual(['open_1nt', 'open_1c']);
    expect(new Set([dsl.rulesetId, json.rulesetId, irYaml.rulesetId]).size).toBe(1);
    expect(dsl.rulesetId).toBe(
      'sha256:39e571721cec89a8d3c8c1e7d469953f369961d5aaf4ed6c557a0e76aa8b7cd7',
    );
  });

  it('v0.4 行式 DSL 明确拒绝', () => {
    const set = compileBiddingRules(
      'VERSION: BRULES/0.4\nFORMAT: bridge-rules\nKIND: bidding\nSYSTEM: test\n',
    );
    expect(set.format).toBe('unsupported');
    expect(set.rules).toEqual([]);
    expect(set.rulesetId).toBeNull();
    expect(set.diagnostics.map((item) => item.code)).toContain('UNSUPPORTED_VERSION');
  });
});

describe('编译元数据进入裁决', () => {
  it('specificity 取源条件项数量，不受 BAL_NO_5M 降解增加的扁平条件影响', () => {
    const set = legacy(`
rules:
  - id: bal_any_nt
    description: 任意均型 1NT
    sequence: "^$"
    when: { balanced: true }
    action: "1NT"
    priority: 50
  - id: shape_first
    description: 两条件规则
    sequence: "^$"
    when: { hcp: "0-40", spades: "3+" }
    action: "2C"
    priority: 50
`);
    const compiled = set.rules.find((rule) => rule.id === 'bal_any_nt')!;
    expect(compiled.when).toEqual({ balanced: true, fiveCardMajor: false });
    expect(compiled.specificity).toBe(1);
    expect(compiled.sourceIndex).toBe(0);
    expect(set.rules.find((rule) => rule.id === 'shape_first')?.specificity).toBe(2);

    // 4333 手牌：两条规则都成立。按源具体度 shape_first(2) 应排在 bal_any_nt(1) 前。
    const hand = parseHand('SAKQ2 HJ43 DQ32 CJ43');
    const candidates = findBidCandidates(hand, [], 'S', null, 1, set.rules);
    expect(candidates.map((item) => item.rule.id)).toEqual(['shape_first', 'bal_any_nt']);
    expect(candidates.map((item) => item.specificity)).toEqual([2, 1]);
  });

  it('同优先级、同具体度时按 IR 声明顺序裁决，与输入数组顺序无关', () => {
    const set = legacy(`
rules:
  - id: first_declared
    description: 先声明
    sequence: "^$"
    when: {}
    action: "1C"
    priority: 50
  - id: second_declared
    description: 后声明
    sequence: "^$"
    when: {}
    action: "1D"
    priority: 50
`);
    const hand = parseHand('SAKQ2 HJ43 DQ32 CJ43');
    const reversed = [...set.rules].reverse();
    const candidates = findBidCandidates(hand, [], 'S', null, 1, reversed);
    expect(candidates.map((item) => item.rule.id)).toEqual([
      'first_declared',
      'second_declared',
    ]);
  });
});

describe('5M5332 balanced 语义评审用例', () => {
  const fiveMajorBalanced = parseHand('SAKQ32 HQJ3 D543 C62'); // 5-3-3-2，13 HCP

  it('balanced:true 迁移为 BAL_NO_5M 后排除 5M5332（与旧 isBalanced=BAL_ANY 不同）', () => {
    const text = `
rules:
  - id: nt_balanced
    description: 均型 1NT
    sequence: "^$"
    when: { hcp: "12-14", balanced: true }
    action: "1NT"
    priority: 100
  - id: spade_five
    description: 五张黑桃
    sequence: "^$"
    when: { hcp: "12-14", spades: "5+" }
    action: "1S"
    priority: 90
`;
    const oldRules = parseBiddingRules(text);
    const newRules = legacy(text).rules;

    // 旧运行时：isBalanced 等价 BAL_ANY，5M5332 匹配 1NT。
    expect(
      findBidCandidates(fiveMajorBalanced, [], 'S', null, 1, oldRules)[0]?.rule.action,
    ).toBe('1NT');
    // v0.5 BAL_NO_5M：1NT 排除 5M5332，改由 1S 规则命中。
    expect(
      findBidCandidates(fiveMajorBalanced, [], 'S', null, 1, newRules)[0]?.rule.action,
    ).toBe('1S');
  });

  it('balanced:false 拆分后由 #2 匹配 5M5332', () => {
    const text = `
rules:
  - id: unbal_action
    description: 非均型
    sequence: "^$"
    when: { balanced: false }
    action: "1D"
    priority: 100
`;
    expect(findBidCandidates(fiveMajorBalanced, [], 'S', null, 1, parseBiddingRules(text))).toEqual(
      [],
    );

    const compiled = legacy(text);
    expect(compiled.rules.map((rule) => rule.id)).toEqual(['unbal_action#1', 'unbal_action#2']);
    expect(compiled.rules.map((rule) => rule.specificity)).toEqual([1, 1]);
    const candidates = findBidCandidates(fiveMajorBalanced, [], 'S', null, 1, compiled.rules);
    expect(candidates.map((item) => item.rule.id)).toEqual(['unbal_action#2']);
  });

  it('balanced:false 拆分不匹配 4333', () => {
    const text = `
rules:
  - id: unbal_action
    description: 非均型
    sequence: "^$"
    when: { balanced: false }
    action: "1D"
    priority: 100
`;
    const balanced4333 = parseHand('SAKQ2 HJ43 DQ32 CJ43');
    const compiled = legacy(text);
    expect(findBidCandidates(balanced4333, [], 'S', null, 1, compiled.rules)).toEqual([]);
  });
});
