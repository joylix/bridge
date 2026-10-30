import { describe, expect, it } from 'vitest';
import { parsePbnDeal } from '../../core/pbn';
import { createTableState, reduceTable } from '../table/reducer';
import { EventLog, EventLogError, parseEventJsonl } from './log';
import type { TableEventDraft } from './types';

const LOG_OPTIONS = {
  sessionId: 'session-1',
  tableId: 'table-1',
  tableBoardId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
};

function appendDrafts(log: EventLog, drafts: TableEventDraft[]): void {
  for (const draft of drafts) {
    // 类型擦除只为测试通用追加；生产代码按事件类型分别调用 append。
    log.append(draft.type, draft.payload as never, { at: '2026-10-28T00:00:00Z' });
  }
}

function expectLogError(fn: () => void, code: string): void {
  try {
    fn();
    throw new Error(`expected EventLogError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(EventLogError);
    expect((error as EventLogError).code).toBe(code);
  }
}

describe('事件信封与 JSONL', () => {
  it('seq 从 1 严格递增，JSONL 可往返恢复', () => {
    const log = new EventLog(LOG_OPTIONS);
    const first = log.append('deal.created', {
      dealId: 'deal-0001',
      boardNumber: 1,
      dealer: 'N',
      vulnerability: 'NONE',
      pbn: 'N:AKQ2.JT9.543.876 ...',
    }, { eventId: 'urn:uuid:00000000-0000-4000-8000-0000000000a1' });
    const second = log.append('auction.call', {
      position: 'N',
      call: { type: 'bid', level: 1, suit: 'NT' },
    }, {
      eventId: 'urn:uuid:00000000-0000-4000-8000-0000000000a2',
      actor: { kind: 'player', seat: 'N', userId: 'u1' },
    });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(first.audience).toEqual(['DIRECTOR']);

    const jsonl = log.toJsonl();
    expect(jsonl.endsWith('\n')).toBe(true);
    expect(jsonl.trim().split('\n')).toHaveLength(2);

    const restored = EventLog.fromJsonl(jsonl);
    expect(restored.events).toEqual(log.events);
    expect(restored.lastSequence).toBe(2);
  });

  it('拒绝重复 seq、乱序 seq 与重复 eventId', () => {
    const log = new EventLog(LOG_OPTIONS);
    const first = log.append('deal.created', {
      dealId: 'd1',
      boardNumber: 1,
      dealer: 'N',
      vulnerability: 'NONE',
      pbn: 'x',
    }, { eventId: 'urn:uuid:00000000-0000-4000-8000-0000000000b1' });

    expectLogError(() => log.appendEvent(first), 'DUPLICATE_SEQ');

    log.append('auction.call', { position: 'N', call: { type: 'pass' } }, {
      eventId: 'urn:uuid:00000000-0000-4000-8000-0000000000b2',
    });
    expectLogError(
      () =>
        log.append('auction.call', { position: 'E', call: { type: 'pass' } }, {
          eventId: 'urn:uuid:00000000-0000-4000-8000-0000000000b2',
        }),
      'DUPLICATE_EVENT_ID',
    );

    const outOfOrder = {
      ...first,
      eventId: 'urn:uuid:00000000-0000-4000-8000-0000000000b3',
      seq: 9,
    };
    expectLogError(() => log.appendEvent(outOfOrder), 'SEQ_OUT_OF_ORDER');
  });

  it('JSONL 中出现重复/跳跃 seq 时解析失败', () => {
    const log = new EventLog(LOG_OPTIONS);
    log.append('auction.call', { position: 'N', call: { type: 'pass' } }, {
      eventId: 'urn:uuid:00000000-0000-4000-8000-0000000000c1',
    });
    const line = log.toJsonl().trim();

    const duplicate = `${line}\n${line}\n`;
    expectLogError(() => parseEventJsonl(duplicate), 'DUPLICATE_SEQ');

    const event = JSON.parse(line) as { seq: number };
    event.seq = 3;
    expectLogError(() => parseEventJsonl(`${JSON.stringify(event)}\n`), 'SEQ_OUT_OF_ORDER');
  });

  it('reducer 事件可直接写入 JSONL', () => {
    const hands = parsePbnDeal(
      'N:AKQ2.JT9.543.876 JT98.AKQ.AKQJ.T9 76543.8765.T98.A -.432.762.KQJ5432',
    ).hands;
    let state = createTableState({ dealer: 'N', vulnerability: 'none', hands });
    const log = new EventLog(LOG_OPTIONS);
    log.append('deal.created', {
      dealId: 'deal-0001',
      boardNumber: 1,
      dealer: 'N',
      vulnerability: 'NONE',
      pbn: 'N:AKQ2.JT9.543.876 JT98.AKQ.AKQJ.T9 76543.8765.T98.A -.432.762.KQJ5432',
    }, { eventId: 'urn:uuid:00000000-0000-4000-8000-0000000000d0' });

    for (const [position, call] of [
      ['N', { type: 'bid', level: 1, suit: 'NT' }],
      ['E', { type: 'pass' }],
      ['S', { type: 'pass' }],
      ['W', { type: 'pass' }],
    ] as const) {
      const step = reduceTable(state, { type: 'call', position, call });
      appendDrafts(log, step.events);
      state = step.state;
    }

    expect(state.phase).toBe('play_waiting_lead');
    const lines = log.toJsonl().trim().split('\n').map((line) => JSON.parse(line) as { type: string });
    expect(lines.map((line) => line.type)).toEqual([
      'deal.created',
      'auction.call',
      'auction.call',
      'auction.call',
      'auction.call',
      'contract.set',
    ]);
    expect(parseEventJsonl(log.toJsonl())).toHaveLength(6);
  });

  it('未知事件类型与错误信封被拒绝', () => {
    expect(() =>
      new EventLog(LOG_OPTIONS).append('nope' as never, {} as never),
    ).toThrowError(EventLogError);
  });
});
