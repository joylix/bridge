import { describe, expect, it } from 'vitest';
import { bidAI } from './bidAI';
import { parseHand, history } from '../testing/testUtils';
import { loadBiddingRules } from '../engine/loader';
import { makeRng } from '../engine/arbiter';
import { isCallLegal } from '../core/bidding/validator';
import { createDeck } from '../core/deck';
import type { BidRecord, Position } from '../models/gameState';

const precision = loadBiddingRules('precision');
const natural = loadBiddingRules('natural');

describe('叫牌 AI（bidAI）', () => {
  it('精确制：1C-1H 后 22+ 均型有 4 张红桃支持时先加叫，不用 3NT 掩盖配合', () => {
    const hand = parseHand('SAKQ2 HAKQJ DA32 C32'); // 24 HCP, 4-4-3-2
    const h = history(['N', '1C'], ['E', 'Pass'], ['S', '1H'], ['W', 'Pass']);
    const call = bidAI(hand, h, 'N', { level: 1, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'H' });
  });

  it('精确制：1C-1H 后 22+ 均型无 4 张红桃支持时叫 3NT', () => {
    const hand = parseHand('SAKQJ HAKQ DA32 C432'); // 23 HCP, 4-3-3-3
    const h = history(['N', '1C'], ['E', 'Pass'], ['S', '1H'], ['W', 'Pass']);
    const call = bidAI(hand, h, 'N', { level: 1, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'NT' });
  });

  it('精确制：1C-1S 后 22+ 均型有 4 张黑桃支持时先加叫', () => {
    const hand = parseHand('SAKQJ HAKQ2 DA32 C32'); // 24 HCP, 4-4-3-2
    const h = history(['N', '1C'], ['E', 'Pass'], ['S', '1S'], ['W', 'Pass']);
    const call = bidAI(hand, h, 'N', { level: 1, suit: 'S' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'S' });
  });

  it('精确制：1C-2C/2D 后 22+ 均型有 4 张支持时先加叫', () => {
    const clubHand = parseHand('SAKQ HAKQ DA32 C5432'); // 22 HCP, 3-3-3-4
    const clubHistory = history(['N', '1C'], ['E', 'Pass'], ['S', '2C'], ['W', 'Pass']);
    expect(
      bidAI(clubHand, clubHistory, 'N', { level: 2, suit: 'C' }, precision, {
        style: 1,
        randomness: 0,
        rng: makeRng(1),
      }),
    ).toEqual({ type: 'bid', level: 3, suit: 'C' });

    const diamondHand = parseHand('SAKQ HAKQ D5432 CA32'); // 22 HCP, 3-3-4-3
    const diamondHistory = history(['N', '1C'], ['E', 'Pass'], ['S', '2D'], ['W', 'Pass']);
    expect(
      bidAI(diamondHand, diamondHistory, 'N', { level: 2, suit: 'D' }, precision, {
        style: 1,
        randomness: 0,
        rng: makeRng(1),
      }),
    ).toEqual({ type: 'bid', level: 3, suit: 'D' });
  });

  it('精确制：16 点均型开叫 1C（优先于 1NT）', () => {
    const hand = parseHand('SAKQ2 HAK3 D5432 C87'); // 16 HCP, 4-4-3-2
    const call = bidAI(hand, [], 'S', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'C' });
  });

  it('自然制（替换规则文件）：同样手牌开叫 1NT', () => {
    const hand = parseHand('SAKQ2 HAK3 D5432 C87');
    const call = bidAI(hand, [], 'S', null, natural, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'NT' });
  });

  it('精确制：13 点均型开叫 1NT（不受自然制 15-17 风格影响）', () => {
    const hand = parseHand('SAK2 HAQ3 D5432 C876'); // 13 HCP, 3-3-4-3
    for (const style of [0, 1, 2] as const) {
      const call = bidAI(hand, [], 'S', null, precision, { style, randomness: 0, rng: makeRng(1) });
      expect(call).toEqual({ type: 'bid', level: 1, suit: 'NT' });
    }
  });

  it('精确制：15 点均型开叫 1NT', () => {
    const hand = parseHand('SAKJ HAK3 D5432 C876'); // 15 HCP, 3-3-4-3
    const call = bidAI(hand, [], 'S', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'NT' });
  });

  it('精确制：赌博 3NT 开叫（7 张坚固低花）', () => {
    const clubs = parseHand('S32 H32 D32 CAKQJ432'); // 10 HCP, 7 张坚固梅花
    expect(
      bidAI(clubs, [], 'S', null, precision, { style: 1, randomness: 0, rng: makeRng(1) }),
    ).toEqual({ type: 'bid', level: 3, suit: 'NT' });

    const diamonds = parseHand('S32 H32 DAKQJ432 C32'); // 10 HCP, 7 张坚固方块
    expect(
      bidAI(diamonds, [], 'S', null, precision, { style: 1, randomness: 0, rng: makeRng(1) }),
    ).toEqual({ type: 'bid', level: 3, suit: 'NT' });
  });

  it('精确制：破低花不构成赌博 3NT，仍按阻击叫', () => {
    const hand = parseHand('S32 H32 D32 CAKJ5432'); // 8 HCP, 7 张梅花缺 Q
    const call = bidAI(hand, [], 'S', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'C' });
  });

  it('精确制：1S-3S 后按调整点进局（11 点 6 张黑桃单张 → AP 15）', () => {
    const hand = parseHand('SAKQJ32 H2 D543 CJ98'); // 11 HCP, 6-1-3-3
    const h = history(['N', '1S'], ['E', 'Pass'], ['S', '3S'], ['W', 'Pass']);
    const call = bidAI(hand, h, 'N', { level: 3, suit: 'S' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 4, suit: 'S' });
  });

  it('精确制：1H-(1S) 强牌扣叫 2S（16+、黑桃单张，有红桃支持）', () => {
    const hand = parseHand('SA HAKQ2 DQJ32 C5432'); // 16 HCP, 1-4-4-4
    const h = history(['N', '1H'], ['E', '1S']);
    const call = bidAI(hand, h, 'S', { level: 1, suit: 'S' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 2, suit: 'S' });
  });

  it('精确制：1H-(1S) 有 5 张梅花时先叫自然长套 2C，不扣叫', () => {
    const hand = parseHand('SA2 HQ2 DKQJ3 CAQ432'); // 17 HCP, 2-2-4-5
    const h = history(['N', '1H'], ['E', '1S']);
    const call = bidAI(hand, h, 'S', { level: 1, suit: 'S' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 2, suit: 'C' });
  });

  it('精确制：1H-(1S) 无长旁套、Ax 黑桃时仍扣叫 2S', () => {
    const hand = parseHand('SA2 HQ32 DKQJ3 CAQ43'); // 17 HCP, 2-3-4-4
    const h = history(['N', '1H'], ['E', '1S']);
    const call = bidAI(hand, h, 'S', { level: 1, suit: 'S' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 2, suit: 'S' });
  });

  it('精确制：1H-(1S) 有 Kx 黑桃但无第一控制时不扣叫，直接 4H', () => {
    const hand = parseHand('SK2 HAKQ2 DQJT CJ432'); // 16 HCP, 2-4-3-4
    const h = history(['N', '1H'], ['E', '1S']);
    const call = bidAI(hand, h, 'S', { level: 1, suit: 'S' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 4, suit: 'H' });
  });

  it('精确制：1S-(2H) 强牌扣叫 3H（Ax 红桃）', () => {
    const hand = parseHand('SAKQ2 H2 DAJ32 CQ432'); // 16 HCP, 4-1-4-4
    const h = history(['N', '1S'], ['E', '2H']);
    const call = bidAI(hand, h, 'S', { level: 2, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'H' });
  });

  it('精确制：强牌扣叫后开叫人 5 张红桃再叫 3H', () => {
    const hand = parseHand('S32 HKJ543 DAJ2 CQ32'); // 11 HCP, 2-5-3-3
    const h = history(['N', '1H'], ['E', '1S'], ['S', '2S'], ['W', 'Pass']);
    const call = bidAI(hand, h, 'N', { level: 2, suit: 'S' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'H' });
  });

  it('精确制：强牌扣叫后开叫人 5 张黑桃再叫 3S', () => {
    const hand = parseHand('SAKJ43 H32 DQ32 CQ32'); // 12 HCP, 5-2-3-3
    const h = history(['N', '1S'], ['E', '2H'], ['S', '3H'], ['W', 'Pass']);
    const call = bidAI(hand, h, 'N', { level: 3, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'S' });
  });

  it('精确制：强牌扣叫后扣叫人 3 张以上红桃支持进局 4H', () => {
    const hand = parseHand('SA HAKQ2 DQJ32 C5432'); // 16 HCP, 1-4-4-4
    const h = history(
      ['N', '1H'],
      ['E', '1S'],
      ['S', '2S'],
      ['W', 'Pass'],
      ['N', '3H'],
      ['E', 'Pass'],
    );
    const call = bidAI(hand, h, 'S', { level: 3, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 4, suit: 'H' });
  });

  it('精确制：强牌扣叫后扣叫人无支持但有黑桃挡张叫 3NT', () => {
    const hand = parseHand('SA2 HQ2 DKQJ3 CAQ432'); // 17 HCP, 2-2-4-5
    const h = history(
      ['N', '1H'],
      ['E', '1S'],
      ['S', '2S'],
      ['W', 'Pass'],
      ['N', '3H'],
      ['E', 'Pass'],
    );
    const call = bidAI(hand, h, 'S', { level: 3, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'NT' });
  });

  it('精确制：1D-(1H)-2H 后开叫人 5 张红桃不能把敌方花色当自然套，改叫 3NT', () => {
    const hand = parseHand('SA2 HKQJ32 DKQJ2 C2'); // 14 HCP, 2-5-5-1
    const h = history(['N', '1D'], ['E', '1H'], ['S', '2H'], ['W', 'Pass']);
    const call = bidAI(hand, h, 'N', { level: 2, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'NT' });
  });

  it('精确制：1C-(1D)-2D 后开叫人 5 张方块不能把敌方花色当自然套，改叫 3NT', () => {
    const hand = parseHand('SAK2 HQ32 DKQJ32 C32'); // 14 HCP, 3-3-5-2
    const h = history(['N', '1C'], ['E', '1D'], ['S', '2D'], ['W', 'Pass']);
    const call = bidAI(hand, h, 'N', { level: 2, suit: 'D' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'NT' });
  });

  it('精确制：同伴自然 1S 后开叫人 5 张红桃是敌方花色，不能自然叫 3H', () => {
    const hand = parseHand('SA2 HKQJ32 DKQJ2 C2'); // 14 HCP, 2-5-5-1
    const h = history(['N', '1D'], ['E', '1H'], ['S', '1S'], ['W', 'Pass']);
    h[2].ruleId = 'nat_1d_over_1h_1s';
    const call = bidAI(hand, h, 'N', { level: 1, suit: 'S' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'NT' });
  });

  it('精确制：同伴自然 2D 后开叫人 5 张梅花是敌方花色，不能自然叫 3C', () => {
    const hand = parseHand('SA2 HK2 DQ32 CKQJ32'); // 13 HCP, 2-2-3-6
    const h = history(['N', '1C'], ['E', '2C'], ['S', '2D'], ['W', 'Pass']);
    h[2].ruleId = 'nat_1c_over_2c_2d';
    const call = bidAI(hand, h, 'N', { level: 2, suit: 'D' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'NT' });
  });

  it('精确制：1D-(1H) 强牌扣叫 2H（红桃单张、无长旁套）', () => {
    const hand = parseHand('SAKQ2 H2 DAJ32 CQ432'); // 16 HCP, 4-1-4-4
    const h = history(['N', '1D'], ['E', '1H']);
    const call = bidAI(hand, h, 'S', { level: 1, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 2, suit: 'H' });
  });

  it('精确制：1D-(1H) 有 5 张黑桃时先叫自然 1S', () => {
    const hand = parseHand('SAKQ32 H2 DAJ3 CQ432'); // 16 HCP, 5-1-3-4
    const h = history(['N', '1D'], ['E', '1H']);
    const call = bidAI(hand, h, 'S', { level: 1, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'S' });
  });

  it('精确制：1C-(1D) 强牌扣叫 2D（方块单张、无 5+ 长套）', () => {
    const hand = parseHand('SAKQ2 HAKQ2 D2 C5432'); // 18 HCP, 4-4-1-4
    const h = history(['N', '1C'], ['E', '1D']);
    const call = bidAI(hand, h, 'S', { level: 1, suit: 'D' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 2, suit: 'D' });
  });

  it('精确制：1C-(1D) 有 5 张红桃时先叫自然 1H', () => {
    const hand = parseHand('SAKQ2 HAKQJ2 D2 C543'); // 19 HCP, 4-5-1-3
    const h = history(['N', '1C'], ['E', '1D']);
    const call = bidAI(hand, h, 'S', { level: 1, suit: 'D' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'H' });
  });

  it('精确制：1D-(1H)-2H 后开叫人 5 张黑桃再叫 3S', () => {
    const hand = parseHand('SAKQJ2 H32 DQ32 CQ32'); // 14 HCP, 5-2-3-3
    const h = history(['N', '1D'], ['E', '1H'], ['S', '2H'], ['W', 'Pass']);
    const call = bidAI(hand, h, 'N', { level: 2, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'S' });
  });

  it('精确制：1D-(1H)-2H-3S 后扣叫人 3 张黑桃进局 4S', () => {
    const hand = parseHand('SQ32 HA2 DKQJ2 CA432'); // 16 HCP, 3-2-4-4
    const h = history(
      ['N', '1D'],
      ['E', '1H'],
      ['S', '2H'],
      ['W', 'Pass'],
      ['N', '3S'],
      ['E', 'Pass'],
    );
    const call = bidAI(hand, h, 'S', { level: 3, suit: 'S' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 4, suit: 'S' });
  });

  it('精确制：1D-(1H)-2H-3S 后扣叫人无支持但有红桃挡张叫 3NT', () => {
    const hand = parseHand('SQ2 HA2 DKQJ32 CA432'); // 16 HCP, 2-2-5-4
    const h = history(
      ['N', '1D'],
      ['E', '1H'],
      ['S', '2H'],
      ['W', 'Pass'],
      ['N', '3S'],
      ['E', 'Pass'],
    );
    const call = bidAI(hand, h, 'S', { level: 3, suit: 'S' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'NT' });
  });

  it('精确制：扣叫后 18+ 且 3+ 支持叫 4NT 满贯试探', () => {
    const hand = parseHand('SA HKQJ2 DKQJ2 CKQJ2'); // 19 HCP, 1-4-4-4
    const h = history(
      ['N', '1H'],
      ['E', '1S'],
      ['S', '2S'],
      ['W', 'Pass'],
      ['N', '3H'],
      ['E', 'Pass'],
    );
    const call = bidAI(hand, h, 'S', { level: 3, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 4, suit: 'NT' });
  });

  it('精确制：4NT 后开叫人按 A 数应答 5H（2 A）', () => {
    const hand = parseHand('S32 HKJ543 DAJ2 CA32'); // 13 HCP, 2-5-3-3, 2 A
    const h = history(
      ['N', '1H'],
      ['E', '1S'],
      ['S', '2S'],
      ['W', 'Pass'],
      ['N', '3H'],
      ['E', 'Pass'],
      ['S', '4NT'],
      ['W', 'Pass'],
    );
    const call = bidAI(hand, h, 'N', { level: 4, suit: 'NT' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 5, suit: 'H' });
  });

  it('精确制：Blackwood 后联手 3 A 叫 6H', () => {
    const hand = parseHand('SA HKQJ2 DKQJ2 CKQJ2'); // 19 HCP, 1 A
    const h = history(
      ['N', '1H'],
      ['E', '1S'],
      ['S', '2S'],
      ['W', 'Pass'],
      ['N', '3H'],
      ['E', 'Pass'],
      ['S', '4NT'],
      ['W', 'Pass'],
      ['N', '5H'],
      ['E', 'Pass'],
    );
    const call = bidAI(hand, h, 'S', { level: 5, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 6, suit: 'H' });
  });

  it('精确制：同伴自然强新花 2C 后开叫人 5 张红桃再叫 3H', () => {
    const hand = parseHand('S32 HKJ543 DAJ2 CQ32'); // 11 HCP, 2-5-3-3
    const h = history(['N', '1H'], ['E', '1S'], ['S', '2C'], ['W', 'Pass']);
    h[2].ruleId = 'nat_1h_over_1s_2c';
    const call = bidAI(hand, h, 'N', { level: 2, suit: 'C' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'H' });
  });

  it('精确制：同伴自然强新花 2C 后开叫人 3 张梅花支持叫 5C', () => {
    const hand = parseHand('S32 HQJ5 DAQJ32 C432'); // 10 HCP, 2-3-5-3
    const h = history(['N', '1D'], ['E', '1S'], ['S', '2C'], ['W', 'Pass']);
    h[2].ruleId = 'nat_1d_over_1s_2c';
    const call = bidAI(hand, h, 'N', { level: 2, suit: 'C' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 5, suit: 'C' });
  });

  it('精确制：自然强新花 2C 后开叫人 3H，应叫人 3+ 红桃进局 4H', () => {
    const hand = parseHand('S2 HAKQ2 DQJ3 CK5432'); // 15 HCP, 1-4-3-5
    const h = history(
      ['N', '1H'],
      ['E', '1S'],
      ['S', '2C'],
      ['W', 'Pass'],
      ['N', '3H'],
      ['E', 'Pass'],
    );
    h[2].ruleId = 'nat_1h_over_1s_2c';
    const call = bidAI(hand, h, 'S', { level: 3, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 4, suit: 'H' });
  });

  it('精确制：自然强新花 2C 后开叫人 3H，应叫人无支持但有黑桃挡张叫 3NT', () => {
    const hand = parseHand('SA2 HQ2 DQJ3 CAK5432'); // 16 HCP, 2-2-4-5
    const h = history(
      ['N', '1H'],
      ['E', '1S'],
      ['S', '2C'],
      ['W', 'Pass'],
      ['N', '3H'],
      ['E', 'Pass'],
    );
    h[2].ruleId = 'nat_1h_over_1s_2c';
    const call = bidAI(hand, h, 'S', { level: 3, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'NT' });
  });

  it('精确制：15 点均型对 1C 不争叫 1NT（争叫下限 16）', () => {
    const hand = parseHand('SAKJ HAK3 D5432 C876'); // 15 HCP
    const h = history(['E', '1C']);
    const call = bidAI(hand, h, 'S', { level: 1, suit: 'C' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).not.toEqual({ type: 'bid', level: 1, suit: 'NT' });
  });

  it('精确制：16 点均型对 1C 争叫 1NT', () => {
    const hand = parseHand('SAKJ HAK3 DJ432 C876'); // 16 HCP, 3-3-4-3
    const h = history(['E', '1C']);
    const call = bidAI(hand, h, 'S', { level: 1, suit: 'C' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'NT' });
  });

  it('精确制：16 点均型对 1S 也争叫 1NT', () => {
    const hand = parseHand('SAKJ HAK3 DJ432 C876'); // 16 HCP, 3-3-4-3
    const h = history(['N', '1S']);
    const call = bidAI(hand, h, 'E', { level: 1, suit: 'S' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'NT' });
  });

  it('17 点 6 张红桃对 1D 争叫 1H，而不是 Pass（精确/自然）', () => {
    // S- HAK9753 DAKQJ7 C63：17 HCP，0-6-5-2
    const hand = parseHand('HAK9753 DAKQJ7 C63');
    const h = history(['E', '1D']);
    for (const rules of [precision, natural]) {
      const call = bidAI(hand, h, 'S', { level: 1, suit: 'D' }, rules, {
        style: 1,
        randomness: 0,
        rng: makeRng(1),
      });
      expect(call).toEqual({ type: 'bid', level: 1, suit: 'H' });
    }
  });

  it('精确制：17 点均型对 1D 仍优先争叫 1NT', () => {
    const hand = parseHand('SAKJ HAK3 DQ32 C8765'); // 17 HCP, 4-3-3-3
    const h = history(['E', '1D']);
    const call = bidAI(hand, h, 'S', { level: 1, suit: 'D' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'NT' });
  });

  it('精确制：19 点 5 张黑桃对 1D 先加倍，同伴 1H 后再叫 1S', () => {
    const hand = parseHand('SAKQJ2 H2 DKJ3 CAJ32'); // 19 HCP, 5-1-3-4
    const first = bidAI(hand, history(['E', '1D']), 'S', { level: 1, suit: 'D' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(first).toEqual({ type: 'double' });

    const h = history(
      ['E', '1D'],
      ['S', 'X'],
      ['W', 'Pass'],
      ['N', '1H'],
      ['E', 'Pass'],
    );
    const rebid = bidAI(hand, h, 'S', { level: 1, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(rebid).toEqual({ type: 'bid', level: 1, suit: 'S' });
  });

  it('精确制：16 点 5 张方块对 1S 加倍，同伴 2H 后再出 3D', () => {
    const hand = parseHand('S2 HAKQ2 DAJ432 CQ32'); // 16 HCP, 1-4-5-3
    const first = bidAI(hand, history(['E', '1S']), 'S', { level: 1, suit: 'S' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(first).toEqual({ type: 'double' });

    const h = history(
      ['E', '1S'],
      ['S', 'X'],
      ['W', 'Pass'],
      ['N', '2H'],
      ['E', 'Pass'],
    );
    const rebid = bidAI(hand, h, 'S', { level: 2, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(rebid).toEqual({ type: 'bid', level: 3, suit: 'D' });
  });

  it('精确制：15 点 5 张方块对 1S 加倍后不再出套（加倍出套需 16+）', () => {
    const hand = parseHand('S2 HKQJ2 DAK432 CQ32'); // 15 HCP, 1-4-5-3
    const h = history(
      ['E', '1S'],
      ['S', 'X'],
      ['W', 'Pass'],
      ['N', '2H'],
      ['E', 'Pass'],
    );
    const rebid = bidAI(hand, h, 'S', { level: 2, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(rebid).toEqual({ type: 'pass' });
  });

  it('无规则命中时兜底 Pass（第 9 用例：^$ 与兜底）', () => {
    const hand = parseHand('SJ32 H854 D763 C92'); // 1 HCP，无任何开叫条件
    const call = bidAI(hand, [], 'S', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'pass' });
  });

  it('randomness=0 时结果确定', () => {
    const hand = parseHand('SAKQ2 HAK3 D5432 C87');
    const a = bidAI(hand, [], 'S', null, precision, { style: 1, randomness: 0, rng: makeRng(9) });
    const b = bidAI(hand, [], 'S', null, precision, { style: 1, randomness: 0, rng: makeRng(9) });
    expect(a).toEqual(b);
  });

  it('AI 绝不产生非法叫品（随机遍历）', () => {
    const deck = createDeck();
    for (let seed = 0; seed < 40; seed++) {
      const rng = makeRng(seed);
      // 从牌堆切出 13 张随机手牌
      const shuffled = [...deck].sort(() => rng() - 0.5);
      const hand = shuffled.slice(0, 13);
      const history: BidRecord[] = [];
      let currentBid: { level: number; suit: import('../models/gameState').BidSuit } | null = null;
      const positions: Position[] = ['N', 'E', 'S', 'W'];
      let pos: Position = 'N';
      // 随机造一段叫牌历史
      const steps = Math.floor(rng() * 6);
      for (let i = 0; i < steps; i++) {
        const call = bidAI(hand, history, pos, currentBid, precision, {
          style: 1,
          randomness: 0.5,
          rng,
        });
        expect(isCallLegal(history, currentBid, pos, call)).toBe(true);
        history.push({ position: pos, call });
        if (call.type === 'bid') currentBid = { level: call.level, suit: call.suit };
        pos = positions[(positions.indexOf(pos) + 1) % 4];
      }
    }
  });

  it('探索带 seed 可复现', () => {
    const hand = parseHand('SAKQ2 HAK3 D5432 C87');
    const pick = (s: number) =>
      bidAI(hand, [], 'S', null, precision, { style: 1, randomness: 0.9, rng: makeRng(s) });
    for (const s of [1, 7, 42, 100]) expect(pick(s)).toEqual(pick(s));
  });
});

describe('用户牌例：北 13 点 2-3-3-5 不应连续 Pass', () => {
  // ♠K7 ♥954 ♦AQJ ♣K10643：13 HCP，2-3-3-5
  const north = parseHand('SK7 H954 DAQJ CKT643');

  it('作为发牌人应开叫 1NT（13 点均型，精确 1NT = 13-15）', () => {
    const call = bidAI(north, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'NT' });
  });

  it('同伴开叫 1H 后应叫 3H（13 点，3 张支持）', () => {
    const h = history(['N', 'Pass'], ['E', 'Pass'], ['S', '1H'], ['W', 'Pass']);
    const call = bidAI(north, h, 'N', { level: 1, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'H' });
  });

  it('开叫 1D 被同伴应 1H 后，再叫 3H 而不是 Pass', () => {
    const h = history(['N', '1D'], ['E', 'Pass'], ['S', '1H'], ['W', 'Pass']);
    const call = bidAI(north, h, 'N', { level: 1, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'H' });
  });

  it('1H 后 13 点均型、无 3 张支持时叫 2NT', () => {
    const hand = parseHand('SKQ2 H54 DAJ3 CK8765'); // 13 HCP，5-3-3-2
    const h = history(['S', '1H'], ['W', 'Pass']);
    const call = bidAI(hand, h, 'N', { level: 1, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 2, suit: 'NT' });
  });

  it('1H 后 13 点、5+ 梅花且非均型时叫 2C', () => {
    const hand = parseHand('SKQ2 H54 DAJ CK87654'); // 13 HCP，3-2-2-6
    const h = history(['S', '1H'], ['W', 'Pass']);
    const call = bidAI(hand, h, 'N', { level: 1, suit: 'H' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 2, suit: 'C' });
  });

  it('6 张梅花仍优先开叫 2C，不被 1D 兜底抢走', () => {
    const hand = parseHand('SAK2 HQ2 D32 CKQJ876'); // 15 HCP，3-2-2-6
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 2, suit: 'C' });
  });
});

describe('开叫门槛：13 点必开、弱 12 点可 Pass', () => {
  it('12 点弱均型（AK 控制 0-2、无 5+ 长套）选择 Pass', () => {
    const hand = parseHand('SQJ2 HJ32 DQJ3 CKQ32'); // 12 HCP，4-3-3-3，仅 1 个 K
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'pass' });
  });

  it('12 点有 A+K（controls 3）且 4 张方块时仍然开叫 1D', () => {
    const hand = parseHand('SA32 HQ32 DKJ43 CQ32'); // 12 HCP，3-3-4-3，A+K
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'D' });
  });

  it('12 点持有 5 张方块时开叫 1D（满足 4+ 方块）', () => {
    const hand = parseHand('SQJ2 HKJ2 DKQ432 C32'); // 12 HCP，5 张方块
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'D' });
  });

  it('13 点弱均型必须开叫（1NT）', () => {
    const hand = parseHand('SQJ2 HJ32 DQJ3 CKQJ2'); // 13 HCP，4-3-3-3
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'NT' });
  });
});

