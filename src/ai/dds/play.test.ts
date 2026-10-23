import { describe, expect, it } from 'vitest';
import type { BidRecord, Contract } from '../../models/gameState';
import { getCard, getSuit } from '../../models/card';
import { makeRng } from '../../engine/arbiter';
import { parsePbnDeal } from '../../core/pbn';
import type { Hand } from '../../models/hand';
import {
  aggregatePlayResults,
  buildDdsPlaySample,
  inferHcpRanges,
  inferVoidSuits,
  playObjectiveInfo,
  sampleHiddenHands,
} from './play';
import type { DdsPlaySampleResult } from './types';

const SAMPLE_PBN =
  'N:5.J653.Q64.KJT74 KT64.Q72.AJ5.A62 J3.AKT98.K832.Q3 AQ9872.4.T97.985';

const CONTRACT: Contract = {
  level: 1,
  suit: 'NT',
  doubled: false,
  redoubled: false,
  declarer: 'N',
  dummy: 'S',
};

function allCards(hands: Record<string, Hand>): number[] {
  return Object.values(hands).flat();
}

describe('隐藏牌抽样', () => {
  it('首攻时只公开自己手牌，三家未知牌按 13 张分配', () => {
    const hands = parsePbnDeal(SAMPLE_PBN).hands;
    const samples = sampleHiddenHands({
      hand: hands.E,
      dummyHand: null,
      currentTrick: [],
      tricks: [],
      position: 'E',
      contract: CONTRACT,
      samples: 5,
      rng: makeRng(1),
    });
    expect(samples).toHaveLength(5);
    for (const sample of samples) {
      expect(sample.E).toEqual(hands.E);
      for (const seat of ['N', 'E', 'S', 'W'] as const) expect(sample[seat]).toHaveLength(13);
      const cards = allCards(sample);
      expect(cards).toHaveLength(52);
      expect(new Set(cards).size).toBe(52);
    }
  });

  it('明手摊开后，残局样本排除当前墩已出的牌，张数正确', () => {
    const hands = parsePbnDeal(SAMPLE_PBN).hands;
    const lead = getCard(3, 2); // ♠4，东家首攻
    const samples = sampleHiddenHands({
      hand: hands.S,
      dummyHand: hands.S,
      currentTrick: [{ position: 'E', card: lead }],
      tricks: [],
      position: 'S',
      contract: CONTRACT,
      samples: 5,
      rng: makeRng(2),
    });
    for (const sample of samples) {
      expect(sample.E).toHaveLength(12);
      expect(sample.N).toHaveLength(13);
      expect(sample.S).toHaveLength(13);
      expect(sample.W).toHaveLength(13);
      expect(allCards(sample)).not.toContain(lead);
      expect(sample.S).toEqual(hands.S);
      expect(new Set(allCards(sample)).size).toBe(51);
    }
  });

  it('叫牌 HCP 下界过严时自动退回无约束抽样', () => {
    const hands = parsePbnDeal(SAMPLE_PBN).hands;
    // 实际北家只有 7 HCP，却伪造“北家开叫 1NT”的历史：约束无解，应仍能出样本
    const history: BidRecord[] = [{ position: 'N', call: { type: 'bid', level: 1, suit: 'NT' } }];
    const samples = sampleHiddenHands({
      hand: hands.E,
      dummyHand: null,
      currentTrick: [],
      tricks: [],
      position: 'E',
      contract: CONTRACT,
      biddingHistory: history,
      samples: 3,
      rng: makeRng(3),
    });
    expect(samples).toHaveLength(3);
  });

  it('从已完成的墩推断缺门，并在抽样中排除该花色', () => {
    const hands = parsePbnDeal(SAMPLE_PBN).hands;
    const contract: Contract = {
      level: 1,
      suit: 'NT',
      doubled: false,
      redoubled: false,
      declarer: 'E',
      dummy: 'W',
    };
    // E 领出 ♠K，S 垫 ♥2：S 已确定黑桃缺门。
    const trick = {
      plays: [
        { position: 'E' as const, card: getCard(3, 11) },
        { position: 'S' as const, card: getCard(2, 0) },
        { position: 'W' as const, card: getCard(3, 12) },
        { position: 'N' as const, card: getCard(3, 3) },
      ],
      leader: 'E' as const,
      winner: 'E' as const,
    };
    const voids = inferVoidSuits([trick], []);
    expect(voids.S.has(3)).toBe(true);
    expect(voids.W.has(3)).toBe(false);

    const northHand = hands.N.filter((card) => card !== getCard(3, 3));
    const dummyHand = hands.W.filter((card) => card !== getCard(3, 12));
    const samples = sampleHiddenHands({
      hand: northHand,
      dummyHand,
      currentTrick: [],
      tricks: [trick],
      position: 'N',
      contract,
      samples: 20,
      rng: makeRng(7),
    });

    expect(samples).toHaveLength(20);
    for (const sample of samples) {
      expect(sample.S.some((card) => getSuit(card) === 3)).toBe(false);
    }
  });

  it('叫牌历史可推断宽松的 HCP 下界', () => {
    const ranges = inferHcpRanges([
      { position: 'N', call: { type: 'bid', level: 1, suit: 'NT' } },
      { position: 'E', call: { type: 'double' } },
      { position: 'S', call: { type: 'bid', level: 3, suit: 'S' } },
      { position: 'W', call: { type: 'pass' } },
    ]);
    expect(ranges.N.min).toBe(12);
    expect(ranges.E.min).toBe(8);
    expect(ranges.S.min).toBe(4);
    expect(ranges.W.min).toBe(0);
  });
});

