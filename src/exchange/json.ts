/**
 * TableBoard JSON 导入 / 导出与验证。
 *
 * 不引入运行时 JSON Schema 依赖；按 `record.schema.json` 的必需字段、
 * `allOf` 状态约束与 `reproducibility.md` 的随机流公式做显式检查。
 */

import type { BidRecord, Position, Trick } from '../models/gameState';
import { nextPosition } from '../models/gameState';
import { parsePbnDeal } from '../core/pbn';
import { auctionOutcome } from '../core/auction';
import { isCallLegal } from '../core/bidding/validator';
import { determineTrickWinner } from '../core/trick';
import { trumpSuitOf } from '../models/gameState';
import { impsFromScoreDiff } from '../core/imps';
import { deriveStreamSeeds } from './rng';
import { callFromCode, contractFromRecord, toInternalVulnerability, toRecordVulnerability } from './record';
import { tokenToCard } from './cards';
import type {
  CallCode,
  EngineSnapshot,
  ExchangeIssue,
  RecordAdjustment,
  RecordContract,
  TableBoardRecord,
} from './types';

const CALL_CODES = new Set<string>([
  'PASS',
  'X',
  'XX',
  ...['1', '2', '3', '4', '5', '6', '7'].flatMap((level) =>
    ['C', 'D', 'H', 'S', 'NT'].map((suit) => `${level}${suit}`),
  ),
]);