describe('2C 开叫：6+ 梅花，或 5 梅花 + 4 张高花', () => {
  it('5 张梅花 + 4 张黑桃开叫 2C', () => {
    const hand = parseHand('SAJ32 HK2 D32 CKJ876'); // 12 HCP，4-2-2-5
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 2, suit: 'C' });
  });

  it('5 张梅花 + 4 张红桃开叫 2C', () => {
    const hand = parseHand('SA32 HKJ32 D2 CKJ876'); // 12 HCP，3-4-1-5
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 2, suit: 'C' });
  });

  it('5 张梅花但没有 4 张高花时不叫 2C；12 点且方块不足 4 张则 Pass', () => {
    const hand = parseHand('SQJ2 HQJ2 DK2 CK8765'); // 12 HCP，3-3-2-5
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'pass' });
  });

  it('6 张梅花 + 4 张方块仍优先开叫 2C（不再限制方块 0-3）', () => {
    const hand = parseHand('SAQ H2 DKQJ4 C987654'); // 12 HCP，2-1-4-6
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 2, suit: 'C' });
  });
});

describe('1D 开叫的方块长度保证与第三/四家例外', () => {
  it('第一/二家 1D 保证 4+ 方块（11 点 4-4-4-1 走 1D）', () => {
    const hand = parseHand('SAK32 HJT98 DQJ43 C8'); // 11 HCP，4 张方块
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'D' });
  });

  it('第一/二家 12 点不足 4 张方块且无其他叫品时 Pass', () => {
    const hand = parseHand('SA32 HQ32 DJ43 CKQ32'); // 12 HCP，3 张方块
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'pass' });
  });

  it('第一/二家 13 点不足 4 张方块、均型时开叫 1NT（不再由 1D 兜底）', () => {
    const hand = parseHand('SQJ2 HQ2 DKQ3 CK8765'); // 13 HCP，3 张方块，5 张梅花，均型
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'NT' });
  });

  it('第三家首叫时 1D 不保证方块长度', () => {
    const hand = parseHand('SQ32 HJ2 DKQ3 CK8765'); // 11 HCP，3 张方块
    const h = history(['N', 'Pass'], ['E', 'Pass']);
    const call = bidAI(hand, h, 'S', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'D' });
  });

  it('第四家首叫时 1D 不保证方块长度', () => {
    const hand = parseHand('SQ32 HJ2 DKQ3 CK8765'); // 11 HCP，3 张方块
    const h = history(['N', 'Pass'], ['E', 'Pass'], ['S', 'Pass']);
    const call = bidAI(hand, h, 'W', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'D' });
  });
});

