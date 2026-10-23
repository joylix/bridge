/**
 * 基于 DDS 的隐藏牌抽样打牌 AI。
 *
 * 关键约束：这里只能使用 AI 自己看到的牌（自己的手牌、已摊开的明手、已打出的牌），
 * 严禁读取其他三家的真实手牌。未知牌按剩余张数随机分配，并可用叫牌历史做宽松的
 * HCP 下界过滤；然后对每个合法分布做双明手求解，按候选牌得票选择。
 */

import type { BidRecord, CardPlay, Contract, Position, StyleLevel, Trick } from '../../models/gameState';
import { ORDER, getSide } from '../../models/gameState';
import type { Hand } from '../../models/hand';
import type { BiddingRule } from '../../engine/types';
import { getCard, getRank, getSuit, type SuitIndex } from '../../models/card';
import { hcp, suitLength } from '../../core/evaluate';
import { shuffle } from '../../core/deck';
import { toPbnHands } from '../../core/pbn';
import { buildAuctionConstraintList, type HandPredicate } from './auctionInference';
import { solvePlaySamples } from './client';
import type { DdsPlayCard, DdsPlaySample, DdsPlaySampleResult } from './types';
import { bidSuitToDds, ddsToRank, ddsToSuit, dealerToDds, rankToDds, suitToDds } from './types';

export interface HcpRange {
  min: number;
  max: number;
}

/**
 * 打牌目标：
 * - tricks：只比较期望可得墩数（旧行为）；
 * - contract：先保证定约成败，再比较超墩/宕墩，更接近复式赛的得分目标。
 */
export type PlayObjective = 'tricks' | 'contract';

export interface PlayObjectiveInfo {
  playerSide: 'NS' | 'EW';
  declarerSide: 'NS' | 'EW';
  requiredTricks: number;
  declarerTricksWon: number;
  /** 含当前墩在内的剩余墩数 */
  futureTricks: number;
}

export interface HiddenHandSampleOptions {
  /** AI 自己的当前手牌 */
  hand: Hand;
  /** 已摊开的明手；尚未摊开时传 null（公开空手必须传 []） */
  dummyHand: Hand | null;
  currentTrick: CardPlay[];
  tricks: Trick[];
  position: Position;
  contract: Contract;
  biddingHistory?: BidRecord[];
  /** 抽样数量，默认 12 */
  samples?: number;
  /** 每个未知座位的 HCP 过滤；默认开启 */
  useAuctionHcp?: boolean;
  /** 用叫牌规则承诺约束隐藏手牌；默认开启（需同时提供 biddingRules） */
  useAuctionConstraints?: boolean;
  /** 是否用首攻约定（低引通常承诺长度）做软约束；默认开启 */
  useLeadInference?: boolean;
  /** 当前叫牌规则；提供后才会启用规则级叫牌推断 */
  biddingRules?: BiddingRule[];
  /** 各座位风格，用于解析规则里的风格变量 */
  styles?: Partial<Record<Position, StyleLevel>>;
  /** 只信任这些座位的叫牌（通常排除人类座位） */
  trustedBiddingSeats?: Position[];
  rng: () => number;
}

export interface DdsPlayOptions extends HiddenHandSampleOptions {
  /** DDS 不可用/超时时的兜底牌（也用于平票时保持启发式偏好） */
  preferred: number;
  legalCards?: Hand;
  timeoutMs?: number;
  /** 默认 contract：优先成约/击宕，再考虑超墩或额外宕墩 */
  objective?: PlayObjective;
}

export interface DdsPlayDecision {
  card: number;
  samples: number;
  solved: number;
  /** 按综合收益从高到低，便于调试/测试 */
  votes: Array<{
    card: number;
    votes: number;
    scoreSum: number;
    meanScore: number;
    meanUtility: number;
    appearances: number;
  }>;
}

/** 可替换的 DDS 批量求解器：浏览器用 Worker，基准测试可注入同步 WASM 实现。 */
export type DdsPlaySolver = (samples: DdsPlaySample[]) => DdsPlaySampleResult[];

const SEATS: Position[] = ORDER;
const TOTAL_PER_SEAT = 13;

/**
 * 从叫牌历史推断每个座位的 HCP 下界。
 * 只使用非常宽松、几乎不会误伤真实牌型的下界，主要用于排除“明显不可能”的分布。
 */