describe('DDS 打牌输入与汇总', () => {
  it('从当前墩生成 DDS 残局输入', () => {
    const hands = parsePbnDeal(SAMPLE_PBN).hands;
    const lead = getCard(3, 2); // ♠4
    hands.E = hands.E.filter((card) => card !== lead);
    const sample = buildDdsPlaySample(
      hands,
      'S',
      [{ position: 'E', card: lead }],
      CONTRACT,
    );
    expect(sample.first).toBe(1); // DDS East
    expect(sample.trump).toBe(4); // NT
    expect(sample.currentTrickSuit.slice(0, 1)).toEqual([0]);
    expect(sample.currentTrickRank.slice(0, 1)).toEqual([4]);
    expect(sample.remainCards.startsWith('E:')).toBe(true);
  });

  it('按最高分候选得票选择，平票时优先启发式牌', () => {
    const spade5 = getCard(3, 3); // ♠5
    const heart3 = getCard(2, 1); // ♥3
    const results: DdsPlaySampleResult[] = [
      { cards: [{ suit: 0, rank: 5, equals: 0, score: 5 }, { suit: 1, rank: 3, equals: 0, score: 4 }] },
      { cards: [{ suit: 0, rank: 5, equals: 0, score: 6 }, { suit: 1, rank: 3, equals: 0, score: 3 }] },
    ];
    const decision = aggregatePlayResults(results, [spade5, heart3], heart3);
    expect(decision?.card).toBe(spade5);
    expect(decision?.solved).toBe(2);

    const tie: DdsPlaySampleResult[] = [
      { cards: [{ suit: 0, rank: 5, equals: 0, score: 5 }, { suit: 1, rank: 3, equals: 0, score: 5 }] },
    ];
    expect(aggregatePlayResults(tie, [spade5, heart3], heart3)?.card).toBe(heart3);
  });

  it('按平均可得墩数汇总，而不是只看最高分得票', () => {
    const spadeAce = getCard(3, 12);
    const spadeKing = getCard(3, 11);
    const results: DdsPlaySampleResult[] = [
      {
        cards: [
          { suit: 0, rank: 14, equals: 0, score: 9 },
          { suit: 0, rank: 13, equals: 0, score: 10 },
        ],
      },
      {
        cards: [
          { suit: 0, rank: 14, equals: 0, score: 9 },
          { suit: 0, rank: 13, equals: 0, score: 10 },
        ],
      },
      {
        cards: [
          { suit: 0, rank: 14, equals: 0, score: 12 },
          { suit: 0, rank: 13, equals: 0, score: 9 },
        ],
      },
    ];
    // 平均墩数：A=10，K=9.67，单纯看墩数应选 A。
    expect(aggregatePlayResults(results, [spadeAce, spadeKing], spadeKing)?.card).toBe(spadeAce);
  });

  it('按定约成败优先选择，成约概率更高的牌可优于平均墩数更高的牌', () => {
    const spadeAce = getCard(3, 12);
    const spadeKing = getCard(3, 11);
    const results: DdsPlaySampleResult[] = [
      {
        cards: [
          { suit: 0, rank: 14, equals: 0, score: 9 },
          { suit: 0, rank: 13, equals: 0, score: 10 },
        ],
      },
      {
        cards: [
          { suit: 0, rank: 14, equals: 0, score: 9 },
          { suit: 0, rank: 13, equals: 0, score: 10 },
        ],
      },
      {
        cards: [
          { suit: 0, rank: 14, equals: 0, score: 12 },
          { suit: 0, rank: 13, equals: 0, score: 9 },
        ],
      },
    ];
    const contract: Contract = {
      level: 4,
      suit: 'S',
      doubled: false,
      redoubled: false,
      declarer: 'S',
      dummy: 'N',
    };
    const info = playObjectiveInfo(contract, [], 'S');
    expect(info).toMatchObject({
      playerSide: 'NS',
      declarerSide: 'NS',
      requiredTricks: 10,
      declarerTricksWon: 0,
      futureTricks: 13,
    });
    // A 平均 10 墩但只有 1/3 成约；K 平均 9.67 墩但 2/3 成约。
    expect(aggregatePlayResults(results, [spadeAce, spadeKing], spadeKing, info)?.card).toBe(
      spadeKing,
    );
  });

  it('等值牌使用启发式偏好作为代表牌（保留信号张）', () => {
    const king = getCard(3, 11); // ♠K
    const queen = getCard(3, 10); // ♠Q
    const results: DdsPlaySampleResult[] = [
      {
        cards: [
          {
            suit: 0,
            rank: 13, // DDS ♠K
            equals: 1 << 12, // DDS ♠Q 等值
            score: 5,
          },
        ],
      },
    ];
    expect(aggregatePlayResults(results, [king, queen], queen)?.card).toBe(queen);
  });
});
