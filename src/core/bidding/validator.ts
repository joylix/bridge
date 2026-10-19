import type { BidRecord, BidCall, BidSuit, Position } from '../../models/gameState';
import { getPartner } from '../../models/gameState';

/** 桥牌叫品花色等级：♣ < ♦ < ♥ < ♠ < NT */
const BID_SUIT_ORDER: Record<BidSuit, number> = { C: 0, D: 1, H: 2, S: 3, NT: 4 };

/** 叫品的“绝对大小”，用于层级递增比较（同阶时按花色等级） */
export function bidValue(level: number, suit: BidSuit): number {
  const normalized = String(suit).toUpperCase() as BidSuit;
  return (level - 1) * 5 + (BID_SUIT_ORDER[normalized] ?? 0);
}

/** 叫品合法性：无当前叫品时任意叫品合法；否则必须严格高于当前叫品 */
export function isBidLegal(
  currentBid: { level: number; suit: BidSuit } | null,
  newBid: { level: number; suit: BidSuit },
): boolean {
  if (!currentBid) return true;
  return bidValue(newBid.level, newBid.suit) > bidValue(currentBid.level, currentBid.suit);
}

/** 找到最后一条“真正的叫品”(bid)，忽略 Pass / Double / Redouble */
function findLastBidIndex(history: BidRecord[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].call.type === 'bid') return i;
  }
  return -1;
}

/** 从叫牌历史中取当前叫品；历史比 UI/存档里的 currentBid 更可靠 */
export function lastBidOf(history: BidRecord[]): { level: number; suit: BidSuit } | null {
  const i = findLastBidIndex(history);
  if (i === -1) return null;
  const call = history[i].call;
  return call.type === 'bid' ? { level: call.level, suit: call.suit } : null;
}

/** 统计 afterIdx 之后出现的加倍状态（新叫品会重置） */
function getDoubleStateAfter(history: BidRecord[], afterIdx: number): 'none' | 'double' | 'redouble' {
  let state: 'none' | 'double' | 'redouble' = 'none';
  for (let i = afterIdx + 1; i < history.length; i++) {
    const call = history[i].call;
    if (call.type === 'double') {
      if (state === 'none') state = 'double';
    } else if (call.type === 'redouble') {
      if (state === 'double') state = 'redouble';
    } else if (call.type === 'bid') {
      state = 'none'; // 新叫品重置
    }
  }
  return state;
}

/**
 * 加倍合法性：存在最后一个叫品，且该叫品由“对方”做出，且尚未被加倍/再加倍。
 * 注意：最后叫品是 bid（不是加倍/再加倍本身），这是旧版最大的错误来源（订正点 3）。
 */
export function isDoubleLegal(history: BidRecord[], position: Position): boolean {
  const i = findLastBidIndex(history);
  if (i === -1) return false;
  const lastBid = history[i];
  const byOpponent = lastBid.position !== position && lastBid.position !== getPartner(position);
  if (!byOpponent) return false; // 不能加倍同伴的叫品
  return getDoubleStateAfter(history, i) === 'none';
}

/**
 * 再加倍合法性：最后一个叫品由“我方”做出，且已被对方加倍、尚未再加倍。
 */
export function isRedoubleLegal(history: BidRecord[], position: Position): boolean {
  const i = findLastBidIndex(history);
  if (i === -1) return false;
  const lastBid = history[i];
  const byOurSide = lastBid.position === position || lastBid.position === getPartner(position);
  if (!byOurSide) return false;
  return getDoubleStateAfter(history, i) === 'double';
}

/** 统一的“该叫品是否合法”判定，供 AI 出口过滤与 UI 按钮禁用共用 */
export function isCallLegal(
  history: BidRecord[],
  currentBid: { level: number; suit: BidSuit } | null,
  position: Position,
  call: BidCall,
): boolean {
  switch (call.type) {
    case 'pass':
      return true;
    case 'bid':
      // 以历史中的最后叫品为准，避免界面状态滞后时把 1♣ 后的 1♠ 误判为非法。
      return isBidLegal(lastBidOf(history) ?? currentBid, call);
    case 'double':
      return isDoubleLegal(history, position);
    case 'redouble':
      return isRedoubleLegal(history, position);
  }
}

/** 动作字符串 → BidCall，供规则引擎与 UI 共用 */
export function parseAction(action: string): BidCall {
  const a = action.trim();
  if (a === 'Pass' || a === 'pass' || a === 'P') return { type: 'pass' };
  if (a === 'X' || a === 'x') return { type: 'double' };
  if (a === 'XX' || a === 'xx') return { type: 'redouble' };
  const level = parseInt(a[0], 10);
  const suit = a.slice(1).toUpperCase() as BidSuit;
  return { type: 'bid', level, suit };
}

/** BidCall → 动作字符串（与 parseAction 互逆） */
export function callToString(call: BidCall): string {
  switch (call.type) {
    case 'pass':
      return 'Pass';
    case 'bid':
      return `${call.level}${call.suit}`;
    case 'double':
      return 'X';
    case 'redouble':
      return 'XX';
  }
}
