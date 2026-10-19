import { describe, expect, it } from 'vitest';
import { controls, distribution, hcp, isBalanced, suitLength } from './evaluate';
import { parseHand } from '../testing/testUtils';

describe('手牌评估', () => {
  it('大牌点 hcp', () => {
    expect(hcp(parseHand('SAKQ HJT9 D5 C2'))).toBe(4 + 3 + 2 + 1); // SAKQ=9, HJ=1 → 10
    expect(hcp(parseHand('S2 H3 D4 C5'))).toBe(0);
    expect(hcp(parseHand('S2 H3 D4 CA'))).toBe(4);
  });

  it('控制点 controls（A=2 K=1）', () => {
    expect(controls(parseHand('SAKQ HJT9 D5 C2'))).toBe(2 + 1); // SA=2, SK=1
    expect(controls(parseHand('SA H3 D4 CK'))).toBe(3);
  });

  it('花色长度与分布', () => {
    const hand = parseHand('SAKQ HJT9 D5 C2');
    expect(suitLength(hand, 3)).toBe(3); // 黑桃
    expect(suitLength(hand, 2)).toBe(3); // 红桃
    expect(suitLength(hand, 1)).toBe(1); // 方块
    expect(distribution(hand)).toEqual({ 0: 1, 1: 1, 2: 3, 3: 3 });
  });

  describe('均型判定（修正 5-4-2-2 / 5-4-3-1 误判）', () => {
    const balancedCases: [string, string][] = [
      ['4-3-3-3', 'SAKQ2 HJT9 D543 C876'],
      ['4-4-3-2', 'SAKQ2 HJT98 D543 C87'],
      ['5-3-3-2', 'SAKQJ2 HT98 D543 C87'],
    ];
    for (const [name, spec] of balancedCases) {
      it(`${name} 为均型`, () => {
        expect(isBalanced(distribution(parseHand(spec)))).toBe(true);
      });
    }

    const unbalancedCases: [string, string][] = [
      ['5-4-2-2', 'SAKQJ HT987 D54 C87'],
      ['5-4-3-1', 'SAKQJ HT987 D543 C8'],
      ['6-3-2-2', 'SAKQJT H987 D54 C87'],
    ];
    for (const [name, spec] of unbalancedCases) {
      it(`${name} 为非均型`, () => {
        expect(isBalanced(distribution(parseHand(spec)))).toBe(false);
      });
    }
  });
});
