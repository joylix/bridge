import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useGameStore } from './game';
import { parseAction } from '../core/bidding/validator';
import { getLegalCards } from '../core/playing';
import { getSuit } from '../models/card';
import { trumpSuitOf } from '../models/gameState';
import { parseEventJsonl } from '../domain/events/log';
import { parseTableBoardRecord } from '../exchange/json';
import type { RecordAdjustment, TableBoardRecord } from '../exchange/types';

function newStore() {
  setActivePinia(createPinia());
  return useGameStore();
}

function playOut(store: ReturnType<typeof newStore>): void {
  store.applyBid('N', parseAction('1NT'));
  store.applyBid('E', { type: 'pass' });
  store.applyBid('S', { type: 'pass' });
  store.applyBid('W', { type: 'pass' });
  store.setContractAndStartPlay();
  let guard = 0;
  while ((store.phase === 'play' || store.phase === 'play_waiting_lead') && guard++ < 60) {
    const seat = store.nextPlayer!;
    const leadSuit = store.currentTrick.length === 0 ? null : getSuit(store.currentTrick[0].card);
    const legal = getLegalCards(store.hands[seat], leadSuit, trumpSuitOf(store.contract!));
    store.applyPlay(seat, legal[0]);
  }
}

describe('store 事件流导出', () => {
  let store: ReturnType<typeof newStore>;
  beforeEach(() => {
    store = newStore();
  });

  it('当前副 JSONL 覆盖发牌→叫牌→定约→出牌→结算，seq 连续', () => {
    store.startNewGame({ autoStart: false, seed: 55 });
    playOut(store);
    expect(store.phase).toBe('scoring');

    const events = parseEventJsonl(store.exportEventJsonl());
    expect(events[0].type).toBe('deal.created');
    expect(events.filter((event) => event.type === 'auction.call')).toHaveLength(4);
    expect(events.filter((event) => event.type === 'play.card')).toHaveLength(52);
    expect(events.filter((event) => event.type === 'trick.completed')).toHaveLength(13);
    expect(events.filter((event) => event.type === 'contract.set')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'board.completed')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'score.computed')).toHaveLength(1);
    expect(events.map((event) => event.seq)).toEqual(
      Array.from({ length: events.length }, (_, index) => index + 1),
    );
    expect(new Set(events.map((event) => event.eventId)).size).toBe(events.length);
  });

  it('流局事件为 PASSED_OUT 且 0 原始分', () => {
    store.startNewGame({ autoStart: false, seed: 3 });
    for (const seat of ['N', 'E', 'S', 'W'] as const) {
      store.applyBid(seat, { type: 'pass' });
    }
    store.checkBiddingEnd();
    const events = parseEventJsonl(store.exportEventJsonl());
    const completed = events.find((event) => event.type === 'board.completed');
    expect(completed?.payload).toMatchObject({ status: 'PASSED_OUT', nsRaw: 0 });
  });
});

function adjustment(kind: RecordAdjustment['kind']): RecordAdjustment {
  return {
    kind,
    reason: kind === 'CANCEL' ? '裁判取消' : '裁判改分',
    actor: 'director-1',
    at: '2026-10-28T00:00:00Z',
    beforeStatus: 'PLAYED',
    afterStatus: kind === 'CANCEL' ? 'CANCELLED' : 'ADJUSTED',
    beforeValue: 90,
    afterValue: kind === 'ADJUST' ? 120 : null,
  };
}

function playedRecord(): TableBoardRecord {
  const source = newStore();
  source.startNewGame({ autoStart: false, seed: 55 });
  playOut(source);
  return parseTableBoardRecord(source.exportTableBoardJson());
}

describe('store 异常记录往返', () => {
  it('导入 CANCELLED 后重新导出仍为 null 分并保留取消审计', () => {
    const record = structuredClone(playedRecord());
    record.status = 'CANCELLED';
    delete record.contract;
    delete record.declarer;
    delete record.tricksTaken;
    delete record.play;
    record.score.nsRaw = null;
    record.derived!.imp!.singleTable = null;
    record.adjustment = adjustment('CANCEL');
    record.adjustHistory = [record.adjustment];

    const target = newStore();
    target.importTableBoardRecord(record, { autoStart: false });
    const exported = parseTableBoardRecord(target.exportTableBoardJson());
    expect(exported.status).toBe('CANCELLED');
    expect(exported.score.nsRaw).toBeNull();
    expect(exported.derived?.imp?.singleTable).toBeNull();
    expect(exported.adjustment?.kind).toBe('CANCEL');
    expect(exported.adjustHistory).toEqual([record.adjustment]);
  });

  it('导入 ADJUSTED 后重新导出保留调整分与历史', () => {
    const record = structuredClone(playedRecord());
    record.status = 'ADJUSTED';
    record.score.nsRaw = 120;
    record.derived!.imp!.singleTable = 3;
    record.adjustment = adjustment('ADJUST');
    record.adjustHistory = [record.adjustment];

    const target = newStore();
    target.importTableBoardRecord(record, { autoStart: false });
    const exported = parseTableBoardRecord(target.exportTableBoardJson());
    expect(exported.status).toBe('ADJUSTED');
    expect(exported.score.nsRaw).toBe(120);
    expect(exported.adjustment).toEqual(record.adjustment);
    expect(exported.adjustHistory).toEqual(record.adjustHistory);
  });
});
