import type { Hand } from '../models/hand';
import type { BidRecord, BidSuit, Position, StyleLevel } from '../models/gameState';
import { bidSuitToIndex, getPartner, ORDER } from '../models/gameState';
import type { SuitIndex } from '../models/card';
import { callToString, isCallLegal, parseAction } from '../core/bidding/validator';
import type { BidCandidate, BiddingRule, StyleParams } from './types';
import { STYLE_PARAMS } from './types';
import { checkConditions, conditionSpecificity, type ConditionContext } from './conditions';
import { inferPartnerHcpMin } from './partnerInference';
import { hcp, type AdjustmentContext } from '../core/evaluate';

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
 * 从叫牌历史推断调整点上下文：
 * - 将牌花色：搭档双方第一次叫到同一门花色，视为已显示配合；
 * - 敌方花色：对手最后一次实质性花色叫牌。
 * 这是规则引擎的近似推断，不追求完整约定卡语义。
 */
export function buildAdjustmentContext(
  history: BidRecord[],
  currentPos: Position,
): AdjustmentContext {
  const partnerPos = getPartner(currentPos);
  const mine = new Set<SuitIndex>();
  const partner = new Set<SuitIndex>();
  let trumpSuit: SuitIndex | undefined;

  for (const record of history) {
    if (record.call.type !== 'bid' || record.call.suit === 'NT') continue;
    const suit = bidSuitToIndex(record.call.suit);
    if (record.position === currentPos) {
      if (partner.has(suit)) {
        trumpSuit = suit;
        break;
      }
      mine.add(suit);
    } else if (record.position === partnerPos) {
      if (mine.has(suit)) {
        trumpSuit = suit;
        break;
      }
      partner.add(suit);
    }
  }

  let opponentSuit: SuitIndex | undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const record = history[i];
    if (record.position === currentPos || record.position === partnerPos) continue;
    if (record.call.type === 'bid' && record.call.suit !== 'NT') {
      opponentSuit = bidSuitToIndex(record.call.suit);
      break;
    }
  }

  return {
    trumpSuit,
    partnerSupported: trumpSuit !== undefined,
    opponentSuit,
  };
}

/**
 * 判断某条历史叫牌规则是否表示“强自然新花”。
 *
 * v0.5 语义权威是 `tags`：同时含 `natural` 与 `forcing` 才成立。
 * 没有 `tags` 字段的 legacy 手写规则回退到 `nat_` 前缀，保持旧规则兼容。
 */
function isForcingNewSuitRule(
  ruleId: string | undefined,
  rulesById: Map<string, BiddingRule>,
): boolean {
  if (!ruleId) return false;
  const rule = rulesById.get(ruleId) as (BiddingRule & { tags?: readonly string[] }) | undefined;
  if (Array.isArray(rule?.tags)) {
    return rule.tags.includes('natural') && rule.tags.includes('forcing');
  }
  return ruleId.startsWith('nat_');
}

/**
 * 从叫牌历史推断“进程上下文”：
 * - 扣叫：叫了敌方此前已经叫过的花色；
 * - 自然新花：该座位最后一次自然花色叫牌命中的规则同时带有
 *   `natural` 与 `forcing` 标签；无 tags 的 legacy 手写规则回退 id 前缀；
 * - Blackwood：4NT 及同伴的 5C/5D/5H/5S 应答。
 *
 * 这些信息只服务于规则条件，不参与计分或调整点。
 */
