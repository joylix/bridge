import { describe, expect, it } from 'vitest';
import {
  bidValue,
  isBidLegal,
  isCallLegal,
  isDoubleLegal,
  isRedoubleLegal,
  parseAction,
  callToString,
} from './validator';
import { history } from '../../testing/testUtils';

describe('叫品层级法律 (isBidLegal)', () => {
  it('无当前叫品时任意叫品合法', () => {
    expect(isBidLegal(null, { level: 1, suit: 'C' })).toBe(true);
    expect(isBidLegal(null, { level: 7, suit: 'NT' })).toBe(true);
  });

  it('必须严格高于当前叫品', () => {
    const cur = { level: 2, suit: 'H' } as const;
    expect(isBidLegal(cur, { level: 2, suit: 'S' })).toBe(true);
    expect(isBidLegal(cur, { level: 2, suit: 'NT' })).toBe(true);
    expect(isBidLegal(cur, { level: 3, suit: 'C' })).toBe(true);
    expect(isBidLegal(cur, { level: 2, suit: 'H' })).toBe(false);
    expect(isBidLegal(cur, { level: 1, suit: 'NT' })).toBe(false);
  });

  it('bidValue 层级单调（同阶 NT > S > H > D > C）', () => {
    expect(bidValue(1, 'NT')).toBeGreaterThan(bidValue(1, 'S'));
    expect(bidValue(1, 'S')).toBeGreaterThan(bidValue(1, 'H'));
    expect(bidValue(2, 'C')).toBeGreaterThan(bidValue(1, 'NT'));
  });

  it('同阶花色严格按 ♣ < ♦ < ♥ < ♠ < NT，1♣ 后可以叫 1♠', () => {
    const suits = ['C', 'D', 'H', 'S', 'NT'] as const;
    for (let i = 0; i < suits.length; i++) {
      for (let j = i + 1; j < suits.length; j++) {
        expect(isBidLegal({ level: 1, suit: suits[i] }, { level: 1, suit: suits[j] })).toBe(true);
        expect(isBidLegal({ level: 1, suit: suits[j] }, { level: 1, suit: suits[i] })).toBe(false);
      }
    }
    expect(isBidLegal({ level: 1, suit: 'C' }, { level: 1, suit: 'S' })).toBe(true);
  });
});

describe('加倍/再加倍法律', () => {
  it('可以加倍对方的叫品', () => {
    expect(isDoubleLegal(history(['N', '1H']), 'E')).toBe(true);
    expect(isDoubleLegal(history(['N', '1H']), 'W')).toBe(true);
  });

  it('不能加倍同伴的叫品', () => {
    expect(isDoubleLegal(history(['N', '1H']), 'S')).toBe(false);
  });

  it('不能加倍自己的叫品', () => {
    expect(isDoubleLegal(history(['N', '1H']), 'N')).toBe(false);
  });

  it('无叫品时不能加倍', () => {
    expect(isDoubleLegal(history(['N', 'Pass']), 'E')).toBe(false);
  });

  it('已加倍后不能在原叫品上再加倍', () => {
    expect(isDoubleLegal(history(['N', '1H'], ['E', 'X']), 'W')).toBe(false);
  });

  it('仅我方叫品被加倍后方可再加倍', () => {
    // N 叫 1H，E 加倍（对方），N 侧可再加倍
    const h = history(['N', '1H'], ['E', 'X']);
    expect(isRedoubleLegal(h, 'S')).toBe(true);
    expect(isRedoubleLegal(h, 'N')).toBe(true);
    expect(isRedoubleLegal(h, 'E')).toBe(false);
    expect(isRedoubleLegal(h, 'W')).toBe(false);
  });

  it('对方叫品被加倍时不能由己方再加倍', () => {
    // E 叫 1H，S 加倍，N 是 E 的对方但未经我方被加倍
    const h = history(['E', '1H'], ['S', 'X']);
    expect(isRedoubleLegal(h, 'E')).toBe(true); // E 侧可再加倍
    expect(isRedoubleLegal(h, 'N')).toBe(false);
  });

  it('新叫品会重置加倍状态', () => {
    // N 1H, E X, S 2H → 新叫品后加倍状态被重置
    const h = history(['N', '1H'], ['E', 'X'], ['S', '2H']);
    expect(isRedoubleLegal(h, 'N')).toBe(false);
    expect(isDoubleLegal(h, 'E')).toBe(true); // E 可加倍 S 的 2H
  });
});

describe('统一合法性入口 (isCallLegal)', () => {
  it('Pass 恒合法', () => {
    expect(isCallLegal([], null, 'N', { type: 'pass' })).toBe(true);
  });
  it('低于当前叫品的叫品非法', () => {
    const h = history(['N', '2H']);
    expect(isCallLegal(h, { level: 2, suit: 'H' }, 'E', { type: 'bid', level: 1, suit: 'S' })).toBe(false);
    expect(isCallLegal(h, { level: 2, suit: 'H' }, 'E', { type: 'bid', level: 2, suit: 'S' })).toBe(true);
  });

  it('上家 1♣ 后可以叫 1♠，即使传入的 currentBid 为空或是旧值', () => {
    const h = history(['N', '1C'], ['E', 'Pass']);
    const oneSpade = { type: 'bid' as const, level: 1, suit: 'S' as const };
    expect(isCallLegal(h, { level: 1, suit: 'C' }, 'S', oneSpade)).toBe(true);
    // 界面状态滞后（currentBid 尚未同步）时，历史中的 1C 仍然作为判定依据
    expect(isCallLegal(h, null, 'S', oneSpade)).toBe(true);
  });
  it('加倍合法性由历史推导', () => {
    const h = history(['N', '1S']);
    expect(isCallLegal(h, { level: 1, suit: 'S' }, 'E', { type: 'double' })).toBe(true);
    expect(isCallLegal(h, { level: 1, suit: 'S' }, 'S', { type: 'double' })).toBe(false);
  });
});

describe('parseAction / callToString', () => {
  it('解析各类叫品', () => {
    expect(parseAction('Pass')).toEqual({ type: 'pass' });
    expect(parseAction('X')).toEqual({ type: 'double' });
    expect(parseAction('XX')).toEqual({ type: 'redouble' });
    expect(parseAction('1C')).toEqual({ type: 'bid', level: 1, suit: 'C' });
    expect(parseAction('3NT')).toEqual({ type: 'bid', level: 3, suit: 'NT' });
  });
  it('往返一致', () => {
    for (const s of ['Pass', 'X', 'XX', '1C', '2H', '7NT']) {
      expect(callToString(parseAction(s))).toBe(s);
    }
  });
});
