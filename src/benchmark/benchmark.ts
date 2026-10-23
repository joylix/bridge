/**
 * 无界面固定种子基准测试。
 *
 * 与正式对局共用叫牌裁决、首攻规则、出牌 AI、墩判定和计分函数，但不经过
 * Pinia/UI/延时，因此可以用固定种子批量跑完整牌局，比较改动前后的真实强度。
 *
 * 用法（命令行）：
 *   npm run benchmark -- --deals 20 --seed 2026
 */

import type { BidRecord, Contract, Position, SeatStyle, StyleLevel, Trick } from '../models/gameState';
import { getSide, nextPosition, trumpSuitOf } from '../models/gameState';
import type { Hand } from '../models/hand';
import type { BiddingRule, LeadRule } from '../engine/types';
import { auctionOutcome, contractFromAuction } from '../core/auction';
import { createDeck, deal, shuffle } from '../core/deck';
import { hcp } from '../core/evaluate';
import { impsFromScoreDiff } from '../core/imps';
import { getLegalCards } from '../core/playing';
import { computeScore } from '../core/scoring';
import { determineTrickWinner } from '../core/trick';
import { getSuit } from '../models/card';
import { bidAI } from '../ai/bidAI';
import { playAI } from '../ai/playAI';
import { makeRng } from '../engine/arbiter';

export interface PlayDecisionContext {
  hand: Hand;
  dummyHand: Hand | null;
  currentTrick: { position: Position; card: number }[];
  tricks: Trick[];
  position: Position;
  contract: Contract;
  legalCards: Hand;
  biddingHistory: BidRecord[];
  /** 当前叫牌规则，供 DDS 决策器做规则级隐藏牌推断 */
  biddingRules: BiddingRule[];
  /** 各座位叫牌风格，用于解析规则变量 */
  styles: Partial<Record<Position, StyleLevel>>;
  rng: () => number;
  /** 现有启发式给出的兜底牌 */
  fallback: number;
}

/** 可注入的出牌决策器（基准测试用 DDS 版本替换启发式）。 */
export type PlayDecider = (context: PlayDecisionContext) => number;

export interface BenchmarkDealOptions {
  seed: number;
  dealer?: Position;
  vulnerability?: 'none' | 'NS' | 'EW' | 'both';
  biddingRules: BiddingRule[];
  /** 可选：按阵营分别指定叫牌规则，用于新旧规则对抗测试 */
  biddingRulesBySide?: { NS: BiddingRule[]; EW: BiddingRule[] };
  leadRules: LeadRule[];
  styles?: Partial<Record<Position, SeatStyle>>;
  /** 最多叫牌轮数，防止规则异常时死循环 */
  maxBids?: number;
  /** 可选：替换默认启发式出牌（例如 DDS 抽样） */
  playDecider?: PlayDecider;
  /** 可选：按阵营分别替换出牌决策器，用于强度对抗测试 */
  playDeciderBySide?: { NS: PlayDecider; EW: PlayDecider };
}

export interface BenchmarkDealResult {
  index: number;
  seed: number;
  dealer: Position;
  vulnerability: 'none' | 'NS' | 'EW' | 'both';
  hands: Record<Position, Hand>;
  biddingHistory: BidRecord[];
  contract: Contract | null;
  tricks: Trick[];
  declarerTricks: number;
  score: { NS: number; EW: number };
  /** 本副 IMP（NS 视角，正=NS 赢） */
  imp: number;
  hcp: { NS: number; EW: number };
  /** 可选：DDS Par 分数（NS 视角）与实际得分差 */
  parScore?: number;
  parContracts?: string[];
  parDiff?: number;
}

export interface BenchmarkOptions {
  /** 跑的副数 */
  deals: number;
  /** 基准种子；第 i 副使用 deriveSeed(seed, i) */
  seed: number;
  /** 首个发牌人，之后顺时针轮转；默认 N */
  dealer?: Position;
  biddingRules: BiddingRule[];
  biddingRulesBySide?: { NS: BiddingRule[]; EW: BiddingRule[] };
  leadRules: LeadRule[];
  styles?: Partial<Record<Position, SeatStyle>>;
  maxBids?: number;
  playDecider?: PlayDecider;
  playDeciderBySide?: { NS: PlayDecider; EW: PlayDecider };
}

export interface BenchmarkSummary {
  deals: number;
  seed: number;
  /** NS 累计得分与 IMP（正=NS） */
  scoreNS: number;
  scoreEW: number;
  impNS: number;
  /** 每副平均 IMP */
  avgImp: number;
  /** 以 IMP 计的胜/平/负（NS 视角） */
  nsWins: number;
  ewWins: number;
  pushes: number;
  /** 有定约/流局的副数 */
  contracts: number;
  passedOut: number;
  /** 每副结果，便于输出或回归比较 */
  results: BenchmarkDealResult[];
  /** 可选：与实际得分对照的 Par 指标（需 --par） */
  parDeals?: number;
  parImpNS?: number;
  avgParImp?: number;
}

