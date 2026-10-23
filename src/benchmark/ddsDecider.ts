/**
 * 基准测试用的同步 DDS 出牌决策器。
 *
 * 浏览器中 DDS 跑在 Web Worker；基准脚本在 Node 中直接调用同一份 WASM，
 * 复用完全相同的“隐藏牌抽样 + 汇总”逻辑，避免两套算法漂移。
 */

import { Dds, loadDds } from 'bridge-dds';
import type { DdsPlaySample, DdsPlaySampleResult } from '../ai/dds/types';
import { chooseDdsPlaySync, type PlayObjective } from '../ai/dds/play';
import type { PlayDecider } from './benchmark';

export interface DdsDeciderOptions {
  /** 每步抽样的隐藏牌分布数；越大越稳但越慢，默认 8 */
  samples?: number;
  useAuctionHcp?: boolean;
  /** 是否用叫牌规则约束隐藏牌；默认开启 */
  useAuctionConstraints?: boolean;
  /** 是否用首攻约定约束隐藏牌；默认开启 */
  useLeadInference?: boolean;
  /** tricks=只看平均墩数；contract=优先成约/击宕（默认） */
  objective?: PlayObjective;
}

export async function createDdsPlayDecider(options: DdsDeciderOptions = {}): Promise<PlayDecider> {
  const module = await loadDds();
  const dds = new Dds(module);

  return (context) => {
    const decision = chooseDdsPlaySync({
      hand: context.hand,
      dummyHand: context.dummyHand,
      currentTrick: context.currentTrick,
      tricks: context.tricks,
      position: context.position,
      contract: context.contract,
      legalCards: context.legalCards,
      biddingHistory: context.biddingHistory,
      biddingRules: context.biddingRules,
      styles: context.styles,
      trustedBiddingSeats: ['N', 'E', 'S', 'W'],
      rng: context.rng,
      preferred: context.fallback,
      samples: options.samples ?? 8,
      useAuctionHcp: options.useAuctionHcp ?? true,
      useAuctionConstraints: options.useAuctionConstraints ?? true,
      useLeadInference: options.useLeadInference ?? true,
      objective: options.objective ?? 'contract',
      solver: (samples: DdsPlaySample[]): DdsPlaySampleResult[] =>
        samples.map((sample) => {
          const future = dds.SolveBoardPBN(
            {
              trump: sample.trump,
              first: sample.first,
              currentTrickSuit: sample.currentTrickSuit,
              currentTrickRank: sample.currentTrickRank,
              remainCards: sample.remainCards,
            },
            -1,
            3,
            0,
          );
          const cards = [];
          for (let i = 0; i < future.cards; i++) {
            cards.push({
              suit: future.suit[i],
              rank: future.rank[i],
              equals: future.equals[i],
              score: future.score[i],
            });
          }
          return { cards };
        }),
    });
    return decision?.card ?? context.fallback;
  };
}