const STATUSES = new Set([
  'IN_PROGRESS',
  'PLAYED',
  'PASSED_OUT',
  'CANCELLED',
  'ADJUSTED',
  'INCOMPLETE',
  'REOPENED',
]);
const LEGACY_STATUSES = new Set(['IN_PROGRESS', 'PLAYED', 'PASSED_OUT', 'CANCELLED', 'ADJUSTED']);
const SCHEMA_VERSIONS = new Set(['1.0', '1.1']);
const NO_SCORE_STATUSES = new Set(['CANCELLED', 'INCOMPLETE', 'REOPENED']);
const ADJUSTMENT_KINDS = new Set(['ADJUST', 'CANCEL', 'REOPEN']);
const SEATS = new Set(['N', 'E', 'S', 'W']);
const VULNERABILITIES = new Set(['NONE', 'NS', 'EW', 'ALL']);
const DOUBLED = new Set(['NONE', 'X', 'XX']);
const DENOMINATIONS = new Set(['C', 'D', 'H', 'S', 'NT']);
const RULESET_ID = /^sha256:[0-9a-f]{64}$/;
const RECORD_ID =
  /^urn:uuid:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class RecordValidationError extends Error {
  readonly issues: ExchangeIssue[];

  constructor(issues: ExchangeIssue[]) {
    const errors = issues.filter((issue) => issue.severity === 'error');
    super(
      errors.length > 0
        ? errors.map((issue) => `${issue.code}: ${issue.message}`).join('；')
        : '记录验证失败',
    );
    this.name = 'RecordValidationError';
    this.issues = issues;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSeat(value: unknown): value is Position {
  return typeof value === 'string' && SEATS.has(value);
}

function stringField(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function intField(value: unknown, min?: number, max?: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    (min === undefined || value >= min) &&
    (max === undefined || value <= max)
  );
}

/** 兼容历史导出：局况接受大小写与 both，叫品转大写。 */
export function normalizeRecord(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const normalized: Record<string, unknown> = { ...raw };
  if (isObject(raw.deal)) {
    const deal = { ...raw.deal };
    if (typeof deal.vulnerability === 'string') {
      try {
        deal.vulnerability = toRecordVulnerability(toInternalVulnerability(deal.vulnerability));
      } catch {
        // 交给验证器报告原始错误
      }
    }
    normalized.deal = deal;
  }
  if (isObject(raw.auction) && Array.isArray(raw.auction.calls)) {
    normalized.auction = {
      ...raw.auction,
      calls: raw.auction.calls.map((call) =>
        typeof call === 'string' ? call.trim().toUpperCase() : call,
      ),
    };
  }
  if (isObject(raw.contract)) {
    const contract = { ...raw.contract };
    if (typeof contract.denomination === 'string') {
      contract.denomination = contract.denomination.toUpperCase();
    }
    if (typeof contract.doubled === 'string') {
      contract.doubled = contract.doubled.toUpperCase();
    }
    normalized.contract = contract;
  }
  return normalized;
}

function checkAuction(
  record: Record<string, unknown>,
  dealer: Position,
  issues: ExchangeIssue[],
): void {
  const auction = record.auction;
  if (!isObject(auction)) {
    issues.push({ code: 'AUCTION_MISSING', severity: 'error', message: '缺少 auction', field: 'auction' });
    return;
  }
  if (!Array.isArray(auction.calls)) {
    issues.push({
      code: 'AUCTION_CALLS_INVALID',
      severity: 'error',
      message: 'auction.calls 必须是数组',
      field: 'auction.calls',
    });
    return;
  }
  if (typeof auction.completed !== 'boolean') {
    issues.push({
      code: 'AUCTION_COMPLETED_INVALID',
      severity: 'error',
      message: 'auction.completed 必须是布尔值',
      field: 'auction.completed',
    });
  }

  const history: BidRecord[] = [];
  let position = dealer;
  let currentBid: { level: number; suit: 'C' | 'D' | 'H' | 'S' | 'NT' } | null = null;
  let endedAt = -1;

  auction.calls.forEach((raw, index) => {
    const field = `auction.calls[${index}]`;
    if (typeof raw !== 'string' || !CALL_CODES.has(raw.toUpperCase())) {
      issues.push({
        code: 'INVALID_CALL',
        severity: 'error',
        message: `非法叫品码 "${String(raw)}"`,
        field,
      });
      return;
    }
    let call;
    try {
      call = callFromCode(raw);
    } catch (error) {
      issues.push({
        code: 'INVALID_CALL',
        severity: 'error',
        message: error instanceof Error ? error.message : String(error),
        field,
      });
      return;
    }
    if (!isCallLegal(history, currentBid, position, call)) {
      issues.push({
        code: 'INVALID_CALL',
        severity: 'error',
        message: `叫品 ${raw} 在 ${position} 家不合法`,
        field,
      });
    }
    history.push({ position, call });
    if (call.type === 'bid') {
      currentBid = { level: call.level, suit: call.suit };
    }
    if (endedAt === -1 && auctionOutcome(history, currentBid) !== 'none') {
      endedAt = index;
    } else if (endedAt !== -1) {
      issues.push({
        code: 'AUCTION_EXTRA_PASS',
        severity: 'warning',
        message: '叫牌结束后仍有额外叫品',
        field,
      });
    }
    position = nextPosition(position);
  });

  const status = record.status;
  if ((status === 'PLAYED' || status === 'PASSED_OUT') && auction.completed !== true) {
    issues.push({
      code: 'AUCTION_COMPLETED_INVALID',
      severity: 'error',
      message: `${String(status)} 记录必须标记 auction.completed=true`,
      field: 'auction.completed',
    });
  }
  if (status === 'PASSED_OUT') {
    if (auction.calls.length !== 4 || auction.calls.some((call) => call !== 'PASS')) {
      issues.push({
        code: 'PASSED_OUT_AUCTION_INVALID',
        severity: 'error',
        message: '流局必须是四个连续 PASS',
        field: 'auction.calls',
      });
    }
  }
}

function checkContract(
  record: Record<string, unknown>,
  deal: Record<string, unknown>,
  issues: ExchangeIssue[],
): Trick[] {
  const status = record.status as string;
  const contract = record.contract;
  const hasContract = contract !== undefined;
  const play = record.play;
  const dealt = parsePbnDeal(String(deal.pbn));
  const hands = new Map<number, Position>();
  for (const seat of ['N', 'E', 'S', 'W'] as Position[]) {
    for (const card of dealt.hands[seat]) hands.set(card, seat);
  }

  if (
    status === 'PASSED_OUT' ||
    status === 'CANCELLED' ||
    status === 'REOPENED' ||
    status === 'INCOMPLETE'
  ) {
    for (const field of ['contract', 'declarer', 'tricksTaken', 'play']) {
      if (record[field] !== undefined) {
        issues.push({
          code: 'CONTRACT_STATE_INVALID',
          severity: 'error',
          message: `${status} 记录不得包含 ${field}`,
          field,
        });
      }
    }
    return [];
  }

  if (hasContract) {
    if (!isObject(contract)) {
      issues.push({
        code: 'CONTRACT_INVALID',
        severity: 'error',
        message: 'contract 必须是对象',
        field: 'contract',
      });
    } else {
      if (!intField(contract.level, 1, 7)) {
        issues.push({
          code: 'CONTRACT_INVALID',
          severity: 'error',
          message: 'contract.level 必须是 1-7 的整数',
          field: 'contract.level',
        });
      }
      if (typeof contract.denomination !== 'string' || !DENOMINATIONS.has(contract.denomination)) {
        issues.push({
          code: 'CONTRACT_INVALID',
          severity: 'error',
          message: 'contract.denomination 非法',
          field: 'contract.denomination',
        });
      }
      if (typeof contract.doubled !== 'string' || !DOUBLED.has(contract.doubled)) {
        issues.push({
          code: 'CONTRACT_INVALID',
          severity: 'error',
          message: 'contract.doubled 非法',
          field: 'contract.doubled',
        });
      }
    }
    if (!isSeat(record.declarer)) {
      issues.push({
        code: 'DECLARER_INVALID',
        severity: 'error',
        message: '有定约时 declarer 必须是 N/E/S/W',
        field: 'declarer',
      });
    }
    if (!intField(record.tricksTaken, 0, 13)) {
      issues.push({
        code: 'TRICKS_TAKEN_INVALID',
        severity: 'error',
        message: '有定约时 tricksTaken 必须是 0-13 的整数',
        field: 'tricksTaken',
      });
    }
  }

  if (status === 'PLAYED' && (!hasContract || record.declarer === undefined || record.tricksTaken === undefined)) {
    issues.push({
      code: 'CONTRACT_STATE_INVALID',
      severity: 'error',
      message: 'PLAYED 记录必须包含 contract / declarer / tricksTaken / play',
      field: 'status',
    });
  }

  const tricks: Trick[] = [];
  if (play !== undefined) {
    if (!hasContract || !isSeat(record.declarer)) {
      issues.push({
        code: 'CONTRACT_MISSING',
        severity: 'error',
        message: '存在 play 时必须同时给出 contract 与 declarer',
        field: 'play',
      });
      return tricks;
    }
    if (!isObject(play) || !Array.isArray(play.tricks)) {
      issues.push({
        code: 'PLAY_INVALID',
        severity: 'error',
        message: 'play.tricks 必须是数组',
        field: 'play.tricks',
      });
      return tricks;
    }
    if (play.tricks.length < 1 || play.tricks.length > 13) {
      issues.push({
        code: 'PLAY_INVALID',
        severity: 'error',
        message: 'play.tricks 长度必须是 1-13',
        field: 'play.tricks',
      });
    }

    const internalContract = contractFromRecord(contract as RecordContract, record.declarer);
    const trump = trumpSuitOf(internalContract);
    const used = new Set<number>();

    play.tricks.forEach((rawTrick, trickIndex) => {
      const field = `play.tricks[${trickIndex}]`;
      if (!isObject(rawTrick) || !Array.isArray(rawTrick.cards) || rawTrick.cards.length !== 4) {
        issues.push({
          code: 'PLAY_INVALID',
          severity: 'error',
          message: '每墩必须包含 leader / winner / 四张 cards',
          field,
        });
        return;
      }
      if (!isSeat(rawTrick.leader) || !isSeat(rawTrick.winner)) {
        issues.push({
          code: 'PLAY_INVALID',
          severity: 'error',
          message: 'trick.leader / trick.winner 必须是座位',
          field,
        });
        return;
      }
      const plays = rawTrick.cards.map((rawCard, cardIndex) => {
        if (!isObject(rawCard) || !isSeat(rawCard.seat) || typeof rawCard.card !== 'string') {
          issues.push({
            code: 'PLAY_INVALID',
            severity: 'error',
            message: 'card 必须包含 seat 与规范牌张',
            field: `${field}.cards[${cardIndex}]`,
          });
          return null;
        }
        let card: number;
        try {
          card = tokenToCard(rawCard.card);
        } catch (error) {
          issues.push({
            code: 'INVALID_PLAY_CARD',
            severity: 'error',
            message: error instanceof Error ? error.message : String(error),
            field: `${field}.cards[${cardIndex}]`,
          });
          return null;
        }
        if (hands.get(card) === undefined) {
          issues.push({
            code: 'INVALID_PLAY_CARD',
            severity: 'error',
            message: `牌 ${rawCard.card} 不在开局四手牌中`,
            field: `${field}.cards[${cardIndex}]`,
          });
        }
        if (used.has(card)) {
          issues.push({
            code: 'DUPLICATE_CARD',
            severity: 'error',
            message: `牌 ${rawCard.card} 在出牌过程中重复出现`,
            field: `${field}.cards[${cardIndex}]`,
          });
        }
        used.add(card);
        return { position: rawCard.seat, card };
      });
      if (plays.every((play): play is { position: Position; card: number } => play !== null)) {
        const winner = determineTrickWinner(plays, trump);
        if (winner !== rawTrick.winner) {
          issues.push({
            code: 'TRICK_WINNER_MISMATCH',
            severity: 'warning',
            message: `第 ${trickIndex + 1} 墩 winner 应为 ${winner}，记录为 ${rawTrick.winner}`,
            field: `${field}.winner`,
          });
        }
        tricks.push({ leader: rawTrick.leader, winner, plays });
      }
    });
  }

  if (status === 'PLAYED' && play === undefined) {
    issues.push({
      code: 'CONTRACT_STATE_INVALID',
      severity: 'error',
      message: 'PLAYED 记录必须包含 play',
      field: 'play',
    });
  }

  return tricks;
}

function checkEngine(record: Record<string, unknown>, issues: ExchangeIssue[]): void {  const engine = record.engine;
  if (!isObject(engine)) {
    issues.push({
      code: 'ENGINE_MISSING',
      severity: 'error',
      message: '缺少 engine 快照；旧版记录不能作为 Profile S 记录导入',
      field: 'engine',
    });
    return;
  }

  const dealSource = engine.dealSource;
  if (!isObject(dealSource) || (dealSource.kind !== 'seeded' && dealSource.kind !== 'imported-pbn')) {
    issues.push({
      code: 'ENGINE_DEAL_SOURCE_INVALID',
      severity: 'error',
      message: 'engine.dealSource.kind 必须是 seeded 或 imported-pbn',
      field: 'engine.dealSource',
    });
  } else if (dealSource.kind === 'seeded') {
    if (!intField(dealSource.baseSeed)) {
      issues.push({
        code: 'ENGINE_DEAL_SOURCE_INVALID',
        severity: 'error',
        message: 'seeded 记录必须含整数 baseSeed',
        field: 'engine.dealSource.baseSeed',
      });
    }
    if (!intField(dealSource.index, 0)) {
      issues.push({
        code: 'ENGINE_DEAL_SOURCE_INVALID',
        severity: 'error',
        message: 'seeded 记录必须含非负整数 index',
        field: 'engine.dealSource.index',
      });
    }
  }

  const streams = engine.streams;
  const requiredStreams: Array<'bidding' | 'play' | 'dds'> = ['bidding', 'play', 'dds'];
  if (!isObject(streams)) {
    if (engine.rngMode !== 'legacy-shared' || !intField(engine.rngSeed)) {
      issues.push({
        code: 'STREAM_SEED_MISSING',
        severity: 'error',
        message: '缺少 engine.streams；只有声明 legacy-shared 的旧记录可仅用 rngSeed',
        field: 'engine.streams',
      });
    } else {
      issues.push({
        code: 'LEGACY_RNG_SHARED',
        severity: 'warning',
        message: '旧记录使用共享 rngSeed，不能作为四条流可复现的证明',
        field: 'engine.rngMode',
      });
    }
  } else {
    const needed =
      isObject(dealSource) && dealSource.kind === 'seeded'
        ? (['deal', 'bidding', 'play', 'dds'] as const)
        : requiredStreams;
    for (const stream of needed) {
      if (!intField(streams[stream])) {
        issues.push({
          code: 'STREAM_SEED_MISSING',
          severity: 'error',
          message: `缺少 engine.streams.${stream}`,
          field: `engine.streams.${stream}`,
        });
      }
    }
    if (
      isObject(dealSource) &&
      dealSource.kind === 'seeded' &&
      intField(dealSource.baseSeed) &&
      intField(dealSource.index)
    ) {
      const expected = deriveStreamSeeds(dealSource.baseSeed, dealSource.index);
      for (const stream of ['deal', 'bidding', 'play', 'dds'] as const) {
        if (intField(streams[stream]) && streams[stream] !== expected[stream]) {
          issues.push({
            code: 'STREAM_SEED_MISMATCH',
            severity: 'error',
            message: `streams.${stream}=${streams[stream]}，按公式应为 ${expected[stream]}`,
            field: `engine.streams.${stream}`,
          });
        }
      }
      if (intField(streams.deal) && engine.rngSeed !== undefined && engine.rngSeed !== streams.deal) {
        issues.push({
          code: 'RNG_SEED_MISMATCH',
          severity: 'warning',
          message: 'engine.rngSeed 应等于 streams.deal（新记录兼容约定）',
          field: 'engine.rngSeed',
        });
      }
    }
  }

  if (
    engine.rulesVersion !== undefined &&
    engine.rulesVersion !== 'wbf-laws-2017'
  ) {
    issues.push({
      code: 'RULES_VERSION_INVALID',
      severity: 'error',
      message: 'engine.rulesVersion 目前只支持 wbf-laws-2017',
      field: 'engine.rulesVersion',
    });
  }

  const ruleset = engine.ruleset;
  if (!isObject(ruleset)) {
    issues.push({
      code: 'RULESET_INVALID',
      severity: 'error',
      message: '缺少 engine.ruleset',
      field: 'engine.ruleset',
    });
  } else {
    for (const field of ['system', 'systemVersion'] as const) {
      if (!stringField(ruleset[field])) {
        issues.push({
          code: 'RULESET_INVALID',
          severity: 'error',
          message: `engine.ruleset.${field} 必须是非空字符串`,
          field: `engine.ruleset.${field}`,
        });
      }
    }
    if (typeof ruleset.rulesetId !== 'string' || !RULESET_ID.test(ruleset.rulesetId)) {
      issues.push({
        code: 'RULESET_INVALID',
        severity: 'error',
        message: 'engine.ruleset.rulesetId 必须是 sha256: + 64 位小写十六进制',
        field: 'engine.ruleset.rulesetId',
      });
    }
    if (typeof ruleset.overlay !== 'boolean') {
      issues.push({
        code: 'RULESET_INVALID',
        severity: 'error',
        message: 'engine.ruleset.overlay 必须是布尔值',
        field: 'engine.ruleset.overlay',
      });
    }
  }

  const playRulesets = engine.playRulesets;
  if (!isObject(playRulesets)) {
    issues.push({
      code: 'PLAY_RULESET_INVALID',
      severity: 'error',
      message: '缺少 engine.playRulesets',
      field: 'engine.playRulesets',
    });
  } else {
    for (const kind of ['lead', 'signal'] as const) {
      const ref = playRulesets[kind];
      if (!isObject(ref)) {
        issues.push({
          code: 'PLAY_RULESET_INVALID',
          severity: 'error',
          message: `缺少 engine.playRulesets.${kind}`,
          field: `engine.playRulesets.${kind}`,
        });
        continue;
      }
      if (!stringField(ref.name)) {
        issues.push({
          code: 'PLAY_RULESET_INVALID',
          severity: 'error',
          message: `${kind} 规则集缺少 name`,
          field: `engine.playRulesets.${kind}.name`,
        });
      }
      if (typeof ref.rulesetId !== 'string' || !RULESET_ID.test(ref.rulesetId)) {
        issues.push({
          code: 'PLAY_RULESET_INVALID',
          severity: 'error',
          message: `${kind} 规则集 rulesetId 非法`,
          field: `engine.playRulesets.${kind}.rulesetId`,
        });
      }
      if (typeof ref.overlay !== 'boolean') {
        issues.push({
          code: 'PLAY_RULESET_INVALID',
          severity: 'error',
          message: `${kind} 规则集 overlay 必须是布尔值`,
          field: `engine.playRulesets.${kind}.overlay`,
        });
      }
      if (kind === 'signal' && !isObject(ref.settings)) {
        issues.push({
          code: 'PLAY_RULESET_INVALID',
          severity: 'error',
          message: 'signal 规则集必须含 settings',
          field: 'engine.playRulesets.signal.settings',
        });
      }
    }
  }

  const seats = engine.seats;
  if (!isObject(seats)) {
    issues.push({
      code: 'SEATS_INVALID',
      severity: 'error',
      message: '缺少 engine.seats',
      field: 'engine.seats',
    });
  } else {
    for (const seat of ['N', 'E', 'S', 'W'] as const) {
      const value = seats[seat];
      if (!isObject(value) || !['human', 'ai', 'auto-ai'].includes(String(value.controller))) {
        issues.push({
          code: 'SEATS_INVALID',
          severity: 'error',
          message: `engine.seats.${seat}.controller 必须是 human / ai / auto-ai`,
          field: `engine.seats.${seat}`,
        });
      }
    }
  }

  const inference = engine.inference;
  if (
    !isObject(inference) ||
    typeof inference.auctionConstraints !== 'boolean' ||
    typeof inference.leadInference !== 'boolean'
  ) {
    issues.push({
      code: 'INFERENCE_INVALID',
      severity: 'error',
      message: 'engine.inference 必须含布尔值 auctionConstraints / leadInference',
      field: 'engine.inference',
    });
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isObject(a) && isObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return (
      keysA.length === keysB.length &&
      keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]))
    );
  }
  return false;
}