export function inferHcpRanges(history: BidRecord[] = []): Record<Position, HcpRange> {
  const ranges = Object.fromEntries(
    SEATS.map((seat) => [seat, { min: 0, max: 37 }]),
  ) as Record<Position, HcpRange>;

  for (const record of history) {
    const range = ranges[record.position];
    let min = 0;
    if (record.call.type === 'bid') {
      const { level, suit } = record.call;
      if (suit === 'NT') {
        min = level === 2 ? 18 : level >= 3 ? 12 : 12;
      } else if (level >= 3) {
        min = 4;
      } else if (level === 2) {
        min = 6;
      } else {
        min = 6;
      }
    } else if (record.call.type === 'double' || record.call.type === 'redouble') {
      min = 8;
    }
    range.min = Math.max(range.min, min);
  }
  return ranges;
}

/** DDS 的 score 是“出牌方”在当前局面还能取得的墩数（含当前墩）。 */
export function playObjectiveInfo(
  contract: Contract,
  tricks: Trick[],
  position: Position,
): PlayObjectiveInfo {
  const declarerSide = getSide(contract.declarer);
  return {
    playerSide: getSide(position),
    declarerSide,
    requiredTricks: contract.level + 6,
    declarerTricksWon: tricks.filter((trick) => getSide(trick.winner) === declarerSide).length,
    futureTricks: 13 - tricks.length,
  };
}

/**
 * 把“还能取得的墩数”换算成带优先级的得分目标。
 * 成约/击宕远比超墩重要，因此用 10 分作为成败分界：
 * - 庄家：成约 10 + 超墩数；宕 N 墩为 −N；
 * - 防守方：击宕 10 + 额外宕墩数；让庄家成约 M 墩为 −(M+1)。
 */
export function contractUtility(score: number, info: PlayObjectiveInfo): number {
  const futureDeclarerTricks =
    info.playerSide === info.declarerSide ? score : info.futureTricks - score;
  const finalDeclarerTricks = info.declarerTricksWon + futureDeclarerTricks;

  if (info.playerSide === info.declarerSide) {
    return finalDeclarerTricks >= info.requiredTricks
      ? 10 + (finalDeclarerTricks - info.requiredTricks)
      : -(info.requiredTricks - finalDeclarerTricks);
  }
  return finalDeclarerTricks < info.requiredTricks
    ? 10 + (info.requiredTricks - 1 - finalDeclarerTricks)
    : -(finalDeclarerTricks - info.requiredTricks + 1);
}

/**
 * 从已完成的墩和当前墩推断“已确定缺门”的花色：
 * 某家在别人领出的花色上打出其他花色，说明该家从那时起已经没有这门牌。
 */
export function inferVoidSuits(
  tricks: Trick[],
  currentTrick: CardPlay[],
): Record<Position, Set<SuitIndex>> {
  const voids = Object.fromEntries(
    SEATS.map((seat) => [seat, new Set<SuitIndex>()]),
  ) as Record<Position, Set<SuitIndex>>;

  const trickPlays: CardPlay[][] = [
    ...tricks.map((trick) => trick.plays),
    ...(currentTrick.length > 0 ? [currentTrick] : []),
  ];
  for (const plays of trickPlays) {
    if (plays.length < 2) continue;
    const leadSuit = getSuit(plays[0].card);
    for (const play of plays.slice(1)) {
      if (getSuit(play.card) !== leadSuit) voids[play.position].add(leadSuit);
    }
  }
  return voids;
}

function cardsOfTricks(tricks: Trick[]): CardPlay[] {
  return tricks.flatMap((trick) => trick.plays);
}

