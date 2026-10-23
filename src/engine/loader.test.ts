import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRuleOverrides,
  getBiddingRuleText,
  getLeadRuleText,
  getSignalRuleText,
  isBiddingRuleOverridden,
  isSignalRuleOverridden,
  listBiddingRuleFiles,
  listLeadRuleFiles,
  listSignalRuleFiles,
  loadAllBiddingRuleSets,
  loadBiddingRules,
  loadLeadRules,
  loadSignalRules,
  parseBiddingRules,
  parseLeadRules,
  parseSignalRules,
  resetBiddingRuleText,
  resetLeadRuleText,
  resetSignalRuleText,
  saveBiddingRuleText,
  saveLeadRuleText,
  saveSignalRuleText,
  validateBiddingRuleText,
  validateLeadRuleText,
  validateSignalRuleText,
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

  it('precision 规则 id 唯一、sequence token 合法且关键规则存在', () => {
    const rules = loadBiddingRules('precision');
    expect(rules.length).toBeGreaterThan(850);

    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);

    const callToken = /^(?:\^\$|\^|\.\*|[MPLR]:(?:Pass|X|XX|[1-7](?:C|D|H|S|NT)))$/;
    const invalidTokens = rules.flatMap((rule) =>
      rule.sequence
        .split(/[\s-]+/)
        .filter(Boolean)
        .filter((token) => !callToken.test(token))
        .map((token) => `${rule.id}: ${token}`),
    );
    expect(invalidTokens).toEqual([]);

    const required = [
      'open_1c',
      'over_3c_3nt',
      'balance_over_3s_3nt',
      'resp_balance_4nt_6h',
      'resp_over_3d_4s_6s',
      'resp_over_2s_3h_4h',
      'opener_1c_1h_2c_2nt_6c',
      'resp_1c_2d_2nt_3d_6d',
      'comp_raise_2h_over_2s',
      'overcaller_2h_comp_4h',
      'opener_1s_3s_4s_short',
      'resp_1s_2d_3c_3s',
    ];
    expect(ids).toEqual(expect.arrayContaining(required));

    // 应叫人的规则必须以同伴开叫开头，不能误写成 M:（自己开叫）。
    expect(ids).not.toContain('opener_1s_2d_3c_3s');
    expect(rules.find((r) => r.id === 'resp_1s_2d_3c_3s')?.sequence).toBe(
      'P:1S R:Pass M:2D L:Pass P:3C R:Pass',
    );
    // 旧的兜底规则名不副实，已改成真实的应叫语义。
    expect(ids).not.toContain('opener_rebid_1nt');
    expect(ids).not.toContain('opener_rebid_raise_major');
    expect(ids).toContain('resp_1d_1nt_strong');
    expect(ids).toContain('resp_partner_1s_raise_constructive');
  });

  it('三阶阻击后的 3NT 规则把对手花色计入挡张', () => {
    const rules = loadBiddingRules('precision');
    const cases: Array<[string, string]> = [
      ['over_3c_3nt', 'C'],
      ['over_3d_3nt', 'D'],
      ['over_3h_3nt', 'H'],
      ['over_3s_3nt', 'S'],
      ['balance_over_3c_3nt', 'C'],
      ['balance_over_3d_3nt', 'D'],
      ['balance_over_3h_3nt', 'H'],
      ['balance_over_3s_3nt', 'S'],
    ];
    for (const [id, suit] of cases) {
      const rule = rules.find((r) => r.id === id);
      expect(rule?.when.stoppers, id).toContain(suit);
    }
  });

  it('解析首攻规则', () => {
    const rules = loadLeadRules('leads');
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((r) => r.context.contract_type === 'NT')).toBe(true);
  });

  it('解析跟牌/垫牌细则与可执行阈值', () => {
    const set = loadSignalRules('signals');
    expect(set.rules.length).toBeGreaterThan(5);
    expect(set.rules.some((r) => r.id === 'follow_count_signal')).toBe(true);
    expect(set.settings.signal_spot_max_rank).toBe(10);
    expect(set.settings.encourage_discard_min_rank).toBe(8);
    for (let i = 1; i < set.rules.length; i++) {
      expect(set.rules[i - 1].priority).toBeGreaterThanOrEqual(set.rules[i].priority);
    }
  });

  it('枚举可用规则文件（可替换）', () => {
    const bidding = listBiddingRuleFiles().map((f) => f.name);
    expect(bidding).toContain('precision');
    expect(bidding).toContain('natural');
    expect(listLeadRuleFiles().map((f) => f.name)).toContain('leads');
    expect(listSignalRuleFiles().map((f) => f.name)).toContain('signals');
  });

  it('批量加载所有叫牌规则集', () => {
    const sets = loadAllBiddingRuleSets();
    expect(Object.keys(sets)).toEqual(expect.arrayContaining(['precision', 'natural']));
  });

  it('缺少 rules 段时抛错', () => {
    expect(() => parseBiddingRules('foo: bar')).toThrow();
    expect(() => parseLeadRules('foo: bar')).toThrow();
    expect(() => parseSignalRules('foo: bar')).toThrow();
  });

  it('signals.yml 作为打牌细则加载，不会混入首攻规则', () => {
    // 首攻 glob 只匹配 leads*.yml，signals.yml 不在其中
    expect(listLeadRuleFiles().map((f) => f.name)).not.toContain('signals');
    expect(loadSignalRules('signals').rules.length).toBeGreaterThan(0);
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

  it('跟牌/垫牌细则：支持阈值覆盖与恢复', () => {
    const original = getSignalRuleText('signals');
    const modified = original.replace('signal_spot_max_rank: 10', 'signal_spot_max_rank: 9');

    saveSignalRuleText('signals', modified);
    expect(isSignalRuleOverridden('signals')).toBe(true);
    expect(loadSignalRules('signals').settings.signal_spot_max_rank).toBe(9);

    resetSignalRuleText('signals');
    expect(isSignalRuleOverridden('signals')).toBe(false);
    expect(loadSignalRules('signals').settings.signal_spot_max_rank).toBe(10);
  });

  it('校验跟牌/垫牌细则的必备字段', () => {
    expect(validateSignalRuleText('foo: bar').ok).toBe(false);
    const missingPhase =
      'settings: {}\nrules:\n  - id: x\n    description: "x"\n    action: "x"\n    priority: 1';
    expect(validateSignalRuleText(missingPhase).ok).toBe(false);
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