function checkAdjustmentEntry(
  value: unknown,
  field: string,
  issues: ExchangeIssue[],
): value is RecordAdjustment {
  if (!isObject(value)) {
    issues.push({
      code: 'ADJUSTMENT_INVALID',
      severity: 'error',
      message: '调整记录必须是对象',
      field,
    });
    return false;
  }
  const start = issues.length;
  if (typeof value.kind !== 'string' || !ADJUSTMENT_KINDS.has(value.kind)) {
    issues.push({
      code: 'ADJUSTMENT_INVALID',
      severity: 'error',
      message: 'adjustment.kind 必须是 ADJUST / CANCEL / REOPEN',
      field: `${field}.kind`,
    });
  }
  for (const key of ['reason', 'actor'] as const) {
    if (!stringField(value[key])) {
      issues.push({
        code: 'ADJUSTMENT_INVALID',
        severity: 'error',
        message: `adjustment.${key} 必须是非空字符串`,
        field: `${field}.${key}`,
      });
    }
  }
  if (typeof value.at !== 'string' || Number.isNaN(Date.parse(value.at))) {
    issues.push({
      code: 'ADJUSTMENT_INVALID',
      severity: 'error',
      message: 'adjustment.at 必须是 ISO 8601 时间',
      field: `${field}.at`,
    });
  }
  for (const key of ['beforeStatus', 'afterStatus'] as const) {
    if (typeof value[key] !== 'string' || !STATUSES.has(value[key] as string)) {
      issues.push({
        code: 'ADJUSTMENT_INVALID',
        severity: 'error',
        message: `adjustment.${key} 必须是合法状态`,
        field: `${field}.${key}`,
      });
    }
  }
  for (const key of ['beforeValue', 'afterValue'] as const) {
    const raw = value[key];
    if (raw !== null && !intField(raw)) {
      issues.push({
        code: 'ADJUSTMENT_INVALID',
        severity: 'error',
        message: `adjustment.${key} 必须是整数或 null`,
        field: `${field}.${key}`,
      });
    }
  }
  if (value.originalRawScore !== undefined && value.originalRawScore !== null && !intField(value.originalRawScore)) {
    issues.push({
      code: 'ADJUSTMENT_INVALID',
      severity: 'error',
      message: 'adjustment.originalRawScore 必须是整数或 null',
      field: `${field}.originalRawScore`,
    });
  }
  if (value.kind === 'ADJUST' && !intField(value.afterValue)) {
    issues.push({
      code: 'ADJUSTMENT_INVALID',
      severity: 'error',
      message: 'ADJUST 记录的 afterValue 必须是整数',
      field: `${field}.afterValue`,
    });
  }
  if ((value.kind === 'CANCEL' || value.kind === 'REOPEN') && value.afterValue !== null) {
    issues.push({
      code: 'ADJUSTMENT_INVALID',
      severity: 'error',
      message: `${value.kind} 记录的 afterValue 必须为 null`,
      field: `${field}.afterValue`,
    });
  }
  if (value.artificialAverage !== undefined) {
    const average = value.artificialAverage;
    if (
      !isObject(average) ||
      !intField(average.nsRaw) ||
      average.artificial !== true
    ) {
      issues.push({
        code: 'ADJUSTMENT_INVALID',
        severity: 'error',
        message: 'artificialAverage 必须含整数 nsRaw 与 artificial=true',
        field: `${field}.artificialAverage`,
      });
    }
  }
  return issues.length === start;
}

