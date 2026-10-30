/**
 * 内部对局状态 → Profile S TableBoard 记录。
 *
 * 只做纯数据转换；不读取 store、不访问 UI。开局快照由调用方（store）
 * 在 `beginAuction` 时冻结后传入，保证记录中的 `engine` 与当前副一致。
 */

import type { BidCall, BidRecord, Contract, Position, Trick } from '../models/gameState';
import { getSide, getPartner } from '../models/gameState';
import { toPbnDeal } from '../core/pbn';
import { auctionOutcome } from '../core/auction';
import { lastBidOf } from '../core/bidding/validator';
import { impsFromScoreDiff } from '../core/imps';
import { WBF_2017_VERSION } from '../core/impTable';
import type { Hand } from '../models/hand';
import { cardToToken } from './cards';
import type {
  CallCode,
  EngineSnapshot,
  InternalVulnerability,
  Producer,
  RecordAdjustment,
  RecordContract,
  RecordPlay,
  RecordStatus,
  RecordVulnerability,
  TableBoardRecord,
} from './types';

export const PRODUCER_APPLICATION = 'bridge-mvp';
export const ENGINE_VERSION = '0.1.0';
export const RECORD_SCHEMA_VERSION = '1.1' as const;

export function toRecordVulnerability(value: InternalVulnerability): RecordVulnerability {
  switch (value) {
    case 'none':
      return 'NONE';
    case 'both':
      return 'ALL';
    case 'NS':
      return 'NS';
    case 'EW':
      return 'EW';
  }
}

export function toInternalVulnerability(value: string): InternalVulnerability {
  switch (value.trim().toUpperCase()) {
    case 'NONE':
    case 'NIL':
    case 'LOVE':
      return 'none';
    case 'NS':
      return 'NS';
    case 'EW':
      return 'EW';
    case 'ALL':
    case 'BOTH':
      return 'both';
    default:
      throw new Error(`未知局况: "${value}"`);
  }
}

/** BidCall → 记录中的规范叫品码。 */
export function callToCode(call: BidCall): CallCode {
  switch (call.type) {
    case 'pass':
      return 'PASS';
    case 'double':
      return 'X';
    case 'redouble':
      return 'XX';
    case 'bid':
      return `${call.level}${call.suit}` as CallCode;
  }
}

/** 记录中的规范叫品码 → BidCall。 */
export function callFromCode(code: string): BidCall {
  const text = code.trim().toUpperCase();
  if (text === 'PASS' || text === 'P') return { type: 'pass' };
  if (text === 'X') return { type: 'double' };
  if (text === 'XX') return { type: 'redouble' };
  const match = /^([1-7])(C|D|H|S|NT)$/.exec(text);
  if (!match) throw new Error(`非法叫品码: "${code}"`);
  return {
    type: 'bid',
    level: Number(match[1]),
    suit: match[2] as 'C' | 'D' | 'H' | 'S' | 'NT',
  };
}

export function contractToRecord(contract: Contract): RecordContract {
  return {
    level: contract.level,
    denomination: contract.suit,
    doubled: contract.doubled ? 'X' : contract.redoubled ? 'XX' : 'NONE',
  };
}

export function contractFromRecord(
  contract: RecordContract,
  declarer: Position,
): Contract {
  return {
    level: contract.level,
    suit: contract.denomination,
    doubled: contract.doubled === 'X',
    redoubled: contract.doubled === 'XX',
    declarer,
    dummy: getPartner(declarer),
  };
}

function declarerTricks(contract: Contract | null, tricks: Trick[]): number {
  if (!contract) return 0;
  const side = getSide(contract.declarer);
  return tricks.filter((trick) => getSide(trick.winner) === side).length;
}

function playFromTricks(tricks: Trick[]): RecordPlay | undefined {
  const complete = tricks.filter((trick) => trick.plays.length === 4);
  if (complete.length === 0) return undefined;
  return {
    tricks: complete.map((trick) => ({
      leader: trick.leader,
      winner: trick.winner,
      cards: trick.plays.map((play) => ({
        seat: play.position,
        card: cardToToken(play.card),
      })),
    })),
  };
}

export function createRecordId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `urn:uuid:${cryptoObj.randomUUID()}`;
  }
  const bytes = new Uint8Array(16);
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createDealId(boardNumber: number): string {
  return `deal-${String(Math.max(1, boardNumber)).padStart(4, '0')}`;
}

