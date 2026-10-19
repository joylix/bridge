import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRuleOverrides,
  getBiddingRuleText,
  getLeadRuleText,
  isBiddingRuleOverridden,
  listBiddingRuleFiles,
  listLeadRuleFiles,
  loadAllBiddingRuleSets,
  loadBiddingRules,
  loadLeadRules,
  parseBiddingRules,
  parseLeadRules,
  resetBiddingRuleText,
  resetLeadRuleText,
  saveBiddingRuleText,
  saveLeadRuleText,
  validateBiddingRuleText,
  validateLeadRuleText,
} from './loader';

describe('规则加载器', () => {
  it('解析叫牌规则并按优先级降序排列', () => {
    const rules = loadBiddingRules('precision');
    expect(rules.length).toBeGreaterThan(10);
    for (let i = 1; i < rules.length; i++) {
      expect(rules[i - 1].priority).toBeGreaterThanOrEqual(rules[i].priority);
    }
    expect(rules.some((r) => r.id === 'open_1c')).toBe(true);
  });

  it('解析首攻规则', () => {
    const rules = loadLeadRules('leads');
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((r) => r.context.contract_type === 'NT')).toBe(true);
  });

  it('枚举可用规则文件（可替换）', () => {
    const bidding = listBiddingRuleFiles().map((f) => f.name);
    expect(bidding).toContain('precision');
    expect(bidding).toContain('natural');
    expect(listLeadRuleFiles().map((f) => f.name)).toContain('leads');
  });

  it('批量加载所有叫牌规则集', () => {
    const sets = loadAllBiddingRuleSets();
    expect(Object.keys(sets)).toEqual(expect.arrayContaining(['precision', 'natural']));
  });

  it('缺少 rules 段时抛错', () => {
    expect(() => parseBiddingRules('foo: bar')).toThrow();
    expect(() => parseLeadRules('foo: bar')).toThrow();
  });

  it('signals.yml 不含 rules 段，不被作为首攻规则加载', () => {
    // 首攻 glob 只匹配 leads*.yml，signals.yml 不在其中
    expect(listLeadRuleFiles().map((f) => f.name)).not.toContain('signals');
  });
});

describe('规则浏览与本地修改', () => {
  beforeEach(() => clearRuleOverrides());

  it('叫牌规则：保存覆盖后可加载修改结果，重置后恢复默认', () => {
    const original = getBiddingRuleText('precision');
    const modified = original.replace('action: "1C"', 'action: "2C"');
    expect(modified).not.toBe(original);

    saveBiddingRuleText('precision', modified);
    expect(isBiddingRuleOverridden('precision')).toBe(true);
    expect(loadBiddingRules('precision').find((r) => r.id === 'open_1c')?.action).toBe('2C');

    resetBiddingRuleText('precision');
    expect(isBiddingRuleOverridden('precision')).toBe(false);
    expect(loadBiddingRules('precision').find((r) => r.id === 'open_1c')?.action).toBe('1C');
  });

  it('首攻规则：同样支持覆盖与恢复', () => {
    const original = getLeadRuleText('leads');
    const modified = original.replace('lead: "top_of_sequence"', 'lead: "4th_best_of_longest"');

    saveLeadRuleText('leads', modified);
    expect(loadLeadRules('leads').find((r) => r.id === 'suit_honor_sequence')?.lead).toBe(
      '4th_best_of_longest',
    );

    resetLeadRuleText('leads');
    expect(loadLeadRules('leads').find((r) => r.id === 'suit_honor_sequence')?.lead).toBe('top_of_sequence');
  });

  it('校验非法 YAML 与缺失字段', () => {
    expect(validateBiddingRuleText('foo: bar').ok).toBe(false);
    expect(
      validateBiddingRuleText('rules:\n  - id: x\n    sequence: "^$"\n    when: {}\n    priority: 1').ok,
    ).toBe(false);
    expect(validateLeadRuleText('foo: bar').ok).toBe(false);
  });

  it('校验首攻规则 role 取值', () => {
    const text = 'rules:\n  - id: x\n    context: { contract_type: "NT" }\n    role: bogus\n    when: {}\n    lead: "4th_best_of_longest"\n    priority: 1';
    const result = validateLeadRuleText(text);
    expect(result.ok).toBe(false);
    expect(result.errors.join('')).toContain('role');
  });

  it('保存非法规则会抛错且不写入', () => {
    expect(() => saveBiddingRuleText('precision', 'foo: bar')).toThrow();
    expect(isBiddingRuleOverridden('precision')).toBe(false);
  });
});
