import type { Hand } from '../models/hand';
import type { BidRecord, CardPlay, Contract, Position, StyleLevel } from '../models/gameState';
import { getPartner, getSide } from '../models/gameState';
import type { LeadRule } from '../engine/types';
import { STYLE_PARAMS } from '../engine/types';
import { getLegalCards } from '../core/playing';
import { beatsCard, determineTrickWinner, getTrickWinnerCard } from '../core/trick';
import { getRank, getSuit, type SuitIndex } from '../models/card';
import { suitLength } from '../core/evaluate';
import { checkConditions } from '../engine/conditions';

export interface PlayAIOptions {
  rng?: () => number;
  /** 供“攻未叫高级花色”等首攻约定使用 */
  biddingHistory?: BidRecord[];
}

const ALL_SUITS: SuitIndex[] = [0, 1, 2, 3];

/**
 * 出牌决策。
 * - 首攻：由 YAML 首攻规则（leads.yml）驱动；
 * - 跟牌：硬编码基础启发式贪心算法；
 * - 任何情况下若结果不合法，降级为随机合法牌。
 */
export function playAI(
  hand: Hand,
  dummyHand: Hand | null,
  currentTrick: CardPlay[],
  trumpSuit: SuitIndex | null,
  position: Position,
  contract: Contract,
  tricksWonByDeclarer: number,
  leadRules: LeadRule[],
  style: StyleLevel,
  opts: PlayAIOptions = {},
): number {
  const rng = opts.rng ?? Math.random;
  const leadSuit = currentTrick.length === 0 ? null : getSuit(currentTrick[0].card);
  const legalCards = getLegalCards(hand, leadSuit, trumpSuit);
  if (legalCards.length === 1) return legalCards[0];

  let selected: number;
  if (currentTrick.length === 0) {
    selected = selectLead(hand, contract, trumpSuit, leadRules, style, opts.biddingHistory ?? [], rng, position);
  } else {
    selected = selectFollow(legalCards, currentTrick, trumpSuit, position, contract, dummyHand, tricksWonByDeclarer);
  }

  if (!legalCards.includes(selected)) {
    return legalCards[Math.floor(rng() * legalCards.length)];
  }
  return selected;
}

/* ------------------------------------------------------------------ *
 * 首攻（YAML 规则驱动）
 * ------------------------------------------------------------------ */

function selectLead(
  hand: Hand,
  contract: Contract,
  trumpSuit: SuitIndex | null,
  rules: LeadRule[],
  style: StyleLevel,
  history: BidRecord[],
  rng: () => number,
  position: Position,
): number {
  const ctype = contract.suit === 'NT' ? 'NT' : 'suit';
  const vars = STYLE_PARAMS[style];
  const isDefender = getSide(position) !== getSide(contract.declarer);
  for (const rule of rules) {
    if (rule.context.contract_type !== ctype) continue;
    if (rule.role === 'defender' && !isDefender) continue;
    if (rule.role === 'declarer' && isDefender) continue;
    if (rule.when && !checkConditions(hand, rule.when, vars)) continue;
    return executeLeadStrategy(hand, rule.lead, trumpSuit, history, contract, rng);
  }
  return executeLeadStrategy(hand, '4th_best_of_longest', trumpSuit, history, contract, rng);
}

function executeLeadStrategy(
  hand: Hand,
  strategy: string,
  trumpSuit: SuitIndex | null,
  history: BidRecord[],
  contract: Contract,
  rng: () => number,
): number {
  switch (strategy) {
    case '4th_best_of_unbid_major':
      return fourthBestOfUnbidMajor(hand, trumpSuit, history, contract);
    case 'top_of_sequence':
      return topOfSequence(hand, trumpSuit);
    case '4th_best_of_longest':
      return fourthBestOfLongest(hand, trumpSuit);
    default:
      return hand[Math.floor(rng() * hand.length)];
  }
}

/** 花色“强度”排序：先比长度，再比大牌点总和 */
function suitStrength(hand: Hand, suit: SuitIndex): number {
  const cards = hand.filter((c) => getSuit(c) === suit);
  const hcpish = cards.reduce((sum, c) => sum + Math.max(0, getRank(c) - 8), 0); // J=1..A=4
  return cards.length * 10 + hcpish;
}

