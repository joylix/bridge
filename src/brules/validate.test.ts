import { describe, expect, it } from 'vitest';
import type { DiagnosticCode } from './diagnostics';
import type { RulesIR } from './types';
import { validateIr } from './validate';
import { parseIrJson, parseIrYaml } from './yaml';

function makeIr(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'bridge-rules-ir',
    formatVersion: '0.5',
    kind: 'bidding',
    system: 'test',
    rules: [
      {
        id: 'r1',
        sequence: '^$',
        when: { hcp: '15-17' },
        action: '1NT',
        priority: 10,
      },
    ],
    ...overrides,
  };
}

function irRules(overrides: Record<string, unknown>): Record<string, unknown> {
  return makeIr({ rules: [{ ...(makeIr().rules as Record<string, unknown>[])[0], ...overrides }] });
}

function codes(value: unknown): DiagnosticCode[] {
  return validateIr(value).diagnostics.map((item) => item.code);
}

describe('IR 结构校验', () => {
  it('接受最小合法 IR', () => {
    const result = validateIr(makeIr());
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.system).toBe('test');
    expect(result.ir?.rules[0].action).toBe('1NT');
  });

  it('拒绝非对象根节点、错误版本与空规则集', () => {
    expect(codes(null)).toEqual(['INVALID_RULESET']);
    expect(codes(makeIr({ formatVersion: '0.4' }))).toContain('UNSUPPORTED_VERSION');
    expect(codes(makeIr({ format: 'other' }))).toContain('INVALID_HEADER_VALUE');
    expect(codes(makeIr({ kind: 'play' }))).toContain('INVALID_HEADER_VALUE');
    expect(codes(makeIr({ rules: [] }))).toContain('INVALID_RULESET');
    expect(codes(makeIr({ rules: 'nope' }))).toContain('INVALID_RULESET');
  });

  it('拒绝根节点与规则中的未知字段', () => {
    expect(codes(makeIr({ extra: true }))).toContain('UNKNOWN_FIELD');
    expect(codes(irRules({ extra: true }))).toContain('UNKNOWN_FIELD');
  });

  it('校验 system、systemVersion、defaults 与 styleParams', () => {
    expect(codes(makeIr({ system: '1bad' }))).toContain('INVALID_HEADER_VALUE');
    expect(codes(makeIr({ systemVersion: '' }))).toContain('INVALID_SYSTEM_VERSION');
    expect(codes(makeIr({ defaults: { priority: 1.5 } }))).toContain('INVALID_DEFAULT_PRIORITY');
    expect(codes(makeIr({ defaults: { other: 1 } }))).toContain('UNKNOWN_FIELD');
    expect(codes(makeIr({ styleParams: ['madeUp'] }))).toContain('INVALID_STYLE_PARAM');
  });

  it('styleParams 重复只警告，仍产出 IR', () => {
    const result = validateIr(makeIr({ styleParams: ['open1ntMin', 'open1ntMin'] }));
    expect(result.ir).not.toBeNull();
    expect(result.diagnostics.map((item) => item.code)).toEqual(['DUPLICATE_STYLE_PARAM']);
    expect(result.diagnostics[0].severity).toBe('warning');
  });

  it('校验 ext 键命名空间', () => {
    expect(codes(makeIr({ ext: { foo: 1 } }))).toContain('UNKNOWN_FIELD');
    expect(codes(makeIr({ ext: { 'ext.source': 'unit' } }))).toEqual([]);
    expect(codes(irRules({ ext: { bad: 1 } }))).toContain('UNKNOWN_FIELD');
  });
});

