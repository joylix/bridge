import type { Hand } from '../models/hand';
import type { BidRecord, Position, StyleLevel } from '../models/gameState';
import { getPartner, ORDER } from '../models/gameState';
import { callToString, isCallLegal, parseAction } from '../core/bidding/validator';
import type { BidCandidate, BiddingRule, StyleParams } from './types';
import { STYLE_PARAMS } from './types';
import { checkConditions, conditionSpecificity, type ConditionContext } from './conditions';
import { inferPartnerHcpMin } from './partnerInference';
import { hcp } from '../core/evaluate';

export { callToString };

/** 相对当前叫牌人的座位：M=自己 P=同伴 L=LHO(下一家) R=RHO(上一家) */
export function relSeat(target: Position, me: Position): 'M' | 'P' | 'L' | 'R' {
  if (target === me) return 'M';
  if (target === getPartner(me)) return 'P';
  const meIdx = ORDER.indexOf(me);
  if (target === ORDER[(meIdx + 3) % 4]) return 'R'; // 上家
  return 'L'; // 下家
}

function splitToken(tok: string): [string | null, string] {
  const i = tok.indexOf(':');
  if (i === -1) return [null, tok];
  return [tok.slice(0, i).toUpperCase(), tok.slice(i + 1)];
}

/**
 * 序列匹配（冻结）：从历史末尾向前逐 token 比较。
 * 特殊模式：`.*` / `*` = 任意历史（兜底）；`^` / `^$` / 空 = 尚无实质叫品。
 */
export function matchSequence(history: BidRecord[], pattern: string, me: Position): boolean {
  const p = pattern.trim();
  if (p === '.*' || p === '*') return true;
  if (p === '^' || p === '^$' || p === '') {
    return history.every((r) => r.call.type === 'pass'); // 无任何实质叫品
  }
  const tokens = p
    .replace(/\$/g, '')
    .replace(/-/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;
  if (history.length < tokens.length) return false;

  const tail = history.slice(-tokens.length); // 从末尾对齐
  for (let k = 0; k < tokens.length; k++) {
    const [seat, callStr] = splitToken(tokens[k]);
    const rec = tail[k];
    if (seat && relSeat(rec.position, me) !== seat) return false;
    if (callToString(rec.call) !== callStr) return false;
  }
  return true;
}

/**
 * 返回全部合法候选，按 优先级↓ → 具体度↓ → 声明顺序 稳定排序。
 * 候选必须同时满足：序列匹配 + 条件成立 + 动作合法（关键修复：过滤非法动作）。
 */
export function findBidCandidates(
  hand: Hand,
  history: BidRecord[],
  currentPos: Position,
  currentBid: { level: number; suit: import('../models/gameState').BidSuit } | null,
  style: StyleLevel,
  rules: BiddingRule[],
): BidCandidate[] {
  const baseVars: StyleParams = STYLE_PARAMS[style];
  // 尚无实质叫品时，历史长度即当前叫牌人的开叫座位序号（0 个 Pass = 第一家）。
  const openingSeat = history.every((r) => r.call.type === 'pass') ? history.length + 1 : undefined;
  const firstBid = history.find((r) => r.call.type === 'bid');
  const partnerOpened = firstBid ? firstBid.position === getPartner(currentPos) : false;
  const partnerPos = getPartner(currentPos);
  const partnerHcpMin = inferPartnerHcpMin(history, partnerPos);
  const combinedHcpMin = partnerHcpMin === undefined ? undefined : hcp(hand) + partnerHcpMin;
  const context: ConditionContext = { openingSeat, partnerOpened, partnerHcpMin, combinedHcpMin };
  const out: BidCandidate[] = [];
  const partnerFirstBid = history.find((r) => r.position === partnerPos && r.call.type === 'bid');
  for (const rule of rules) {
    if (!matchSequence(history, rule.sequence, currentPos)) continue;
    const first = rule.sequence.trim().split(/\s+/)[0];
    const [firstSeat, firstCall] = splitToken(first);
    // 规则以“自己的叫品”开头时，要求该叫品是本副第一次实质叫牌。
    // 否则只做后缀匹配会产生歧义：例如 1S-(P)-2C-(P)-2D-(P) 的 2D
    // 会误匹配“2C 开叫-2D 应叫-2H”的续叫；1C-2D-2NT-3D 的 3D
    // 会误匹配“2NT 开叫-3D 转移”的应答。
    if (firstSeat === 'M' && firstCall !== 'Pass') {
      if (!firstBid || firstBid.position !== currentPos || callToString(firstBid.call) !== firstCall) continue;
    }
    // 规则以“同伴的叫品”开头时，避免把同伴的再叫误当成开叫。
    // 例：1C-(1H)-X-2C 后，P:2C R:Pass 不应匹配“应叫同伴 2C 开叫”的规则。
    if (rule.when.partnerOpened === true) {
      if (firstSeat === 'P' && firstCall !== 'Pass') {
        if (!partnerFirstBid || callToString(partnerFirstBid.call) !== firstCall) continue;
      }
    }
    const vars: StyleParams = { ...baseVars, ...(rule.style ?? {}) };
    if (!checkConditions(hand, rule.when, vars, context)) continue;
    const call = parseAction(rule.action);
    if (!isCallLegal(history, currentBid, currentPos, call)) continue; // 动作合法性过滤
    out.push({ rule, call, specificity: conditionSpecificity(rule.when) });
  }
  // stable sort（Array.prototype.sort 在现代引擎中稳定）：
  return out.sort((a, b) => b.rule.priority - a.rule.priority || b.specificity - a.specificity);
}
