/**
 * 客户端 ↔ 服务端协议（M5 冻结草案，版本 1.0）。
 *
 * 设计依据：
 * - SRS V0.7 5.2 / 5.3 / 8.9、附录 B；
 * - `docs/adr/0006-transaction-boundaries.md`（命令幂等与并发）；
 * - `docs/adr/0007-projection.md`（受众与字段级投影）。
 *
 * 约束：
 * - 命令必须带 `commandId` 与 `expectedVersion`（可选）；
 * - 服务端只接受 `protocolVersion=1.0`；
 * - 事件走独立 `event` 消息，且已经按受众投影；
 * - 协议类型不直接复用 UI 状态，避免把内部字段泄漏到线上。
 */

import { z } from 'zod';
import type { EventActor, EventAudience, EventEnvelope } from '../domain/events/types';
import type { BidCall, Position } from '../models/gameState';
import { ERROR_CODES, type ErrorCode } from './errors';

export const PROTOCOL_VERSION = '1.0';

export const seatSchema = z.enum(['N', 'E', 'S', 'W']);
export const bidSuitSchema = z.enum(['C', 'D', 'H', 'S', 'NT']);

export const bidCallSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pass') }),
  z.object({ type: z.literal('bid'), level: z.number().int().min(1).max(7), suit: bidSuitSchema }),
  z.object({ type: z.literal('double') }),
  z.object({ type: z.literal('redouble') }),
]);

export const COMMAND_TYPES = [
  'session.start',
  'auction.call',
  'play.card',
  'board.settle',
  'director.cancel',
  'director.adjust',
  'director.reopen',
  'director.redeal',
  'chat.send',
  'substitute.invite',
  'client.ping',
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

export const commandTypeSchema = z.enum(COMMAND_TYPES);

const reasonSchema = z.string().trim().min(1).max(500);

/**
 * 每种命令的 payload 契约。
 * `board.settle` / `client.ping` 无业务参数；未知类型在编译期即被拒绝。
 */
export const commandPayloadSchemas = {
  'session.start': z.object({}).strict(),
  'auction.call': z.object({ position: seatSchema, call: bidCallSchema }).strict(),
  'play.card': z.object({ position: seatSchema, card: z.number().int().min(0).max(51) }).strict(),
  'board.settle': z.object({}).strict(),
  'director.cancel': z.object({ reason: reasonSchema }).strict(),
  'director.adjust': z
    .object({
      reason: reasonSchema,
      nsRaw: z.number().int(),
      artificialAverage: z
        .object({ nsRaw: z.number().int(), artificial: z.literal(true) })
        .strict()
        .optional(),
    })
    .strict(),
  'director.reopen': z.object({ reason: reasonSchema }).strict(),
  'director.redeal': z.object({ reason: reasonSchema }).strict(),
  'chat.send': z
    .object({
      audience: z.enum(['ROOM', 'TABLE']),
      text: z.string().trim().min(1).max(500),
    })
    .strict(),
  'substitute.invite': z.object({ targetUserId: z.uuid() }).strict(),
  'client.ping': z.object({}).strict(),
} satisfies Record<CommandType, z.ZodType>;

export type CommandPayload<T extends CommandType> = z.infer<(typeof commandPayloadSchemas)[T]>;

const commandIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9:_-]+$/, 'commandId 只允许字母、数字、冒号、下划线与连字符');

export const commandEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    commandId: commandIdSchema,
    type: commandTypeSchema,
    sessionId: z.uuid(),
    tableId: z.uuid().optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
    payload: z.unknown(),
  })
  .strict();

export interface CommandEnvelope<T extends CommandType = CommandType> {
  protocolVersion: typeof PROTOCOL_VERSION;
  commandId: string;
  type: T;
  sessionId: string;
  tableId?: string;
  expectedVersion?: number;
  payload: CommandPayload<T>;
}

export const audienceSchema = z.enum([
  'LOBBY',
  'ROOM',
  'TABLE',
  'SPECTATORS_DELAYED',
  'DIRECTOR',
  'POSTGAME',
]);

