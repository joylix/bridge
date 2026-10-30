import { describe, expect, it } from 'vitest';
import { compileRules, toBiddingRules, toRuntimeAction, toRuntimeSequence } from './compile';
import { computeRulesetId } from './ruleset';
import type { RuleIR, RulesIR, WhenIR } from './types';

function makeIr(rules: RuleIR[], extra: Partial<RulesIR> = {}): RulesIR {
  return {
    format: 'bridge-rules-ir',
    formatVersion: '0.5',
    kind: 'bidding',
    system: 'test',
    rules,
    ...extra,
  };
}

function makeRule(overrides: Partial<RuleIR> = {}): RuleIR {
  return {
    id: 'r1',
    sequence: '^$',
    when: { hcp: '15-17' },
    action: '1NT',
    priority: 10,
    ...overrides,
  };
}

function compile(rules: RuleIR[], extra: Partial<RulesIR> = {}) {
  return compileRules(makeIr(rules, extra));
}

describe('IR → BiddingRule 适配', () => {
  it('BAL_NO_5M 降解为 balanced + fiveCardMajor，specificity 不变', () => {
    const result = compile([
      makeRule({
        when: { hcp: '15-17', shapeClass: 'BAL_NO_5M' } as unknown as WhenIR,
        specificity: 2,
      }),
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toMatchObject({
      id: 'r1',
      sequence: '^$',
      when: { hcp: '15-17', balanced: true, fiveCardMajor: false },
      action: '1NT',
      priority: 10,
      specificity: 2,
      sourceIndex: 0,
      sourceId: 'r1',
    });
  });

  it('BAL_NO_5M 缺省 specificity 按源条件数计算，不因降解增加', () => {
    const result = compile([
      makeRule({ when: { shapeClass: 'BAL_NO_5M' } as unknown as WhenIR }),
    ]);
    expect(result.rules[0].specificity).toBe(1);
    expect(result.rules[0].when).toEqual({ balanced: true, fiveCardMajor: false });
  });

  it('BAL_ANY 只降解为 balanced，不附加 fiveCardMajor', () => {
    const result = compile([
      makeRule({ when: { hcp: '16+', shapeClass: 'BAL_ANY' } as unknown as WhenIR }),
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(result.rules[0].when).toEqual({ hcp: '16+', balanced: true });
  });

  it('SEMIBAL / UNBAL 报 UNSUPPORTED_CONDITION 且不进入可执行集', () => {
    const result = compile([
      makeRule({ id: 'semi', when: { shapeClass: 'SEMIBAL' } as unknown as WhenIR }),
      makeRule({ id: 'unbal', when: { shapeClass: 'UNBAL' } as unknown as WhenIR }),
      makeRule({ id: 'ok' }),
    ]);
    expect(result.diagnostics.map((item) => [item.code, item.severity, item.ruleId])).toEqual([
      ['UNSUPPORTED_CONDITION', 'warning', 'semi'],
      ['UNSUPPORTED_CONDITION', 'warning', 'unbal'],
    ]);
    expect(result.rules.map((rule) => rule.id)).toEqual(['ok']);
  });

  it('矛盾组合只警告并保留规则', () => {
    const result = compile([
      makeRule({
        id: 'any_false',
        when: { shapeClass: 'BAL_ANY', balanced: false } as unknown as WhenIR,
      }),
      makeRule({
        id: 'no5m_true',
        when: { shapeClass: 'BAL_NO_5M', fiveCardMajor: true } as unknown as WhenIR,
      }),
    ]);
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      'CONTRADICTORY_CONDITION',
      'CONTRADICTORY_CONDITION',
    ]);
    expect(result.rules.map((rule) => rule.id)).toEqual(['any_false', 'no5m_true']);
    expect(result.rules[0].when).toEqual({ balanced: false });
    expect(result.rules[1].when).toEqual({ balanced: true, fiveCardMajor: true });
  });

  it('PASS 映射为运行时 Pass，其余叫品不变', () => {
    expect(toRuntimeAction('PASS')).toBe('Pass');
    expect(toRuntimeAction('X')).toBe('X');
    expect(toRuntimeSequence('M:PASS P:PASS')).toBe('M:Pass P:Pass');
    expect(toRuntimeSequence('^$')).toBe('^$');
    expect(toRuntimeSequence('.*')).toBe('.*');
    const result = compile([
      makeRule({
        sequence: 'M:PASS P:PASS',
        action: 'PASS',
        when: {},
      }),
    ]);
    expect(result.rules[0]).toMatchObject({ sequence: 'M:Pass P:Pass', action: 'Pass' });
  });

  it('禁用规则只产生 info 诊断', () => {
    const result = compile([makeRule({ id: 'off', enabled: false }), makeRule({ id: 'on' })]);
    expect(result.diagnostics.map((item) => [item.code, item.severity])).toEqual([['RULE_DISABLED', 'info']]);
    expect(result.rules.map((rule) => rule.id)).toEqual(['on']);
  });

  it('保留声明顺序与源索引', () => {
    const result = compile([
      makeRule({ id: 'third', priority: 1 }),
      makeRule({ id: 'first', priority: 3 }),
      makeRule({ id: 'second', priority: 2 }),
    ]);
    expect(result.rules.map((rule) => rule.id)).toEqual(['third', 'first', 'second']);
    expect(result.rules.map((rule) => rule.sourceIndex)).toEqual([0, 1, 2]);
    expect(result.rules.map((rule) => rule.sourceId)).toEqual(['third', 'first', 'second']);
  });

  it('同优先级/同具体度/同序列且动作冲突时给出 AMBIGUOUS_RULES', () => {
    const result = compile([
      makeRule({ id: 'a', when: { hcp: '15-17' }, action: '1NT' }),
      makeRule({ id: 'b', when: { hcp: '16-18' }, action: '1S' }),
    ]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'AMBIGUOUS_RULES',
      severity: 'warning',
    });
    expect(result.diagnostics[0].details?.ruleIds).toEqual(['a', 'b']);
    expect(result.rules).toHaveLength(2);
  });

  it('动作相同的同组规则不报歧义', () => {
    const result = compile([
      makeRule({ id: 'a', when: { hcp: '15-17' }, action: '1NT' }),
      makeRule({ id: 'b', when: { hcp: '16-18' }, action: '1NT' }),
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('description 缺省为空串，tags 只进入编译元数据', () => {
    const result = compile([makeRule({ tags: ['natural', 'forcing'] })]);
    expect(result.rules[0].description).toBe('');
    expect(result.rules[0].tags).toEqual(['natural', 'forcing']);
    expect('tags' in toBiddingRules(result.rules)[0]).toBe(false);
  });

  it('rulesetId 对完整 IR 计算，与可执行集无关', () => {
    const ir = makeIr([
      makeRule({ id: 'ok' }),
      makeRule({ id: 'semi', when: { shapeClass: 'SEMIBAL' } as unknown as WhenIR }),
    ]);
    const result = compileRules(ir);
    expect(result.rulesetId).toBe(computeRulesetId(ir));
    expect(result.rules).toHaveLength(1);
  });
});

describe('toBiddingRules', () => {
  it('展开产物 sourceId 去掉 #n 后缀', () => {
    const result = compile([makeRule({ id: 'r#2' })]);
    expect(result.rules[0].id).toBe('r#2');
    expect(result.rules[0].sourceId).toBe('r');
  });

  it('剥离 specificity / sourceIndex / sourceId', () => {
    const result = compile([makeRule({ description: undefined })]);
    const rules = toBiddingRules(result.rules);
    expect(rules).toEqual([
      {
        id: 'r1',
        description: '',
        sequence: '^$',
        when: { hcp: '15-17' },
        action: '1NT',
        priority: 10,
      },
    ]);
  });
});
