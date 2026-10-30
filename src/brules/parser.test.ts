import { describe, expect, it } from 'vitest';
import { parseDsl, parseQuoted, stripComment } from './parser';
import type { DiagnosticCode } from './diagnostics';

const HEADER = `VERSION: BRULES/0.5
FORMAT: bridge-rules
KIND: bidding
SYSTEM: test
`;

function dsl(body: string): string {
  return `${HEADER}${body}`;
}

function codes(text: string): DiagnosticCode[] {
  return parseDsl(text).diagnostics.map((item) => item.code);
}

describe('注释与引号', () => {
  it('只剥离字符串外的注释', () => {
    expect(stripComment('WHEN: hcp 15-17 # 注释')).toBe('WHEN: hcp 15-17 ');
    expect(stripComment('DESC: "1NT # 不是注释" # 是注释')).toBe('DESC: "1NT # 不是注释" ');
    expect(stripComment('DESC: "a\\"b # c"')).toBe('DESC: "a\\"b # c"');
  });

  it('解析双引号转义', () => {
    expect(parseQuoted('"a\\"b"')).toBe('a"b');
    expect(parseQuoted('"a\\\\b"')).toBe('a\\b');
    expect(parseQuoted('"桥牌"')).toBe('桥牌');
    expect(parseQuoted('no quotes')).toBeNull();
    expect(parseQuoted('"unterminated')).toBeNull();
  });
});

describe('基础解析', () => {
  it('解析文件头、规则与默认优先级', () => {
    const result = parseDsl(
      dsl(`DEFAULT_PRIORITY: 40
SYSTEM_VERSION: 1.2.3
LOCALE: "zh-CN"
AUTHOR: "tester"
SOURCE: "unit"

RULE: open_1nt
SEQ: ^$
WHEN: hcp 15-17
BID: 1NT
DESC: "1NT opening"
TAGS: natural, forcing
ENABLED: true
END
`),
      { file: 'test.brules' },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.ir).toMatchObject({
      format: 'bridge-rules-ir',
      formatVersion: '0.5',
      kind: 'bidding',
      system: 'test',
      systemVersion: '1.2.3',
      locale: 'zh-CN',
      author: 'tester',
      source: 'unit',
      defaults: { priority: 40 },
    });
    expect(result.ir?.rules).toEqual([
      {
        id: 'open_1nt',
        sequence: '^$',
        when: { hcp: '15-17' },
        action: '1NT',
        priority: 40,
        specificity: 1,
        source: { file: 'test.brules', line: 11 },
        description: '1NT opening',
        tags: ['natural', 'forcing'],
        enabled: true,
      },
    ]);
  });

  it('关键字、叫品、座位、花色与标签大小写不敏感', () => {
    const result = parseDsl(
      dsl(`style_params: open1ntMin, open1ntMax

rule: R1
seq: m:1s p:- 
when: hcp ${'${open1ntMin}'}-17
bid: 1nt
prio: 10
tags: Natural, FORCING
end
`),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.styleParams).toEqual(['open1ntMin', 'open1ntMax']);
    expect(result.ir?.rules[0]).toMatchObject({
      id: 'R1',
      sequence: 'M:1S P:PASS',
      when: { hcp: '${open1ntMin}-17' },
      action: '1NT',
      tags: ['natural', 'forcing'],
    });
  });

  it('保留 # 后缀 id 并保持声明顺序', () => {
    const result = parseDsl(
      dsl(`RULE: b
SEQ: ^$
WHEN: hcp 10+
BID: 1S
PRIO: 1
END

RULE: a
SEQ: ^$
WHEN: hcp 10+
BID: 1H
PRIO: 2
END
`),
    );
    expect(result.ir?.rules.map((rule) => rule.id)).toEqual(['b', 'a']);
  });

  it('BID: - 映射为 IR PASS，序列中的 - 也映射为 PASS', () => {
    const result = parseDsl(
      dsl(`RULE: pass_out
SEQ: M:- P:- R:- L:-
BID: -
PRIO: 0
END
`),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.rules[0]).toMatchObject({
      sequence: 'M:PASS P:PASS R:PASS L:PASS',
      action: 'PASS',
    });
  });

  it('解引用 COND，并允许 COND 之间嵌套', () => {
    const result = parseDsl(
      dsl(`COND: strong
WHEN: hcp 18+
END

COND: balanced_strong
USE: strong
WHEN: balanced true
END

RULE: r
SEQ: ^$
USE: balanced_strong
BID: 2NT
PRIO: 10
END
`),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.rules[0].when).toEqual({ balanced: true, hcp: '18+' });
    expect(result.ir?.rules[0].specificity).toBe(2);
  });
});

