import { describe, expect, it } from 'vitest';
import { findBidCandidates, matchSequence, relSeat } from './matcher';
import { loadBiddingRules } from './loader';
import type { BiddingRule } from './types';
import type { BidSuit } from '../models/gameState';
import { history, parseHand } from '../testing/testUtils';

describe('相对座位 relSeat', () => {
  it('正确区分自己/同伴/上下家', () => {
    expect(relSeat('S', 'S')).toBe('M');
    expect(relSeat('N', 'S')).toBe('P');
    expect(relSeat('E', 'S')).toBe('R'); // 上家
    expect(relSeat('W', 'S')).toBe('L'); // 下家
  });
});

describe('序列匹配 matchSequence', () => {
  it('".*" 匹配任意历史（兜底）', () => {
    expect(matchSequence([], '.*', 'S')).toBe(true);
    expect(matchSequence(history(['N', '1C'], ['E', 'Pass']), '.*', 'S')).toBe(true);
  });

  it('"^$" 仅匹配“尚无实质叫品”', () => {
    expect(matchSequence([], '^$', 'S')).toBe(true);
    expect(matchSequence(history(['N', 'Pass']), '^$', 'S')).toBe(true);
    expect(matchSequence(history(['N', 'Pass'], ['E', 'Pass']), '^', 'S')).toBe(true);
    expect(matchSequence(history(['N', '1C']), '^$', 'S')).toBe(false);
  });

  it('"P:1C R:Pass" 匹配同伴 1C、RHO Pass', () => {
    const h = history(['N', '1C'], ['E', 'Pass']);
    expect(matchSequence(h, 'P:1C R:Pass', 'S')).toBe(true);
  });

  it('可从末尾对齐（忽略更早历史）', () => {
    const h = history(['W', 'Pass'], ['N', '1C'], ['E', 'Pass']);
    expect(matchSequence(h, 'P:1C R:Pass', 'S')).toBe(true);
  });

  it('"R:1D" 匹配 RHO 刚开叫 1D', () => {
    expect(matchSequence(history(['E', '1D']), 'R:1D', 'S')).toBe(true);
    expect(matchSequence(history(['E', '1H']), 'R:1D', 'S')).toBe(false);
  });

  it('座位归属：区分同伴与对手的相同叫品（干扰识别）', () => {
    // 同伴叫 1H 后 RHO Pass：应匹配 P:1H，而非 R:1H
    const h = history(['N', '1H'], ['E', 'Pass']);
    expect(matchSequence(h, 'P:1H R:Pass', 'S')).toBe(true);
    expect(matchSequence(h, 'R:1H R:Pass', 'S')).toBe(false);
  });

  it('支持 "-" 分隔符', () => {
    const h = history(['N', '1C'], ['E', 'Pass']);
    expect(matchSequence(h, 'P:1C - R:Pass', 'S')).toBe(true);
  });
});