function validateKnownCards(
  position: Position,
  hand: Hand,
  dummyHand: Hand | null,
  contract: Contract,
  currentTrick: CardPlay[],
  tricks: Trick[],
): {
  known: Partial<Record<Position, Hand>>;
  played: CardPlay[];
  playedBySeat: Record<Position, number>;
  playedBySeatCards: Record<Position, Hand>;
} {
  const known: Partial<Record<Position, Hand>> = { [position]: [...hand] };
  if (dummyHand !== null) {
    known[contract.dummy] = [...dummyHand];
  }

  const played = [...cardsOfTricks(tricks), ...currentTrick];
  const playedBySeat: Record<Position, number> = { N: 0, E: 0, S: 0, W: 0 };
  const playedBySeatCards: Record<Position, Hand> = { N: [], E: [], S: [], W: [] };
  const seen = new Set<number>();

  for (const play of played) {
    if (!Number.isInteger(play.card) || play.card < 0 || play.card > 51) {
      throw new Error(`非法牌号: ${play.card}`);
    }
    if (seen.has(play.card)) throw new Error(`同一张牌被打出两次: ${play.card}`);
    seen.add(play.card);
    playedBySeat[play.position] += 1;
    playedBySeatCards[play.position].push(play.card);
  }

  for (const seat of SEATS) {
    const cards = known[seat];
    if (!cards) continue;
    for (const card of cards) {
      if (!Number.isInteger(card) || card < 0 || card > 51) {
        throw new Error(`非法牌号: ${card}`);
      }
      if (seen.has(card)) throw new Error(`已知手牌与已打出的牌重复: ${card}`);
      seen.add(card);
    }
    const expected = TOTAL_PER_SEAT - playedBySeat[seat];
    if (cards.length !== expected) {
      throw new Error(`${seat} 家剩余张数异常：期望 ${expected}，实际 ${cards.length}`);
    }
  }

  return { known, played, playedBySeat, playedBySeatCards };
}

/**
 * 生成合法的隐藏牌分布。每个分布只包含四家“剩余牌”（不含当前墩已出的牌），
 * 张数与已打出的牌严格对应。
 */
