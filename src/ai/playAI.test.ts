import { describe, expect, it } from 'vitest';
import { playAI } from './playAI';
import { parseHand, history } from '../testing/testUtils';
import { loadLeadRules } from '../engine/loader';
import { makeRng } from '../engine/arbiter';
import { isCardLegal } from '../core/playing';
import { getSuit } from '../models/card';
import type { CardPlay, Contract } from '../models/gameState';

const leads = loadLeadRules('leads');

const ntContract: Contract = { level: 3, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };

describe('打牌 AI（playAI）', () => {
  it('首攻返回手中的合法牌；NT 走 YAML 首攻约定', () => {
    const hand = parseHand('SAKQ2 HJT98 D543 C87');
    const card = playAI(hand, null, [], null, 'W', ntContract, 0, leads, 1, { rng: makeRng(3) });
    expect(hand).toContain(card);
  });

  it('跟牌必须跟出领出花色', () => {
    const hand = parseHand('SAKQ2 HJT98 D543 C87');
    const lead: CardPlay = { position: 'W', card: parseHand('S5')[0] }; // 领出黑桃
    const card = playAI(hand, null, [lead], null, 'N', ntContract, 0, leads, 1, { rng: makeRng(3) });
    expect(getSuit(card)).toBe(3); // 必须出黑桃
    expect(isCardLegal(card, hand, 3)).toBe(true);
  });

  it('缺门时可以垫牌/将吃（不强制）', () => {
    const hand = parseHand('HKQ2 HJT9 D543 C87'); // 无黑桃
    const lead: CardPlay = { position: 'W', card: parseHand('SA')[0] };
    const card = playAI(hand, null, [lead], null, 'N', ntContract, 0, leads, 1, { rng: makeRng(3) });
    expect(isCardLegal(card, hand, 3)).toBe(true);
  });

  it('第四家能赢则用最小赢张', () => {
    const hand = parseHand('SKQJ2 H432 D432 C32'); // 有黑桃 KQJ
    const trick: CardPlay[] = [
      { position: 'W', card: parseHand('S5')[0] },
      { position: 'W', card: parseHand('S9')[0] },
      { position: 'W', card: parseHand('S4')[0] },
    ];
    const card = playAI(hand, null, trick, null, 'S', ntContract, 0, leads, 1, { rng: makeRng(3) });
    // 当前最大为黑桃 9，最小能赢的牌为 J（rank 9）
    expect(card).toBe(parseHand('SJ')[0]);
  });

  it('将牌可将吃赢过大牌', () => {
    const trumpContract: Contract = { level: 2, suit: 'H', doubled: false, redoubled: false, declarer: 'E', dummy: 'W' };
    const hand = parseHand('H2 D432 C5432 C87'); // 无黑桃，仅 H2 为将牌
    const trick: CardPlay[] = [
      { position: 'S', card: parseHand('SA')[0] },
      { position: 'W', card: parseHand('S3')[0] },
      { position: 'N', card: parseHand('S4')[0] },
    ];
    const card = playAI(hand, null, trick, 2, 'E', trumpContract, 0, leads, 1, { rng: makeRng(3) });
    expect(card).toBe(parseHand('H2')[0]); // 缺门 → 用最小将牌将吃赢墩
  });

  it('跟牌张数信号：该花色偶数张先打较大信号张（先大后小）', () => {
    const hand = parseHand('S84 HAKQ DAKQ CAKQ');
    const lead: CardPlay = { position: 'S', card: parseHand('S5')[0] }; // 庄家领出
    const card = playAI(hand, null, [lead], null, 'E', ntContract, 0, leads, 1, { rng: makeRng(3) });
    expect(card).toBe(parseHand('S8')[0]);
  });

  it('跟牌张数信号：该花色奇数张先打最小牌（先小后大）', () => {
    const hand = parseHand('S842 HAKQ DAKQ CAKQ');
    const lead: CardPlay = { position: 'S', card: parseHand('S5')[0] }; // 庄家领出
    const card = playAI(hand, null, [lead], null, 'E', ntContract, 0, leads, 1, { rng: makeRng(3) });
    expect(card).toBe(parseHand('S2')[0]);
  });

  it('庄家侧跟牌不发张数信号，按最小牌出', () => {
    const hand = parseHand('S84 HAKQ DAKQ CAKQ');
    const lead: CardPlay = { position: 'W', card: parseHand('S5')[0] }; // 防守方领出
    const card = playAI(hand, null, [lead], null, 'N', ntContract, 0, leads, 1, { rng: makeRng(3) });
    expect(card).toBe(parseHand('S4')[0]);
  });

  it('NT 定约无长套时，首攻敌方未叫过的高花', () => {
    const hand = parseHand('SAQ76 H54 D932 C8642'); // 四门均 ≤4 张
    const card = playAI(hand, null, [], null, 'W', ntContract, 0, leads, 1, {
      rng: makeRng(3),
      biddingHistory: history(['S', '2H']), // 定约方叫过红桃，黑桃未叫
    });
    expect(getSuit(card)).toBe(3);
    expect(card).toBe(parseHand('S6')[0]); // 黑桃长四
  });

  it('NT 定约持有长套时，首攻长套而不是未叫高花', () => {
    const hand = parseHand('SAQ76 H54 D98765 C86'); // 方块 5 张
    const card = playAI(hand, null, [], null, 'W', ntContract, 0, leads, 1, {
      rng: makeRng(3),
      biddingHistory: history(['S', '2H']),
    });
    expect(getSuit(card)).toBe(1);
    expect(card).toBe(parseHand('D6')[0]); // 方块长四
  });

  it('NT 首攻的“未叫高花”约定只对防守方生效', () => {
    const hand = parseHand('SAQ7 H543 D876 C9876');
    const card = playAI(hand, null, [], null, 'N', ntContract, 0, leads, 1, {
      rng: makeRng(3),
      biddingHistory: history(['E', '2H']),
    });
    expect(getSuit(card)).toBe(0); // 庄家侧不走该约定，改攻最长套（梅花）
  });

  it('无将垫牌：从最不鼓励（最弱）的花色垫最小牌', () => {
    const hand = parseHand('SAKQ D7654 C98'); // 无红桃
    const lead: CardPlay = { position: 'S', card: parseHand('H5')[0] }; // 庄家领出
    const card = playAI(hand, null, [lead], null, 'E', ntContract, 0, leads, 1, { rng: makeRng(3) });
    // 方块与梅花均无大牌；方块更长，优先保留梅花 → 垫方块最小牌
    expect(card).toBe(parseHand('D4')[0]);
  });

  it('有将定约：用无损失高信号张垫牌，鼓励同伴攻该花色', () => {
    const trumpContract: Contract = { level: 2, suit: 'H', doubled: false, redoubled: false, declarer: 'E', dummy: 'W' };
    const hand = parseHand('H32 DAK98 C7654'); // 无黑桃；方块有力量且有 8/9 信号张
    const lead: CardPlay = { position: 'S', card: parseHand('S5')[0] };
    const card = playAI(hand, null, [lead], 2, 'N', trumpContract, 0, leads, 1, { rng: makeRng(3) });
    expect(card).toBe(parseHand('D9')[0]);
  });

  it('有将定约：没有无损失信号张时回退到最弱花色垫最小牌', () => {
    const trumpContract: Contract = { level: 2, suit: 'H', doubled: false, redoubled: false, declarer: 'E', dummy: 'W' };
    const hand = parseHand('H32 DAKQJ C7654'); // 方块只有大牌，无 8/9/10 可垫
    const lead: CardPlay = { position: 'S', card: parseHand('S5')[0] };
    const card = playAI(hand, null, [lead], 2, 'N', trumpContract, 0, leads, 1, { rng: makeRng(3) });
    expect(card).toBe(parseHand('C4')[0]);
  });
});
