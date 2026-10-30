import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useGameStore } from '../store/game';
import { parseAction } from '../core/bidding/validator';
import { getLegalCards } from '../core/playing';
import { getSuit } from '../models/card';
import { trumpSuitOf, type Position } from '../models/gameState';
import { parsePbnDeal, toPbnDeal } from '../core/pbn';
import { deriveStreamSeeds, streamSeed } from './rng';
import { parsePbnDocument } from './pbn';
import { parseTableBoardRecord, validateTableBoardRecord } from './json';
import { callFromCode, callToCode, toInternalVulnerability, toRecordVulnerability } from './record';
import { toTableBoardCsv } from './csv';

const SEATS: Position[] = ['N', 'E', 'S', 'W'];
const SAMPLE_PBN =
  'N:AKQ2.JT9.543.876 JT98.AKQ.AKQJ.T9 76543.8765.T98.A -.432.762.KQJ5432';

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

describe('随机流派生', () => {
  it('与 reproducibility.md §3.2 的示例一致', () => {
    expect(streamSeed(2026, 0, 'deal')).toBe(2931564761);
    expect(streamSeed(2026, 0, 'bidding')).toBe(3056024501);
    expect(streamSeed(2026, 0, 'play')).toBe(4016366938);
    expect(streamSeed(2026, 0, 'dds')).toBe(3100401203);
    expect(deriveStreamSeeds(2026, 0)).toEqual({
      deal: 2931564761,
      bidding: 3056024501,
      play: 4016366938,
      dds: 3100401203,
    });
  });

  it('四条流彼此独立，且同种子可复现', () => {
    const first = deriveStreamSeeds(42, 3);
    expect(new Set(Object.values(first)).size).toBe(4);
    expect(deriveStreamSeeds(42, 3)).toEqual(first);
    expect(deriveStreamSeeds(42, 4).deal).not.toBe(first.deal);
  });
});

describe('记录基础转换', () => {
  it('局况在内部值与记录值之间双向转换', () => {
    expect(toRecordVulnerability('none')).toBe('NONE');
    expect(toRecordVulnerability('both')).toBe('ALL');
    expect(toInternalVulnerability('all')).toBe('both');
    expect(toInternalVulnerability('None')).toBe('none');
    expect(toInternalVulnerability('NS')).toBe('NS');
    expect(toInternalVulnerability('EW')).toBe('EW');
  });

  it('叫品码与 BidCall 互转', () => {
    expect(callToCode({ type: 'pass' })).toBe('PASS');
    expect(callToCode({ type: 'bid', level: 3, suit: 'NT' })).toBe('3NT');
    expect(callToCode({ type: 'double' })).toBe('X');
    expect(callToCode({ type: 'redouble' })).toBe('XX');
    expect(callFromCode('PASS')).toEqual({ type: 'pass' });
    expect(callFromCode('4S')).toEqual({ type: 'bid', level: 4, suit: 'S' });
  });
});

