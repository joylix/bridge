/**
 * Profile S `TableBoard` 记录类型。
 *
 * 与 `docs/brules-v0.5/record.schema.json` 一一对应；内部 gameState 使用
 * 小写局况与数字牌号，适配层负责双向转换。
 */

import type { BidSuit, Position } from '../models/gameState';

export type RecordVulnerability = 'NONE' | 'NS' | 'EW' | 'ALL';

export type InternalVulnerability = 'none' | 'NS' | 'EW' | 'both';

export type RecordSchemaVersion = '1.0' | '1.1';

export type RecordStatus =
  | 'IN_PROGRESS'
  | 'PLAYED'
  | 'PASSED_OUT'
  | 'CANCELLED'
  | 'ADJUSTED'
  | 'INCOMPLETE'
  | 'REOPENED';

export type RecordAdjustmentKind = 'ADJUST' | 'CANCEL' | 'REOPEN';

export type CallCode =
  | 'PASS'
  | 'X'
  | 'XX'
  | '1C'
  | '1D'
  | '1H'
  | '1S'
  | '1NT'
  | '2C'
  | '2D'
  | '2H'
  | '2S'
  | '2NT'
  | '3C'
  | '3D'
  | '3H'
  | '3S'
  | '3NT'
  | '4C'
  | '4D'
  | '4H'
  | '4S'
  | '4NT'
  | '5C'
  | '5D'
  | '5H'
  | '5S'
  | '5NT'
  | '6C'
  | '6D'
  | '6H'
  | '6S'
  | '6NT'
  | '7C'
  | '7D'
  | '7H'
  | '7S'
  | '7NT';

export interface Producer {
  application: string;
  version?: string;
}

export interface RecordDeal {
  dealId: string;
  boardNumber: number;
  dealer: Position;
  vulnerability: RecordVulnerability;
  /** PBN `[Deal]` 值，不含方括号。 */
  pbn: string;
}

export interface RecordAuction {
  calls: CallCode[];
  completed: boolean;
}

export interface RecordContract {
  level: number;
  denomination: BidSuit;
  doubled: 'NONE' | 'X' | 'XX';
}

export interface RecordCardPlay {
  seat: Position;
  /** 规范牌张：点数 + 花色，例如 AS、TD、2C。 */
  card: string;
}

export interface RecordTrick {
  leader: Position;
  cards: RecordCardPlay[];
  winner: Position;
}

export interface RecordPlay {
  tricks: RecordTrick[];
}

export interface RecordScore {
  /** NS 视角带符号原始分：NS 得分减 EW 得分；无成绩状态必须为 null（不得写 0）。 */
  nsRaw: number | null;
  source: 'computed' | 'director';
}

export interface RecordHcp {
  ns: number;
  ew: number;
}

export interface RecordDerived {
  imp?: { singleTable: number | null; tableVersion?: 'wbf-2017' };
  adjusted?: { profile: string; nsPoints: number };
  mp?: number;
}

export interface RecordArtificialAverage {
  nsRaw: number;
  artificial: true;
}

/**
 * 裁判操作审计条目。1.1 新记录用 `adjustment`（最新一条）+
 * `adjustHistory`（完整历史）；取消副的补偿分单独放在 `artificialAverage`。
 */
export interface RecordAdjustment {
  kind: RecordAdjustmentKind;
  reason: string;
  actor: string;
  at: string;
  beforeStatus: RecordStatus;
  afterStatus: RecordStatus;
  originalRawScore?: number | null;
  beforeValue: number | null;
  afterValue: number | null;
  artificialAverage?: RecordArtificialAverage;
}

export interface RuleSetRef {
  name: string;
  rulesetId: string;
  overlay: boolean;
}

export interface SignalSettingsRecord {
  signal_spot_max_rank?: number;
  encourage_discard_min_rank?: number;
}

export interface SignalRuleSetRef extends RuleSetRef {
  settings: SignalSettingsRecord;
}

export interface SeatEngine {
  controller: 'human' | 'ai' | 'auto-ai';
  bidStyle?: 0 | 1 | 2;
  playStyle?: 0 | 1 | 2;
  randomness?: number;
  ddsPlay?: boolean;
  ddsSamples?: number;
  objective?: 'contract' | 'tricks';
}

export interface EngineStreamSeeds {
  deal?: number;
  bidding?: number;
  play?: number;
  dds?: number;
}

export type DealSource =
  | { kind: 'seeded'; baseSeed: number; index: number }
  | { kind: 'imported-pbn' };

export interface EngineRulesetRef {
  system: string;
  systemVersion: string;
  rulesetId: string;
  overlay: boolean;
}

export interface EngineInference {
  auctionConstraints: boolean;
  leadInference: boolean;
}

export interface EngineDds {
  workerTimeoutMs?: number;
  samples?: number;
  fallback?: string;
}

export interface EngineSnapshot {
  dealSource: DealSource;
  /** 旧版兼容字段；新记录以 streams 为准。 */
  rngSeed?: number;
  streams?: EngineStreamSeeds;
  ruleset: EngineRulesetRef;
  playRulesets: {
    lead: RuleSetRef;
    signal: SignalRuleSetRef;
  };
  seats: Record<Position, SeatEngine>;
  inference: EngineInference;
  dds?: EngineDds;
  /** WBF 规则版本；1.1 新记录固定为 wbf-laws-2017。 */
  rulesVersion?: 'wbf-laws-2017';
  engineVersion?: string;
  snapshotAt?: string;
  rngMode?: 'streams' | 'legacy-shared';
}

export interface TableBoardRecord {
  format: 'bridge-record';
  schemaVersion: RecordSchemaVersion;
  profile: 'standalone';
  recordType: 'table-board';
  recordId: string;
  createdAt: string;
  updatedAt?: string;
  producer?: Producer;
  deal: RecordDeal;
  status: RecordStatus;
  auction: RecordAuction;
  contract?: RecordContract;
  declarer?: Position;
  tricksTaken?: number;
  play?: RecordPlay;
  score: RecordScore;
  hcp: RecordHcp;
  derived?: RecordDerived;
  adjustment?: RecordAdjustment;
  adjustHistory?: RecordAdjustment[];
  engine: EngineSnapshot;
}

/* ------------------------------------------------------------------ *
 * 交换层诊断
 * ------------------------------------------------------------------ */

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ExchangeIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  field?: string;
}

/**
 * 损失报告：任何 PBN/CSV 转换无法保留的信息都要显式声明。
 * `action` 与 `pbn.md` §10 一致。
 */
export interface LossReport {
  field: string;
  action: 'omitted' | 'transformed' | 'approximated';
  reason: string;
}
