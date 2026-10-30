import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useGameStore } from '../store/game';
import { parseAction } from '../core/bidding/validator';
import { getLegalCards } from '../core/playing';
import { getSuit } from '../models/card';
import { trumpSuitOf } from '../models/gameState';
import {
  parseTableBoardRecord,
  parseTableBoardRecordDetailed,
  validateTableBoardRecord,
} from './json';
import { tableBoardToPbn } from './pbn';
import { toTableBoardCsv } from './csv';
import type { RecordAdjustment, TableBoardRecord } from './types';

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

function adjustment(kind: RecordAdjustment['kind'], patch: Partial<RecordAdjustment> = {}): RecordAdjustment {
  return {
    kind,
    reason: kind === 'CANCEL' ? '裁判取消' : kind === 'REOPEN' ? '裁判重开' : '裁判改分',
    actor: 'director-1',
    at: '2026-10-28T00:00:00Z',
    beforeStatus: 'PLAYED',
    afterStatus: kind === 'CANCEL' ? 'CANCELLED' : kind === 'REOPEN' ? 'REOPENED' : 'ADJUSTED',
    beforeValue: 90,
    afterValue: kind === 'ADJUST' ? 120 : null,
    ...patch,
  };
}

function asNoScore(record: TableBoardRecord): TableBoardRecord {
  delete record.contract;
  delete record.declarer;
  delete record.tricksTaken;
  delete record.play;
  record.score.nsRaw = null;
  if (record.derived?.imp) record.derived.imp.singleTable = null;
  return record;
}

function codes(record: unknown): string[] {
  return validateTableBoardRecord(record).map((issue) => issue.code);
}

describe('Schema 1.1 导出与状态约束', () => {
  let base: TableBoardRecord;
  beforeEach(() => {
    base = playedRecord();
  });

  it('新导出统一写 schemaVersion=1.1、WBF 版本与 IMP 表版本', () => {
    expect(base.schemaVersion).toBe('1.1');
    expect(base.engine.rulesVersion).toBe('wbf-laws-2017');
    expect(base.derived?.imp?.tableVersion).toBe('wbf-2017');
    expect(base.score.nsRaw).toBeTypeOf('number');
  });

  it('CANCELLED 必须写 rawScore=null、imp=null，并带取消审计', () => {
    const record = asNoScore(structuredClone(base));
    record.status = 'CANCELLED';
    record.adjustment = adjustment('CANCEL');
    record.adjustHistory = [record.adjustment];
    expect(codes(record)).toEqual([]);

    const zero = structuredClone(record);
    zero.score.nsRaw = 0;
    zero.derived!.imp!.singleTable = 0;
    expect(codes(zero)).toContain('SCORE_STATE_INVALID');

    const noReason = structuredClone(record);
    delete noReason.adjustment;
    expect(codes(noReason)).toContain('CANCELLED_REASON_MISSING');
  });

  it('INCOMPLETE 不计算成绩，必须 rawScore=null', () => {
    const record = asNoScore(structuredClone(base));
    record.status = 'INCOMPLETE';
    expect(codes(record)).toEqual([]);

    const scored = structuredClone(record);
    scored.score.nsRaw = 0;
    scored.derived!.imp!.singleTable = 0;
    expect(codes(scored)).toContain('SCORE_STATE_INVALID');

    const withContract = structuredClone(record);
    withContract.contract = { level: 1, denomination: 'NT', doubled: 'NONE' };
    expect(codes(withContract)).toContain('CONTRACT_STATE_INVALID');
  });

  it('REOPENED 必须带 REOPEN 审计且无定约/出牌', () => {
    const record = asNoScore(structuredClone(base));
    record.status = 'REOPENED';
    record.adjustment = adjustment('REOPEN');
    expect(codes(record)).toEqual([]);

    record.contract = { level: 1, denomination: 'NT', doubled: 'NONE' };
    expect(codes(record)).toContain('CONTRACT_STATE_INVALID');
  });

  it('ADJUSTED 要求 adjustment/adjustHistory，且 afterValue 与 rawScore 一致', () => {
    const record = structuredClone(base);
    record.status = 'ADJUSTED';
    record.score.nsRaw = 120;
    record.derived!.imp!.singleTable = 3;
    record.adjustment = adjustment('ADJUST');
    record.adjustHistory = [record.adjustment];
    expect(codes(record)).toEqual([]);

    record.adjustment.afterValue = 130;
    expect(codes(record)).toContain('ADJUSTED_INVALID');

    const mismatch = structuredClone(record);
    mismatch.adjustment = adjustment('ADJUST');
    expect(codes(mismatch)).toContain('ADJUSTMENT_HISTORY_MISMATCH');
  });

  it('IN_PROGRESS 在叫牌结束后可以携带 contract / declarer', () => {
    const record = structuredClone(base);
    record.status = 'IN_PROGRESS';
    delete record.play;
    record.tricksTaken = 0;
    expect(codes(record)).toEqual([]);
    expect(record.contract?.level).toBe(1);
    expect(record.declarer).toBe('N');
  });

  it('PASSED_OUT 仍要求 0 分与四 Pass', () => {
    const record = asNoScore(structuredClone(base));
    record.status = 'PASSED_OUT';
    record.score.nsRaw = 0;
    record.derived!.imp!.singleTable = 0;
    record.auction = { calls: ['PASS', 'PASS', 'PASS', 'PASS'], completed: true };
    expect(codes(record)).toEqual([]);

    record.score.nsRaw = null;
    record.derived!.imp!.singleTable = null;
    expect(codes(record)).toContain('SCORE_STATE_INVALID');
  });
});

