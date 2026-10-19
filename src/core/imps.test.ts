import { describe, expect, it } from 'vitest';
import { impsFromScoreDiff, impAbsFromDiff, hcpAdjustedPoints } from './imps';

describe('IMP（点数）换算表', () => {
  it('按标准表换算分差', () => {
    expect(impAbsFromDiff(0)).toBe(0);
    expect(impAbsFromDiff(10)).toBe(0);
    expect(impAbsFromDiff(20)).toBe(1);
    expect(impAbsFromDiff(40)).toBe(1);
    expect(impAbsFromDiff(50)).toBe(2);
    expect(impAbsFromDiff(90)).toBe(3);
    expect(impAbsFromDiff(420)).toBe(9);
    expect(impAbsFromDiff(430)).toBe(10);
    expect(impAbsFromDiff(600)).toBe(12);
    expect(impAbsFromDiff(1000)).toBe(14);
    expect(impAbsFromDiff(3990)).toBe(23);
    expect(impAbsFromDiff(4000)).toBe(24);
    expect(impAbsFromDiff(99999)).toBe(24);
  });

  it('带符号点数：NS 为正、EW 为负、平为 0', () => {
    expect(impsFromScoreDiff(420)).toBe(9);
    expect(impsFromScoreDiff(-420)).toBe(-9);
    expect(impsFromScoreDiff(0)).toBe(0);
    expect(impsFromScoreDiff(-50)).toBe(-2);
  });
});

describe('经典“贴点制”折算', () => {
  it('胜方点 − 20 直接扣减；26 点得 9 IMP → 3', () => {
    expect(hcpAdjustedPoints(420, 26, 14)).toBe(3);
  });

  it('高牌胜方可能被倒扣为负', () => {
    expect(hcpAdjustedPoints(420, 34, 6)).toBe(-5);
  });

  it('低点胜方按贴点获得奖励（EW 胜时取负）', () => {
    // EW 12 点赢 3 IMP → |3| − (12 − 20) = 11，NS 视角 −11
    expect(hcpAdjustedPoints(-100, 28, 12)).toBe(-11);
  });

  it('流局（IMP 为 0）：大牌点多的一方贴点计负', () => {
    // 南北 26 : 东西 14 → 南北 −6、东西 +6
    expect(hcpAdjustedPoints(0, 26, 14)).toBe(-6);
    // 南北 12 : 东西 28 → 南北 +8、东西 −8
    expect(hcpAdjustedPoints(0, 12, 28)).toBe(8);
    // 双方各 20 点 → 0
    expect(hcpAdjustedPoints(0, 20, 20)).toBe(0);
  });
});