function checkAdjustments(
  record: Record<string, unknown>,
  issues: ExchangeIssue[],
): void {
  const schemaVersion = String(record.schemaVersion);
  const status = String(record.status);
  const adjustment = record.adjustment;
  const rawHistory = record.adjustHistory;

  let history: RecordAdjustment[] = [];
  if (rawHistory !== undefined) {
    if (!Array.isArray(rawHistory) || rawHistory.length === 0) {
      issues.push({
        code: 'ADJUSTMENT_INVALID',
        severity: 'error',
        message: 'adjustHistory 必须是非空数组',
        field: 'adjustHistory',
      });
    } else {
      history = rawHistory.filter((entry, index) =>
        checkAdjustmentEntry(entry, `adjustHistory[${index}]`, issues),
      ) as RecordAdjustment[];
    }
  }

  if (adjustment !== undefined) {
    checkAdjustmentEntry(adjustment, 'adjustment', issues);
  }

  if (adjustment !== undefined && history.length > 0) {
    const latest = history[history.length - 1];
    if (!deepEqual(adjustment, latest)) {
      issues.push({
        code: 'ADJUSTMENT_HISTORY_MISMATCH',
        severity: 'error',
        message: 'adjustment 必须等于 adjustHistory 的最后一条',
        field: 'adjustment',
      });
    }
  }

  const score = isObject(record.score) ? record.score : undefined;
  const nsRaw = score?.nsRaw;

  if (status === 'ADJUSTED') {
    if (!isObject(adjustment)) {
      issues.push({
        code: 'ADJUSTED_INVALID',
        severity: 'error',
        message: 'ADJUSTED 记录必须含 adjustment',
        field: 'adjustment',
      });
    } else if (adjustment.kind !== 'ADJUST') {
      issues.push({
        code: 'ADJUSTED_INVALID',
        severity: 'error',
        message: 'ADJUSTED 的 adjustment.kind 必须是 ADJUST',
        field: 'adjustment.kind',
      });
    } else if (intField(nsRaw) && adjustment.afterValue !== nsRaw) {
      issues.push({
        code: 'ADJUSTED_INVALID',
        severity: 'error',
        message: `adjustment.afterValue=${String(adjustment.afterValue)} 与 score.nsRaw=${nsRaw} 不一致`,
        field: 'adjustment.afterValue',
      });
    }
    if (!rawHistory) {
      issues.push({
        code: 'ADJUSTED_INVALID',
        severity: 'error',
        message: 'ADJUSTED 记录必须含 adjustHistory',
        field: 'adjustHistory',
      });
    }
  }

  if (status === 'CANCELLED') {
    if (!isObject(adjustment)) {
      issues.push({
        code: 'CANCELLED_REASON_MISSING',
        severity: schemaVersion === '1.1' ? 'error' : 'warning',
        message: 'CANCELLED 记录应含 adjustment（取消原因/操作人/时间）',
        field: 'adjustment',
      });
    } else if (adjustment.kind !== 'CANCEL') {
      issues.push({
        code: 'CANCELLED_REASON_MISSING',
        severity: 'error',
        message: 'CANCELLED 的 adjustment.kind 必须是 CANCEL',
        field: 'adjustment.kind',
      });
    }
  }

  if (status === 'REOPENED') {
    if (!isObject(adjustment)) {
      issues.push({
        code: 'REOPENED_REASON_MISSING',
        severity: 'error',
        message: 'REOPENED 记录必须含 adjustment（重开原因/操作人/时间）',
        field: 'adjustment',
      });
    } else if (adjustment.kind !== 'REOPEN') {
      issues.push({
        code: 'REOPENED_REASON_MISSING',
        severity: 'error',
        message: 'REOPENED 的 adjustment.kind 必须是 REOPEN',
        field: 'adjustment.kind',
      });
    }
  }
}

