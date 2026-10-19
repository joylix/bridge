import { describe, expect, it } from 'vitest';
import { getLegalCards, isCardLegal } from './playing';
import { parseHand } from '../testing/testUtils';
import { getCard } from '../models/card';

describe('出牌法律', () => {
  const hand = parseHand('SAKQ HJT9 D5 C2'); // S:AKQ H:JT9 D:5 C:2

  it('领出（leadSuit=null）时任意牌合法', () => {
    expect(getLegalCards(hand, null).length).toBe(hand.length);
  });

  it('有领出花色必须跟牌', () => {
    const legal = getLegalCards(hand, 3); // 黑桃
    expect(legal).toEqual(parseHand('SAKQ'));
  });

  it('缺门时可出任意牌', () => {
    const legal = getLegalCards(hand, 1); // 方块：手中只有一张 D5，仍必须跟
    expect(legal).toEqual(parseHand('D5'));

    const noDiamond = parseHand('SAK HJT');
    const legal2 = getLegalCards(noDiamond, 1);
    expect(legal2.length).toBe(noDiamond.length); // 缺门 → 任意
  });

  it('isCardLegal 校验', () => {
    expect(isCardLegal(getCard(3, 12), hand, 3)).toBe(true);
    expect(isCardLegal(getCard(2, 12), hand, 3)).toBe(false); // 有黑桃时必须跟黑桃
    expect(isCardLegal(getCard(2, 12), hand, 1)).toBe(false); // 有方块 D5 时不能垫红桃
    expect(isCardLegal(getCard(3, 12), hand, null)).toBe(true);
    expect(isCardLegal(getCard(1, 0), hand, null)).toBe(false); // 方块 2 不在手中
  });
});