describe('ANY / ALL 展开', () => {
  it('ANY(U, LEN>=5) 展开为两条规则并共享 specificity', () => {
    const result = parseDsl(
      dsl(`RULE: r
SEQ: ^$
WHEN: hcp 12+
WHEN: ANY(U, LEN>=5)
BID: 1S
PRIO: 10
END
`),
    );
    expect(result.diagnostics.map((item) => item.code)).toEqual(['EXPANDED_DISJUNCTION']);
    expect(result.ir?.rules).toHaveLength(2);
    expect(result.ir?.rules.map((rule) => rule.id)).toEqual(['r#1', 'r#2']);
    expect(result.ir?.rules.map((rule) => rule.when)).toEqual([
      { hcp: '12+', hearts: '5+' },
      { hcp: '12+', spades: '5+' },
    ]);
    expect(result.ir?.rules.map((rule) => rule.specificity)).toEqual([2, 2]);
  });

  it('ALL(U, LEN>=5) 合并为一条规则', () => {
    const result = parseDsl(
      dsl(`RULE: r
SEQ: ^$
WHEN: ALL(U, LEN>=5)
BID: 1S
PRIO: 10
END
`),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.rules).toEqual([
      expect.objectContaining({
        id: 'r',
        when: { hearts: '5+', spades: '5+' },
        specificity: 1,
      }),
    ]);
  });

  it('单元素集合与 <= / = / > / < 量词', () => {
    const result = parseDsl(
      dsl(`RULE: r1
SEQ: ^$
WHEN: ALL(C, LEN<=3)
BID: 1C
PRIO: 1
END

RULE: r2
SEQ: ^$
WHEN: ANY(L, LEN>4)
BID: 1D
PRIO: 1
END

RULE: r3
SEQ: ^$
WHEN: ALL(S, LEN<3)
BID: 1S
PRIO: 1
END
`),
    );
    expect(result.diagnostics.map((item) => item.code)).toEqual(['EXPANDED_DISJUNCTION']);
    expect(result.ir?.rules.map((rule) => rule.when)).toEqual([
      { clubs: '0-3' },
      { clubs: '5+' },
      { diamonds: '5+' },
      { spades: '0-2' },
    ]);
  });

  it('ANY(HCP) / ALL(CTL) 无法降解为扁平条件', () => {
    expect(
      codes(
        dsl(`RULE: r
SEQ: ^$
WHEN: ANY(L, HCP>=5)
BID: 1C
PRIO: 1
END
`),
      ),
    ).toContain('UNSUPPORTED_FEATURE');

    expect(
      codes(
        dsl(`RULE: r
SEQ: ^$
WHEN: ALL(U, CTL>=3)
BID: 1S
PRIO: 1
END
`),
      ),
    ).toContain('UNSUPPORTED_FEATURE');
  });

  it('非法量词与花色集合', () => {
    expect(
      codes(
        dsl(`RULE: r
SEQ: ^$
WHEN: ANY(U, LEN=>5)
BID: 1S
PRIO: 1
END
`),
      ),
    ).toContain('INVALID_QUANTIFIER');
    expect(
      codes(
        dsl(`RULE: r
SEQ: ^$
WHEN: ANY(N, LEN>=5)
BID: 1S
PRIO: 1
END
`),
      ),
    ).toContain('INVALID_QUANTIFIER');
  });
});