export interface RecordBuildInput {
  recordId?: string;
  createdAt?: string;
  producer?: Producer;
  dealId?: string;
  boardNumber: number;
  dealer: Position;
  vulnerability: InternalVulnerability;
  /** 开局四手牌；仅在未提供 pbn 时用于生成。 */
  hands?: Record<Position, Hand>;
  pbn?: string;
  status?: RecordStatus;
  biddingHistory: BidRecord[];
  contract: Contract | null;
  /** 已完成的墩；进行中的墩不进入记录（记录 Play 的一墩必须四张）。 */
  tricks: Trick[];
  /** 双方得分；无成绩状态传 null（原始分写 null，不写 0）。 */
  score: { NS: number; EW: number } | null;
  scoreSource?: 'computed' | 'director';
  hcp: { NS: number; EW: number };
  engine: EngineSnapshot;
  auctionCompleted?: boolean;
  tricksTaken?: number;
  /** 裁判操作最新一条；未提供时取 adjustHistory 最后一条。 */
  adjustment?: RecordAdjustment;
  adjustHistory?: RecordAdjustment[];
  updatedAt?: string;
}

function deriveStatus(input: RecordBuildInput): RecordStatus {
  if (input.status) return input.status;
  if (input.contract) {
    return input.tricks.filter((trick) => trick.plays.length === 4).length === 13
      ? 'PLAYED'
      : 'IN_PROGRESS';
  }
  const outcome = auctionOutcome(input.biddingHistory, lastBidOf(input.biddingHistory));
  return outcome === 'passed_out' ? 'PASSED_OUT' : 'IN_PROGRESS';
}

export function buildTableBoardRecord(input: RecordBuildInput): TableBoardRecord {
  const status = deriveStatus(input);
  const completed =
    input.auctionCompleted ??
    (input.contract !== null ||
      auctionOutcome(input.biddingHistory, lastBidOf(input.biddingHistory)) !== 'none');
  const pbn = input.pbn ?? toPbnDeal(requireHands(input.hands), input.dealer);
  const noScore =
    status === 'CANCELLED' || status === 'INCOMPLETE' || status === 'REOPENED';
  const nsRaw = noScore ? null : input.score ? input.score.NS - input.score.EW : null;
  const includeContract =
    status !== 'PASSED_OUT' &&
    status !== 'CANCELLED' &&
    status !== 'REOPENED' &&
    status !== 'INCOMPLETE' &&
    input.contract !== null;
  const adjustHistory = input.adjustHistory?.length ? input.adjustHistory : undefined;
  const adjustment = input.adjustment ?? adjustHistory?.[adjustHistory.length - 1];

  const record: TableBoardRecord = {
    format: 'bridge-record',
    schemaVersion: RECORD_SCHEMA_VERSION,
    profile: 'standalone',
    recordType: 'table-board',
    recordId: input.recordId ?? createRecordId(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    producer: input.producer ?? { application: PRODUCER_APPLICATION, version: ENGINE_VERSION },
    deal: {
      dealId: input.dealId ?? createDealId(input.boardNumber),
      boardNumber: Math.max(1, input.boardNumber),
      dealer: input.dealer,
      vulnerability: toRecordVulnerability(input.vulnerability),
      pbn,
    },
    status,
    auction: {
      calls: input.biddingHistory.map((item) => callToCode(item.call)),
      completed,
    },
    score: {
      nsRaw,
      source: input.scoreSource ?? 'computed',
    },
    hcp: { ns: input.hcp.NS, ew: input.hcp.EW },
    derived: {
      imp: {
        singleTable: nsRaw === null ? null : impsFromScoreDiff(nsRaw),
        tableVersion: WBF_2017_VERSION,
      },
    },
    engine: {
      ...input.engine,
      rulesVersion: input.engine.rulesVersion ?? 'wbf-laws-2017',
    },
  };

  if (adjustment) record.adjustment = adjustment;
  if (adjustHistory) record.adjustHistory = adjustHistory;

  if (includeContract && input.contract) {
    record.contract = contractToRecord(input.contract);
    record.declarer = input.contract.declarer;
    record.tricksTaken = input.tricksTaken ?? declarerTricks(input.contract, input.tricks);
  }

  const play = playFromTricks(input.tricks);
  if (play && includeContract) record.play = play;

  return record;
}

function requireHands(hands: Record<Position, Hand> | undefined): Record<Position, Hand> {
  if (!hands) throw new Error('生成记录需要四手牌或 PBN 发牌字符串');
  return hands;
}
