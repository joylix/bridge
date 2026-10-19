import { describe, expect, it } from 'vitest';
import { computeScore } from './scoring';
import type { BidSuit, Contract, Position } from '../models/gameState';

function mk(
  level: number,
  suit: BidSuit,
  opts: { doubled?: boolean; redoubled?: boolean; declarer?: Position } = {},
): Contract {
  const declarer = opts.declarer ?? 'S';
  return {
    level,
    suit,
    doubled: opts.doubled ?? false,
    redoubled: opts.redoubled ?? false,
    declarer,
    dummy: declarer === 'S' ? 'N' : 'S',
  };
}

describe('标准桥牌计分', () => {
  it('部分定约：2C 做成 8 墩，无局 → 90', () => {
    expect(computeScore(mk(2, 'C'), 8, 'none').NS).toBe(90);
  });

  it('成局：4H 做成 10 墩，无局 → 420', () => {
    expect(computeScore(mk(4, 'H'), 10, 'none').NS).toBe(420);
  });

  it('成局加成：3NT 做成 9 墩，有局 → 600', () => {
    expect(computeScore(mk(3, 'NT'), 9, 'both').NS).toBe(600);
  });

  it('满贯：6H 做成 12 墩，有局 → 1430', () => {
    expect(computeScore(mk(6, 'H'), 12, 'NS').NS).toBe(1430);
  });

  it('大满贯：7NT 做成 13 墩，无局 → 1520', () => {
    expect(computeScore(mk(7, 'NT'), 13, 'none').NS).toBe(1520);
  });

  it('加倍做成：2H× 做成 8 墩，有局 → 670', () => {
    expect(computeScore(mk(2, 'H', { doubled: true }), 8, 'both').NS).toBe(670);
  });

  it('加倍带超墩：3NT× 做成 10 墩，无局 → 650', () => {
    expect(computeScore(mk(3, 'NT', { doubled: true }), 10, 'none').NS).toBe(650);
  });

  it('再加倍做成：2H×× 做成 8 墩，无局 → 760', () => {
    // 墩分 60×4=240，成局奖 300，再加倍礼貌奖 100 → 640？核对：60*4=240 +300 +100 = 640
    expect(computeScore(mk(2, 'H', { redoubled: true }), 8, 'none').NS).toBe(640);
  });

  it('宕墩：3NT 宕 1，无局 → 防守方 50', () => {
    const r = computeScore(mk(3, 'NT'), 8, 'none');
    expect(r.NS).toBe(0);
    expect(r.EW).toBe(50);
  });

  it('宕墩：3NT 宕 1，有局 → 100', () => {
    expect(computeScore(mk(3, 'NT'), 8, 'both').EW).toBe(100);
  });

  it('加倍宕墩：3NT× 宕 1，无局 → 100', () => {
    expect(computeScore(mk(3, 'NT', { doubled: true }), 8, 'none').EW).toBe(100);
  });

  it('加倍宕墩：3NT× 宕 2，无局 → 300', () => {
    expect(computeScore(mk(3, 'NT', { doubled: true }), 7, 'none').EW).toBe(300);
  });

  it('加倍宕墩：3NT× 宕 4，无局 → 800', () => {
    expect(computeScore(mk(3, 'NT', { doubled: true }), 5, 'none').EW).toBe(800);
  });

  it('加倍宕墩：3NT× 宕 1，有局 → 200', () => {
    expect(computeScore(mk(3, 'NT', { doubled: true }), 8, 'both').EW).toBe(200);
  });

  it('东西定约时得分归 EW', () => {
    const r = computeScore(mk(4, 'S', { declarer: 'W' }), 10, 'EW');
    expect(r.EW).toBe(620); // 4S 有局 = 120+500
    expect(r.NS).toBe(0);
  });
});