const DEFAULT_STYLES: Record<Position, SeatStyle> = {
  N: { bid: 1, play: 1, randomness: 0 },
  E: { bid: 1, play: 1, randomness: 0 },
  S: { bid: 1, play: 1, randomness: 0 },
  W: { bid: 1, play: 1, randomness: 0 },
};

const VULNERABILITIES: Array<'none' | 'NS' | 'EW' | 'both'> = ['none', 'NS', 'EW', 'both'];

/** 从基准种子派生第 index 副的种子，保证批次可分离复现。 */
export function deriveSeed(baseSeed: number, index: number): number {
  let x = (baseSeed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

function roundRobinDealer(start: Position, index: number): Position {
  const seats: Position[] = ['N', 'E', 'S', 'W'];
  return seats[(seats.indexOf(start) + index) % 4];
}

function styleFor(styles: BenchmarkDealOptions['styles'], pos: Position): SeatStyle {
  return { ...DEFAULT_STYLES[pos], ...(styles?.[pos] ?? {}) };
}

/**
 * 模拟一整副牌：发牌 → 叫牌 → 打牌 → 计分。
 * 与 store 的行为保持一致，但不含任何 UI 延时。
 */
export function simulateDeal(options: BenchmarkDealOptions): BenchmarkDealResult {
  const {
    seed,
    biddingRules,
    biddingRulesBySide,
    leadRules,
    styles,
    maxBids = 200,
    playDecider,
    playDeciderBySide,
  } = options;
  const rng = makeRng(seed);
  const dealt = deal(shuffle(createDeck(), rng));
  const vulnerability =
    options.vulnerability ?? VULNERABILITIES[Math.floor(rng() * VULNERABILITIES.length)];
  const dealer = options.dealer ?? 'N';

  const history: BidRecord[] = [];
  let currentBid: { level: number; suit: 'C' | 'D' | 'H' | 'S' | 'NT' } | null = null;
  let doubleState: 'none' | 'double' | 'redouble' = 'none';
  let bidder = dealer;
  let contract: Contract | null = null;
  let passedOut = false;

  for (let turn = 0; turn < maxBids; turn++) {
    const style = styleFor(styles, bidder);
    const rules = biddingRulesBySide ? biddingRulesBySide[getSide(bidder)] : biddingRules;
    const call = bidAI(dealt[bidder], history, bidder, currentBid, rules, {
      style: style.bid,
      randomness: style.randomness,
      rng,
    });
    history.push({ position: bidder, call });
    if (call.type === 'bid') {
      currentBid = { level: call.level, suit: call.suit };
      doubleState = 'none';
    } else if (call.type === 'double') {
      doubleState = 'double';
    } else if (call.type === 'redouble') {
      doubleState = 'redouble';
    }

    const outcome = auctionOutcome(history, currentBid);
    if (outcome === 'passed_out') {
      passedOut = true;
      break;
    }
    if (outcome === 'contract') {
      contract = contractFromAuction(history, currentBid, doubleState);
      break;
    }
    bidder = nextPosition(bidder);
  }

  const hands: Record<Position, Hand> = {
    N: [...dealt.N],
    E: [...dealt.E],
    S: [...dealt.S],
    W: [...dealt.W],
  };
  const originalHands: Record<Position, Hand> = {
    N: [...dealt.N],
    E: [...dealt.E],
    S: [...dealt.S],
    W: [...dealt.W],
  };
  const tricks: Trick[] = [];
  let declarerTricks = 0;
  let score = { NS: 0, EW: 0 };

  if (contract) {
    const trump = trumpSuitOf(contract);
    let leader = nextPosition(contract.declarer);
    let currentTrick: { position: Position; card: number }[] = [];
    let dummyOpen = false;
    let player = leader;

    for (let cardIndex = 0; cardIndex < 52; cardIndex++) {
      const leadSuit = currentTrick.length === 0 ? null : getSuit(currentTrick[0].card);
      const legal = getLegalCards(hands[player], leadSuit, trump);
      if (legal.length === 0) break;
      const declSide = getSide(contract.declarer);
      const style = styleFor(styles, player);
      const dummyHand = dummyOpen ? hands[contract.dummy] : null;
      const fallback =
        legal.length === 1
          ? legal[0]
          : playAI(
              hands[player],
              dummyHand,
              currentTrick,
              trump,
              player,
              contract,
              tricks.filter((t) => getSide(t.winner) === declSide).length,
              leadRules,
              style.play,
              { rng, biddingHistory: history },
            );
      const decider = playDeciderBySide ? playDeciderBySide[getSide(player)] : playDecider;
      const card =
        legal.length === 1 || !decider
          ? fallback
          : decider({
              hand: hands[player],
              dummyHand,
              currentTrick,
              tricks,
              position: player,
              contract,
              legalCards: legal,
              biddingHistory: history,
              biddingRules,
              styles: {
                N: styleFor(styles, 'N').bid,
                E: styleFor(styles, 'E').bid,
                S: styleFor(styles, 'S').bid,
                W: styleFor(styles, 'W').bid,
              },
              rng,
              fallback,
            });
      hands[player] = hands[player].filter((c) => c !== card);
      currentTrick.push({ position: player, card });
      if (!dummyOpen) dummyOpen = true;

      if (currentTrick.length === 4) {
        const winner = determineTrickWinner(currentTrick, trump);
        tricks.push({ plays: [...currentTrick], leader, winner });
        if (getSide(winner) === getSide(contract.declarer)) declarerTricks += 1;
        currentTrick = [];
        leader = winner;
        player = winner;
      } else {
        player = nextPosition(player);
      }
    }
    score = computeScore(contract, declarerTricks, vulnerability);
  }

  const hcpBySide = {
    NS: hcp(dealt.N) + hcp(dealt.S),
    EW: hcp(dealt.E) + hcp(dealt.W),
  };
  const imp = passedOut ? 0 : impsFromScoreDiff(score.NS - score.EW);

  return {
    index: 0,
    seed,
    dealer,
    vulnerability,
    hands: originalHands,
    biddingHistory: history,
    contract,
    tricks,
    declarerTricks,
    score,
    imp,
    hcp: hcpBySide,
  };
}

/** 跑一批固定种子牌局，汇总 NS/EW 的得分与 IMP。 */
export function runBenchmark(options: BenchmarkOptions): BenchmarkSummary {
  const results: BenchmarkDealResult[] = [];
  let scoreNS = 0;
  let scoreEW = 0;
  let impNS = 0;
  let nsWins = 0;
  let ewWins = 0;
  let pushes = 0;
  let contracts = 0;
  let passedOut = 0;

  for (let i = 0; i < options.deals; i++) {
    const seed = deriveSeed(options.seed, i);
    const result = simulateDeal({
      seed,
      dealer: options.dealer ? roundRobinDealer(options.dealer, i) : roundRobinDealer('N', i),
      vulnerability: undefined,
      biddingRules: options.biddingRules,
      biddingRulesBySide: options.biddingRulesBySide,
      leadRules: options.leadRules,
      styles: options.styles,
      maxBids: options.maxBids,
      playDecider: options.playDecider,
      playDeciderBySide: options.playDeciderBySide,
    });
    result.index = i + 1;
    results.push(result);

    scoreNS += result.score.NS;
    scoreEW += result.score.EW;
    impNS += result.imp;
    if (result.imp > 0) nsWins += 1;
    else if (result.imp < 0) ewWins += 1;
    else pushes += 1;
    if (result.contract) contracts += 1;
    else passedOut += 1;
  }

  return {
    deals: options.deals,
    seed: options.seed,
    scoreNS,
    scoreEW,
    impNS,
    avgImp: options.deals > 0 ? impNS / options.deals : 0,
    nsWins,
    ewWins,
    pushes,
    contracts,
    passedOut,
    results,
  };
}

/** 紧凑命令行输出，便于保存历史基线。 */
export function formatBenchmark(summary: BenchmarkSummary): string {
  const lines: string[] = [];
  for (const r of summary.results) {
    const c = r.contract
      ? `${r.contract.declarer} ${r.contract.level}${r.contract.suit}${r.contract.doubled ? 'X' : r.contract.redoubled ? 'XX' : ''}`
      : 'Pass-out';
    lines.push(
      `#${String(r.index).padStart(2, '0')} seed=${r.seed} ${r.dealer}/${r.vulnerability} ${c.padEnd(9)} ` +
        `tricks=${r.declarerTricks} score=${r.score.NS}:${r.score.EW} imp=${r.imp > 0 ? '+' : ''}${r.imp}` +
        (r.parScore !== undefined
          ? ` par=${r.parScore > 0 ? '+' : ''}${r.parScore} diff=${r.parDiff! > 0 ? '+' : ''}${r.parDiff}`
          : ''),
    );
  }
  lines.push(
    `--- ${summary.deals} deals | NS ${summary.scoreNS} : ${summary.scoreEW} EW | ` +
      `IMP ${summary.impNS > 0 ? '+' : ''}${summary.impNS} (avg ${summary.avgImp.toFixed(2)}) | ` +
      `NS ${summary.nsWins} / EW ${summary.ewWins} / push ${summary.pushes} | ` +
      `contracts ${summary.contracts}, passed out ${summary.passedOut}` +
      (summary.parImpNS !== undefined
        ? ` | vs par IMP ${summary.parImpNS > 0 ? '+' : ''}${summary.parImpNS} (avg ${summary.avgParImp?.toFixed(2)})`
        : ''),
  );
  return lines.join('\n');
}
