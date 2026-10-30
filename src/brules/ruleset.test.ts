import { describe, expect, it } from 'vitest';
import { jcs } from './jcs';
import { computeRulesetId, semanticProjection } from './ruleset';
import type { RuleIR, RulesIR } from './types';

function minimalIr(): RulesIR {
  return {
    format: 'bridge-rules-ir',
    formatVersion: '0.5',
    kind: 'bidding',
    system: 'precision',
    systemVersion: '0.5.0',
    defaults: { priority: 50 },
    styleParams: ['open1ntMin', 'open1ntMax'],
    rules: [
      {
        id: 'open_1nt',
        sequence: '^$',
        when: { hcp: '${open1ntMin}-${open1ntMax}', shapeClass: 'BAL_NO_5M' },
        action: '1NT',
        priority: 80,
        description: '1NT opening: 15-17, no 5-card major',
        tags: ['natural'],
        enabled: true,
      },
      {
        id: 'open_1c',
        sequence: '^$',
        when: { hcp: '16+', shapeClass: 'BAL_ANY' },
        action: '1C',
        priority: 70,
        description: 'Strong 1C opening',
        tags: ['natural', 'forcing'],
        enabled: true,
      },
    ],
  };
}

const EXPECTED_ID = 'sha256:39e571721cec89a8d3c8c1e7d469953f369961d5aaf4ed6c557a0e76aa8b7cd7';

const EXPECTED_PROJECTION =
  '{"defaults":{"priority":50},"format":"bridge-rules-ir","formatVersion":"0.5","kind":"bidding","rules":[{"action":"1NT","enabled":true,"id":"open_1nt","priority":80,"sequence":"^$","tags":["natural"],"when":{"hcp":"${open1ntMin}-${open1ntMax}","shapeClass":"BAL_NO_5M"}},{"action":"1C","enabled":true,"id":"open_1c","priority":70,"sequence":"^$","tags":["natural","forcing"],"when":{"hcp":"16+","shapeClass":"BAL_ANY"}}],"styleParams":["open1ntMin","open1ntMax"],"system":"precision","systemVersion":"0.5.0"}';

describe('语义投影', () => {
  it('与 reproducibility.md 的 JCS 示例逐字节一致', () => {
    expect(jcs(semanticProjection(minimalIr()))).toBe(EXPECTED_PROJECTION);
  });

  it('生成冻结的 rulesetId', () => {
    expect(computeRulesetId(minimalIr())).toBe(EXPECTED_ID);
    expect(EXPECTED_ID).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('忽略 description、examples、source、author、locale 与非语义 ext', () => {
    const baseline = minimalIr();
    const changed = minimalIr();
    changed.author = 'someone';
    changed.locale = 'zh-CN';
    changed.source = 'somewhere';
    changed.ext = { 'ext.build': '2026-10-27' };
    changed.rules[0].description = 'changed';
    changed.rules[0].examples = [{ hand: 'AKQ2.JT9.543.876' }];
    changed.rules[0].source = { file: 'other.brules', line: 999 };
    expect(computeRulesetId(changed)).toBe(computeRulesetId(baseline));
  });

  it('缺少 enabled / tags 时按默认值参与投影', () => {
    const withDefaults: RulesIR = {
      ...minimalIr(),
      rules: [
        {
          id: 'r1',
          sequence: '^$',
          when: { hcp: '15-17' },
          action: '1NT',
          priority: 10,
        },
      ],
    };
    const explicit: RulesIR = {
      ...withDefaults,
      rules: [{ ...withDefaults.rules[0], enabled: true, tags: [] }],
    };
    expect(computeRulesetId(withDefaults)).toBe(computeRulesetId(explicit));
  });

  it('priority、action、when、tags、enabled 与顺序都会改变身份', () => {
    const baseline = computeRulesetId(minimalIr());
    const mutations: Array<(ir: RulesIR) => void> = [
      (ir) => {
        ir.rules[0].priority = 81;
      },
      (ir) => {
        ir.rules[0].action = '1S';
      },
      (ir) => {
        ir.rules[0].when.hcp = '15-18';
      },
      (ir) => {
        ir.rules[0].tags = ['natural', 'forcing'];
      },
      (ir) => {
        ir.rules[0].enabled = false;
      },
      (ir) => {
        ir.rules.reverse();
      },
    ];
    for (const mutate of mutations) {
      const changed = minimalIr();
      mutate(changed);
      expect(computeRulesetId(changed)).not.toBe(baseline);
    }
  });

  it('忽略 specificity 的显式值', () => {
    const baseline = minimalIr();
    const changed = minimalIr();
    (changed.rules[0] as RuleIR).specificity = 99;
    expect(computeRulesetId(changed)).toBe(computeRulesetId(baseline));
  });
});