describe('精确 2D 开叫 = 4-4-1-4（11-15，方块单张）', () => {
  it('4-4-1-4 且 11-15 点开叫 2D（回归：此前会误判/漏叫）', () => {
    const hand = parseHand('SAKQ2 HKJ32 D5 C8765'); // 13 HCP, 4-4-1-4
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 2, suit: 'D' });
  });

  it('低限 4-4-1-4（11 点）也开叫 2D', () => {
    const hand = parseHand('SKJ32 HQJ32 D5 CA876'); // 11 HCP, 4-4-1-4
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 2, suit: 'D' });
  });

  it('16+ 的 4-4-1-4 仍应开叫 1C（强开叫优先）', () => {
    const hand = parseHand('SAKQ2 HAKJ2 D5 C876'); // 17 HCP, 4-4-1-4
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'C' });
  });

  it('普通 6 张方块弱牌不再叫 2D（2D 已改为人工叫）', () => {
    const hand = parseHand('SA H32 DQJ8765 C432'); // 7 HCP, 6 张方块
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).not.toEqual({ type: 'bid', level: 2, suit: 'D' });
  });

  it('4-4-4-1（方块 4 张）走 1D 而非 2D', () => {
    const hand = parseHand('SAK32 HJT98 DQJ43 C8'); // 11 HCP, 4-4-4-1（方块 4 张）
    const call = bidAI(hand, [], 'N', null, precision, { style: 1, randomness: 0, rng: makeRng(1) });
    expect(call).toEqual({ type: 'bid', level: 1, suit: 'D' });
  });

  it('同伴 2D-2S 后，开叫人用 4 张支持加叫 3S（复现用户牌例的续叫）', () => {
    const hand = parseHand('SAKQ2 HKJ32 D5 C8765'); // 4-4-1-4
    const h = history(['N', '2D'], ['E', 'Pass'], ['S', '2S'], ['W', 'Pass']);
    const call = bidAI(hand, h, 'N', { level: 2, suit: 'D' }, precision, {
      style: 1,
      randomness: 0,
      rng: makeRng(1),
    });
    expect(call).toEqual({ type: 'bid', level: 3, suit: 'S' });
  });
});

