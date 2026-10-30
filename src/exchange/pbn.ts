/**
 * Profile S 的 PBN 2.1 子集：完整 TableBoard（Deal / Auction / Contract /
 * Result / Play / Score）与内部记录互转。
 *
 * 规范见 `docs/brules-v0.5/pbn.md`。只声明支持该子集；不能保留的信息
 * 进入损失报告，不做“无损”承诺。
 */

import type { BidRecord, Contract, Position } from '../models/gameState';
import { nextPosition, trumpSuitOf } from '../models/gameState';
import type { Hand } from '../models/hand';
import { parsePbnDeal, toPbnDeal } from '../core/pbn';
import { auctionOutcome } from '../core/auction';
import { computeScore } from '../core/scoring';
import { determineTrickWinner } from '../core/trick';
import { getSuit } from '../models/card';
import { hcp } from '../core/evaluate';
import { isCallLegal } from '../core/bidding/validator';
import { impsFromScoreDiff } from '../core/imps';
import { tokenToCard, cardToToken } from './cards';
import {
  PRODUCER_APPLICATION,
  callFromCode,
  callToCode,
  contractFromRecord,
  createDealId,
  createRecordId,
} from './record';
import { RecordValidationError } from './json';
import type {
  CallCode,
  EngineSnapshot,
  ExchangeIssue,
  LossReport,
  RecordCardPlay,
  RecordContract,
  RecordPlay,
  RecordScore,
  RecordTrick,
  RecordVulnerability,
  TableBoardRecord,
} from './types';

const SEATS: Position[] = ['N', 'E', 'S', 'W'];

interface PbnDocument {
  dealer: Position;
  hands: Record<Position, Hand>;
  dealText: string;
  vulnerability: RecordVulnerability;
  boardNumber?: number;
  auctionDealer?: Position;
  calls: CallCode[];
  auctionCompleted: boolean;
  status: TableBoardRecord['status'];
  contract?: RecordContract;
  declarer?: Position;
  tricksTaken?: number;
  play?: RecordPlay;
  score: RecordScore;
  issues: ExchangeIssue[];
  losses: LossReport[];
}

export interface PbnImportOptions {
  /** PBN 未写 `[Vulnerable]` 时使用的局况；默认 NONE 并给警告。 */
  vulnerability?: RecordVulnerability;
  recordId?: string;
  createdAt?: string;
  engine: EngineSnapshot;
  dealId?: string;
  boardNumber?: number;
}

