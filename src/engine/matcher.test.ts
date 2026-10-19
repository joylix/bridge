import { describe, expect, it } from 'vitest';
import { findBidCandidates, matchSequence, relSeat } from './matcher';
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
});
