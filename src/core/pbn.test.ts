import { describe, expect, it } from 'vitest';
import { createDeck } from './deck';
import { toPbnDeal, toPbnHands, parsePbnDeal, handToPbn } from './pbn';
import { parseHand } from '../testing/testUtils';

const SAMPLE_PBN =
  'N:5.J653.Q64.KJT74 KT64.Q72.AJ5.A62 J3.AKT98.K832.Q3 AQ9872.4.T97.985';

describe('PBN 发牌转换', () => {
  it('单手牌按 ♠♥♦♣ 输出，点数从大到小', () => {
    expect(handToPbn(parseHand('SAKQ HJT9 D5 C876'))).toBe('AKQ.JT9.5.876');
  });

  it('四手牌可往返转换', () => {
    const parsed = parsePbnDeal(SAMPLE_PBN);
    const text = toPbnDeal(parsed.hands);
    expect(text).toBe(SAMPLE_PBN);

    const reparsed = parsePbnDeal(text);
    expect(reparsed.dealer).toBe('N');
    expect(reparsed.hands).toEqual(parsed.hands);
  });

  it('按发牌人开始顺时针解析四手牌', () => {
    const chunks = SAMPLE_PBN.slice(2).split(' ');
    // 原顺序 N E S W；改为 E 发牌后为 E S W N
    const eastFirst = `E:${[chunks[1], chunks[2], chunks[3], chunks[0]].join(' ')}`;
    const parsed = parsePbnDeal(eastFirst);
    expect(parsed.dealer).toBe('E');
    expect(parsed.hands.N).toEqual(parsePbnDeal(SAMPLE_PBN).hands.N);
    expect(parsed.hands.E).toEqual(parsePbnDeal(SAMPLE_PBN).hands.E);
    expect(parsed.hands.S).toEqual(parsePbnDeal(SAMPLE_PBN).hands.S);
    expect(parsed.hands.W).toEqual(parsePbnDeal(SAMPLE_PBN).hands.W);
  });

  it('完整 52 张牌不会丢失或重复', () => {
    const deck = createDeck();
    const hands = {
      N: deck.slice(0, 13),
      E: deck.slice(13, 26),
      S: deck.slice(26, 39),
      W: deck.slice(39, 52),
    };
    const parsed = parsePbnDeal(toPbnDeal(hands));
    const all = Object.values(parsed.hands).flat();
    expect(all).toHaveLength(52);
    expect(new Set(all).size).toBe(52);
  });

  it('残局可生成不等长 PBN，空手输出 ...', () => {
    const text = toPbnHands(
      {
        N: [],
        E: parseHand('H3'),
        S: parseHand('H5'),
        W: parseHand('H4'),
      },
      'E',
    );
    // 顺序从 E 开始：E S W N；空手用 ... 表示
    expect(text).toBe('E:.3.. .5.. .4.. ...');
    expect(text.startsWith('E:')).toBe(true);
    expect(text.endsWith('...')).toBe(true);
  });

  it('拒绝张数不足的发牌', () => {
    expect(() => parsePbnDeal('N:AKQ.J.2.3 AKQ.J.2.3 AKQ.J.2.3 AKQ.J.2.3')).toThrow(/13/);
  });

  it('拒绝重复的牌', () => {
    const spades = 'AKQJT98765432...';
    const hearts = '.AKQJT98765432..';
    const diamonds = '..AKQJT98765432.';
    const clubs = '...AKQJT98765432';
    expect(() => parsePbnDeal(`N:${spades} ${spades} ${diamonds} ${clubs}`)).toThrow(/同时出现|重复/);
    // 同一组四手牌本身是合法的
    expect(() => parsePbnDeal(`N:${spades} ${hearts} ${diamonds} ${clubs}`)).not.toThrow();
  });

  it('拒绝乱序点数', () => {
    const ascending = SAMPLE_PBN.replace('N:5.J653', 'N:5K.J653');
    expect(() => parsePbnDeal(ascending)).toThrow(/从大到小/);
  });
});