function checkScore(
  record: Record<string, unknown>,
  issues: ExchangeIssue[],
): void {
  const schemaVersion = String(record.schemaVersion);
  const status = String(record.status);
  const score = record.score;
  if (!isObject(score)) {
    issues.push({ code: 'SCORE_INVALID', severity: 'error', message: '缺少 score', field: 'score' });
    return;
  }
  if (score.source !== 'computed' && score.source !== 'director') {
    issues.push({
      code: 'SCORE_INVALID',
      severity: 'error',
      message: 'score.source 必须是 computed / director',
      field: 'score.source',
    });
  }

  const nsRaw = score.nsRaw;
  const noScore = NO_SCORE_STATUSES.has(status);
  const legacyCancelled = schemaVersion === '1.0' && status === 'CANCELLED';

  if (nsRaw === null) {
    if (!noScore) {
      issues.push({
        code: 'SCORE_STATE_INVALID',
        severity: 'error',
        message: `${status} 记录必须有整数 score.nsRaw`,
        field: 'score.nsRaw',
      });
    }
  } else if (!intField(nsRaw)) {
    issues.push({
      code: 'SCORE_INVALID',
      severity: 'error',
      message: 'score.nsRaw 必须是整数或 null',
      field: 'score.nsRaw',
    });
  } else if (noScore && !legacyCancelled) {
    issues.push({
      code: 'SCORE_STATE_INVALID',
      severity: 'error',
      message: `${status} 记录必须写 score.nsRaw=null（不得写 0）`,
      field: 'score.nsRaw',
    });
  } else if (legacyCancelled) {
    issues.push({
      code: 'LEGACY_CANCELLED_ZERO_SCORE',
      severity: 'warning',
      message: 'Schema 1.0 取消副写了数字原始分；1.1 起应写 null',
      field: 'score.nsRaw',
    });
  }
  if (status === 'PASSED_OUT' && nsRaw !== 0) {
    issues.push({
      code: 'SCORE_STATE_INVALID',
      severity: 'error',
      message: 'PASSED_OUT 的 score.nsRaw 必须为 0',
      field: 'score.nsRaw',
    });
  }

  const derived = record.derived;
  if (!isObject(derived)) return;
  const imp = derived.imp;
  if (!isObject(imp)) return;
  if (imp.tableVersion !== undefined && imp.tableVersion !== 'wbf-2017') {
    issues.push({
      code: 'IMP_TABLE_INVALID',
      severity: 'error',
      message: 'derived.imp.tableVersion 目前只支持 wbf-2017',
      field: 'derived.imp.tableVersion',
    });
  }
  if (nsRaw === null) {
    if (imp.singleTable !== null) {
      issues.push({
        code: 'IMP_STATE_INVALID',
        severity: 'error',
        message: '无原始分时 derived.imp.singleTable 必须为 null',
        field: 'derived.imp.singleTable',
      });
    }
    return;
  }
  if (imp.singleTable === undefined) return;
  if (!intField(imp.singleTable)) {
    issues.push({
      code: 'IMP_STATE_INVALID',
      severity: 'error',
      message: 'derived.imp.singleTable 必须是整数或 null',
      field: 'derived.imp.singleTable',
    });
    return;
  }
  if (!intField(nsRaw)) return;
  const expected = impsFromScoreDiff(nsRaw);
  if (imp.singleTable !== expected) {
    issues.push({
      code: 'IMP_MISMATCH',
      severity: 'warning',
      message: `derived.imp.singleTable=${imp.singleTable}，按 wbf-2017 应为 ${expected}`,
      field: 'derived.imp.singleTable',
    });
  }
}

