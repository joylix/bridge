import { describe, expect, it } from 'vitest';
import { checkConditions, conditionSpecificity, inRange, resolveVars } from './conditions';
import type { StyleParams } from './types';
import { STYLE_PARAMS } from './types';
import { parseHand } from '../testing/testUtils';

const normal: StyleParams = STYLE_PARAMS[1];

describe('区间解析 inRange', () => {
  it('区间 / 下限 / 定值', () => {
    expect(inRange(16, '16-40', normal)).toBe(true);
    expect(inRange(15, '16-40', normal)).toBe(false);
    expect(inRange(5, '5+', normal)).toBe(true);
    expect(inRange(4, '5+', normal)).toBe(false);
    expect(inRange(12, '12', normal)).toBe(true);
    expect(inRange(11, '12', normal)).toBe(false);
  });

  it('支持风格变量替换', () => {
    expect(resolveVars('${open1ntMin}-${open1ntMax}', normal)).toBe('15-17');
    // 保守风格（0）争叫下限为 9
    expect(inRange(9, '${overcallMinHcp}-15', STYLE_PARAMS[0])).toBe(true);
    expect(inRange(8, '${overcallMinHcp}-15', STYLE_PARAMS[0])).toBe(false);
    // 激进风格（2）争叫下限为 7
    expect(inRange(7, '${overcallMinHcp}-15', STYLE_PARAMS[2])).toBe(true);
  });
});

