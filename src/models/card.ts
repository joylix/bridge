/**
 * 牌表示（0-51）
 * 见《桥牌游戏 MVP 详细设计文档 V1.4》2.1。
 *
 * 花色：0=♣ 1=♦ 2=♥ 3=♠（与设计文档 SUIT 数组一致）。
 * 点数：0=2 ... 12=A（即 getRank 越大牌越大）。
 */

export const SUIT = ['♣', '♦', '♥', '♠'] as const;
export type SuitIndex = 0 | 1 | 2 | 3;

export const RANK_NAMES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
export const SUIT_NAMES_CN = ['梅花', '方块', '红桃', '黑桃'] as const;

export function getSuit(card: number): SuitIndex {
  return Math.floor(card / 13) as SuitIndex;
}

export function getRank(card: number): number {
  return card % 13;
}

export function getCard(suit: SuitIndex, rank: number): number {
  return suit * 13 + rank;
}

/** 花色符号（♣♦♥♠） */
export function suitSymbol(suit: SuitIndex): string {
  return SUIT[suit];
}

/** 点数名称（2..10,J,Q,K,A） */
export function rankName(card: number): string {
  return RANK_NAMES[getRank(card)];
}

/** 牌面文字，如 "♠A" */
export function cardLabel(card: number): string {
  return `${suitSymbol(getSuit(card))}${rankName(card)}`;
}

/** 红桃/方块为红色（UI 用） */
export function isRedSuit(suit: SuitIndex): boolean {
  return suit === 1 || suit === 2;
}