function fourthBestOfLongest(hand: Hand, trumpSuit: SuitIndex | null): number {
  const all = ALL_SUITS.filter((s) => suitLength(hand, s) > 0);
  if (all.length === 0) return hand[0];
  let nonTrump = all.filter((s) => !(trumpSuit !== null && s === trumpSuit));
  if (nonTrump.length === 0) nonTrump = all;
  const best = nonTrump.reduce((a, b) => (suitStrength(hand, b) > suitStrength(hand, a) ? b : a));
  const cards = hand.filter((c) => getSuit(c) === best).sort((a, b) => getRank(b) - getRank(a));
  return cards.length >= 4 ? cards[3] : cards[cards.length - 1];
}

/** 攻敌方（定约方）未叫过的高级花色，取长四 */
function fourthBestOfUnbidMajor(
  hand: Hand,
  trumpSuit: SuitIndex | null,
  history: BidRecord[],
  contract: Contract,
): number {
  const declSide = getSide(contract.declarer);
  const bidSuits = new Set<string>();
  for (const rec of history) {
    if (rec.call.type === 'bid' && getSide(rec.position) === declSide) bidSuits.add(rec.call.suit);
  }
  const majors: { idx: SuitIndex; key: 'S' | 'H' }[] = [
    { idx: 3, key: 'S' },
    { idx: 2, key: 'H' },
  ];
  let pool = majors.filter((m) => !bidSuits.has(m.key) && suitLength(hand, m.idx) >= 3).map((m) => m.idx);
  if (pool.length === 0) pool = majors.filter((m) => suitLength(hand, m.idx) > 0).map((m) => m.idx);
  if (pool.length === 0) return fourthBestOfLongest(hand, trumpSuit);
  const best = pool.reduce((a, b) => (suitStrength(hand, b) > suitStrength(hand, a) ? b : a));
  const cards = hand.filter((c) => getSuit(c) === best).sort((a, b) => getRank(b) - getRank(a));
  return cards.length >= 4 ? cards[3] : cards[cards.length - 1];
}

/** 连张首攻：找最长的顶部连张（如 AKQ/KQJ/QJT/JT9），出连张顶张 */
function topOfSequence(hand: Hand, trumpSuit: SuitIndex | null): number {
  let bestCard: number | null = null;
  let bestRun = 0;
  let bestTop = -1;
  for (const suit of ALL_SUITS) {
    if (trumpSuit !== null && suit === trumpSuit) continue; // 通常不攻将牌
    const cards = hand.filter((c) => getSuit(c) === suit).sort((a, b) => getRank(b) - getRank(a));
    if (cards.length === 0) continue;
    let run = 1;
    for (let i = 1; i < cards.length; i++) {
      if (getRank(cards[i - 1]) - getRank(cards[i]) === 1) run++;
      else break;
    }
    const topRank = getRank(cards[0]);
    if (run >= 2 && topRank >= 9 && (run > bestRun || (run === bestRun && topRank > bestTop))) {
      bestRun = run;
      bestTop = topRank;
      bestCard = cards[0];
    }
  }
  return bestCard ?? fourthBestOfLongest(hand, trumpSuit);
}

/* ------------------------------------------------------------------ *
 * 跟牌 / 垫牌（硬编码启发式 + 信号约定）
 *
 * 基本桥牌技巧（与 rules/play/signals.yml 保持一致）：
 * - 第二家：通常出小牌；若上家（对手）领出 10 以上的荣誉大牌，
 *   用“最小能盖过它的牌”盖打（cover an honor with an honor）。
 * - 第三家：同伴的大牌正在赢则出小牌；同伴的小牌虽然当前赢、
 *   但第四家可能超打时，出最小能赢的牌保护（third hand high）；
 *   对手当前赢时同样出最小能赢的牌。
 * - 第四家：能赢则用最小赢张；若同伴（第二家）已经赢墩，
 *   不得无谓超打同伴。
 * - 跟牌张数信号：偶数张“先大后小”，奇数张“先小后大”；
 *   信号张只用 10 及以下，保留 J 以上大牌。
 * - 无将垫牌：从“不鼓励”（最弱）的花色垫最小牌。
 * - 有将垫牌：若某非将花色有力量且存在无损失的高信号张（8/9/10），
 *   垫该张以鼓励同伴攻此花色；否则回退到无将垫牌逻辑。
 * ------------------------------------------------------------------ */

