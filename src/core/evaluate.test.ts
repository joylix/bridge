import { describe, expect, it } from 'vitest';
import {
  adjustedHcp,
  controls,
  distribution,
  hasSolidSuit,
  hcp,
  isBalanced,
  isSolidSuit,
  suitLength,
} from './evaluate';
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

  describe('调整点 AP（叫牌估值，不参与计分）', () => {
    it('无配合时只加长套点，不加短套点', () => {
      const hand = parseHand('SAKQJ2 H2 D5432 C876'); // 10 HCP, 5-1-4-3
      expect(adjustedHcp(hand)).toBe(11); // +1 第五张黑桃
      expect(adjustedHcp(hand, { trumpSuit: 3 })).toBe(11); // 未显示配合
    });

    it('同伴显示支持后，旁门单张按 +2 计入', () => {
      const hand = parseHand('SAKQJ2 H2 D5432 C876'); // 10 HCP, 5-1-4-3
      expect(adjustedHcp(hand, { trumpSuit: 3, partnerSupported: true })).toBe(13);
    });

    it('敌方花色单张 K/Q/J 作为废点扣 1', () => {
      const hand = parseHand('SAKQJ2 HQ D5432 C876'); // 12 HCP, 5-1-4-3
      expect(adjustedHcp(hand, { trumpSuit: 3, partnerSupported: true })).toBe(15);
      expect(
        adjustedHcp(hand, { trumpSuit: 3, partnerSupported: true, opponentSuit: 2 }),
      ).toBe(14);
    });

    it('敌方花色中的长度不计长套点', () => {
      const hand = parseHand('S32 H2 DAKQJ432 C432'); // 10 HCP, 7 张方块
      expect(adjustedHcp(hand)).toBe(14); // +3 长套 +1 坚固套
      expect(adjustedHcp(hand, { opponentSuit: 1 })).toBe(10); // 方块是敌方花色
    });

    it('坚固长套奖励 +1，破套不奖励', () => {
      const solid = parseHand('SAKQJ432 H32 D32 C32'); // 7 张黑桃，A/K/Q/J
      expect(isSolidSuit(solid, 3)).toBe(true);
      expect(hasSolidSuit(solid, 'S')).toBe(true);
      expect(adjustedHcp(solid)).toBe(14); // 10 HCP +3 长套 +1 坚固套

      const broken = parseHand('SAKJ5432 H32 D32 C32'); // 缺 Q
      expect(isSolidSuit(broken, 3)).toBe(false);
      expect(hasSolidSuit(broken, 'S')).toBe(false);
    });
  });
});