describe('条件语义', () => {
  it('shapeClass 原样保留在 IR，由编译器降级', () => {
    const result = parseDsl(
      dsl(`RULE: r
SEQ: ^$
WHEN: shapeClass SEMIBAL
BID: 1NT
PRIO: 1
END
`),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.rules[0].when).toEqual({ shapeClass: 'SEMIBAL' });
  });

  it('when 键按字典序输出，重复同值条件只计一次', () => {
    const result = parseDsl(
      dsl(`RULE: r
SEQ: ^$
WHEN: spades 5+
WHEN: hcp 12+
WHEN: hcp 12+
BID: 1S
PRIO: 1
END
`),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.rules[0].when).toEqual({ hcp: '12+', spades: '5+' });
    expect(result.ir?.rules[0].specificity).toBe(2);
  });

  it('同一条件键不同值报 DUPLICATE_CONDITION', () => {
    const result = parseDsl(
      dsl(`RULE: r
SEQ: ^$
WHEN: hcp 12+
WHEN: hcp 15+
BID: 1S
PRIO: 1
END
`),
    );
    expect(result.diagnostics.map((item) => item.code)).toEqual(['DUPLICATE_CONDITION']);
    expect(result.ir).toBeNull();
  });

  it('未登记的条件键与非法取值', () => {
    expect(
      codes(
        dsl(`RULE: r
SEQ: ^$
WHEN: HCP 12+
BID: 1S
PRIO: 1
END
`),
      ),
    ).toContain('INVALID_CONDITION_KEY');
    expect(
      codes(
        dsl(`RULE: r
SEQ: ^$
WHEN: balanced yes
BID: 1S
PRIO: 1
END
`),
      ),
    ).toContain('INVALID_BOOLEAN');
  });

  it('风格变量必须先声明', () => {
    const result = parseDsl(
      dsl(`RULE: r
SEQ: ^$
WHEN: hcp \${open1ntMin}-17
BID: 1NT
PRIO: 1
END
`),
    );
    expect(result.diagnostics.map((item) => item.code)).toContain('UNRESOLVED_STYLE_VAR');
    expect(result.ir).toBeNull();
  });

  it('未登记的风格变量名', () => {
    expect(
      codes(
        dsl(`STYLE_PARAMS: madeUpName

RULE: r
SEQ: ^$
WHEN: hcp 1+
BID: 1S
PRIO: 1
END
`),
      ),
    ).toContain('INVALID_STYLE_PARAM');
  });
});

describe('USE / 结构错误', () => {
  it('未定义引用与循环引用', () => {
    expect(
      codes(
        dsl(`RULE: r
SEQ: ^$
USE: missing
BID: 1S
PRIO: 1
END
`),
      ),
    ).toContain('UNRESOLVED_REFERENCE');

    expect(
      codes(
        dsl(`COND: a
USE: b
END

COND: b
USE: a
END

RULE: r
SEQ: ^$
USE: a
BID: 1S
PRIO: 1
END
`),
      ),
    ).toContain('CYCLIC_CONDITION');
  });

  it('缺少 SEQ / BID / PRIO', () => {
    const result = parseDsl(
      dsl(`RULE: r
WHEN: hcp 12+
END
`),
    );
    const list = result.diagnostics.map((item) => item.code);
    expect(list).toContain('MISSING_RULE_FIELD');
    expect(list).toContain('MISSING_PRIORITY');
    expect(result.ir).toBeNull();
  });

  it('缺少 END', () => {
    const result = parseDsl(
      dsl(`RULE: r
SEQ: ^$
WHEN: hcp 12+
BID: 1S
PRIO: 1
`),
    );
    expect(result.diagnostics.map((item) => item.code)).toContain('MISSING_END');
    expect(result.ir).toBeNull();
  });

  it('重复 id 按大小写不敏感处理', () => {
    const result = parseDsl(
      dsl(`RULE: Open
SEQ: ^$
WHEN: hcp 12+
BID: 1S
PRIO: 1
END

RULE: open
SEQ: ^$
WHEN: hcp 12+
BID: 1H
PRIO: 1
END
`),
    );
    expect(result.diagnostics.map((item) => item.code)).toContain('DUPLICATE_ID');
    expect(result.ir).toBeNull();
  });

  it('重复文件头与缺少必需文件头', () => {
    expect(codes(dsl(`SYSTEM: again\n`))).toContain('DUPLICATE_HEADER');
    expect(codes('VERSION: BRULES/0.5\nFORMAT: bridge-rules\nKIND: bidding\n')).toContain('MISSING_HEADER');
  });

  it('缺少 VERSION 或版本不支持', () => {
    expect(codes('FORMAT: bridge-rules\nKIND: bidding\nSYSTEM: test\n')).toContain('MISSING_VERSION');
    expect(codes('VERSION: BRULES/0.6\nFORMAT: bridge-rules\nKIND: bidding\nSYSTEM: test\n')).toContain(
      'UNSUPPORTED_VERSION',
    );
  });
});