/** 信号张上限：10（rank 8），不拿 J 及以上大牌做信号 */
const SIGNAL_SPOT_MAX_RANK = 8;
/** “鼓励垫牌”的最小信号张：8（rank 6） */
const ENCOURAGE_DISCARD_MIN_RANK = 6;

/** 某花色的荣誉力量：J=1 / Q=2 / K=3 / A=4 */
function honorPoints(hand: Hand, suit: SuitIndex): number {
  return hand.reduce((sum, card) => {
    if (getSuit(card) !== suit) return sum;
    const rank = getRank(card);
    return sum + (rank >= 9 ? rank - 8 : 0);
  }, 0);
}

function selectFollow(
  legalCards: Hand,
  currentTrick: CardPlay[],
  trumpSuit: SuitIndex | null,
  position: Position,
  contract: Contract,
  dummyHand: Hand | null,
  tricksWonByDeclarer: number,
): number {
  void dummyHand;
  void tricksWonByDeclarer;

  const leadSuit = getSuit(currentTrick[0].card);
  const following = legalCards.some((card) => getSuit(card) === leadSuit);
  // 防守信号只对防守方生效；庄家侧按普通“低牌优先”处理
  const isDefender = getSide(position) !== getSide(contract.declarer);
  const lowPlay = (): number =>
    isDefender ? lowCardOrSignal(legalCards, leadSuit, trumpSuit, following) : lowest(legalCards);
  const numPlayed = currentTrick.length;

  if (numPlayed === 3) {
    return fourthHandPlay(legalCards, currentTrick, trumpSuit, position, leadSuit, lowPlay);
  }
  if (numPlayed === 2) {
    return thirdHandPlay(legalCards, currentTrick, trumpSuit, position, leadSuit, following, lowPlay);
  }
  return secondHandPlay(legalCards, currentTrick, trumpSuit, position, leadSuit, following, lowPlay);
}

/** 10 及以上视为荣誉大牌（10/J/Q/K/A） */
function isHonor(card: number): boolean {
  return getRank(card) >= 8;
}

/**
 * 第二家：
 * - 默认第二家出小牌，让第三家/同伴处理；
 * - 对手领出荣誉大牌时，若手里有更大的牌，用最小能盖过的牌盖打。
 * 同伴领出的牌不盖（避免浪费己方大牌）。
 */
function secondHandPlay(
  legalCards: Hand,
  currentTrick: CardPlay[],
  trumpSuit: SuitIndex | null,
  position: Position,
  leadSuit: SuitIndex,
  following: boolean,
  lowPlay: () => number,
): number {
  if (!following) return lowPlay();

  const leader = currentTrick[0];
  const leaderIsOpponent = getSide(leader.position) !== getSide(position);
  if (leaderIsOpponent && isHonor(leader.card)) {
    const winners = legalCards.filter((card) => beatsCard(card, leader.card, leadSuit, trumpSuit));
    if (winners.length > 0) return lowest(winners);
  }
  return lowPlay();
}

/** 非赢墩出牌：跟牌时给张数信号；缺门时按垫牌约定选牌 */
function lowCardOrSignal(
  legalCards: Hand,
  leadSuit: SuitIndex,
  trumpSuit: SuitIndex | null,
  following: boolean,
): number {
  if (following) return followWithCountSignal(legalCards, leadSuit);
  return chooseDiscard(legalCards, trumpSuit);
}

/**
 * 跟牌张数信号：
 * - 该花色剩偶数张 → 先打较高的信号张（10 及以下）；
 * - 剩奇数张 → 先打最小牌。
 * 下一轮剩余张数奇偶性翻转，自然形成“先大后小 / 先小后大”。
 */
function followWithCountSignal(legalCards: Hand, leadSuit: SuitIndex): number {
  const ordered = legalCards
    .filter((card) => getSuit(card) === leadSuit)
    .sort((a, b) => getRank(a) - getRank(b));
  if (ordered.length === 0) return lowest(legalCards);

  if (ordered.length % 2 === 0) {
    const spots = ordered.filter((card) => getRank(card) <= SIGNAL_SPOT_MAX_RANK);
    if (spots.length > 0) return spots[spots.length - 1];
  }
  return ordered[0];
}

/**
 * 垫牌：
 * - 有将定约先尝试“无损失鼓励垫牌”（高信号张 8/9/10）；
 * - 否则从不鼓励（荣誉力量最弱、同力量时较长）的花色垫最小牌。
 */