describe('叫牌候选匹配（含动作合法性过滤）', () => {
  const rules: BiddingRule[] = [
    {
      id: 'illegal_low',
      description: '非法：低于当前叫品的叫品',
      sequence: 'R:1H',
      when: { hearts: '5+' },
      action: '1D',
      priority: 90,
    },
    {
      id: 'legal_overcall',
      description: '合法争叫 1S',
      sequence: 'R:1H',
      when: { spades: '5+' },
      action: '1S',
      priority: 80,
    },
  ];

  it('过滤掉低于当前叫品的非法动作', () => {
    const hand = parseHand('SAKQJ2 HKQJT9 D5 C8'); // 6 黑桃 + 5 红桃，两条件均满足
    const h = history(['E', '1H']);
    const currentBid = { level: 1, suit: 'H' as BidSuit };
    const cands = findBidCandidates(hand, h, 'S', currentBid, 1, rules);
    expect(cands.map((c) => c.rule.id)).toEqual(['legal_overcall']);
  });

  it('以 M 开头的规则要求自己完成本副第一次实质叫牌，避免把再叫误当开叫', () => {
    const rule: BiddingRule = {
      id: 'opener_2c_2d_2h',
      description: '2C-2D-2H',
      sequence: 'M:2C L:Pass P:2D R:Pass',
      when: {},
      action: '2H',
      priority: 80,
    };
    const hand = parseHand('SAKQJ HJT9 D543 C87');

    // 同伴 1S，自己应叫 2C，同伴再叫 2D：2C 不是开叫，规则不应命中。
    const ambiguous = history(
      ['N', '1S'], ['E', 'Pass'], ['S', '2C'], ['W', 'Pass'], ['N', '2D'], ['E', 'Pass'],
    );
    expect(findBidCandidates(hand, ambiguous, 'S', { level: 2, suit: 'D' as BidSuit }, 1, [rule])).toEqual([]);

    // 自己开叫 2C，同伴应叫 2D：规则正常命中。
    const opening = history(['S', '2C'], ['W', 'Pass'], ['N', '2D'], ['E', 'Pass']);
    expect(findBidCandidates(hand, opening, 'S', { level: 2, suit: 'D' as BidSuit }, 1, [rule]).map((c) => c.rule.id)).toEqual([
      'opener_2c_2d_2h',
    ]);
  });

  it('以 M:2NT 开头的转移应答不会误匹配 2NT 再叫后的自然叫品', () => {
    const rule: BiddingRule = {
      id: 'opener_2nt_accept_transfer_h',
      description: '2NT-3D 转移红桃',
      sequence: 'M:2NT L:Pass P:3D R:Pass',
      when: {},
      action: '3H',
      priority: 96,
    };
    const hand = parseHand('SAKQJ HJT9 D543 C87');

    // 1C-2D-2NT-3D：2NT 是开叫人再叫，3D 是自然叫，不应按转移接受。
    const natural = history(
      ['S', '1C'], ['W', 'Pass'], ['N', '2D'], ['E', 'Pass'],
      ['S', '2NT'], ['W', 'Pass'], ['N', '3D'], ['E', 'Pass'],
    );
    expect(findBidCandidates(hand, natural, 'S', { level: 3, suit: 'D' as BidSuit }, 1, [rule])).toEqual([]);

    // 真正的 2NT 开叫后转移，规则正常命中。
    const transfer = history(['S', '2NT'], ['W', 'Pass'], ['N', '3D'], ['E', 'Pass']);
    expect(findBidCandidates(hand, transfer, 'S', { level: 3, suit: 'D' as BidSuit }, 1, [rule]).map((c) => c.rule.id)).toEqual([
      'opener_2nt_accept_transfer_h',
    ]);
  });

  it('按 优先级↓ → 具体度↓ 排序', () => {
    const rules2: BiddingRule[] = [
      { id: 'a', description: '', sequence: '.*', when: {}, action: 'Pass', priority: 10 },
      { id: 'b', description: '', sequence: '.*', when: { hcp: '0-40' }, action: 'Pass', priority: 10 },
      { id: 'c', description: '', sequence: '.*', when: {}, action: 'Pass', priority: 20 },
    ];
    const cands = findBidCandidates(parseHand('SAKQ HJT9 D543 C87'), [], 'S', null, 1, rules2);
    expect(cands[0].rule.id).toBe('c'); // 优先级最高
    expect(cands[1].rule.id).toBe('b'); // 次高优先级中具体度更高
  });

  it('1C-1NT-2S 后，10 点 4 张黑桃但无控制时进局 4S', () => {
    const rules = loadBiddingRules('precision');
    // 北家：10 HCP，4 张黑桃，4-3-3-3 均型，0 控制。
    const north = parseHand('SQJ32 HQJ3 DQJ5 CJ62');
    const h = history(
      ['S', '1C'],
      ['W', 'Pass'],
      ['N', '1NT'],
      ['E', 'Pass'],
      ['S', '2S'],
      ['W', 'Pass'],
    );
    const cands = findBidCandidates(north, h, 'N', { level: 2, suit: 'S' as BidSuit }, 1, rules);
    expect(cands[0]?.rule.id).toBe('resp_1c_1nt_2s_4s');
    expect(cands[0]?.call).toMatchObject({ type: 'bid', level: 4, suit: 'S' });
  });

  it('1C-1NT-2S 后，10 点 4 张黑桃且有 2+ 控制时 4NT 问 A', () => {
    const rules = loadBiddingRules('precision');
    // 北家：10 HCP，4 张黑桃，SA + HK = 3 控制。
    const north = parseHand('SA432 HK73 DQ85 CJ62');
    const h = history(
      ['S', '1C'],
      ['W', 'Pass'],
      ['N', '1NT'],
      ['E', 'Pass'],
      ['S', '2S'],
      ['W', 'Pass'],
    );
    const cands = findBidCandidates(north, h, 'N', { level: 2, suit: 'S' as BidSuit }, 1, rules);
    expect(cands[0]?.rule.id).toBe('resp_1c_1nt_2s_4nt');
    expect(cands[0]?.call).toMatchObject({ type: 'bid', level: 4, suit: 'NT' });
  });

  it('1C-1NT-2S-4NT 后，开叫人按 A 数答叫', () => {
    const rules = loadBiddingRules('precision');
    // 南家：20 HCP，5 张黑桃，SA + HA = 2 A。
    const south = parseHand('SAKQJ2 HAQ DKJ5 C32');
    const h = history(
      ['S', '1C'],
      ['W', 'Pass'],
      ['N', '1NT'],
      ['E', 'Pass'],
      ['S', '2S'],
      ['W', 'Pass'],
      ['N', '4NT'],
      ['E', 'Pass'],
    );
    const cands = findBidCandidates(south, h, 'S', { level: 4, suit: 'NT' }, 1, rules);
    expect(cands[0]?.rule.id).toBe('blackwood_1c_1nt_2s_4nt_2');
    expect(cands[0]?.call).toMatchObject({ type: 'bid', level: 5, suit: 'H' });
  });

  it('1C-1NT-2S-4NT-5H 后，应叫人 6S', () => {
    const rules = loadBiddingRules('precision');
    const north = parseHand('SA432 HK73 DQ85 CJ62');
    const h = history(
      ['S', '1C'],
      ['W', 'Pass'],
      ['N', '1NT'],
      ['E', 'Pass'],
      ['S', '2S'],
      ['W', 'Pass'],
      ['N', '4NT'],
      ['E', 'Pass'],
      ['S', '5H'],
      ['W', 'Pass'],
    );
    const cands = findBidCandidates(north, h, 'N', { level: 5, suit: 'H' }, 1, rules);
    expect(cands[0]?.rule.id).toBe('resp_1c_1nt_2s_4nt_5h_6s');
    expect(cands[0]?.call).toMatchObject({ type: 'bid', level: 6, suit: 'S' });
  });

  it('1C-1NT-2S-4NT-5C-5S 后，开叫人持 4 A 改叫 6S', () => {
    const rules = loadBiddingRules('precision');
    // 南家：25 HCP，5 张黑桃，4 A。
    const south = parseHand('SAKQJ2 HA DAKJ CA32');
    const h = history(
      ['S', '1C'],
      ['W', 'Pass'],
      ['N', '1NT'],
      ['E', 'Pass'],
      ['S', '2S'],
      ['W', 'Pass'],
      ['N', '4NT'],
      ['E', 'Pass'],
      ['S', '5C'],
      ['W', 'Pass'],
      ['N', '5S'],
      ['E', 'Pass'],
    );
    const cands = findBidCandidates(south, h, 'S', { level: 5, suit: 'S' }, 1, rules);
    expect(cands[0]?.rule.id).toBe('opener_1c_1nt_2s_4nt_5c_5s_4a_6s');
    expect(cands[0]?.call).toMatchObject({ type: 'bid', level: 6, suit: 'S' });
  });

  it('1C-1NT 后，16-18 均型且无四张高花叫 3NT 封局', () => {
    const rules = loadBiddingRules('precision');
    // 南家：17 HCP，3-3-3-4 均型，四张在梅花，无四张高花。
    const south = parseHand('SAKQ HKJ2 DQJ3 CJ432');
    const h = history(['S', '1C'], ['W', 'Pass'], ['N', '1NT'], ['E', 'Pass']);
    const cands = findBidCandidates(south, h, 'S', { level: 1, suit: 'NT' }, 1, rules);
    expect(cands[0]?.rule.id).toBe('opener_1c_1nt_3nt');
    expect(cands[0]?.call).toMatchObject({ type: 'bid', level: 3, suit: 'NT' });
  });

  it('1C-1NT 后，16-18 均型但有四张高花不封 3NT', () => {
    const rules = loadBiddingRules('precision');
    // 南家：17 HCP，3-4-3-3 均型，四张红桃。
    const south = parseHand('SAKQ HKJ32 DQJ3 CJ43');
    const h = history(['S', '1C'], ['W', 'Pass'], ['N', '1NT'], ['E', 'Pass']);
    const cands = findBidCandidates(south, h, 'S', { level: 1, suit: 'NT' }, 1, rules);
    expect(cands[0]?.rule.id).not.toBe('opener_1c_1nt_3nt');
    expect(cands[0]?.call).toMatchObject({ type: 'bid', level: 2, suit: 'NT' });
  });

  it('1C-1NT 后，19 点均型无四张高花不再封 3NT', () => {
    const rules = loadBiddingRules('precision');
    // 南家：19 HCP，4-3-3-3 均型，无四张高花。
    const south = parseHand('SAKQ HAKJ DQ32 C5432');
    const h = history(['S', '1C'], ['W', 'Pass'], ['N', '1NT'], ['E', 'Pass']);
    const cands = findBidCandidates(south, h, 'S', { level: 1, suit: 'NT' }, 1, rules);
    expect(cands[0]?.rule.id).toBe('opener_1c_1nt_2nt');
    expect(cands[0]?.call).toMatchObject({ type: 'bid', level: 2, suit: 'NT' });
  });
});
