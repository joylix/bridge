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

  it('具体度 = 指定条件数量', () => {
    expect(conditionSpecificity({})).toBe(0);
    expect(conditionSpecificity({ hcp: '16-40' })).toBe(1);
    expect(conditionSpecificity({ hcp: '16-40', balanced: true })).toBe(2);
  });
});