describe('开局快照与四条随机流（store 集成）', () => {
  let store: ReturnType<typeof newStore>;
  beforeEach(() => {
    store = newStore();
  });

  it('beginAuction 冻结 engine 快照；局中换规则不影响当前副', () => {
    store.startNewGame({ autoStart: false, seed: 2026 });
    const engine = store.dealEngine!;
    expect(engine.dealSource).toEqual({ kind: 'seeded', baseSeed: 2026, index: 0 });
    expect(engine.streams).toEqual(deriveStreamSeeds(2026, 0));
    expect(engine.rngSeed).toBe(engine.streams!.deal);
    expect(engine.ruleset.rulesetId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(engine.playRulesets.lead.rulesetId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(engine.playRulesets.signal.rulesetId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(engine.snapshotAt).toBeTruthy();
    expect(engine.seats.N.controller).toBe('ai');
    expect(engine.seats.S.controller).toBe('human');

    const before = engine.ruleset.rulesetId;
    store.setBiddingRuleFile('natural');
    expect(store.dealEngine!.ruleset.rulesetId).toBe(before);
  });

  it('同一 seed 的完整记录可复现：发牌、局况与四条流种子一致', () => {
    store.startNewGame({ autoStart: false, seed: 77 });
    const first = {
      hands: SEATS.map((seat) => [...store.hands[seat]]),
      vulnerability: store.vulnerability,
      engine: store.dealEngine!,
    };
    store.startNewGame({ autoStart: false, seed: 77 });
    expect(SEATS.map((seat) => store.hands[seat])).toEqual(first.hands);
    expect(store.vulnerability).toBe(first.vulnerability);
    expect(store.dealEngine!.streams).toEqual(first.engine.streams);
  });
});

describe('JSON 导入 / 导出', () => {
  it('完整打完的一副可 JSON 往返，并恢复结算状态', () => {
    const store = newStore();
    store.startNewGame({ autoStart: false, seed: 55 });
    playOut(store);
    expect(store.phase).toBe('scoring');

    const json = store.exportTableBoardJson();
    const record = parseTableBoardRecord(json);
    expect(record.status).toBe('PLAYED');
    expect(record.auction.calls).toEqual(['1NT', 'PASS', 'PASS', 'PASS']);
    expect(record.contract).toMatchObject({ level: 1, denomination: 'NT', doubled: 'NONE' });
    expect(record.play?.tricks).toHaveLength(13);
    expect(record.hcp.ns + record.hcp.ew).toBe(40);
    expect(record.engine.ruleset.rulesetId).toMatch(/^sha256:/);

    const restored = newStore();
    restored.importTableBoardJson(json, { autoStart: false });
    expect(restored.phase).toBe('scoring');
    expect(restored.tricks).toHaveLength(13);
    expect(restored.contract).toMatchObject({ level: 1, suit: 'NT' });
    expect(restored.score).toEqual(store.score);
    expect(restored.gamesPlayed).toBe(1);
  });

  it('拒绝 HCP 合计不为 40 的记录', () => {
    const store = newStore();
    store.startNewGame({ autoStart: false, seed: 1 });
    const raw = JSON.parse(store.exportTableBoardJson()) as Record<string, unknown>;
    raw.hcp = { ns: 39, ew: 0 };
    const issues = validateTableBoardRecord(raw);
    expect(issues.map((issue) => issue.code)).toContain('HCP_SUM_INVALID');
  });

  it('拒绝 PASSED_OUT 带 contract，以及缺少 engine 的旧记录', () => {
    const store = newStore();
    store.startNewGame({ autoStart: false, seed: 1 });
    const raw = JSON.parse(store.exportTableBoardJson()) as Record<string, unknown>;
    raw.status = 'PASSED_OUT';
    raw.contract = { level: 1, denomination: 'NT', doubled: 'NONE' };
    delete raw.engine;
    const issues = validateTableBoardRecord(raw);
    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain('CONTRACT_STATE_INVALID');
    expect(codes).toContain('ENGINE_MISSING');
  });

  it('拒绝被篡改的随机流种子', () => {
    const store = newStore();
    store.startNewGame({ autoStart: false, seed: 2026 });
    const raw = JSON.parse(store.exportTableBoardJson()) as Record<string, unknown>;
    const engine = raw.engine as { streams: Record<string, number> };
    engine.streams.play += 1;
    const issues = validateTableBoardRecord(raw);
    expect(issues.map((issue) => issue.code)).toContain('STREAM_SEED_MISMATCH');
  });
});

describe('完整 PBN 导入 / 导出', () => {
  it('导出包含 Deal/Auction/Contract/Result/Play/Score，并可恢复', () => {
    const store = newStore();
    store.startNewGame({ autoStart: false, seed: 55 });
    playOut(store);

    const result = store.exportTableBoardPbn();
    for (const tag of ['[Deal "', '[Auction "', '[Contract "', '[Declarer "', '[Result "', '[Play "', '[Score "']) {
      expect(result.text).toContain(tag);
    }
    expect(result.text.startsWith('% PBN 2.1\n')).toBe(true);
    expect(result.text).toContain('[Vulnerable "');

    const restored = newStore();
    const issues = restored.importTableBoardPbn(result.text, { autoStart: false });
    expect(issues.some((issue) => issue.severity === 'error')).toBe(false);
    expect(restored.phase).toBe('scoring');
    expect(restored.tricks).toHaveLength(13);
    expect(restored.score).toEqual(store.score);

    const reexported = restored.exportTableBoardPbn().text;
    const first = parsePbnDocument(result.text);
    const second = parsePbnDocument(reexported);
    expect(second.calls).toEqual(first.calls);
    expect(second.contract).toEqual(first.contract);
    expect(second.declarer).toBe(first.declarer);
    expect(second.tricksTaken).toBe(first.tricksTaken);
    expect(second.score).toEqual(first.score);
    expect(second.play?.tricks).toHaveLength(13);
  });

  it('AP 展开为补足叫牌结束所需的 Pass，而不是固定四个', () => {
    const doc = parsePbnDocument(`% PBN 2.1
[Deal "${SAMPLE_PBN}"]
[Dealer "N"]
[Vulnerable "None"]
[Auction "N"]
1NT P 2C P 2H P 3NT AP
[Contract "3NT"]
[Declarer "N"]
[Result "9"]
[Score "NS 400"]
`);
    expect(doc.calls).toEqual([
      '1NT',
      'PASS',
      '2C',
      'PASS',
      '2H',
      'PASS',
      '3NT',
      'PASS',
      'PASS',
      'PASS',
    ]);
    expect(doc.auctionCompleted).toBe(true);
    expect(doc.score).toEqual({ nsRaw: 400, source: 'director' });
    expect(doc.issues.map((issue) => issue.code)).toContain('PLAY_MISSING');
  });

  it('Score 按方向换算 nsRaw', () => {
    const doc = parsePbnDocument(`% PBN 2.1
[Deal "${SAMPLE_PBN}"]
[Dealer "N"]
[Vulnerable "None"]
[Auction "N"]
1NT P P P
[Contract "1NT"]
[Declarer "N"]
[Result "7"]
[Score "EW 620"]
`);
    expect(doc.score).toEqual({ nsRaw: -620, source: 'director' });
  });

  it('拒绝非法 Score、缺少 Result、Dealer 与前缀冲突只警告', () => {
    expect(() =>
      parsePbnDocument(`% PBN 2.1
[Deal "${SAMPLE_PBN}"]
[Dealer "N"]
[Auction "N"]
1NT P P P
[Contract "1NT"]
[Declarer "N"]
[Result "7"]
[Score "NS -420"]
`),
    ).toThrow(/INVALID_SCORE/);

    expect(() =>
      parsePbnDocument(`% PBN 2.1
[Deal "${SAMPLE_PBN}"]
[Dealer "N"]
[Auction "N"]
1NT P P P
[Contract "1NT"]
[Declarer "N"]
`),
    ).toThrow(/CONTRACT_INCOMPLETE/);

    const mismatch = parsePbnDocument(`% PBN 2.1
[Deal "${SAMPLE_PBN}"]
[Dealer "E"]
[Vulnerable "None"]
[Auction "E"]
P P P P
[Contract "Pass"]
[Score "NS 0"]
`);
    expect(mismatch.dealer).toBe('E');
    expect(mismatch.issues.map((issue) => issue.code)).toContain('DEALER_PREFIX_MISMATCH');
    expect(mismatch.status).toBe('PASSED_OUT');
  });

  it('缺门用 - 导出，空段导入只作兼容并给警告', () => {
    const hands = parsePbnDeal(SAMPLE_PBN).hands;
    expect(toPbnDeal(hands, 'N')).toContain('-.432.762.KQJ5432');

    const withEmpty = SAMPLE_PBN.replace('-.432.762.KQJ5432', '.432.762.KQJ5432');
    const doc = parsePbnDocument(`% PBN 2.1
[Deal "${withEmpty}"]
[Dealer "N"]
[Vulnerable "None"]
[Auction "N"]
P P P P
[Contract "Pass"]
[Score "NS 0"]
`);
    expect(doc.issues.map((issue) => issue.code)).toContain('EMPTY_SUIT_SEGMENT');
  });
});

describe('CSV 导出', () => {
  it('带 UTF-8 BOM、表头与每副一行', () => {
    const store = newStore();
    store.startNewGame({ autoStart: false, seed: 1 });
    playOut(store);
    store.setBiddingRuleFile('natural');
    store.startNewGame({ autoStart: false, seed: 2 });
    const csv = store.exportTableBoardCsv();
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\n');
    expect(lines[0]).toContain('board,dealId,recordId');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('PLAYED');
    expect(lines[2]).toContain('IN_PROGRESS');

    const single = toTableBoardCsv([parseTableBoardRecord(store.exportTableBoardJson())]);
    expect(single).toContain('singleTableImp');
  });
});
