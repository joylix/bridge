import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useGameStore } from '../../store/game';
import { parseAction } from '../../core/bidding/validator';
import { getLegalCards } from '../../core/playing';
import { getSuit } from '../../models/card';
import { trumpSuitOf } from '../../models/gameState';
import { parseTableBoardRecord } from '../../exchange/json';
import type { RecordAdjustment, TableBoardRecord } from '../../exchange/types';
import {
  assertExportReleased,
  isReleased,
  projectBoardForViewer,
  type ReleaseState,
  type ViewerContext,
} from './projection';

const TABLE_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_TABLE_ID = '99999999-9999-4999-8999-999999999999';

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

function playedRecord(): TableBoardRecord {
  const store = newStore();
  store.startNewGame({ autoStart: false, seed: 55 });
  playOut(store);
  return parseTableBoardRecord(store.exportTableBoardJson());
}

function adjustment(): RecordAdjustment {
  return {
    kind: 'ADJUST',
    reason: '裁判改分',
    actor: 'director-1',
    at: '2026-10-28T00:00:00Z',
    beforeStatus: 'PLAYED',
    afterStatus: 'ADJUSTED',
    beforeValue: 90,
    afterValue: 120,
  };
}

const NOW = new Date('2026-10-28T12:00:00Z');

function release(overrides: Partial<ReleaseState> = {}): ReleaseState {
  return {
    tableCompletedAt: '2026-10-28T11:59:00Z',
    delayedBoards: 1,
    minDelayMs: 30_000,
    ...overrides,
  };
}

function viewer(overrides: Partial<ViewerContext> = {}): ViewerContext {
  return { userId: 'user-1', role: 'player', participantTableId: TABLE_ID, seat: 'N', ...overrides };
}

describe('转播释放门禁', () => {
  it('同时满足结束时间、延迟副数与最短等待才释放', () => {
    expect(isReleased(release(), NOW)).toBe(true);
    expect(isReleased(release({ tableCompletedAt: null }), NOW)).toBe(false);
    expect(isReleased(release({ delayedBoards: 0 }), NOW)).toBe(false);
    expect(isReleased(release({ minDelayMs: 120_000 }), NOW)).toBe(false);
  });

  it('整副导出要求所有桌完成', () => {
    expect(() => assertExportReleased(release(), NOW)).not.toThrow();
    expect(() =>
      assertExportReleased(release({ allTablesCompletedAt: null }), NOW),
    ).toThrowError(/暂不可导出/);
  });
});

describe('字段级投影', () => {
  let record: TableBoardRecord;
  beforeEach(() => {
    record = playedRecord();
    record.status = 'ADJUSTED';
    record.score.nsRaw = 120;
    record.adjustment = adjustment();
    record.adjustHistory = [adjustment()];
  });

  it('管理员看到四家手牌与完整审计', () => {
    const projected = projectBoardForViewer({
      record,
      tableId: TABLE_ID,
      viewer: { userId: 'admin-1', role: 'admin' },
      release: release({ tableCompletedAt: null }),
      now: NOW,
    });
    expect(Object.keys(projected.hands).sort()).toEqual(['E', 'N', 'S', 'W']);
    expect(projected.hcp).toBeDefined();
    expect(projected.adjustment?.kind).toBe('ADJUST');
    expect(projected.adjustHistory).toHaveLength(1);
    expect(projected.projection.role).toBe('admin');
  });

  it('本桌玩家只看到本人暗手与明手', () => {
    const north = projectBoardForViewer({
      record,
      tableId: TABLE_ID,
      viewer: viewer(),
      release: release({ tableCompletedAt: null }),
      now: NOW,
    });
    // 定约 1NT 由 N 主打，明手为 S。
    expect(Object.keys(north.hands).sort()).toEqual(['N', 'S']);
    expect(north.hands.N).toHaveLength(13);
    expect(north.adjustment).toBeUndefined();
    expect(north.adjustHistory).toBeUndefined();
    expect(north.hcp).toBeDefined();
  });

  it('东家看到本人暗手与明手 S，但看不到庄家 N 与 W', () => {
    const east = projectBoardForViewer({
      record,
      tableId: TABLE_ID,
      viewer: viewer({ seat: 'E' }),
      release: release({ tableCompletedAt: null }),
      now: NOW,
    });
    expect(Object.keys(east.hands).sort()).toEqual(['E', 'S']);
    expect(east.hands.N).toBeUndefined();
    expect(east.hands.W).toBeUndefined();
  });

  it('他桌参赛者被拒绝，不泄漏记录是否存在', () => {
    expect(() =>
      projectBoardForViewer({
        record,
        tableId: TABLE_ID,
        viewer: viewer({ participantTableId: OTHER_TABLE_ID }),
        release: release(),
        now: NOW,
      }),
    ).toThrowError(/无权查看/);
  });

  it('旁观者未释放时拒绝，释放后仅见明手', () => {
    const spectator: ViewerContext = { userId: 'spec-1', role: 'spectator' };
    expect(() =>
      projectBoardForViewer({
        record,
        tableId: TABLE_ID,
        viewer: spectator,
        release: release({ tableCompletedAt: null }),
        now: NOW,
      }),
    ).toThrowError(/尚未释放/);

    const projected = projectBoardForViewer({
      record,
      tableId: TABLE_ID,
      viewer: spectator,
      release: release(),
      now: NOW,
    });
    expect(Object.keys(projected.hands)).toEqual(['S']);
    expect(projected.hcp).toBeUndefined();
    expect(projected.adjustment).toBeUndefined();
    expect(projected.play).toBeDefined();
    expect(projected.score.nsRaw).toBe(120);
  });

  it('室主按旁观者投影，不获得暗手或审计字段', () => {
    const projected = projectBoardForViewer({
      record,
      tableId: TABLE_ID,
      viewer: { userId: 'owner-1', role: 'room_owner' },
      release: release(),
      now: NOW,
    });
    expect(Object.keys(projected.hands)).toEqual(['S']);
    expect(projected.adjustment).toBeUndefined();
  });
});