describe('规则字段校验', () => {
  it('id、sequence、action、priority', () => {
    expect(codes(irRules({ id: '1bad' }))).toContain('INVALID_ID');
    expect(codes(irRules({ id: 'r#1' }))).toEqual([]);
    expect(codes(irRules({ sequence: 'M:Pass' }))).toContain('INVALID_SEQUENCE');
    expect(codes(irRules({ sequence: 'M:PASS P:PASS' }))).toEqual([]);
    expect(codes(irRules({ sequence: '.*' }))).toEqual([]);
    expect(codes(irRules({ sequence: '' }))).toContain('INVALID_SEQUENCE');
    expect(codes(irRules({ action: 'Pass' }))).toContain('INVALID_CALL');
    expect(codes(irRules({ action: 'P' }))).toContain('INVALID_CALL');
    expect(codes(irRules({ priority: 1.5 }))).toContain('INVALID_PRIORITY');
  });

  it('重复 id 按大小写不敏感处理', () => {
    const rule = (makeIr().rules as Record<string, unknown>[])[0];
    const result = validateIr(
      makeIr({
        rules: [rule, { ...rule, id: 'R1', action: '1S' }],
      }),
    );
    expect(result.diagnostics.map((item) => item.code)).toContain('DUPLICATE_ID');
    expect(result.ir).toBeNull();
  });

  it('when 的值必须是 IR 允许的字符串或布尔', () => {
    expect(codes(irRules({ when: { hcp: 15 } }))).toContain('INVALID_CONDITION_VALUE');
    expect(codes(irRules({ when: { hcp: '15-17', extra: '1' } }))).toContain('INVALID_CONDITION_KEY');
    expect(codes(irRules({ when: { balanced: 'true' } }))).toContain('INVALID_CONDITION_VALUE');
    expect(codes(irRules({ when: { balanced: true } }))).toEqual([]);
  });

  it('IR 条件值必须已经是规范形式', () => {
    expect(codes(irRules({ when: { stoppers: 'sh' } }))).toContain('INVALID_CONDITION_VALUE');
    expect(codes(irRules({ when: { stoppers: 'HS' } }))).toEqual([]);
    expect(codes(irRules({ when: { shapeClass: 'bal_any' } }))).toContain('INVALID_CONDITION_VALUE');
    expect(codes(irRules({ when: { shapeClass: 'BAL_ANY' } }))).toEqual([]);
    expect(codes(irRules({ when: { lastBidSuit: 'NT' } }))).toEqual([]);
  });

  it('tags、enabled、specificity 与 source', () => {
    expect(codes(irRules({ tags: ['Natural'] }))).toContain('INVALID_TAG');
    expect(codes(irRules({ tags: ['natural', 'natural'] }))).toContain('INVALID_TAG');
    expect(codes(irRules({ tags: ['natural'] }))).toEqual([]);
    expect(codes(irRules({ enabled: 'false' }))).toContain('INVALID_BOOLEAN');
    expect(codes(irRules({ enabled: false }))).toEqual([]);
    expect(codes(irRules({ specificity: 2 }))).toContain('INVALID_RULESET');
    expect(codes(irRules({ specificity: 1 }))).toEqual([]);
    expect(codes(irRules({ source: { line: 0 } }))).toContain('INVALID_SOURCE');
    expect(codes(irRules({ source: { file: 'a.brules', line: 3 } }))).toEqual([]);
  });

  it('examples 结构', () => {
    expect(codes(irRules({ examples: [{ hand: 'AKQ2.JT9.543.876' }] }))).toEqual([]);
    expect(codes(irRules({ examples: [{ hand: '' }] }))).toContain('INVALID_RULE_EXAMPLE');
    expect(codes(irRules({ examples: 'nope' }))).toContain('INVALID_RULE_EXAMPLE');
    expect(
      codes(
        irRules({
          examples: [{ hand: 'AKQ2.JT9.543.876', auction: ['1C'], expected: '1NT' }],
        }),
      ),
    ).toEqual([]);
  });
});

describe('JSON / YAML 载入', () => {
  it('从 JSON 载入并校验', () => {
    const result = parseIrJson(JSON.stringify(makeIr()), { file: 'rules.json' });
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.rules[0].id).toBe('r1');
  });

  it('JSON 语法错误', () => {
    const result = parseIrJson('{ nope');
    expect(result.ir).toBeNull();
    expect(result.diagnostics[0].code).toBe('JSON_PARSE_ERROR');
  });

  it('从 YAML 载入并校验', () => {
    const text = `format: bridge-rules-ir
formatVersion: "0.5"
kind: bidding
system: test
rules:
  - id: r1
    sequence: "^$"
    when:
      hcp: "15-17"
    action: 1NT
    priority: 10
`;
    const result = parseIrYaml(text, { file: 'rules.yaml' });
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.rules[0].action).toBe('1NT');
  });

  it('YAML 语法错误', () => {
    const result = parseIrYaml('a: [1, 2');
    expect(result.ir).toBeNull();
    expect(result.diagnostics[0].code).toBe('YAML_PARSE_ERROR');
  });
});

describe('校验结果类型', () => {
  it('合法输入返回同一 IR 对象', () => {
    const input = makeIr();
    const result = validateIr(input);
    expect(result.ir).toBe(input as unknown as RulesIR);
  });
});