const TAG_RE = /^\s*\[([A-Za-z][A-Za-z0-9_]*)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/;
const VULNERABILITY_MAP: Record<string, RecordVulnerability> = {
  none: 'NONE',
  ns: 'NS',
  ew: 'EW',
  all: 'ALL',
  both: 'ALL',
};

function warn(issues: ExchangeIssue[], code: string, message: string, field?: string): void {
  issues.push({ code, severity: 'warning', message, ...(field ? { field } : {}) });
}

function info(issues: ExchangeIssue[], code: string, message: string, field?: string): void {
  issues.push({ code, severity: 'info', message, ...(field ? { field } : {}) });
}

function fail(issues: ExchangeIssue[], code: string, message: string, field?: string): void {
  issues.push({ code, severity: 'error', message, ...(field ? { field } : {}) });
}

function normalizeCallToken(token: string): string {
  const text = token.trim().toUpperCase();
  if (text === 'P' || text === 'PASS' || text === '-') return 'PASS';
  return text;
}

function isSeat(value: string | undefined): value is Position {
  return value === 'N' || value === 'E' || value === 'S' || value === 'W';
}

function parseAuctionDealer(tags: Record<string, string>): Position | undefined {
  const value = tags.auction?.trim().toUpperCase();
  return isSeat(value) ? value : undefined;
}

function parseContractTag(value: string): RecordContract | 'PASS' | null {
  const text = value.trim().toUpperCase().replace(/\s+/g, '');
  if (text === 'PASS' || text === 'P') return 'PASS';
  const match = /^([1-7])(C|D|H|S|NT)(X{0,2})$/.exec(text);
  if (!match) return null;
  return {
    level: Number(match[1]),
    denomination: match[2] as RecordContract['denomination'],
    doubled: match[3] === 'XX' ? 'XX' : match[3] === 'X' ? 'X' : 'NONE',
  };
}

function contractTag(contract: RecordContract): string {
  const doubled = contract.doubled === 'XX' ? 'XX' : contract.doubled === 'X' ? 'X' : '';
  return `${contract.level}${contract.denomination}${doubled}`;
}

function parseScoreTag(value: string): RecordScore | null {
  const match = /^(NS|EW)\s+(\d+)$/.exec(value.trim().toUpperCase());
  if (!match) return null;
  const amount = Number(match[2]);
  if (!Number.isInteger(amount) || amount < 0) return null;
  return { nsRaw: match[1] === 'NS' ? amount : -amount, source: 'director' };
}

function scoreTag(score: RecordScore): string | null {
  if (score.nsRaw === null) return null;
  return score.nsRaw >= 0 ? `NS ${score.nsRaw}` : `EW ${-score.nsRaw}`;
}

/** 解析 PBN 文本；有 error 时抛出 RecordValidationError。 */
export function parsePbnDocument(
  text: string,
  options: Pick<PbnImportOptions, 'vulnerability'> = {},
): PbnDocument {
  const issues: ExchangeIssue[] = [];
  const losses: LossReport[] = [];
  let source = text;

  if (source.charCodeAt(0) === 0xfeff) {
    source = source.slice(1);
    warn(issues, 'BOM_STRIPPED', '已移除 UTF-8 BOM');
  }

  const tags: Record<string, string> = {};
  const sections: Record<string, string[]> = { auction: [], play: [] };
  let currentSection: 'auction' | 'play' | null = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('%') || line.startsWith(';')) continue;

    const match = TAG_RE.exec(rawLine);
    if (match) {
      const name = match[1].toLowerCase();
      const value = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      tags[name] = value;
      currentSection = name === 'auction' ? 'auction' : name === 'play' ? 'play' : null;
      if (currentSection) sections[currentSection] = [];
      continue;
    }
    if (currentSection) {
      sections[currentSection].push(line);
    } else {
      info(issues, 'PBN_TEXT_IGNORED', `忽略无法识别的文本行: ${line}`);
    }
  }

  /* ---------------- Deal / Dealer ---------------- */
  const dealText = tags.deal;
  if (!dealText) {
    fail(issues, 'DEAL_MISSING', 'PBN 缺少 [Deal]');
    throw new RecordValidationError(issues);
  }

  const dealerTag = tags.dealer?.trim().toUpperCase();
  const dealerFromTag = isSeat(dealerTag) ? dealerTag : undefined;
  const dealerFromPrefix = (() => {
    const prefix = /^([NESW])\s*:/i.exec(dealText.trim());
    return prefix ? (prefix[1].toUpperCase() as Position) : undefined;
  })();

  if (!dealerFromTag && !dealerFromPrefix) {
    fail(issues, 'DEALER_UNKNOWN', 'PBN 既没有 [Dealer]，Deal 也没有座位前缀');
    throw new RecordValidationError(issues);
  }

  let hands: Record<Position, Hand>;
  try {
    hands = parsePbnDeal(dealText).hands;
  } catch (error) {
    fail(issues, 'DEAL_INVALID', error instanceof Error ? error.message : String(error));
    throw new RecordValidationError(issues);
  }

  const dealer = dealerFromTag ?? dealerFromPrefix!;
  if (!dealerFromTag && dealerFromPrefix) {
    warn(
      issues,
      'DEALER_INFERRED_FROM_DEAL_PREFIX',
      `未写 [Dealer]；按 Deal 前缀推断发牌人为 ${dealerFromPrefix}`,
      'Dealer',
    );
  } else if (!dealerFromPrefix && dealerFromTag) {
    warn(
      issues,
      'DEAL_PREFIX_DEFAULTED_N',
      '[Deal] 无座位前缀；第一手按 N 解析',
      'Deal',
    );
  } else if (dealerFromTag && dealerFromPrefix && dealerFromTag !== dealerFromPrefix) {
    warn(
      issues,
      'DEALER_PREFIX_MISMATCH',
      `[Dealer] ${dealerFromTag} 与 Deal 前缀 ${dealerFromPrefix} 不同；以 [Dealer] 为准`,
      'Dealer',
    );
  }

  const chunks = dealText
    .trim()
    .replace(/^[NESW]\s*:/i, '')
    .split(/\s+/)
    .filter(Boolean);
  for (const chunk of chunks) {
    if (chunk.split('.').some((segment) => segment === '')) {
      warn(issues, 'EMPTY_SUIT_SEGMENT', 'Deal 中存在空花色段；已规范化为缺门', 'Deal');
      break;
    }
  }

  /* ---------------- Vulnerable / Board ---------------- */
  let vulnerability: RecordVulnerability;
  const vulnerabilityTag = tags.vulnerable?.trim().toLowerCase();
  if (vulnerabilityTag) {
    const mapped = VULNERABILITY_MAP[vulnerabilityTag];
    if (!mapped) {
      fail(issues, 'INVALID_VULNERABILITY', `无法识别 [Vulnerable "${tags.vulnerable}"]`);
      throw new RecordValidationError(issues);
    }
    vulnerability = mapped;
  } else if (options.vulnerability) {
    vulnerability = options.vulnerability;
    warn(issues, 'VULNERABILITY_DEFAULTED', `PBN 未写局况，使用 ${options.vulnerability}`, 'Vulnerable');
  } else {
    vulnerability = 'NONE';
    warn(issues, 'VULNERABILITY_UNKNOWN', 'PBN 未写局况；记录按 NONE 保存', 'Vulnerable');
  }

  let boardNumber: number | undefined;
  if (tags.board !== undefined) {
    const parsed = Number.parseInt(tags.board, 10);
    if (Number.isInteger(parsed) && parsed > 0) boardNumber = parsed;
    else warn(issues, 'BOARD_INVALID', `[Board "${tags.board}"] 不是正整数`, 'Board');
  }

  for (const key of ['event', 'site', 'date', 'scoring']) {
    if (tags[key] !== undefined) {
      losses.push({
        field: `session.${key}`,
        action: 'omitted',
        reason: 'Profile S TableBoard 记录不保存赛事元数据',
      });
    }
  }
  for (const key of ['north', 'east', 'south', 'west']) {
    if (tags[key] !== undefined) {
      losses.push({
        field: `players.${key}.nickname`,
        action: 'omitted',
        reason: 'Profile S TableBoard 记录不保存球员昵称；PBN 伪名不进入 JSON',
      });
    }
  }

  /* ---------------- Auction ---------------- */
  const auctionDealer = parseAuctionDealer(tags);
  const calls: CallCode[] = [];
  const history: BidRecord[] = [];
  let position = dealer;
  let currentBid: { level: number; suit: 'C' | 'D' | 'H' | 'S' | 'NT' } | null = null;
  let auctionCompleted = false;

  const pushPass = (): boolean => {
    const call = { type: 'pass' as const };
    if (!isCallLegal(history, currentBid, position, call)) return false;
    history.push({ position, call });
    calls.push('PASS');
    position = nextPosition(position);
    return true;
  };

  const auctionTokens = sections.auction.join(' ').split(/\s+/).filter(Boolean);
  if (auctionDealer && auctionDealer !== dealer) {
    warn(
      issues,
      'AUCTION_DEALER_MISMATCH',
      `[Auction "${auctionDealer}"] 与发牌人 ${dealer} 不同；按发牌人解释座位`,
      'Auction',
    );
  }

  for (let index = 0; index < auctionTokens.length; index += 1) {
    const raw = auctionTokens[index];
    if (raw.toUpperCase() === 'AP') {
      let guard = 0;
      while (auctionOutcome(history, currentBid) === 'none' && guard < 4) {
        if (!pushPass()) break;
        guard += 1;
      }
      if (auctionOutcome(history, currentBid) === 'none') {
        fail(issues, 'AUCTION_INCOMPLETE', 'AP 无法补足叫牌结束所需的 Pass', 'Auction');
      } else {
        auctionCompleted = true;
      }
      if (index !== auctionTokens.length - 1) {
        warn(issues, 'AUCTION_TOKEN_AFTER_AP', 'AP 后仍有叫品；已忽略', 'Auction');
      }
      break;
    }

    if (auctionOutcome(history, currentBid) !== 'none') {
      warn(issues, 'AUCTION_EXTRA_PASS', `叫牌已结束，忽略额外叫品 ${raw}`, 'Auction');
      break;
    }

    const code = normalizeCallToken(raw) as CallCode;
    let call;
    try {
      call = callFromCode(code);
    } catch {
      fail(issues, 'INVALID_CALL', `无法识别叫品 "${raw}"`, 'Auction');
      continue;
    }
    if (!isCallLegal(history, currentBid, position, call)) {
      fail(issues, 'INVALID_CALL', `叫品 ${raw} 在 ${position} 家不合法`, 'Auction');
      continue;
    }
    history.push({ position, call });
    calls.push(callToCode(call));
    if (call.type === 'bid') currentBid = { level: call.level, suit: call.suit };
    position = nextPosition(position);
  }

  const outcome = auctionOutcome(history, currentBid);
  if (outcome !== 'none') auctionCompleted = true;
  else if (auctionTokens.length > 0) {
    warn(issues, 'AUCTION_INCOMPLETE', '叫牌序列未结束', 'Auction');
  }

  /* ---------------- Contract / Declarer / Result ---------------- */
  let contract: RecordContract | undefined;
  let declarer: Position | undefined;
  let tricksTaken: number | undefined;
  let passedOut = false;

  const contractValue = tags.contract;
  if (contractValue !== undefined) {
    const parsed = parseContractTag(contractValue);
    if (parsed === null) {
      fail(issues, 'CONTRACT_INVALID', `无法识别 [Contract "${contractValue}"]`, 'Contract');
    } else if (parsed === 'PASS') {
      passedOut = true;
    } else {
      contract = parsed;
      const declarerValue = tags.declarer?.trim().toUpperCase();
      if (!isSeat(declarerValue)) {
        fail(issues, 'CONTRACT_INCOMPLETE', '有 Contract 时必须写 [Declarer]', 'Declarer');
      } else {
        declarer = declarerValue;
      }
      const resultValue = tags.result?.trim();
      const result = resultValue === undefined ? Number.NaN : Number(resultValue);
      if (!Number.isInteger(result) || result < 0 || result > 13) {
        fail(issues, 'CONTRACT_INCOMPLETE', '有 Contract 时必须写 0-13 的 [Result]', 'Result');
      } else {
        tricksTaken = result;
      }
    }
  } else if (outcome === 'passed_out') {
    passedOut = true;
  }

  /* ---------------- Play ---------------- */
  let play: RecordPlay | undefined;
  const playLeaderTag = tags.play?.trim().toUpperCase();
  const playLines = sections.play.filter((line) => line.length > 0);
  if (playLines.length > 0) {
    if (!contract || !declarer || tricksTaken === undefined) {
      fail(issues, 'CONTRACT_MISSING', '存在 [Play] 时必须同时给出 Contract / Declarer / Result', 'Play');
    } else {
      const internalContract = contractFromRecord(contract, declarer);
      const trump = trumpSuitOf(internalContract);
      const remaining: Record<Position, Set<number>> = {
        N: new Set(hands.N),
        E: new Set(hands.E),
        S: new Set(hands.S),
        W: new Set(hands.W),
      };
      const used = new Set<number>();
      const tricks: RecordTrick[] = [];
      let leader: Position = isSeat(playLeaderTag) ? playLeaderTag : nextPosition(declarer);

      if (!isSeat(playLeaderTag)) {
        warn(issues, 'PLAY_LEADER_MISSING', 'Play 缺少首攻座位；按庄家左手方处理', 'Play');
      }

      playLines.forEach((line, lineIndex) => {
        const tokens = line.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return;
        if (tokens.length !== 4) {
          warn(
            issues,
            'PARTIAL_TRICK_DROPPED',
            `第 ${lineIndex + 1} 墩只有 ${tokens.length} 张；记录只保存完整墩`,
            'Play',
          );
          return;
        }
        const seats = SEATS.map((_, offset) => SEATS[(SEATS.indexOf(leader) + offset) % 4]);
        const cards: RecordCardPlay[] = [];
        const internalPlays: Array<{ position: Position; card: number }> = [];
        let leadSuit: number | null = null;

        tokens.forEach((token, offset) => {
          const seat = seats[offset];
          let card: number;
          try {
            card = tokenToCard(token);
          } catch (error) {
            fail(issues, 'INVALID_PLAY_CARD', error instanceof Error ? error.message : String(error), 'Play');
            return;
          }
          const canonical = cardToToken(card);
          if (cards.some((item) => item.card === canonical)) {
            fail(issues, 'DUPLICATE_CARD', `牌 ${canonical} 在同一墩重复出现`, 'Play');
            return;
          }
          if (used.has(card)) {
            fail(issues, 'DUPLICATE_CARD', `牌 ${canonical} 在出牌过程中重复出现`, 'Play');
            return;
          }
          if (!remaining[seat].has(card)) {
            fail(issues, 'INVALID_PLAY_CARD', `牌 ${canonical} 不在 ${seat} 家的剩余手牌中`, 'Play');
            return;
          }
          if (offset === 0) leadSuit = getSuit(card);
          if (offset > 0 && leadSuit !== null && getSuit(card) !== leadSuit) {
            const hasLead = [...remaining[seat]].some((item) => getSuit(item) === leadSuit);
            if (hasLead) {
              warn(issues, 'PLAY_UNVERIFIED', `${seat} 家有领出花色却垫了 ${canonical}`, 'Play');
            }
          }
          remaining[seat].delete(card);
          used.add(card);
          cards.push({ seat, card: canonical });
          internalPlays.push({ position: seat, card });
        });

        if (cards.length !== 4 || internalPlays.length !== 4) return;
        const winner = determineTrickWinner(internalPlays, trump);
        tricks.push({ leader, cards, winner });
        leader = winner;
      });

      if (tricks.length > 0) play = { tricks };
    }
  }

  /* ---------------- Score ---------------- */
  let score: RecordScore | undefined;
  const scoreValue = tags.score;
  if (scoreValue !== undefined) {
    const parsed = parseScoreTag(scoreValue);
    if (!parsed) {
      fail(issues, 'INVALID_SCORE', `无法识别 [Score "${scoreValue}"]；应为 "NS 420" / "EW 620"`, 'Score');
    } else {
      score = parsed;
    }
  }

  const modelScore = (() => {
    if (passedOut) return { nsRaw: 0, source: 'computed' as const };
    if (!contract || !declarer || tricksTaken === undefined) return null;
    const internal: Contract = contractFromRecord(contract, declarer);
    const result = computeScore(internal, tricksTaken, vulnerability);
    return { nsRaw: result.NS - result.EW, source: 'computed' as const };
  })();

  if (score && modelScore && score.nsRaw !== modelScore.nsRaw) {
    warn(
      issues,
      'SCORE_MISMATCH',
      `[Score] ${score.nsRaw} 与按 Contract/Result 计算的 ${modelScore.nsRaw} 不一致；保留导演分`,
      'Score',
    );
  }
  if (!score) {
    if (!modelScore) {
      fail(issues, 'SCORE_UNKNOWN', '缺少 [Score]，且无法由 Contract/Result 计算', 'Score');
    } else {
      score = modelScore;
    }
  }

  /* ---------------- Status ---------------- */
  let status: TableBoardRecord['status'];
  if (passedOut) {
    if (contract) {
      fail(issues, 'CONTRACT_STATE_INVALID', '流局不得同时带 Contract');
    }
    if (play) {
      fail(issues, 'CONTRACT_STATE_INVALID', '流局不得带 Play');
    }
    status = 'PASSED_OUT';
  } else if (contract && declarer && tricksTaken !== undefined) {
    if (play) {
      status = 'PLAYED';
    } else {
      status = 'IN_PROGRESS';
      warn(issues, 'PLAY_MISSING', '有 Contract/Result 但缺少 [Play]；按进行中记录导入', 'Play');
    }
  } else {
    status = 'IN_PROGRESS';
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) throw new RecordValidationError(issues);

  return {
    dealer,
    hands,
    dealText,
    vulnerability,
    ...(boardNumber !== undefined ? { boardNumber } : {}),
    ...(auctionDealer !== undefined ? { auctionDealer } : {}),
    calls,
    auctionCompleted,
    status,
    ...(contract ? { contract } : {}),
    ...(declarer ? { declarer } : {}),
    ...(tricksTaken !== undefined ? { tricksTaken } : {}),
    ...(play ? { play } : {}),
    score: score!,
    issues,
    losses,
  };
}

