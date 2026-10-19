import { describe, expect, it } from 'vitest';
import { determineTrickWinner, getTrickWinnerCard } from './trick';
import type { CardPlay } from '../models/gameState';
import { getCard } from '../models/card';

const S = 3,
  H = 2,
  D = 1,
  C = 0;

function play(position: CardPlay['position'], suit: number, rank: number): CardPlay {
  return { position, card: getCard(suit as 0 | 1 | 2 | 3, rank) };
}

describe('赢墩判定', () => {
  it('无将：比较领出花色最大牌', () => {
    const plays = [play('W', S, 5), play('N', S, 12), play('E', H, 12), play('S', S, 9)];
    // 领出黑桃，北家 SA 最大；东家红桃垫牌被忽略
    expect(determineTrickWinner(plays, null)).toBe('N');
  });

  it('有将：将牌可以赢过领出花色', () => {
    const plays = [play('W', S, 12), play('N', C, 2), play('E', S, 11), play('S', S, 10)];
    // 将牌为梅花，北家 C2 将吃黑桃 SA
    expect(determineTrickWinner(plays, C as 0 | 1 | 2 | 3)).toBe('N');
  });

  it('有将：多张将牌比大小', () => {
    const plays = [play('W', H, 12), play('N', C, 5), play('E', C, 9), play('S', H, 10)];
    expect(determineTrickWinner(plays, C as 0 | 1 | 2 | 3)).toBe('E');
  });

  it('垫牌不能赢墩', () => {
    const plays = [play('W', D, 3), play('N', S, 12), play('E', H, 12), play('S', C, 12)];
    expect(determineTrickWinner(plays, null)).toBe('W'); // 领出方块 D3 无人跟出
    expect(getTrickWinnerCard(plays, null)).toBe(getCard(D as 0 | 1 | 2 | 3, 3));
  });
});