export function sampleHiddenHands(options: HiddenHandSampleOptions): Record<Position, Hand>[] {
  const {
    hand,
    dummyHand,
    currentTrick,
    tricks,
    position,
    contract,
    biddingHistory = [],
    samples = 12,
    useAuctionHcp = true,
    useAuctionConstraints = true,
    useLeadInference = true,
    biddingRules,
    styles,
    trustedBiddingSeats,
    rng,
  } = options;

  const { known, played, playedBySeat, playedBySeatCards } = validateKnownCards(
    position,
    hand,
    dummyHand,
    contract,
    currentTrick,
    tricks,
  );

  const knownCards = new Set<number>();
  for (const seat of SEATS) {
    for (const card of known[seat] ?? []) knownCards.add(card);
  }
  for (const play of played) knownCards.add(play.card);

  const unseen = Array.from({ length: 52 }, (_, card) => card).filter((card) => !knownCards.has(card));
  const unknownSeats = SEATS.filter((seat) => known[seat] === undefined);
  const counts = Object.fromEntries(
    unknownSeats.map((seat) => [seat, TOTAL_PER_SEAT - playedBySeat[seat]]),
  ) as Record<Position, number>;

  const expectedUnseen = unknownSeats.reduce((sum, seat) => sum + counts[seat], 0);
  if (expectedUnseen !== unseen.length) {
    throw new Error(`剩余牌数不匹配：未知手牌 ${expectedUnseen} 张，未知牌 ${unseen.length} 张`);
  }

  const ranges = inferHcpRanges(biddingHistory);
  const voids = inferVoidSuits(tricks, currentTrick);
  const auctionConstraints: Partial<Record<Position, HandPredicate[]>> =
    useAuctionConstraints && biddingRules && biddingRules.length > 0
      ? buildAuctionConstraintList(biddingHistory, {
          rules: biddingRules,
          styles,
          trustedSeats: trustedBiddingSeats,
        })
      : {};

  /**
   * 生成一个满足缺门约束的均匀分布。
   *
   * 先在可选牌最少的座位发牌，避免“无约束座位先拿走缺门座位唯一可用的牌”。
   * HCP 与叫牌规则约束不在生成阶段硬拒绝，而是作为后验权重（见下），
   * 这样即使真实牌型是低概率的轻开叫/心理叫，也不会被完全排除。
   */
  const buildBase = (enforceVoids: boolean): Record<Position, Hand> | null => {
    const pool = shuffle(unseen, rng);
    const result = { ...known } as Record<Position, Hand>;

    const eligibleCount = (seat: Position): number =>
      enforceVoids
        ? pool.reduce(
            (sum, card) => sum + (voids[seat].has(getSuit(card)) ? 0 : 1),
            0,
          )
        : pool.length;
    const order = [...unknownSeats].sort((a, b) => eligibleCount(a) - eligibleCount(b));

    for (const seat of order) {
      const count = counts[seat];
      const eligible = enforceVoids
        ? pool.filter((card) => !voids[seat].has(getSuit(card)))
        : pool;
      if (eligible.length < count) return null;
      const cards = shuffle(eligible, rng).slice(0, count);
      const chosen = new Set(cards);
      for (let i = pool.length - 1; i >= 0; i--) {
        if (chosen.has(pool[i])) pool.splice(i, 1);
      }
      result[seat] = cards;
    }
    return pool.length === 0 ? result : null;
  };

  // 先生成一池均匀分布，再按叫牌/规则/缺门信息做加权重采样。
  // 池子只做 shuffle，成本远低于 DDS；多生成一些样本可显著提高后验质量。
  const poolSize = Math.max(samples * 40, 240);
  const candidateDeals: Record<Position, Hand>[] = [];
  const fillPool = (enforceVoids: boolean): void => {
    const maxAttempts = poolSize * 4;
    for (let attempt = 0; attempt < maxAttempts && candidateDeals.length < poolSize; attempt++) {
      const deal = buildBase(enforceVoids);
      if (deal) candidateDeals.push(deal);
    }
  };
  fillPool(true);
  if (candidateDeals.length === 0) fillPool(false);
  if (candidateDeals.length === 0) {
    throw new Error('无法生成隐藏牌分布：未知牌数或缺门约束异常');
  }

  // 首攻信息：低引通常来自 4 张以上长套（第四张）。这只是软约束，
  // 因为单张首攻、三张套首攻在实战中同样存在。
  const openingLead: CardPlay | undefined =
    tricks.length > 0 ? tricks[0].plays[0] : currentTrick[0];
  const leadInference =
    useLeadInference &&
    openingLead !== undefined &&
    unknownSeats.includes(openingLead.position) &&
    (trustedBiddingSeats === undefined || trustedBiddingSeats.includes(openingLead.position)) &&
    getSide(openingLead.position) !== getSide(contract.declarer)
      ? {
          position: openingLead.position,
          suit: getSuit(openingLead.card),
        }
      : null;

  const weightOf = (deal: Record<Position, Hand>): number => {
    let weight = 1;
    for (const seat of unknownSeats) {
      // 叫牌发生在打牌之前，因此“初始 13 张”= 当前剩余牌 + 该家已打出的牌。
      const fullHand = [...deal[seat], ...playedBySeatCards[seat]];
      if (
        useAuctionHcp &&
        (trustedBiddingSeats === undefined || trustedBiddingSeats.includes(seat))
      ) {
        const range = ranges[seat];
        const points = hcp(fullHand);
        if (points < range.min) weight *= Math.exp(-(range.min - points) * 0.8);
        else if (points > range.max) weight *= Math.exp(-(points - range.max) * 0.8);
      }
      const tests = auctionConstraints[seat];
      if (tests?.length) {
        let failed = 0;
        for (const test of tests) {
          if (!test(fullHand)) failed += 1;
        }
        if (failed > 0) weight *= 0.08 ** failed;
      }
      if (leadInference && seat === leadInference.position) {
        // 低引通常来自 4 张以上长套（第四张）。这只是软约束：
        // 三张套首攻、单张首攻在实战中同样存在，因此不可过度惩罚。
        const length = suitLength(fullHand, leadInference.suit);
        if (length >= 4) weight *= 1;
        else if (length === 3) weight *= 0.85;
        else if (length === 2) weight *= 0.6;
        else weight *= 0.7;
      }
    }
    return weight;
  };

  const candidates = candidateDeals.map((deal) => ({ deal, weight: weightOf(deal) }));
  const result: Record<Position, Hand>[] = [];
  while (result.length < samples && candidates.length > 0) {
    const total = candidates.reduce((sum, entry) => sum + entry.weight, 0);
    if (!(total > 0)) {
      const index = Math.floor(rng() * candidates.length);
      result.push(candidates[index].deal);
      candidates.splice(index, 1);
      continue;
    }
    let pick = rng() * total;
    let index = 0;
    while (index < candidates.length - 1 && pick >= candidates[index].weight) {
      pick -= candidates[index].weight;
      index += 1;
    }
    result.push(candidates[index].deal);
    candidates.splice(index, 1);
  }

  // 极端情况下样本数大于候选池：允许重复抽取，保证 DDS 始终有输入。
  while (result.length < samples) {
    result.push(candidateDeals[Math.floor(rng() * candidateDeals.length)]);
  }
  return result;
}