/** PBN → TableBoard 记录（需要调用方提供当前引擎快照）。 */
export function recordFromPbnDocument(
  document: PbnDocument,
  options: PbnImportOptions,
): TableBoardRecord {
  const boardNumber = options.boardNumber ?? document.boardNumber ?? 1;
  const record: TableBoardRecord = {
    format: 'bridge-record',
    schemaVersion: '1.1',
    profile: 'standalone',
    recordType: 'table-board',
    recordId: options.recordId ?? createRecordId(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    producer: { application: PRODUCER_APPLICATION },
    deal: {
      dealId: options.dealId ?? createDealId(boardNumber),
      boardNumber,
      dealer: document.dealer,
      vulnerability: document.vulnerability,
      pbn: toPbnDeal(document.hands, document.dealer),
    },
    status: document.status,
    auction: {
      calls: document.calls,
      completed: document.auctionCompleted,
    },
    score: document.score,
    hcp: {
      ns: hcp(document.hands.N) + hcp(document.hands.S),
      ew: hcp(document.hands.E) + hcp(document.hands.W),
    },
    derived: {
      imp: {
        singleTable:
          document.score.nsRaw === null ? null : impsFromScoreDiff(document.score.nsRaw),
        tableVersion: 'wbf-2017',
      },
    },
    engine: {
      ...options.engine,
      rulesVersion: options.engine.rulesVersion ?? 'wbf-laws-2017',
    },
  };

  if (document.contract && document.declarer && document.tricksTaken !== undefined && record.status !== 'PASSED_OUT') {
    record.contract = document.contract;
    record.declarer = document.declarer;
    record.tricksTaken = document.tricksTaken;
  }
  if (document.play && record.contract) record.play = document.play;
  return record;
}

/** 便捷入口：PBN 文本 → TableBoard 记录。 */
export function tableBoardFromPbn(
  text: string,
  options: PbnImportOptions,
): { record: TableBoardRecord; issues: ExchangeIssue[]; losses: LossReport[] } {
  const document = parsePbnDocument(text, { vulnerability: options.vulnerability });
  const record = recordFromPbnDocument(document, options);
  return { record, issues: document.issues, losses: document.losses };
}

export interface PbnExportResult {
  text: string;
  losses: LossReport[];
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '2026.01.01';
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

/** TableBoard 记录 → PBN 子集文本。 */
export function tableBoardToPbn(record: TableBoardRecord): PbnExportResult {
  const losses: LossReport[] = [];
  let hands: Record<Position, Hand>;
  try {
    hands = parsePbnDeal(record.deal.pbn).hands;
  } catch (error) {
    throw new Error(
      `记录中的 deal.pbn 无法解析: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const lines: string[] = ['% PBN 2.1'];
  const push = (name: string, value: string): void => {
    lines.push(`[${name} "${value}"]`);
  };

  push('Board', String(record.deal.boardNumber));
  push('West', 'Player-4');
  push('North', 'Player-1');
  push('East', 'Player-2');
  push('South', 'Player-3');
  push('Date', formatDate(record.createdAt));
  push('Dealer', record.deal.dealer);
  push('Vulnerable', {
    NONE: 'None',
    NS: 'NS',
    EW: 'EW',
    ALL: 'All',
  }[record.deal.vulnerability]);
  push('Deal', toPbnDeal(hands, record.deal.dealer));
  push('Scoring', 'IMP');

  if (record.status === 'PASSED_OUT') {
    push('Contract', 'Pass');
  } else if (record.contract && record.declarer && record.tricksTaken !== undefined) {
    const canExportResult =
      record.status === 'PLAYED' || record.status === 'ADJUSTED' || record.play !== undefined;
    if (canExportResult) {
      push('Contract', contractTag(record.contract));
      push('Declarer', record.declarer);
      push('Result', String(record.tricksTaken));
    } else {
      losses.push({
        field: 'contract',
        action: 'omitted',
        reason: '进行中且尚无完整出牌；PBN 的 Contract 必须与 Result/Play 成组写入',
      });
    }
  }

  if (
    record.status !== 'CANCELLED' &&
    record.status !== 'REOPENED' &&
    record.status !== 'INCOMPLETE' &&
    record.auction.calls.length > 0
  ) {
    push('Auction', record.deal.dealer);
    const tokens = record.auction.calls.map((call) => (call === 'PASS' ? 'P' : call));
    lines.push(tokens.join(' '));
    // PBN 导出永不写 AP，只在 calls 已包含结束所需的 Pass 时照原样输出。
    losses.push({
      field: 'auction.alert',
      action: 'omitted',
      reason: 'PBN 子集不保存提醒/规则 id；完整信息保留在 JSON',
    });
  }

  if (
    record.play &&
    record.play.tricks.length > 0 &&
    record.status !== 'PASSED_OUT' &&
    record.status !== 'INCOMPLETE'
  ) {
    push('Play', record.play.tricks[0].leader);
    for (const trick of record.play.tricks) {
      if (trick.cards.length !== 4) {
        losses.push({
          field: 'play.partialTrick',
          action: 'omitted',
          reason: 'PBN 对局导出只写完整墩；残局不得作为 .pbn 对局导出',
        });
        continue;
      }
      lines.push(trick.cards.map((item) => item.card.toUpperCase()).join(' '));
    }
  }

  const score = scoreTag(record.score);
  if (score === null) {
    losses.push({
      field: 'score',
      action: 'omitted',
      reason: `${record.status} 记录没有原始分（rawScore=null）；PBN 不再写 0`,
    });
  } else {
    push('Score', score);
  }

  if (record.engine) {
    losses.push({
      field: 'engine',
      action: 'omitted',
      reason: 'PBN 2.1 子集不承载 engine 快照；完整快照保留在 JSON',
    });
  }
  if (record.derived?.adjusted) {
    losses.push({
      field: 'derived.adjusted',
      action: 'omitted',
      reason: 'PBN 子集不承载导演调整分',
    });
  }

  return { text: `${lines.join('\n')}\n`, losses };
}

/** 便捷入口：记录 → PBN 文本。 */
export function toPbnRecordText(record: TableBoardRecord): string {
  return tableBoardToPbn(record).text;
}

export type { PbnDocument };
