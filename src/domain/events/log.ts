/**
 * 事件流：事件信封校验、JSONL 序列化、重复 seq 拒绝。
 *
 * `EventLog` 是单个 `TableBoard` 的事件追加器；服务端重启后可从 JSONL
 * 恢复并继续追加，`seq` 必须从 1 开始严格递增。
 */

import {
  DEFAULT_AUDIENCE,
  type BridgeEvent,
  type BridgeEventPayloads,
  type BridgeEventType,
  type EventActor,
  type EventAudience,
  type EventEnvelope,
} from './types';

const EVENT_TYPES = new Set<BridgeEventType>([
  'deal.created',
  'auction.call',
  'contract.set',
  'play.card',
  'trick.completed',
  'board.completed',
  'score.computed',
]);

export type EventLogErrorCode =
  | 'INVALID_EVENT'
  | 'INVALID_JSONL'
  | 'DUPLICATE_SEQ'
  | 'SEQ_OUT_OF_ORDER'
  | 'DUPLICATE_EVENT_ID'
  | 'LOG_MISMATCH';

export class EventLogError extends Error {
  readonly code: EventLogErrorCode;

  constructor(code: EventLogErrorCode, message: string) {
    super(message);
    this.name = 'EventLogError';
    this.code = code;
  }
}

export interface EventLogOptions {
  sessionId: string;
  tableId: string;
  tableBoardId: string;
  /** 恢复时传入已落盘的最后一个 seq；新日志从 0 开始。 */
  startSeq?: number;
}

export interface AppendOptions {
  actor?: EventActor;
  audience?: EventAudience[];
  at?: string;
  /** 测试/导入时可注入稳定 id；生产环境省略。 */
  eventId?: string;
}

function createEventId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `urn:uuid:${cryptoObj.randomUUID()}`;
  }
  const bytes = new Uint8Array(16);
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertEventShape(event: EventEnvelope<unknown>): void {
  if (event.schemaVersion !== '1.0') {
    throw new EventLogError('INVALID_EVENT', '事件 schemaVersion 必须是 1.0');
  }
  if (!EVENT_TYPES.has(event.type)) {
    throw new EventLogError('INVALID_EVENT', `未知事件类型 ${String(event.type)}`);
  }
  for (const field of ['eventId', 'sessionId', 'tableId', 'tableBoardId'] as const) {
    if (typeof event[field] !== 'string' || event[field].length === 0) {
      throw new EventLogError('INVALID_EVENT', `事件缺少 ${field}`);
    }
  }
  if (!Number.isInteger(event.seq) || event.seq < 1) {
    throw new EventLogError('INVALID_EVENT', '事件 seq 必须是正整数');
  }
  if (typeof event.at !== 'string' || Number.isNaN(Date.parse(event.at))) {
    throw new EventLogError('INVALID_EVENT', '事件 at 必须是 ISO 8601 时间');
  }
  if (!event.actor || typeof event.actor !== 'object' || typeof event.actor.kind !== 'string') {
    throw new EventLogError('INVALID_EVENT', '事件缺少 actor');
  }
  if (!Array.isArray(event.audience) || event.audience.length === 0) {
    throw new EventLogError('INVALID_EVENT', '事件 audience 必须是非空数组');
  }
  if (typeof event.payload !== 'object' || event.payload === null) {
    throw new EventLogError('INVALID_EVENT', '事件 payload 必须是对象');
  }
}

/**
 * 单桌副事件日志。
 *
 * 追加顺序即写入顺序；`appendEvent` 用于恢复或外部导入，重复/跳跃 seq 均拒绝。
 */
export class EventLog {
  readonly sessionId: string;
  readonly tableId: string;
  readonly tableBoardId: string;
  private readonly entries: BridgeEvent[] = [];
  private readonly eventIds = new Set<string>();
  private lastSeq: number;

  constructor(options: EventLogOptions) {
    this.sessionId = options.sessionId;
    this.tableId = options.tableId;
    this.tableBoardId = options.tableBoardId;
    this.lastSeq = options.startSeq ?? 0;
  }

  get size(): number {
    return this.entries.length;
  }

  get lastSequence(): number {
    return this.lastSeq;
  }

  get events(): readonly BridgeEvent[] {
    return this.entries;
  }