describe('Schema 1.0 兼容导入', () => {
  function legacy(record: TableBoardRecord): Record<string, unknown> {
    const raw = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
    raw.schemaVersion = '1.0';
    return raw;
  }

  it('1.0 的 PLAYED / PASSED_OUT / ADJUSTED 仍可导入', () => {
    const base = playedRecord();
    expect(codes(legacy(base))).toEqual([]);

    const adjusted = structuredClone(base);
    adjusted.status = 'ADJUSTED';
    adjusted.score.nsRaw = 120;
    adjusted.derived = {
      imp: { singleTable: 3, tableVersion: 'wbf-2017' },
      adjusted: { profile: 'standard-duplicate', nsPoints: 3 },
    };
    adjusted.adjustment = adjustment('ADJUST');
    adjusted.adjustHistory = [adjusted.adjustment];
    expect(codes(legacy(adjusted))).toEqual([]);
  });

  it('1.0 不允许 INCOMPLETE / REOPENED', () => {
    const record = asNoScore(structuredClone(playedRecord()));
    record.status = 'INCOMPLETE';
    expect(codes(legacy(record))).toContain('STATUS_INVALID');
  });

  it('1.0 取消副写 0 分只给兼容警告', () => {
    const record = asNoScore(structuredClone(playedRecord()));
    record.status = 'CANCELLED';
    record.score.nsRaw = 0;
    record.derived!.imp!.singleTable = 0;
    const issues = validateTableBoardRecord(legacy(record));
    expect(issues.some((issue) => issue.code === 'LEGACY_CANCELLED_ZERO_SCORE')).toBe(true);
    expect(issues.some((issue) => issue.severity === 'error')).toBe(false);
  });
});

describe('Schema 1.1 的 PBN / CSV 降级', () => {
  it('取消副导出 PBN 不写 [Score]，并在损失报告中说明', () => {
    const record = asNoScore(structuredClone(playedRecord()));
    record.status = 'CANCELLED';
    record.adjustment = adjustment('CANCEL');
    const result = tableBoardToPbn(record);
    expect(result.text).not.toContain('[Score "');
    expect(result.text).not.toContain('[Contract "');
    expect(result.losses.map((loss) => loss.field)).toContain('score');
  });

  it('取消副的 CSV 原始分与 IMP 留空，不写 0', () => {
    const record = asNoScore(structuredClone(playedRecord()));
    record.status = 'CANCELLED';
    record.adjustment = adjustment('CANCEL');
    const csv = toTableBoardCsv([record]).replace(/^\uFEFF/, '');
    const row = csv.trim().split('\n')[1].split(',');
    const header = csv.trim().split('\n')[0].split(',');
    expect(row[header.indexOf('nsRaw')]).toBe('');
    expect(row[header.indexOf('singleTableImp')]).toBe('');
  });

  it('未完成副导出 PBN 不写 Score / Auction / Contract', () => {
    const record = asNoScore(structuredClone(playedRecord()));
    record.status = 'INCOMPLETE';
    const result = tableBoardToPbn(record);
    expect(result.text).not.toContain('[Score "');
    expect(result.text).not.toContain('[Auction');
    expect(result.text).not.toContain('[Contract "');
    expect(result.losses.map((loss) => loss.field)).toContain('score');
  });
});

describe('诊断接口', () => {
  it('parseTableBoardRecordDetailed 保留 warning/info 供 UI 展示', () => {
    const base = playedRecord();
    const raw = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    (raw.deal as Record<string, unknown>).dealer = 'E';
    const { issues } = parseTableBoardRecordDetailed(JSON.stringify(raw));
    expect(issues.map((issue) => issue.code)).toContain('DEALER_PREFIX_MISMATCH');
  });
});
