/**
 * 对局事件信封（SRS V0.7 6.5 / 6.8.3 / 8.9）。
 *
 * 事件是审计与回放的来源；`TableBoard` 是事件流的投影结果。
 * 字段级投影由服务端按 `audience` 执行，本模块只定义事件形状与顺序。
 */

import type { BidCall, CardPlay, Contract, Position } from '../../models/gameState';

export type EventSchemaVersion = '1.0';

export type EventAudience =
  | 'LOBBY'
  | 'ROOM'
  | 'TABLE'
  | 'SPECTATORS_DELAYED'
  | 'DIRECTOR'
  | 'POSTGAME'
  | `WHISPER:${string}`;

export type EventActorKind = 'player' | 'ai' | 'director' | 'system';

export interface EventActor {
  kind: EventActorKind;
  seat?: Position;
  userId?: string;
  label?: string;
}

export interface EventEnvelope<T = unknown> {
  eventId: string;
  schemaVersion: EventSchemaVersion;
  sessionId: string;
  tableId: string;
  tableBoardId: string;
  /** 同一 tableBoardId 内从 1 开始严格递增；重复 seq 必须拒绝。 */
  seq: number;
  type: BridgeEventType;
  at: string;
  actor: EventActor;
  audience: EventAudience[];
  payload: T;
}

export type BridgeEventType =
  | 'deal.created'
  | 'auction.call'
  | 'contract.set'
  | 'play.card'
  | 'trick.completed'
  | 'board.completed'
  | 'score.computed';

export interface DealCreatedPayload {
  dealId: string;
  boardNumber: number;
  dealer: Position;
  vulnerability: 'NONE' | 'NS' | 'EW' | 'ALL';
  /** PBN [Deal] 值；完整牌型只对 DIRECTOR 投影，牌桌客户端需按座位裁剪。 */
  pbn: string;
}

export interface AuctionCallPayload {
  position: Position;
  call: BidCall;
  ruleId?: string;
  alerted?: boolean;
  alertText?: string;
}

export interface ContractSetPayload {
  contract: Contract;
  declarer: Position;
  tricksTaken: number;
}

export interface PlayCardPayload {
  position: Position;
  /** 0..51 的内部牌张编号；投影层可转成规范牌张字符串。 */
  card: number;
}

export interface TrickCompletedPayload {
  index: number;
  leader: Position;
  winner: Position;
  cards: CardPlay[];
}

export interface BoardCompletedPayload {
  status: 'PLAYED' | 'PASSED_OUT';
  nsRaw: number;
  tricksTaken: number;
}

export interface ScoreComputedPayload {
  nsRaw: number;
  singleTableImp: number;
  tableVersion: 'wbf-2017';
}

export interface BridgeEventPayloads {
  'deal.created': DealCreatedPayload;
  'auction.call': AuctionCallPayload;
  'contract.set': ContractSetPayload;
  'play.card': PlayCardPayload;
  'trick.completed': TrickCompletedPayload;
  'board.completed': BoardCompletedPayload;
  'score.computed': ScoreComputedPayload;
}

export type BridgeEvent<T extends BridgeEventType = BridgeEventType> = EventEnvelope<
  BridgeEventPayloads[T]
>;

/** reducer 产出的事件草稿；由 EventLog 补 eventId / seq / at。 */
export type TableEventDraft =
  | { type: 'auction.call'; payload: AuctionCallPayload }
  | { type: 'contract.set'; payload: ContractSetPayload }
  | { type: 'play.card'; payload: PlayCardPayload }
  | { type: 'trick.completed'; payload: TrickCompletedPayload }
  | { type: 'board.completed'; payload: BoardCompletedPayload }
  | { type: 'score.computed'; payload: ScoreComputedPayload };

export const DEFAULT_AUDIENCE: Record<BridgeEventType, EventAudience[]> = {
  'deal.created': ['DIRECTOR'],
  'auction.call': ['TABLE', 'DIRECTOR'],
  'contract.set': ['TABLE', 'DIRECTOR'],
  'play.card': ['TABLE', 'DIRECTOR'],
  'trick.completed': ['TABLE', 'DIRECTOR'],
  'board.completed': ['TABLE', 'DIRECTOR'],
  'score.computed': ['TABLE', 'DIRECTOR'],
};