  append<T extends BridgeEventType>(
    type: T,
    payload: BridgeEventPayloads[T],
    options: AppendOptions = {},
  ): BridgeEvent<T> {
    if (!EVENT_TYPES.has(type)) {
      throw new EventLogError('INVALID_EVENT', `未知事件类型 ${String(type)}`);
    }
    const event = {
      eventId: options.eventId ?? createEventId(),
      schemaVersion: '1.0',
      sessionId: this.sessionId,
      tableId: this.tableId,
      tableBoardId: this.tableBoardId,
      seq: this.lastSeq + 1,
      type,
      at: options.at ?? new Date().toISOString(),
      actor: options.actor ?? { kind: 'system' },
      audience: [...(options.audience ?? DEFAULT_AUDIENCE[type])],
      payload,
    } as BridgeEvent<T>;
    this.appendEvent(event);
    return event;
  }

  /** 恢复/导入：要求 seq 严格连续，eventId 不重复。 */
  appendEvent<T extends BridgeEventType>(event: BridgeEvent<T>): void {
    assertEventShape(event as EventEnvelope<unknown>);
    if (
      event.sessionId !== this.sessionId ||
      event.tableId !== this.tableId ||
      event.tableBoardId !== this.tableBoardId
    ) {
      throw new EventLogError('LOG_MISMATCH', '事件属于其它 session/table/tableBoard');
    }
    if (event.seq <= this.lastSeq) {
      throw new EventLogError('DUPLICATE_SEQ', `seq ${event.seq} 已存在（lastSeq=${this.lastSeq}）`);
    }
    if (event.seq !== this.lastSeq + 1) {
      throw new EventLogError(
        'SEQ_OUT_OF_ORDER',
        `seq ${event.seq} 不连续；期望 ${this.lastSeq + 1}`,
      );
    }
    if (this.eventIds.has(event.eventId)) {
      throw new EventLogError('DUPLICATE_EVENT_ID', `eventId ${event.eventId} 重复`);
    }
    this.eventIds.add(event.eventId);
    this.entries.push(event);
    this.lastSeq = event.seq;
  }

  toJsonl(): string {
    return eventsToJsonl(this.entries);
  }

  static fromJsonl(text: string, options?: Partial<EventLogOptions>): EventLog {
    const events = parseEventJsonl(text);
    if (events.length === 0) {
      return new EventLog({
        sessionId: options?.sessionId ?? 'session-empty',
        tableId: options?.tableId ?? 'table-empty',
        tableBoardId: options?.tableBoardId ?? 'table-board-empty',
        startSeq: options?.startSeq ?? 0,
      });
    }
    const first = events[0];
    const log = new EventLog({
      sessionId: options?.sessionId ?? first.sessionId,
      tableId: options?.tableId ?? first.tableId,
      tableBoardId: options?.tableBoardId ?? first.tableBoardId,
      startSeq: options?.startSeq ?? 0,
    });
    for (const event of events) log.appendEvent(event);
    return log;
  }
}

export function eventsToJsonl(events: readonly BridgeEvent[]): string {
  if (events.length === 0) return '';
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

/** 解析 JSONL；重复 seq、非连续 seq、未知事件类型都会抛 EventLogError。 */
export function parseEventJsonl(text: string): BridgeEvent[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = source.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const events: BridgeEvent[] = [];
  let lastSeq = 0;
  const ids = new Set<string>();
  for (const [index, line] of lines.entries()) {
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch (error) {
      throw new EventLogError(
        'INVALID_JSONL',
        `第 ${index + 1} 行不是合法 JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (typeof raw !== 'object' || raw === null) {
      throw new EventLogError('INVALID_JSONL', `第 ${index + 1} 行不是对象`);
    }
    const event = raw as BridgeEvent;
    assertEventShape(event);
    if (event.seq <= lastSeq) {
      throw new EventLogError('DUPLICATE_SEQ', `第 ${index + 1} 行 seq ${event.seq} 已存在`);
    }
    if (event.seq !== lastSeq + 1) {
      throw new EventLogError(
        'SEQ_OUT_OF_ORDER',
        `第 ${index + 1} 行 seq ${event.seq} 不连续；期望 ${lastSeq + 1}`,
      );
    }
    if (ids.has(event.eventId)) {
      throw new EventLogError('DUPLICATE_EVENT_ID', `第 ${index + 1} 行 eventId 重复`);
    }
    ids.add(event.eventId);
    lastSeq = event.seq;
    events.push(event);
  }
  return events;
}
