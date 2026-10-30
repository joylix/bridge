import { describe, expect, it } from 'vitest';
import {
  canonicalSuitSet,
  expandSuitSet,
  quantifierRange,
  parseConditionValue,
  type ConditionValueContext,
} from './conditions';
import { formatDiagnostic, sortDiagnostics, type Diagnostic } from './diagnostics';
import { jcs } from './jcs';
import { sha256Hex } from './sha256';

function makeValueContext() {
  const reports: Array<{ code: string; severity: string; message: string }> = [];
  const ctx: ConditionValueContext = {
    location: { file: 'test.brules', line: 7 },
    report: (code, severity, message) => {
      reports.push({ code, severity, message });
    },
  };
  return { ctx, reports };
}

describe('SHA-256', () => {
  it('匹配已知测试向量', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('The quick brown fox jumps over the lazy dog')).toBe(
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    );
    expect(sha256Hex('a'.repeat(1000))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });

  it('按 UTF-8 编码多字节字符', () => {
    expect(sha256Hex('桥')).toBe('a1e218ec8e11995a65f11a42558a9c7001f25e1a93d0cf9ba2f9ed58eaf272b2');
    expect(sha256Hex('桥牌')).toBe('aec473c6c7a2d7a4d62ebb47d081e5fd0133a84f239c4f9a0bc6ec839235074a');
    expect(sha256Hex('𝄞')).toBe('e419efd3d6046adf7662b0daadab65047e8014a523316d7ccc8710de694aa9b6');
  });
});

describe('JCS', () => {
  it('对象键按 UTF-16 code unit 排序', () => {
    expect(jcs({ b: 2, a: 1, A: 0 })).toBe('{"A":0,"a":1,"b":2}');
    expect(jcs({ 10: 'ten', 2: 'two' })).toBe('{"10":"ten","2":"two"}');
  });

  it('数字使用 ECMAScript Number::toString', () => {
    expect(jcs(1.0)).toBe('1');
    expect(jcs(-0)).toBe('0');
    expect(jcs(1e21)).toBe('1e+21');
    expect(jcs(1e-7)).toBe('1e-7');
    expect(jcs(1e-6)).toBe('0.000001');
    expect(jcs(333333333.33333329)).toBe('333333333.3333333');
  });

  it('字符串保留非 ASCII，转义引号与控制字符', () => {
    expect(jcs('桥牌')).toBe('"桥牌"');
    expect(jcs('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(jcs('\u0001')).toBe('"\\u0001"');
  });

  it('嵌套结构与空容器规范化', () => {
    expect(jcs({ z: [true, false, null], a: {} })).toBe('{"a":{},"z":[true,false,null]}');
    expect(jcs([])).toBe('[]');
  });

  it('拒绝 JSON 无法表达的输入', () => {
    expect(() => jcs(Number.NaN)).toThrow(/NaN/);
    expect(() => jcs({ a: undefined })).toThrow(/undefined/);
    expect(() => jcs(1n)).toThrow(/bigint/);
  });
});

describe('条件值规范化', () => {
  it('花色集合按 CDHS 排序并拒绝重复', () => {
    expect(canonicalSuitSet('sh')).toBe('HS');
    expect(canonicalSuitSet('dc')).toBe('CD');
    expect(canonicalSuitSet('H')).toBe('H');
    expect(canonicalSuitSet('HSH')).toBeNull();
    expect(canonicalSuitSet('HX')).toBeNull();
  });

  it('U/L 展开为高花/低花', () => {
    expect(expandSuitSet('U')).toEqual(['H', 'S']);
    expect(expandSuitSet('L')).toEqual(['C', 'D']);
    expect(expandSuitSet('s')).toEqual(['S']);
    expect(expandSuitSet('N')).toBeNull();
  });

  it('量词比较符降解为扁平区间', () => {
    const { ctx, reports } = makeValueContext();
    expect(quantifierRange('>=', 5, 'LEN', ctx)).toBe('5+');
    expect(quantifierRange('<=', 3, 'LEN', ctx)).toBe('0-3');
    expect(quantifierRange('=', 2, 'LEN', ctx)).toBe('2');
    expect(quantifierRange('>', 4, 'LEN', ctx)).toBe('5+');
    expect(quantifierRange('<', 3, 'LEN', ctx)).toBe('0-2');
    expect(quantifierRange('>=', 40, 'HCP', ctx)).toBe('40+');
    expect(quantifierRange('>', 40, 'HCP', ctx)).toBeNull();
    expect(quantifierRange('<', 0, 'CTL', ctx)).toBeNull();
    expect(reports.map((item) => item.code)).toEqual(['INVALID_QUANTIFIER', 'INVALID_QUANTIFIER']);
  });

  it('接受区间、风格变量、布尔、花色与形状类', () => {
    const { ctx, reports } = makeValueContext();
    expect(parseConditionValue('hcp', '15-17', ctx)).toBe('15-17');
    expect(parseConditionValue('hcp', '${open1ntMin}-15', ctx)).toBe('${open1ntMin}-15');
    expect(parseConditionValue('hcp', '16+', ctx)).toBe('16+');
    expect(parseConditionValue('balanced', 'true', ctx)).toBe(true);
    expect(parseConditionValue('stoppers', 'sh', ctx)).toBe('HS');
    expect(parseConditionValue('lastBidSuit', 'nt', ctx)).toBe('NT');
    expect(parseConditionValue('shapeClass', 'bal_any', ctx)).toBe('BAL_ANY');
    expect(reports).toEqual([]);
  });

  it('报告非法区间与取值', () => {
    const { ctx, reports } = makeValueContext();
    expect(parseConditionValue('hcp', '17-15', ctx)).toBeNull();
    expect(parseConditionValue('hcp', '5-6+', ctx)).toBeNull();
    expect(parseConditionValue('hcp', 'abc', ctx)).toBeNull();
    expect(parseConditionValue('balanced', 'yes', ctx)).toBeNull();
    expect(parseConditionValue('lastBidSuit', 'U', ctx)).toBeNull();
    expect(parseConditionValue('shapeClass', 'ROUND', ctx)).toBeNull();
    expect(parseConditionValue('unknown', '1', ctx)).toBeNull();
    expect(reports.map((item) => item.code)).toEqual([
      'INVALID_RANGE',
      'INVALID_RANGE',
      'INVALID_RANGE',
      'INVALID_BOOLEAN',
      'INVALID_CONDITION_VALUE',
      'INVALID_CONDITION_VALUE',
      'INVALID_CONDITION_KEY',
    ]);
  });
});

describe('诊断', () => {
  it('按严重度、位置、码稳定排序并可格式化', () => {
    const make = (code: string, severity: Diagnostic['severity'], line: number): Diagnostic => ({
      code: code as Diagnostic['code'],
      severity,
      message: code,
      location: { file: 'a.brules', line },
    });
    const sorted = sortDiagnostics([
      make('SYNTAX_ERROR', 'warning', 2),
      make('MISSING_END', 'error', 9),
      make('DUPLICATE_ID', 'error', 3),
      make('RULE_DISABLED', 'info', 1),
    ]);
    expect(sorted.map((item) => item.code)).toEqual([
      'DUPLICATE_ID',
      'MISSING_END',
      'SYNTAX_ERROR',
      'RULE_DISABLED',
    ]);
    expect(formatDiagnostic(sorted[0])).toBe('a.brules:3: error DUPLICATE_ID: DUPLICATE_ID');
  });
});
