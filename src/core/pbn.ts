/**
 * PBN（Portable Bridge Notation）发牌字符串转换。
 *
 * 本项目内部牌号为 0-51：花色 0=♣ 1=♦ 2=♥ 3=♠，点数 0=2 ... 12=A。
 * PBN 的花色顺序固定为 ♠ ♥ ♦ ♣，点数用 `23456789TJQKA` 表示。
 *
 * 纯函数，不依赖 UI，也不依赖 DDS；供复盘、导入导出和双明手分析共用。
 */

import { getCard, getRank, getSuit, type SuitIndex } from '../models/card';
import type { Hand } from '../models/hand';
import { ORDER, type Position } from '../models/gameState';

/** PBN 花色顺序：♠ ♥ ♦ ♣ */
export const PBN_SUIT_ORDER: readonly SuitIndex[] = [3, 2, 1, 0];

/** PBN 点数顺序（索引即内部点数 0..12） */
const PBN_RANK_CHARS = '23456789TJQKA';

const PBN_RANK_TO_INDEX: Record<string, number> = Object.fromEntries(
  [...PBN_RANK_CHARS].map((ch, index) => [ch, index]),
);

export interface PbnDeal {
  /** 发牌人（PBN 字符串前缀；缺省为 N） */
  dealer: Position;
  hands: Record<Position, Hand>;
}

function isPosition(value: string): value is Position {
  return (ORDER as string[]).includes(value);
}

/** 单手牌 → PBN 的四个花色段（如 `AKQ2.KJ3.AKQ4.A2`） */
export function handToPbn(hand: Hand): string {
  const bySuit: string[][] = [[], [], [], []];
  const seen = new Set<number>();
  for (const card of hand) {
    if (!Number.isInteger(card) || card < 0 || card > 51) {
      throw new Error(`非法牌号: ${card}`);
    }
    if (seen.has(card)) throw new Error(`同一手牌中重复出现: ${card}`);
    seen.add(card);
    bySuit[getSuit(card)][getRank(card)] = PBN_RANK_CHARS[getRank(card)];
  }
  return PBN_SUIT_ORDER.map((suit) => bySuit[suit].slice().reverse().join('')).join('.');
}

/**
 * 四手牌 → PBN 发牌字符串（不要求每手 13 张）。
 *
 * 传入 first 时从该座位开始顺时针排列，适合 DDS 残局求解；所有手牌必须
 * 属于同一副牌且不能重复。空手会输出 `...`（DDS 可接受）。
 */
export function toPbnHands(
  hands: Record<Position, Hand>,
  first: Position = 'N',
): string {
  const start = ORDER.indexOf(first);
  const seats = ORDER.map((_, offset) => ORDER[(start + offset) % 4]);
  const seen = new Set<number>();
  for (const seat of seats) {
    for (const card of hands[seat] ?? []) {
      if (seen.has(card)) throw new Error(`牌 ${card} 在 ${seat} 家重复出现`);
      seen.add(card);
    }
  }
  return `${first}:${seats.map((seat) => handToPbn(hands[seat] ?? [])).join(' ')}`;
}

/**
 * 四手牌 → PBN 发牌字符串。
 *
 * 默认以 N 开头，便于直接交给 DDS；传入 dealer 时按 PBN 惯例从发牌人开始
 * 顺时针排列（N → E → S → W）。
 */
export function toPbnDeal(
  hands: Record<Position, Hand>,
  dealer: Position = 'N',
): string {
  const start = ORDER.indexOf(dealer);
  const seats = ORDER.map((_, offset) => ORDER[(start + offset) % 4]);
  return `${dealer}:${seats.map((seat) => handToPbn(hands[seat])).join(' ')}`;
}

function parseHandPbn(text: string): Hand {
  const suits = text.split('.');
  if (suits.length !== 4) {
    throw new Error(`PBN 单手牌应包含 4 个花色段，实际为 ${suits.length} 个: "${text}"`);
  }
  const hand: Hand = [];
  suits.forEach((ranks, suitIndex) => {
    const suit = PBN_SUIT_ORDER[suitIndex];
    let lastRank = 13;
    for (const raw of ranks) {
      const ch = raw.toUpperCase();
      const rank = PBN_RANK_TO_INDEX[ch];
      if (rank === undefined) throw new Error(`未知 PBN 点数: "${raw}"`);
      if (rank >= lastRank) {
        throw new Error(`同一花色点数应按从大到小排列，且不能重复: "${ranks}"`);
      }
      lastRank = rank;
      hand.push(getCard(suit, rank));
    }
  });
  return hand;
}

/**
 * 解析 PBN 发牌字符串。
 *
 * 支持 `N:...` / `E:...` 等前缀，也支持无前缀（默认 N）。
 * 四手牌按发牌人开始顺时针排列。会校验每手 13 张、整副 52 张且无重复。
 */
export function parsePbnDeal(input: string): PbnDeal {
  let text = input.trim();
  if (!text) throw new Error('PBN 发牌字符串为空');

  let dealer: Position = 'N';
  const prefix = text.match(/^([NESW])\s*:\s*/i);
  if (prefix) {
    const seat = prefix[1].toUpperCase();
    if (!isPosition(seat)) throw new Error(`未知发牌人: "${prefix[1]}"`);
    dealer = seat;
    text = text.slice(prefix[0].length);
  }

  const chunks = text.split(/\s+/).filter(Boolean);
  if (chunks.length !== 4) {
    throw new Error(`PBN 发牌应包含 4 手牌，实际为 ${chunks.length} 手`);
  }

  const start = ORDER.indexOf(dealer);
  const hands = { N: [], E: [], S: [], W: [] } as Record<Position, Hand>;
  const seen = new Map<number, Position>();

  chunks.forEach((chunk, offset) => {
    const seat = ORDER[(start + offset) % 4];
    const hand = parseHandPbn(chunk);
    if (hand.length !== 13) {
      throw new Error(`${seat} 家应有 13 张牌，实际为 ${hand.length} 张`);
    }
    for (const card of hand) {
      const owner = seen.get(card);
      if (owner) throw new Error(`牌 ${card} 同时出现在 ${owner} 和 ${seat} 家`);
      seen.set(card, seat);
    }
    hands[seat] = hand;
  });

  if (seen.size !== 52) {
    throw new Error(`PBN 发牌应包含 52 张不同牌，实际为 ${seen.size} 张`);
  }

  return { dealer, hands };
}