function chooseDiscard(legalCards: Hand, trumpSuit: SuitIndex | null): number {
  const candidateSuits = ALL_SUITS.filter(
    (suit) => (trumpSuit === null || suit !== trumpSuit) && legalCards.some((card) => getSuit(card) === suit),
  );
  if (candidateSuits.length === 0) return lowest(legalCards);

  if (trumpSuit !== null) {
    const encouraging = candidateSuits
      .map((suit) => ({
        suit,
        honor: honorPoints(legalCards, suit),
        length: suitLength(legalCards, suit),
      }))
      .filter((entry) => entry.honor > 0 && entry.length >= 3)
      .sort((a, b) => b.honor - a.honor || b.length - a.length)[0];

    if (encouraging) {
      const cards = legalCards
        .filter((card) => getSuit(card) === encouraging.suit)
        .sort((a, b) => getRank(a) - getRank(b));
      const topRank = getRank(cards[cards.length - 1]);
      const spots = cards.filter(
        (card) =>
          getRank(card) >= ENCOURAGE_DISCARD_MIN_RANK &&
          getRank(card) <= SIGNAL_SPOT_MAX_RANK &&
          getRank(card) !== topRank,
      );
      if (spots.length > 0) return spots[spots.length - 1];
    }
  }

  const leastEncouraging = candidateSuits
    .map((suit) => ({
      suit,
      honor: honorPoints(legalCards, suit),
      length: suitLength(legalCards, suit),
    }))
    .sort((a, b) => a.honor - b.honor || b.length - a.length || a.suit - b.suit)[0];

  return lowest(legalCards.filter((card) => getSuit(card) === leastEncouraging.suit));
}

/**
 * 第四家：
 * - 同伴（第二家）已经赢墩时出小牌，不无谓超打同伴；
 * - 否则能赢则用足够赢的最小牌，不能赢则按信号/垫牌约定出牌。
 */
function fourthHandPlay(
  legalCards: Hand,
  currentTrick: CardPlay[],
  trumpSuit: SuitIndex | null,
  position: Position,
  leadSuit: SuitIndex,
  lowPlay: () => number,
): number {
  if (determineTrickWinner(currentTrick, trumpSuit) === getPartner(position)) {
    return lowPlay();
  }
  const bestSoFar = getTrickWinnerCard(currentTrick, trumpSuit);
  const winners = legalCards.filter((card) => beatsCard(card, bestSoFar, leadSuit, trumpSuit));
  if (winners.length > 0) return lowest(winners);
  return lowPlay();
}

/**
 * 第三家：
 * - 同伴领出荣誉大牌且正在赢：出小牌，保留己方大牌；
 * - 同伴领出小牌虽然当前赢，但第四家可能超打：出最小能赢的牌保护；
 * - 对手当前赢：出最小能赢的牌（third hand high，连张时保留更大牌）；
 * - 无法赢：按张数信号/垫牌约定出小牌。
 */
function thirdHandPlay(
  legalCards: Hand,
  currentTrick: CardPlay[],
  trumpSuit: SuitIndex | null,
  position: Position,
  leadSuit: SuitIndex,
  following: boolean,
  lowPlay: () => number,
): number {
  const partnerWinning = determineTrickWinner(currentTrick, trumpSuit) === getPartner(position);
  const bestSoFar = getTrickWinnerCard(currentTrick, trumpSuit);
  const winners = legalCards.filter((card) => beatsCard(card, bestSoFar, leadSuit, trumpSuit));

  if (!following) {
    // 缺门时：同伴已赢就不将吃；对手赢则尝试用最小将牌赢墩。
    return partnerWinning || winners.length === 0 ? lowPlay() : lowest(winners);
  }

  if (partnerWinning) {
    // 同伴领出的是荣誉大牌，通常不超打；小牌则需要第三家高牌保护。
    if (isHonor(currentTrick[0].card)) return lowPlay();
    return winners.length > 0 ? lowest(winners) : lowPlay();
  }

  return winners.length > 0 ? lowest(winners) : lowPlay();
}

/** 取点数最小的牌（并列时取较低花色，保证确定性） */
function lowest(cards: Hand): number {
  return [...cards].sort((a, b) => getRank(a) - getRank(b) || getSuit(a) - getSuit(b))[0];
}
