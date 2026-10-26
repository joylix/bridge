/**
 * 会员权益与“推荐 + 浮动层解释”试用策略。
 *
 * 当前阶段（无后台账号体系）：默认按非会员处理，非会员可试用前 50 副牌；
 * 后续接入登录态后，由 `store.setMembership()` 注入真实会员状态。
 */
export const HINTS_TRIAL_DEALS = 50;

/** 非会员已使用试用副数的本地存储键（用于刷新后继续累计） */
export const HINTS_TRIAL_STORAGE_KEY = 'bridge.hintsTrialDeals.v1';

/** 非会员试用是否已结束的本地存储键（开始第 51 副时置为已结束） */
export const HINTS_TRIAL_ENDED_STORAGE_KEY = 'bridge.hintsTrialEnded.v1';

/** 指定会员状态与已用副数时，试用额度是否仍允许开启推荐 + 浮动层解释 */
export function canEnableHints(isMember: boolean, trialDealsUsed: number): boolean {
  return isMember || trialDealsUsed <= HINTS_TRIAL_DEALS;
}

/** 非会员剩余试用副数；会员不受试用限制 */
export function hintsTrialRemaining(isMember: boolean, trialDealsUsed: number): number {
  if (isMember) return HINTS_TRIAL_DEALS;
  return Math.max(0, HINTS_TRIAL_DEALS - Math.max(0, trialDealsUsed));
}
