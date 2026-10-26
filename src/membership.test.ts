import { describe, expect, it } from 'vitest';
import { HINTS_TRIAL_DEALS, canEnableHints, hintsTrialRemaining } from './membership';

describe('推荐 + 浮动层解释的会员试用策略', () => {
  it('非会员在试用额度内可以开启，额度用完后不能开启', () => {
    expect(canEnableHints(false, 0)).toBe(true);
    expect(canEnableHints(false, HINTS_TRIAL_DEALS - 1)).toBe(true);
    // 第 50 副仍属于试用范围；开始第 51 副时才由 store 置为结束。
    expect(canEnableHints(false, HINTS_TRIAL_DEALS)).toBe(true);
    expect(canEnableHints(false, HINTS_TRIAL_DEALS + 1)).toBe(false);
  });

  it('会员不受试用额度限制', () => {
    expect(canEnableHints(true, 0)).toBe(true);
    expect(canEnableHints(true, HINTS_TRIAL_DEALS)).toBe(true);
  });

  it('剩余副数按已用副数递减，会员显示完整额度', () => {
    expect(hintsTrialRemaining(false, 0)).toBe(HINTS_TRIAL_DEALS);
    expect(hintsTrialRemaining(false, 12)).toBe(HINTS_TRIAL_DEALS - 12);
    expect(hintsTrialRemaining(false, HINTS_TRIAL_DEALS)).toBe(0);
    expect(hintsTrialRemaining(true, HINTS_TRIAL_DEALS)).toBe(HINTS_TRIAL_DEALS);
  });
});