/** 校验任意 JSON 值是否为合法的 TableBoard 记录。 */
export function validateTableBoardRecord(value: unknown): ExchangeIssue[] {
  const issues: ExchangeIssue[] = [];
  const record = normalizeRecord(value);
  if (!isObject(record)) {
    return [{ code: 'RECORD_INVALID', severity: 'error', message: '记录必须是 JSON 对象' }];
  }

  if (record.format !== 'bridge-record') {
    issues.push({ code: 'RECORD_INVALID', severity: 'error', message: 'format 必须是 bridge-record', field: 'format' });
  }
  if (typeof record.schemaVersion !== 'string' || !SCHEMA_VERSIONS.has(record.schemaVersion)) {
    issues.push({
      code: 'RECORD_INVALID',
      severity: 'error',
      message: 'schemaVersion 必须是 1.0 或 1.1',
      field: 'schemaVersion',
    });
  }
  if (record.profile !== 'standalone') {
    issues.push({ code: 'RECORD_INVALID', severity: 'error', message: 'profile 必须是 standalone', field: 'profile' });
  }
  if (record.recordType !== 'table-board') {
    issues.push({ code: 'RECORD_INVALID', severity: 'error', message: 'recordType 必须是 table-board', field: 'recordType' });
  }
  if (typeof record.recordId !== 'string' || !RECORD_ID.test(record.recordId)) {
    issues.push({
      code: 'RECORD_ID_INVALID',
      severity: 'error',
      message: 'recordId 必须是 urn:uuid: 格式',
      field: 'recordId',
    });
  }
  if (
    typeof record.createdAt !== 'string' ||
    Number.isNaN(Date.parse(record.createdAt))
  ) {
    issues.push({
      code: 'CREATED_AT_INVALID',
      severity: 'error',
      message: 'createdAt 必须是 ISO 8601 时间',
      field: 'createdAt',
    });
  }
  if (record.producer !== undefined) {
    if (!isObject(record.producer) || !stringField(record.producer.application)) {
      issues.push({
        code: 'PRODUCER_INVALID',
        severity: 'error',
        message: 'producer.application 必须是非空字符串',
        field: 'producer',
      });
    }
  }

  const deal = record.deal;
  if (!isObject(deal)) {
    issues.push({ code: 'DEAL_INVALID', severity: 'error', message: '缺少 deal', field: 'deal' });
    return issues;
  }
  if (!stringField(deal.dealId)) {
    issues.push({ code: 'DEAL_INVALID', severity: 'error', message: 'deal.dealId 缺失', field: 'deal.dealId' });
  }
  if (!intField(deal.boardNumber, 1)) {
    issues.push({
      code: 'DEAL_INVALID',
      severity: 'error',
      message: 'deal.boardNumber 必须是正整数',
      field: 'deal.boardNumber',
    });
  }
  if (!isSeat(deal.dealer)) {
    issues.push({ code: 'DEAL_INVALID', severity: 'error', message: 'deal.dealer 非法', field: 'deal.dealer' });
  }
  if (typeof deal.vulnerability !== 'string' || !VULNERABILITIES.has(deal.vulnerability)) {
    issues.push({
      code: 'DEAL_INVALID',
      severity: 'error',
      message: 'deal.vulnerability 必须是 NONE / NS / EW / ALL',
      field: 'deal.vulnerability',
    });
  }
  if (typeof deal.pbn !== 'string' || deal.pbn.length === 0) {
    issues.push({ code: 'DEAL_INVALID', severity: 'error', message: 'deal.pbn 缺失', field: 'deal.pbn' });
    return issues;
  }
  try {
    const parsed = parsePbnDeal(deal.pbn);
    if (isSeat(deal.dealer) && parsed.dealer !== deal.dealer) {
      issues.push({
        code: 'DEALER_PREFIX_MISMATCH',
        severity: 'warning',
        message: `[Dealer] ${deal.dealer} 与 Deal 前缀 ${parsed.dealer} 不同；以 [Dealer] 为准`,
        field: 'deal.pbn',
      });
    }
  } catch (error) {
    issues.push({
      code: 'DEAL_INVALID',
      severity: 'error',
      message: error instanceof Error ? error.message : String(error),
      field: 'deal.pbn',
    });
    return issues;
  }

  if (typeof record.status !== 'string' || !STATUSES.has(record.status)) {
    issues.push({ code: 'STATUS_INVALID', severity: 'error', message: 'status 非法', field: 'status' });
  } else if (record.schemaVersion === '1.0' && !LEGACY_STATUSES.has(record.status)) {
    issues.push({
      code: 'STATUS_INVALID',
      severity: 'error',
      message: `Schema 1.0 不支持 status=${record.status}；请升级到 1.1`,
      field: 'status',
    });
  }

  if (isSeat(deal.dealer)) checkAuction(record, deal.dealer, issues);
  checkContract(record, deal, issues);

  const hcp = record.hcp;
  if (!isObject(hcp) || !intField(hcp.ns, 0, 40) || !intField(hcp.ew, 0, 40)) {
    issues.push({
      code: 'HCP_INVALID',
      severity: 'error',
      message: 'hcp.ns / hcp.ew 必须是 0-40 的整数',
      field: 'hcp',
    });
  } else if (hcp.ns + hcp.ew !== 40) {
    issues.push({
      code: 'HCP_SUM_INVALID',
      severity: 'error',
      message: `hcp.ns + hcp.ew = ${hcp.ns + hcp.ew}，应为 40`,
      field: 'hcp',
    });
  }

  checkScore(record, issues);

  checkAdjustments(record, issues);

  if (record.status === 'ADJUSTED') {
    const derived = record.derived;
    if (
      record.schemaVersion === '1.0' &&
      (!isObject(derived) || !isObject(derived.adjusted))
    ) {
      issues.push({
        code: 'ADJUSTED_INVALID',
        severity: 'error',
        message: 'Schema 1.0 的 ADJUSTED 记录必须含 derived.adjusted',
        field: 'derived.adjusted',
      });
    }
  }

  checkEngine(record, issues);
  return issues;
}