describe('叫品与序列边界', () => {
  it('拒绝单字母 P / PASS；Pass 只写 -', () => {
    expect(
      codes(
        dsl(`RULE: r
SEQ: ^$
WHEN: hcp 12+
BID: P
PRIO: 1
END
`),
      ),
    ).toContain('PASS_ALIAS_REJECTED');
    expect(
      codes(
        dsl(`RULE: r
SEQ: ^$
WHEN: hcp 12+
BID: PASS
PRIO: 1
END
`),
      ),
    ).toContain('PASS_ALIAS_REJECTED');
  });

  it('拒绝已退役的小写 x、序列 * 与 ^', () => {
    expect(
      codes(
        dsl(`RULE: r
SEQ: ^$
WHEN: hcp 12+
BID: x
PRIO: 1
END
`),
      ),
    ).toContain('LEGACY_WILDCARD_MIGRATED');
    expect(
      codes(
        dsl(`RULE: r
SEQ: *
WHEN: hcp 12+
BID: 1S
PRIO: 1
END
`),
      ),
    ).toContain('INVALID_SEQUENCE');
    expect(
      codes(
        dsl(`RULE: r
SEQ: ^
WHEN: hcp 12+
BID: 1S
PRIO: 1
END
`),
      ),
    ).toContain('INVALID_SEQUENCE');
  });

  it('接受 .*、大小写叫品与相对座位，拒绝 PAR / 非法阶数', () => {
    const ok = parseDsl(
      dsl(`RULE: r
SEQ: .*
WHEN: hcp 12+
BID: 7nt
PRIO: 1
END

RULE: r2
SEQ: L:1c R:1d M:1h P:1s
BID: 3NT
PRIO: 1
END
`),
    );
    expect(ok.diagnostics).toEqual([]);
    expect(ok.ir?.rules.map((rule) => rule.sequence)).toEqual(['.*', 'L:1C R:1D M:1H P:1S']);
    expect(ok.ir?.rules.map((rule) => rule.action)).toEqual(['7NT', '3NT']);

    expect(
      codes(
        dsl(`RULE: r
SEQ: PAR:1S
WHEN: hcp 12+
BID: 1S
PRIO: 1
END
`),
      ),
    ).toContain('INVALID_SEQUENCE');
    expect(
      codes(
        dsl(`RULE: r
SEQ: ^$
WHEN: hcp 12+
BID: 8NT
PRIO: 1
END
`),
      ),
    ).toContain('INVALID_CALL');
  });

  it('PRIO 与 DEFAULT_PRIORITY 只接受非负整数', () => {
    expect(
      codes(
        dsl(`RULE: r
SEQ: ^$
WHEN: hcp 12+
BID: 1S
PRIO: -1
END
`),
      ),
    ).toContain('INVALID_PRIORITY');
    expect(codes(dsl('DEFAULT_PRIORITY: -5\n'))).toContain('INVALID_DEFAULT_PRIORITY');
  });
});
