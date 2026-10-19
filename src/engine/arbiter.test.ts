import { describe, expect, it } from 'vitest';
import { makeRng, selectBidCandidate, selectWithExploration } from './arbiter';
import type { BidCandidate } from './types';
import type { BiddingRule } from './types';

function cand(id: string): BidCandidate {
  const rule: BiddingRule = { id, description: '', sequence: '.*', when: {}, action: 'Pass', priority: 0 };
  return { rule, call: { type: 'pass' }, specificity: 0 };
}

const candidates = [cand('best'), cand('alt1'), cand('alt2'), cand('alt3')];

describe('mulberry32 随机源', () => {
  it('相同种子产生相同序列', () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('不同种子产生不同序列', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a()).not.toBe(b());
  });

  it('输出落在 [0,1)', () => {
    const r = makeRng(999);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('叫牌裁决与 ε 探索', () => {
  it('空候选返回 null', () => {
    expect(selectBidCandidate([], { randomness: 0, rng: makeRng(1) })).toBeNull();
  });

  it('randomness=0 恒取最优', () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(selectBidCandidate(candidates, { randomness: 0, rng: makeRng(seed) })?.rule.id).toBe('best');
    }
  });

  it('只有一个候选时恒选它', () => {
    const only = [cand('solo')];
    expect(selectBidCandidate(only, { randomness: 1, rng: makeRng(7) })?.rule.id).toBe('solo');
  });

  it('randomness>0 时可能偏离，但只落在合法候选内', () => {
    const ids = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const picked = selectBidCandidate(candidates, { randomness: 0.5, rng: makeRng(seed) });
      expect(picked).not.toBeNull();
      ids.add(picked!.rule.id);
    }
    // 应至少出现一次非最优（探索生效），且全部来自候选集合
    expect(ids.size).toBeGreaterThan(1);
    for (const id of ids) expect(['best', 'alt1', 'alt2', 'alt3']).toContain(id);
  });

  it('同一 seed 结果可复现', () => {
    const pick = (s: number) => selectBidCandidate(candidates, { randomness: 0.7, rng: makeRng(s) })?.rule.id;
    expect(pick(42)).toBe(pick(42));
  });

  it('探索只从 altPool 指定的次优候选中选取', () => {
    // randomness=1 必然触发探索；altPool=1 时仅在 best 与 alt1 之间
    for (let seed = 0; seed < 30; seed++) {
      const picked = selectBidCandidate(candidates, { randomness: 1, rng: makeRng(seed), altPool: 1 });
      expect(['best', 'alt1']).toContain(picked!.rule.id);
    }
  });
});

describe('通用 ε-greedy', () => {
  it('randomness=0 取首项', () => {
    expect(selectWithExploration([1, 2, 3], 0, makeRng(1))).toBe(1);
  });
  it('空数组返回 null', () => {
    expect(selectWithExploration<number>([], 1, makeRng(1))).toBeNull();
  });
});