export function assertValidTableBoardRecord(value: unknown): TableBoardRecord {
  const record = normalizeRecord(value) as TableBoardRecord;
  const issues = validateTableBoardRecord(record);
  if (issues.some((issue) => issue.severity === 'error')) {
    throw new RecordValidationError(issues);
  }
  return record;
}

/**
 * 字符串 → TableBoard 记录，同时返回 warning / info 级诊断。
 *
 * error 级诊断仍抛出 RecordValidationError；调用方可把返回的 issues 直接
 * 展示给用户（例如 Dealer 前缀不一致的警告）。
 */
export function parseTableBoardRecordDetailed(text: string): {
  record: TableBoardRecord;
  issues: ExchangeIssue[];
} {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    throw new RecordValidationError([
      {
        code: 'JSON_INVALID',
        severity: 'error',
        message: error instanceof Error ? error.message : String(error),
      },
    ]);
  }
  const record = normalizeRecord(raw) as TableBoardRecord;
  const issues = validateTableBoardRecord(record);
  if (issues.some((issue) => issue.severity === 'error')) {
    throw new RecordValidationError(issues);
  }
  return { record, issues };
}

/** 字符串 → TableBoard 记录；验证失败抛出 RecordValidationError。 */
export function parseTableBoardRecord(text: string): TableBoardRecord {
  return parseTableBoardRecordDetailed(text).record;
}

/** TableBoard 记录 → 稳定格式 JSON（LF、末尾换行、2 空格缩进）。 */
export function toTableBoardJson(record: TableBoardRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export type { CallCode, EngineSnapshot };
