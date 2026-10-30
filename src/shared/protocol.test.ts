import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './errors';
import {
  PROTOCOL_VERSION,
  commandEnvelopeSchema,
  makeCommand,
  parseClientMessage,
  parseCommandPayload,
  toWireEvent,
} from './protocol';
import type { EventEnvelope } from '../domain/events/types';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const TABLE_ID = '22222222-2222-4222-8222-222222222222';

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'command',
    protocolVersion: PROTOCOL_VERSION,
    commandId: 'cmd-00000001',
    type: 'auction.call',
    sessionId: SESSION_ID,
    tableId: TABLE_ID,
    expectedVersion: 3,
    payload: { position: 'N', call: { type: 'bid', level: 1, suit: 'NT' } },
    ...overrides,
  };
}

describe('命令信封', () => {
  it('接受合法命令并保留 expectedVersion', () => {
    const parsed = parseClientMessage(envelope());
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.value.kind === 'command') {
      expect(parsed.value.commandId).toBe('cmd-00000001');
      expect(parsed.value.expectedVersion).toBe(3);
    }
  });

  it('拒绝错误协议版本、非法 commandId 与未知命令', () => {
    expect(parseClientMessage(envelope({ protocolVersion: '2.0' })).ok).toBe(false);
    expect(parseClientMessage(envelope({ commandId: 'short' })).ok).toBe(false);
    expect(parseClientMessage(envelope({ commandId: 'bad id with space' })).ok).toBe(false);
    expect(parseClientMessage(envelope({ type: 'table.explode' })).ok).toBe(false);
  });

  it('严格拒绝未知字段，避免把内部字段带进协议', () => {
    const result = commandEnvelopeSchema.safeParse({
      ...envelope(),
      internalRawScore: 420,
    });
    expect(result.success).toBe(false);
  });
});

describe('命令 payload', () => {
  function payloadRejected(raw: unknown): boolean {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) return true;
    if (parsed.value.kind !== 'command') return true;
    return !parseCommandPayload(parsed.value).ok;
  }

  it('按命令类型校验 payload', () => {
    expect(
      payloadRejected(
        envelope({ payload: { position: 'N', call: { type: 'bid', level: 8, suit: 'NT' } } }),
      ),
    ).toBe(true);

    expect(
      payloadRejected(envelope({ payload: { position: 'X', call: { type: 'pass' } } })),
    ).toBe(true);
  });

  it('director.adjust 要求原因、整数分与 artificial 标记', () => {
    expect(
      payloadRejected(
        envelope({
          type: 'director.adjust',
          payload: {
            reason: '裁判改分',
            nsRaw: 120,
            artificialAverage: { nsRaw: 60, artificial: true },
          },
        }),
      ),
    ).toBe(false);

    expect(
      payloadRejected(envelope({ type: 'director.adjust', payload: { nsRaw: 120 } })),
    ).toBe(true);

    expect(
      payloadRejected(
        envelope({
          type: 'director.adjust',
          payload: { reason: 'x', nsRaw: 120, artificialAverage: { nsRaw: 60, artificial: false } },
        }),
      ),
    ).toBe(true);
  });

  it('parseCommandPayload 对合法命令返回 payload', () => {
    const parsed = parseClientMessage(envelope());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.kind !== 'command') return;
    const payload = parseCommandPayload(parsed.value);
    expect(payload.ok).toBe(true);
    if (payload.ok) {
      expect(payload.value).toMatchObject({ position: 'N' });
    }
  });
});

describe('订阅与事件', () => {
  it('接受订阅消息，拒绝空受众', () => {
    expect(
      parseClientMessage({
        kind: 'subscribe',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: SESSION_ID,
        tableId: TABLE_ID,
        audiences: ['TABLE'],
        lastSeq: 12,
      }).ok,
    ).toBe(true);

    expect(
      parseClientMessage({
        kind: 'subscribe',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: SESSION_ID,
        audiences: [],
      }).ok,
    ).toBe(false);
  });

  it('toWireEvent 把领域事件映射为线上信封', () => {
    const event: EventEnvelope = {
      eventId: '33333333-3333-4333-8333-333333333333',
      schemaVersion: '1.0',
      sessionId: SESSION_ID,
      tableId: TABLE_ID,
      tableBoardId: '44444444-4444-4444-8444-444444444444',
      seq: 7,
      type: 'auction.call',
      at: '2026-10-28T00:00:00Z',
      actor: { kind: 'player', seat: 'N' },
      audience: ['TABLE', 'DIRECTOR'],
      payload: { position: 'N', call: { type: 'pass' } },
    };
    const wire = toWireEvent(event);
    expect(wire.streamId).toBe(event.tableBoardId);
    expect(wire.sessionId).toBe(SESSION_ID);
    expect(wire.tableId).toBe(TABLE_ID);
    expect(wire.occurredAt).toBe(event.at);
    expect(wire.seq).toBe(7);
  });

  it('makeCommand 在构造时校验 payload', () => {
    expect(() =>
      makeCommand({
        commandId: 'cmd-00000002',
        type: 'play.card',
        sessionId: SESSION_ID,
        payload: { position: 'N', card: 52 },
      }),
    ).toThrow();
  });
});

describe('错误码', () => {
  it('协议校验失败使用稳定错误码', () => {
    const parsed = parseClientMessage({ kind: 'command' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});
