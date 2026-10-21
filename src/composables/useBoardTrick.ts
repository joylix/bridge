import { computed, onUnmounted, ref, watch } from 'vue';
import { PLAY_DISPLAY_MS, useGameStore } from '../store/game';
import type { CardPlay, Position, Trick } from '../models/gameState';

export interface BoardTrick {
  plays: CardPlay[];
  winner: Position | null;
}

/**
 * 中央出牌区的展示规则：
 * - 本轮已有牌时显示本轮；
 * - 第四家出牌完成、本墩被结算后，完整的一墩继续停留 PLAY_DISPLAY_MS，然后全部清除；
 * - 清除后等待下一轮出牌；若 13 墩已全部完成，则由结算界面接管。
 */
export function useBoardTrick() {
  const store = useGameStore();

  /** 是否正在展示刚刚完成的上一墩（仅停留 1 秒） */
  const completedTrickVisible = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function hideCompletedTrick(): void {
    clearTimer();
    completedTrickVisible.value = false;
  }

  // 新的一墩被结算（tricks 增加）时，开始 1 秒展示倒计时
  watch(
    () => store.tricks.length,
    (count, previous) => {
      clearTimer();
      if (count > (previous ?? 0)) {
        completedTrickVisible.value = true;
        timer = setTimeout(() => {
          completedTrickVisible.value = false;
          timer = null;
        }, PLAY_DISPLAY_MS);
      } else {
        completedTrickVisible.value = false;
      }
    },
  );

  // 下一轮第一张牌落地后，立即收起上一墩，避免两墩牌同时出现
  watch(
    () => store.currentTrick.length,
    (length) => {
      if (length > 0) hideCompletedTrick();
    },
  );

  const lastTrick = computed<Trick | null>(() =>
    store.tricks.length ? store.tricks[store.tricks.length - 1] : null,
  );

  const boardTrick = computed<BoardTrick>(() => {
    if (store.currentTrick.length > 0) {
      return { plays: store.currentTrick, winner: null };
    }
    if (completedTrickVisible.value && lastTrick.value) {
      return { plays: lastTrick.value.plays, winner: lastTrick.value.winner };
    }
    return { plays: [], winner: null };
  });

  onUnmounted(clearTimer);

  return { boardTrick };
}
