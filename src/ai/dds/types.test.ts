import { describe, expect, it } from 'vitest';
import {
  DD_SEATS,
  DD_STRAINS,
  bidSuitToDds,
  ddsToRank,
  ddsToSuit,
  dealerToDds,
  formatParScore,
  makeableContracts,
  rankToDds,
  suitToDds,
  vulnerabilityToDds,
} from './types';

describe('DDS 结果映射', () => {
  it('庄家与局况映射到 DDS 枚举', () => {
    expect(DD_SEATS).toEqual(['N', 'E', 'S', 'W']);
    expect(dealerToDds('N')).toBe(0);
    expect(dealerToDds('E')).toBe(1);
    expect(dealerToDds('S')).toBe(2);
    expect(dealerToDds('W')).toBe(3);

    expect(vulnerabilityToDds('none')).toBe(0);
    expect(vulnerabilityToDds('both')).toBe(1);
    expect(vulnerabilityToDds('NS')).toBe(2);
    expect(vulnerabilityToDds('EW')).toBe(3);
  });

  it('花色/点数与 DDS 编码互转', () => {
    // 内部 C=0,D=1,H=2,S=3；DDS S=0,H=1,D=2,C=3
    expect(suitToDds(0)).toBe(3);
    expect(suitToDds(1)).toBe(2);
    expect(suitToDds(2)).toBe(1);
    expect(suitToDds(3)).toBe(0);
    expect([0, 1, 2, 3].map((s) => ddsToSuit(s))).toEqual([3, 2, 1, 0]);

    expect(bidSuitToDds('S')).toBe(0);
    expect(bidSuitToDds('H')).toBe(1);
    expect(bidSuitToDds('D')).toBe(2);
    expect(bidSuitToDds('C')).toBe(3);
    expect(bidSuitToDds('NT')).toBe(4);

    expect(rankToDds(0)).toBe(2);
    expect(rankToDds(12)).toBe(14);
    expect(ddsToRank(14)).toBe(12);
  });

  it('Par 分数按 NS 视角显示', () => {
    expect(formatParScore(0)).toBe('平');
    expect(formatParScore(420)).toBe('NS +420');
    expect(formatParScore(-100)).toBe('EW +100');
  });

  it('从 DD 表提取可成约摘要', () => {
    const table = [
      [4, 9, 4, 9],
      [9, 3, 9, 3],
      [8, 5, 8, 5],
      [8, 4, 8, 4],
      [4, 8, 4, 8],
    ];
    expect(makeableContracts(table)).toEqual([
      { strain: 'S', tricks: 9, seats: ['E', 'W'] },
      { strain: 'H', tricks: 9, seats: ['N', 'S'] },
      { strain: 'D', tricks: 8, seats: ['N', 'S'] },
      { strain: 'C', tricks: 8, seats: ['N', 'S'] },
      { strain: 'NT', tricks: 8, seats: ['E', 'W'] },
    ]);
    expect(DD_STRAINS).toEqual(['S', 'H', 'D', 'C', 'NT']);
  });

  it('没有 7 墩以上定约时返回空数组', () => {
    const table = [
      [6, 6, 6, 6],
      [6, 6, 6, 6],
      [6, 6, 6, 6],
      [6, 6, 6, 6],
      [6, 6, 6, 6],
    ];
    expect(makeableContracts(table)).toEqual([]);
  });
});
