import type { Hand } from '../models/hand';
import type { Position } from '../models/gameState';

/** 生成一副标准的 52 张牌（0-51） */
export function createDeck(): number[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

/**
 * 洗牌（Fisher-Yates）。
 * @param rng 随机源，默认 Math.random；可传入已播种的随机源以复现牌局。
 */
export function shuffle(deck: number[], rng: () => number = Math.random): number[] {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 依次给 N/E/S/W 各发 13 张 */
export function deal(shuffled: number[]): Record<Position, Hand> {
  return {
    N: shuffled.slice(0, 13),
    E: shuffled.slice(13, 26),
    S: shuffled.slice(26, 39),
    W: shuffled.slice(39, 52),
  };
}
