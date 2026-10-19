import { getRank, getSuit } from './card';

/** 一手牌（牌号数组） */
export type Hand = number[];

/** 花色展示顺序：♠ > ♥ > ♦ > ♣ */
const SUIT_DISPLAY_ORDER = [3, 2, 1, 0];

/**
 * 排序：♠ > ♥ > ♦ > ♣，同花色点数从 A 到 2 降序。
 */
export function sortHand(hand: Hand): Hand {
  return [...hand].sort((a, b) => {
    const sa = getSuit(a);
    const sb = getSuit(b);
    const ia = SUIT_DISPLAY_ORDER.indexOf(sa);
    const ib = SUIT_DISPLAY_ORDER.indexOf(sb);
    if (ia !== ib) return ia - ib;
    return getRank(b) - getRank(a); // 降序
  });
}