describe('条件组合 checkConditions（扁平 AND）', () => {
  it('所有指定条件均需满足', () => {
    const hand = parseHand('SAKQ HJT9 D543 C876'); // 16 HCP? SA4+SK3+SQ2+SJ1=10, H1 → 11
    expect(checkConditions(hand, { hcp: '10-12', spades: '3+' }, normal)).toBe(true);
    expect(checkConditions(hand, { hcp: '10-12', spades: '5+' }, normal)).toBe(false);
  });

  it('空条件恒成立', () => {
    expect(checkConditions(parseHand('S2 H3 D4 C5'), {}, normal)).toBe(true);
  });

  it('均型条件', () => {
    expect(checkConditions(parseHand('SAKQ2 HJT9 D543 C876'), { balanced: true }, normal)).toBe(true);
    expect(checkConditions(parseHand('SAKQJ HT987 D54 C87'), { balanced: true }, normal)).toBe(false);
  });

  it('开叫座位条件需要上下文', () => {
    const hand = parseHand('SAKQ2 HJT9 D543 C876');
    expect(checkConditions(hand, { openingSeat: '1-2' }, normal, { openingSeat: 1 })).toBe(true);
    expect(checkConditions(hand, { openingSeat: '1-2' }, normal, { openingSeat: 3 })).toBe(false);
    expect(checkConditions(hand, { openingSeat: '3-4' }, normal)).toBe(false);
  });

  it('失张 / 牌型 / 高花 / 大牌数条件', () => {
    const hand = parseHand('SAKQ2 HJT9 D543 C876'); // 4-3-3-3，4 张黑桃，1 A 1 K
    expect(checkConditions(hand, { fourCardMajor: true }, normal)).toBe(true);
    expect(checkConditions(hand, { fiveCardMajor: true }, normal)).toBe(false);
    expect(checkConditions(hand, { aces: '1', kings: '1' }, normal)).toBe(true);
    expect(checkConditions(hand, { aces: '2+' }, normal)).toBe(false);
    expect(checkConditions(hand, { voids: '0', singletons: '0', doubletons: '0' }, normal)).toBe(true);
    expect(checkConditions(hand, { losers: '0-9' }, normal)).toBe(true);
    expect(checkConditions(hand, { losers: '0-8' }, normal)).toBe(false);

    const twoDoubletons = parseHand('SAKQ32 HJT98 D54 C87'); // 5-4-2-2
    expect(checkConditions(twoDoubletons, { doubletons: '2', fiveCardMajor: true }, normal)).toBe(true);
  });

  it('同伴开叫条件需要上下文', () => {
    const hand = parseHand('SAKQ2 HJT9 D543 C876');
    expect(checkConditions(hand, { partnerOpened: true }, normal, { partnerOpened: true })).toBe(true);
    expect(checkConditions(hand, { partnerOpened: true }, normal, { partnerOpened: false })).toBe(false);
    expect(checkConditions(hand, { partnerOpened: true }, normal, {})).toBe(false);
  });

  it('无将挡张条件按花色检查', () => {
    const hand = parseHand('SAK2 HQJ3 D876 C5432');
    expect(checkConditions(hand, { stoppers: 'SH' }, normal)).toBe(true);
    expect(checkConditions(hand, { stoppers: 'SHD' }, normal)).toBe(false); // 方块无挡张
    expect(checkConditions(hand, { stoppers: 'S' }, normal)).toBe(true);
  });

  it('同伴点力 / 联手点力条件使用推断下限', () => {
    const hand = parseHand('SA432 HK73 DQ85 CJ62'); // 10 HCP
    expect(checkConditions(hand, { partnerHcp: '19+' }, normal, { partnerHcpMin: 19 })).toBe(true);
    expect(checkConditions(hand, { partnerHcp: '20+' }, normal, { partnerHcpMin: 19 })).toBe(false);
    expect(
      checkConditions(hand, { combinedHcp: '29+' }, normal, { partnerHcpMin: 19, combinedHcpMin: 29 }),
    ).toBe(true);
    expect(
      checkConditions(hand, { combinedHcp: '30+' }, normal, { partnerHcpMin: 19, combinedHcpMin: 29 }),
    ).toBe(false);
    // 没有推断上下文时条件不成立，避免规则误命中。
    expect(checkConditions(hand, { combinedHcp: '29+' }, normal, {})).toBe(false);
  });

  it('调整点条件区分“有配合/无配合”', () => {
    const hand = parseHand('SAKQJ2 H2 D5432 C876'); // 10 HCP, 5-1-4-3
    expect(checkConditions(hand, { adjustedHcp: '13+' }, normal)).toBe(false);
    expect(
      checkConditions(hand, { adjustedHcp: '13+' }, normal, {
        adjustment: { trumpSuit: 3, partnerSupported: true },
      }),
    ).toBe(true);
  });

  it('坚固低花条件用于赌博 3NT', () => {
    const solid = parseHand('S32 H32 D32 CAKQJ432'); // 7 张坚固梅花
    const broken = parseHand('S32 H32 D32 CAKJ5432'); // 缺 Q
    expect(checkConditions(solid, { solidSuit: 'CD' }, normal)).toBe(true);
    expect(checkConditions(broken, { solidSuit: 'CD' }, normal)).toBe(false);
  });

  it('敌方花色第一轮控制：缺门/单张或 Ax', () => {
    const ctx = { adjustment: { opponentSuit: 3 as const } }; // 敌方黑桃
    expect(checkConditions(parseHand('S2 HAKQ D543 C8762'), { opponentSuitFirstControl: true }, normal, ctx)).toBe(true); // 单张
    expect(checkConditions(parseHand('HAKQ D5432 C8762'), { opponentSuitFirstControl: true }, normal, ctx)).toBe(true); // 缺门
    expect(checkConditions(parseHand('SA2 HAKQ D543 C876'), { opponentSuitFirstControl: true }, normal, ctx)).toBe(true); // Ax
    expect(checkConditions(parseHand('SK2 HAKQ D543 C876'), { opponentSuitFirstControl: true }, normal, ctx)).toBe(false); // Kx
    expect(checkConditions(parseHand('SA32 HAKQ D54 C876'), { opponentSuitFirstControl: true }, normal, ctx)).toBe(false); // Axx
    expect(checkConditions(parseHand('SA2 HAKQ D543 C876'), { opponentSuitFirstControl: true }, normal)).toBe(false); // 无上下文
  });

  it('无长套 / 允许指定长套', () => {
    const balanced = parseHand('SAKQ2 HJT9 D543 C876'); // 4-3-3-3
    expect(checkConditions(balanced, { noLongSuit: true }, normal)).toBe(true);
    expect(checkConditions(parseHand('SAKQ32 HJT9 D54 C876'), { noLongSuit: true }, normal)).toBe(false); // 5 黑桃
    expect(checkConditions(parseHand('SAKQ32 HJT9 D54 C876'), { noLongSuit: false }, normal)).toBe(true);
    expect(checkConditions(parseHand('SAKQ32 HJT9 D54 C876'), { noLongSuitExcept: 'S' }, normal)).toBe(true);
    expect(checkConditions(parseHand('SAKQ32 HJT987 C876'), { noLongSuitExcept: 'S' }, normal)).toBe(false); // 5 红桃
    expect(checkConditions(parseHand('SAKQ32 HJT987 C876'), { noLongSuitExcept: 'SH' }, normal)).toBe(true);
  });

  it('扣叫花色 / 敌方花色挡张', () => {
    const hand = parseHand('SA2 HKQJ D543 C8762');
    expect(checkConditions(hand, { cueSuitStopper: true }, normal, { cueBidSuit: 'S' })).toBe(true);
    expect(checkConditions(parseHand('S32 HKQJ D543 C8762'), { cueSuitStopper: true }, normal, { cueBidSuit: 'S' })).toBe(false);
    expect(checkConditions(hand, { cueSuitStopper: true }, normal)).toBe(false); // 无扣叫上下文
    expect(
      checkConditions(hand, { opponentSuitStopper: true }, normal, { adjustment: { opponentSuit: 3 } }),
    ).toBe(true);
    expect(
      checkConditions(hand, { opponentSuitStopper: true }, normal, { adjustment: { opponentSuit: 1 } }),
    ).toBe(false); // 方块无挡张
  });

  it('扣叫花色 / 敌方花色排除条件', () => {
    const hand = parseHand('SA2 HKQJ D543 C8762');
    expect(checkConditions(hand, { cueBidSuitNot: 'H' }, normal, { cueBidSuit: 'S' })).toBe(true);
    expect(checkConditions(hand, { cueBidSuitNot: 'H' }, normal, { cueBidSuit: 'H' })).toBe(false);
    expect(checkConditions(hand, { cueBidSuitNot: 'H' }, normal)).toBe(false); // 无扣叫上下文
    expect(checkConditions(hand, { opponentSuitNot: 'H' }, normal, { adjustment: { opponentSuit: 3 } })).toBe(true);
    expect(checkConditions(hand, { opponentSuitNot: 'H' }, normal, { adjustment: { opponentSuit: 2 } })).toBe(false);
    expect(checkConditions(hand, { opponentSuitNot: 'H' }, normal)).toBe(false); // 无对手花色上下文
  });

  it('进程上下文条件：扣叫 / 最后叫品 / 自然新花', () => {
    const hand = parseHand('SAKQ2 HJT9 D543 C876');
    expect(checkConditions(hand, { partnerCueBid: true }, normal, { partnerCueBid: true })).toBe(true);
    expect(checkConditions(hand, { partnerCueBid: true }, normal, { partnerCueBid: false })).toBe(false);
    expect(checkConditions(hand, { partnerCueBid: false }, normal, {})).toBe(true); // 未定义按 false
    expect(
      checkConditions(hand, { cueBidLevel: '3', cueBidSuit: 'S' }, normal, { cueBidLevel: 3, cueBidSuit: 'S' }),
    ).toBe(true);
    expect(
      checkConditions(hand, { cueBidLevel: '2' }, normal, { cueBidLevel: 3, cueBidSuit: 'S' }),
    ).toBe(false);
    expect(
      checkConditions(hand, { lastBidSuit: 'NT', lastBidLevel: '3' }, normal, { lastBidSuit: 'NT', lastBidLevel: 3 }),
    ).toBe(true);
    expect(
      checkConditions(hand, { partnerSuit: 'H' }, normal, { partnerSuit: 'H', partnerNaturalSuit: true }),
    ).toBe(true);
    expect(
      checkConditions(hand, { partnerForcingNewSuit: true }, normal, { partnerForcingNewSuit: true }),
    ).toBe(true);
    expect(checkConditions(hand, { partnerForcingNewSuit: true }, normal, {})).toBe(false);
  });

  it('联手 A 数：自己 A + 同伴 Blackwood 应答', () => {
    const oneAce = parseHand('SAKQ2 HJT9 D543 C876'); // 1 A
    expect(checkConditions(oneAce, { combinedAces: '3+' }, normal, { partnerAcesShown: 2 })).toBe(true);
    expect(checkConditions(oneAce, { combinedAces: '4+' }, normal, { partnerAcesShown: 2 })).toBe(false);
    // 5C 是 0/4 模糊应答：自己 0 A 时按 4 A 处理
    const noAce = parseHand('SKQJ2 HJT9 DQJ4 CQ76');
    expect(
      checkConditions(noAce, { combinedAces: '4+' }, normal, {
        partnerAcesShown: 0,
        partnerAcesAmbiguous: true,
      }),
    ).toBe(true);
    expect(checkConditions(oneAce, { combinedAces: '3+' }, normal, {})).toBe(false); // 无应答上下文
  });

  it('具体度 = 指定条件数量', () => {
    expect(conditionSpecificity({})).toBe(0);
    expect(conditionSpecificity({ hcp: '16-40' })).toBe(1);
    expect(conditionSpecificity({ hcp: '16-40', balanced: true })).toBe(2);
  });
});