/** 把一次抽样转换为 DDS 残局输入。 */
export function buildDdsPlaySample(
  hands: Record<Position, Hand>,
  position: Position,
  currentTrick: CardPlay[],
  contract: Contract,
): DdsPlaySample {
  const first = currentTrick.length === 0 ? position : currentTrick[0].position;
  const currentTrickSuit = [0, 0, 0];
  const currentTrickRank = [0, 0, 0];
  currentTrick.slice(0, 3).forEach((play, index) => {
    currentTrickSuit[index] = suitToDds(getSuit(play.card));
    currentTrickRank[index] = rankToDds(getRank(play.card));
  });
  return {
    remainCards: toPbnHands(hands, first),
    trump: bidSuitToDds(contract.suit),
    first: dealerToDds(first),
    currentTrickSuit,
    currentTrickRank,
  };
}

function cardFromDds(card: DdsPlayCard): number | null {
  if (card.suit < 0 || card.suit > 3 || card.rank < 2 || card.rank > 14) return null;
  return getCard(ddsToSuit(card.suit), ddsToRank(card.rank));
}

function representativeCard(card: DdsPlayCard, preferred: number, legal: Set<number>): number | null {
  const own = cardFromDds(card);
  if (own === null) return null;
  const preferredSuit = getSuit(preferred);
  const preferredRank = getRank(preferred) + 2;
  const sameSuit = ddsToSuit(card.suit) === preferredSuit;
  const isPreferredOrEqual =
    sameSuit && (card.rank === preferredRank || (card.equals & (1 << preferredRank)) !== 0);
  if (isPreferredOrEqual && legal.has(preferred)) return preferred;
  if (legal.has(own)) return own;

  // DDS 用一张代表牌 + equals 位图表示等价牌；若代表牌不在合法牌中，
  // 从等价组里选一张合法牌，避免整组候选被丢弃。
  const suit = ddsToSuit(card.suit);
  const group: number[] = [];
  for (let ddsRank = 2; ddsRank <= 14; ddsRank++) {
    if (ddsRank !== card.rank && (card.equals & (1 << ddsRank)) === 0) continue;
    const candidate = getCard(suit, ddsToRank(ddsRank));
    if (legal.has(candidate)) group.push(candidate);
  }
  if (group.length === 0) return null;
  return group.sort((a, b) => getRank(a) - getRank(b))[0];
}

/**
 * 汇总各样本的 DDS 候选牌。
 *
 * 旧实现只统计“每个样本的最高分牌”得票，忽略了不同牌之间的墩数差距。
 * 现在按样本取平均收益：默认使用与定约成败绑定的 contractUtility，
 * 使机器人优先选择能成约/击宕的线路，再比较超墩或额外宕墩；
 * 也可传 objective=undefined 退化为“平均可得墩数”。
 * 完全平票时才采用启发式兜底牌，以保留信号张等约定。
 */
export function aggregatePlayResults(
  results: DdsPlaySampleResult[],
  legalCards: Hand,
  preferred: number,
  objective?: PlayObjectiveInfo,
): DdsPlayDecision | null {
  const legal = new Set(legalCards);
  const stats = new Map<
    number,
    { votes: number; scoreSum: number; utilitySum: number; appearances: number }
  >();
  let solved = 0;

  for (const result of results) {
    const scores = new Map<number, number>();
    for (const raw of result.cards) {
      const card = representativeCard(raw, preferred, legal);
      if (card === null) continue;
      // 同一等价组可能映射到同一张牌，取较高分。
      scores.set(card, Math.max(scores.get(card) ?? -Infinity, raw.score));
    }
    if (scores.size === 0) continue;
    solved += 1;
    const maxScore = Math.max(...scores.values());
    const best = new Set(
      [...scores.entries()].filter(([, score]) => score === maxScore).map(([card]) => card),
    );

    for (const card of legalCards) {
      // DDS 会返回全部合法牌；若因等价牌映射缺失，按“比本样本最佳少 2 墩”
      // 做一个保守惩罚，避免偶然出现一次的高分牌被高估。
      const score = scores.get(card) ?? maxScore - 2;
      const utility = objective ? contractUtility(score, objective) : score;
      const current = stats.get(card) ?? {
        votes: 0,
        scoreSum: 0,
        utilitySum: 0,
        appearances: 0,
      };
      current.scoreSum += score;
      current.utilitySum += utility;
      if (scores.has(card)) current.appearances += 1;
      if (best.has(card)) current.votes += 1 / best.size;
      stats.set(card, current);
    }
  }

  if (stats.size === 0 || solved === 0) return null;

  const denominator = Math.max(1, results.length);
  const votes = [...stats.entries()]
    .map(([card, stat]) => ({
      card,
      ...stat,
      meanScore: stat.scoreSum / denominator,
      meanUtility: stat.utilitySum / denominator,
    }))
    .sort(
      (a, b) =>
        b.meanUtility - a.meanUtility ||
        b.votes - a.votes ||
        b.meanScore - a.meanScore ||
        b.appearances - a.appearances ||
        (a.card === preferred ? -1 : b.card === preferred ? 1 : 0) ||
        a.card - b.card,
    );

  return { card: votes[0].card, samples: results.length, solved, votes };
}