export function buildAuctionContext(
  history: BidRecord[],
  currentPos: Position,
  rules: readonly BiddingRule[] = [],
): Partial<ConditionContext> {
  const partnerPos = getPartner(currentPos);
  const opponentSuits = new Set<SuitIndex>();
  const rulesById = new Map<string, BiddingRule>();
  for (const rule of rules) {
    if (!rulesById.has(rule.id)) rulesById.set(rule.id, rule);
  }

  let myLastBidWasCue = false;
  let partnerLastBidWasCue = false;
  let myLastBidWasNaturalSuit = false;
  let partnerLastBidWasNaturalSuit = false;
  let myLastBidRuleId: string | undefined;
  let partnerLastBidRuleId: string | undefined;
  let mySuit: string | undefined;
  let partnerSuit: string | undefined;
  let lastBid: { level: number; suit: BidSuit; position: Position } | undefined;
  let cueBid: { suit: string; level: number } | undefined;
  let cueBidActive = false;
  let myBlackwood = false;
  let partnerBlackwood = false;
  let myBlackwoodAgreedSuit: string | undefined;
  let partnerBlackwoodAgreedSuit: string | undefined;

  for (const record of history) {
    if (record.call.type !== 'bid') continue;
    const { level, suit } = record.call;
    lastBid = { level, suit, position: record.position };
    const isSuit = suit !== 'NT';
    const suitIndex = isSuit ? bidSuitToIndex(suit) : undefined;
    const isCue = isSuit && opponentSuits.has(suitIndex!);

    if (record.position === currentPos) {
      myLastBidWasCue = isCue;
      myLastBidWasNaturalSuit = isSuit && !isCue;
      myLastBidRuleId = record.ruleId;
      if (isSuit && !isCue) mySuit = suit;
      if (isCue) {
        cueBid = { suit, level };
        cueBidActive = true;
      }
      myBlackwood = suit === 'NT' && level === 4;
      if (myBlackwood) myBlackwoodAgreedSuit = partnerSuit;
    } else if (record.position === partnerPos) {
      partnerLastBidWasCue = isCue;
      partnerLastBidWasNaturalSuit = isSuit && !isCue;
      partnerLastBidRuleId = record.ruleId;
      if (isSuit && !isCue) partnerSuit = suit;
      if (isCue) {
        cueBid = { suit, level };
        cueBidActive = true;
      }
      partnerBlackwood = suit === 'NT' && level === 4;
      if (partnerBlackwood) partnerBlackwoodAgreedSuit = mySuit;
    } else if (isSuit) {
      opponentSuits.add(suitIndex!);
    }
  }

  let partnerAcesShown: number | undefined;
  let partnerAcesAmbiguous = false;
  if (
    myBlackwood &&
    lastBid?.position === partnerPos &&
    lastBid.level === 5 &&
    lastBid.suit !== 'NT'
  ) {
    if (lastBid.suit === 'C') {
      partnerAcesShown = 0;
      partnerAcesAmbiguous = true;
    } else if (lastBid.suit === 'D') {
      partnerAcesShown = 1;
    } else if (lastBid.suit === 'H') {
      partnerAcesShown = 2;
    } else if (lastBid.suit === 'S') {
      partnerAcesShown = 3;
    }
  }

  return {
    partnerCueBid: partnerLastBidWasCue,
    myCueBid: myLastBidWasCue,
    cueBidActive,
    cueBidSuit: cueBid?.suit,
    cueBidLevel: cueBid?.level,
    partnerSuit,
    mySuit,
    partnerNaturalSuit: partnerLastBidWasNaturalSuit,
    myNaturalSuit: myLastBidWasNaturalSuit,
    partnerForcingNewSuit:
      partnerLastBidWasNaturalSuit && isForcingNewSuitRule(partnerLastBidRuleId, rulesById),
    myForcingNewSuit:
      myLastBidWasNaturalSuit && isForcingNewSuitRule(myLastBidRuleId, rulesById),
    lastBidSuit: lastBid?.suit,
    lastBidLevel: lastBid?.level,
    partnerBlackwood: partnerBlackwood && cueBidActive,
    myBlackwood: myBlackwood && cueBidActive,
    agreedSuit: myBlackwood ? myBlackwoodAgreedSuit : partnerBlackwood ? partnerBlackwoodAgreedSuit : undefined,
    partnerAcesShown,
    partnerAcesAmbiguous,
  };
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
 * 编译后规则的可选裁决元数据。
 *
 * `BiddingRule` 契约保持冻结，因此这里只做结构化读取：v0.5 编译结果带
 * `specificity` / `sourceIndex`，手写或 legacy 规则没有时回退到旧算法。
 */
type RankedRule = BiddingRule & {
  specificity?: number;
  sourceIndex?: number;
};

interface RankedCandidate extends BidCandidate {
  /** 声明顺序；没有编译元数据时用输入数组下标。 */
  sourceIndex: number;
}

/**
 * 返回全部合法候选，按 优先级↓ → 具体度↓ → 声明顺序 排序。
 * 候选必须同时满足：序列匹配 + 条件成立 + 动作合法（关键修复：过滤非法动作）。
 *
 * Phase 3 起具体度优先读取编译器的 `specificity`（源条件项数量），声明顺序
 * 优先读取 `sourceIndex`（IR 顺序）。这样 `BAL_NO_5M` 降解、`balanced:false`
 * 拆分增加的扁平条件不会改变裁决结果。
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
  const adjustment = buildAdjustmentContext(history, currentPos);
  const auctionContext = buildAuctionContext(history, currentPos, rules);
  const context: ConditionContext = {
    openingSeat,
    partnerOpened,
    partnerHcpMin,
    combinedHcpMin,
    adjustment,
    ...auctionContext,
  };
  const out: RankedCandidate[] = [];
  const partnerFirstBid = history.find((r) => r.position === partnerPos && r.call.type === 'bid');
  for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex += 1) {
    const rule = rules[ruleIndex];
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
    const ranked = rule as RankedRule;
    const specificity =
      typeof ranked.specificity === 'number'
        ? ranked.specificity
        : conditionSpecificity(rule.when);
    const sourceIndex =
      typeof ranked.sourceIndex === 'number' ? ranked.sourceIndex : ruleIndex;
    out.push({ rule, call, specificity, sourceIndex });
  }
  // 显式三段排序：优先级↓ → 源具体度↓ → 声明顺序↑。
  return out.sort(
    (a, b) =>
      b.rule.priority - a.rule.priority ||
      b.specificity - a.specificity ||
      a.sourceIndex - b.sourceIndex,
  );
}
