import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useGameStore } from './game';
import {
  HINTS_TRIAL_DEALS,
  HINTS_TRIAL_ENDED_STORAGE_KEY,
  HINTS_TRIAL_STORAGE_KEY,
} from '../membership';

const SHOW_HINTS_KEY = 'bridge.showHints.v1';

function newStore() {
  setActivePinia(createPinia());
  return useGameStore();
}

const storage = new Map<string, string>();

beforeAll(() => {
  // 测试环境没有可用的 localStorage；用内存实现验证刷新后的试用进度恢复。
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function clearHintsStorage(): void {
  globalThis.localStorage?.removeItem(HINTS_TRIAL_STORAGE_KEY);
  globalThis.localStorage?.removeItem(HINTS_TRIAL_ENDED_STORAGE_KEY);
  globalThis.localStorage?.removeItem(SHOW_HINTS_KEY);
}

beforeEach(clearHintsStorage);

describe('推荐 + 浮动层解释的试用与会员开关', () => {
  it('非会员默认开启，并显示前 50 副试用额度', () => {
    const store = newStore();
    expect(store.isMember).toBe(false);
    expect(store.showHints).toBe(true);
    expect(store.hintsTrialDealsUsed).toBe(0);
    expect(store.hintsTrialRemaining).toBe(HINTS_TRIAL_DEALS);
    expect(store.canEnableHints).toBe(true);
  });

  it('非会员用满前 50 副后，开始第 51 副时自动关闭且不能再次开启', () => {
    const store = newStore();
    for (let i = 0; i < HINTS_TRIAL_DEALS; i += 1) {
      store.startNewGame({ autoStart: false, seed: i + 1 });
    }
    expect(store.hintsTrialDealsUsed).toBe(HINTS_TRIAL_DEALS);
    expect(store.showHints).toBe(true);
    expect(store.hintsTrialExhausted).toBe(false);
    expect(store.hintsTrialRemaining).toBe(0);
    expect(store.canEnableHints).toBe(true);

    store.startNewGame({ autoStart: false, seed: 100 });
    expect(store.showHints).toBe(false);
    expect(store.hintsTrialExhausted).toBe(true);
    expect(store.hintsTrialRemaining).toBe(0);
    expect(store.canEnableHints).toBe(false);

    store.setShowHints(true);
    expect(store.showHints).toBe(false);
    expect(store.message).toContain('试用已结束');
  });

  it('会员不受 50 副限制，试用结束后仍可重新开启', () => {
    const store = newStore();
    for (let i = 0; i <= HINTS_TRIAL_DEALS; i += 1) {
      store.startNewGame({ autoStart: false, seed: i + 1 });
    }
    expect(store.showHints).toBe(false);

    store.setMembership(true);
    expect(store.isMember).toBe(true);
    expect(store.hintsTrialExhausted).toBe(false);
    expect(store.canEnableHints).toBe(true);

    store.setShowHints(true);
    expect(store.showHints).toBe(true);
  });

  it('试用进度从 localStorage 恢复，已用满时默认关闭', () => {
    globalThis.localStorage?.setItem(HINTS_TRIAL_STORAGE_KEY, '7');
    let store = newStore();
    expect(store.hintsTrialDealsUsed).toBe(7);
    expect(store.hintsTrialRemaining).toBe(HINTS_TRIAL_DEALS - 7);
    expect(store.showHints).toBe(true);

    globalThis.localStorage?.setItem(HINTS_TRIAL_STORAGE_KEY, String(HINTS_TRIAL_DEALS));
    store = newStore();
    // 已用完 50 副但尚未开始第 51 副：仍可查看/调整开关。
    expect(store.hintsTrialExhausted).toBe(false);
    expect(store.showHints).toBe(true);

    globalThis.localStorage?.setItem(HINTS_TRIAL_ENDED_STORAGE_KEY, '1');
    store = newStore();
    expect(store.hintsTrialExhausted).toBe(true);
    expect(store.showHints).toBe(false);
    expect(store.canEnableHints).toBe(false);
  });
});