/**
 * 抽样 → DDS 批量求解 → 汇总。DDS 不可用或全部样本失败时返回 null，
 * 由调用方无缝回退到现有启发式。
 */
export async function chooseDdsPlay(options: DdsPlayOptions): Promise<DdsPlayDecision | null> {
  const {
    hand,
    dummyHand,
    currentTrick,
    tricks,
    position,
    contract,
    biddingHistory = [],
    samples = 12,
    useAuctionHcp = true,
    useAuctionConstraints = true,
    useLeadInference = true,
    biddingRules,
    styles,
    trustedBiddingSeats,
    rng,
    preferred,
    legalCards,
    timeoutMs,
    objective = 'contract',
  } = options;

  const legal =
    legalCards ??
    (currentTrick.length === 0
      ? hand
      : hand.filter((card) => getSuit(card) === getSuit(currentTrick[0].card)));
  if (legal.length <= 1) return null;

  let distributions: Record<Position, Hand>[];
  try {
    distributions = sampleHiddenHands({
      hand,
      dummyHand,
      currentTrick,
      tricks,
      position,
      contract,
      biddingHistory,
      samples,
      useAuctionHcp,
      useAuctionConstraints,
      useLeadInference,
      biddingRules,
      styles,
      trustedBiddingSeats,
      rng,
    });
  } catch {
    return null;
  }

  const ddsSamples = distributions.map((dist) =>
    buildDdsPlaySample(dist, position, currentTrick, contract),
  );
  let results: DdsPlaySampleResult[];
  try {
    results = await solvePlaySamples(ddsSamples, timeoutMs);
  } catch {
    return null;
  }
  const objectiveInfo =
    objective === 'contract' ? playObjectiveInfo(contract, tricks, position) : undefined;
  return aggregatePlayResults(results, legal, preferred, objectiveInfo);
}

/**
 * 同步版本，供无界面基准测试注入直接调用 WASM 的 solver。
 * 抽样/汇总逻辑与浏览器版本一致。
 */
export function chooseDdsPlaySync(
  options: DdsPlayOptions & { solver: DdsPlaySolver },
): DdsPlayDecision | null {
  const {
    hand,
    dummyHand,
    currentTrick,
    tricks,
    position,
    contract,
    biddingHistory = [],
    samples = 12,
    useAuctionHcp = true,
    useAuctionConstraints = true,
    useLeadInference = true,
    biddingRules,
    styles,
    trustedBiddingSeats,
    rng,
    preferred,
    legalCards,
    solver,
    objective = 'contract',
  } = options;

  const legal =
    legalCards ??
    (currentTrick.length === 0
      ? hand
      : hand.filter((card) => getSuit(card) === getSuit(currentTrick[0].card)));
  if (legal.length <= 1) return null;

  let distributions: Record<Position, Hand>[];
  try {
    distributions = sampleHiddenHands({
      hand,
      dummyHand,
      currentTrick,
      tricks,
      position,
      contract,
      biddingHistory,
      samples,
      useAuctionHcp,
      useAuctionConstraints,
      useLeadInference,
      biddingRules,
      styles,
      trustedBiddingSeats,
      rng,
    });
  } catch {
    return null;
  }

  try {
    const results = solver(distributions.map((dist) => buildDdsPlaySample(dist, position, currentTrick, contract)));
    const objectiveInfo =
      objective === 'contract' ? playObjectiveInfo(contract, tricks, position) : undefined;
    return aggregatePlayResults(results, legal, preferred, objectiveInfo);
  } catch {
    return null;
  }
}

/** 供测试/调试：判断某个座位是否在定约方。 */
export function isDeclaringSide(position: Position, contract: Contract): boolean {
  return getSide(position) === getSide(contract.declarer);
}