export const clientMessageSchema = z.discriminatedUnion('kind', [
  commandEnvelopeSchema.extend({ kind: z.literal('command') }),
  z
    .object({
      kind: z.literal('subscribe'),
      protocolVersion: z.literal(PROTOCOL_VERSION),
      sessionId: z.uuid(),
      tableId: z.uuid().optional(),
      audiences: z.array(audienceSchema).min(1).max(4),
      lastSeq: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ kind: z.literal('ping'), protocolVersion: z.literal(PROTOCOL_VERSION) }).strict(),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type CommandMessage = Extract<ClientMessage, { kind: 'command' }>;

/** 协议层事件信封：与领域事件同源，但字段名对齐 SRS 5.3.8 的线上契约。 */
export interface WireEventEnvelope {
  eventId: string;
  schemaVersion: '1.0';
  /** 事件流标识；桌副事件等于 tableBoardId，盘级事件为 `session:<sessionId>`。 */
  streamId: string;
  sessionId: string;
  tableId?: string;
  seq: number;
  type: EventEnvelope['type'];
  occurredAt: string;
  actor: EventActor;
  audience: EventAudience[];
  payload: unknown;
  /** 撤销/更正指向被更正事件；被更正事件保留并标记 supersededBy。 */
  corrects?: string;
  supersededBy?: string;
}

export type ServerMessage =
  | {
      kind: 'hello';
      protocolVersion: typeof PROTOCOL_VERSION;
      connectionId: string;
      serverTime: string;
    }
  | {
      kind: 'ack';
      protocolVersion: typeof PROTOCOL_VERSION;
      commandId: string;
      seq?: number;
      result?: unknown;
    }
  | {
      kind: 'error';
      protocolVersion: typeof PROTOCOL_VERSION;
      commandId?: string;
      code: ErrorCode;
      message: string;
      requestId?: string;
    }
  | {
      kind: 'event';
      protocolVersion: typeof PROTOCOL_VERSION;
      event: WireEventEnvelope;
    }
  | {
      kind: 'subscribed';
      protocolVersion: typeof PROTOCOL_VERSION;
      sessionId: string;
      tableId?: string;
      audiences: string[];
    }
  | {
      kind: 'snapshot';
      protocolVersion: typeof PROTOCOL_VERSION;
      sessionId: string;
      tableId?: string;
      lastSeq: number;
      state: unknown;
    }
  | { kind: 'pong'; protocolVersion: typeof PROTOCOL_VERSION; serverTime: string };

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ErrorCode; message: string; issues: string[] };

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}

/** 解析并校验客户端消息外壳；命令 payload 由 `parseCommandPayload` 单独校验。 */
export function parseClientMessage(raw: unknown): ParseResult<ClientMessage> {
  const result = clientMessageSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: '协议消息格式不合法',
      issues: formatIssues(result.error),
    };
  }
  return { ok: true, value: result.data };
}

/** 在解析信封后，按命令类型校验 payload。 */
export function parseCommandPayload(
  command: Pick<CommandMessage, 'type' | 'payload'>,
): ParseResult<CommandPayload<CommandType>> {
  const schema = commandPayloadSchemas[command.type];
  const result = schema.safeParse(command.payload);
  if (!result.success) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: `命令 ${command.type} 的 payload 不合法`,
      issues: formatIssues(result.error),
    };
  }
  return { ok: true, value: result.data as CommandPayload<CommandType> };
}

/** 把领域事件映射为线上信封；`tableBoardId` 即桌副事件流标识。 */
export function toWireEvent(event: EventEnvelope): WireEventEnvelope {
  return {
    eventId: event.eventId,
    schemaVersion: event.schemaVersion,
    streamId: event.tableBoardId,
    sessionId: event.sessionId,
    tableId: event.tableId,
    seq: event.seq,
    type: event.type,
    occurredAt: event.at,
    actor: event.actor,
    audience: event.audience,
    payload: event.payload,
  };
}

export function isCommandMessage(message: ClientMessage): message is CommandMessage {
  return message.kind === 'command';
}

/** 便于测试与客户端构造：类型安全的命令工厂。 */
export function makeCommand<T extends CommandType>(input: {
  commandId: string;
  type: T;
  sessionId: string;
  tableId?: string;
  expectedVersion?: number;
  payload: CommandPayload<T>;
}): CommandEnvelope<T> {
  const payload = commandPayloadSchemas[input.type].parse(input.payload) as CommandPayload<T>;
  return {
    protocolVersion: PROTOCOL_VERSION,
    commandId: input.commandId,
    type: input.type,
    sessionId: input.sessionId,
    ...(input.tableId ? { tableId: input.tableId } : {}),
    ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
    payload,
  };
}

/** 供 UI/测试复用的固定座位与叫品类型。 */
export type { BidCall, Position };
