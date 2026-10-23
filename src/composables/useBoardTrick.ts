import { computed, onUnmounted, ref, watch } from 'vue';
import { PLAY_DISPLAY_MS, useGameStore } from '../store/game';
import type { CardPlay, Position, Trick } from '../models/gameState';

export interface BoardTrick {
  plays: CardPlay[];
  winner: Position | null;
}

/**
 * 中央出牌区的展示规则：
 * - 第四家出牌完成、本墩被结算后，完整的一墩优先停留 PLAY_DISPLAY_MS；
 * - 即使下一墩第一张牌提前落地，也先展示完上一墩，再切换到下一墩；
 * - 若 13 墩已全部完成，则由结算界面接管。
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

  // 新的一墩被结算（tricks 增加）时，开始 1 秒展示倒计时。
  // 展示优先级高于下一墩：即使下一墩第一张牌已经落地，也先让完整的四张牌停满 1 秒。
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

  const lastTrick = computed<Trick | null>(() =>
    store.tricks.length ? store.tricks[store.tricks.length - 1] : null,
  );

  const boardTrick = computed<BoardTrick>(() => {
    // 刚完成的墩优先显示满 1 秒；下一墩的牌会在这之后自然接上。
    if (completedTrickVisible.value && lastTrick.value) {
      return { plays: lastTrick.value.plays, winner: lastTrick.value.winner };
    }
    if (store.currentTrick.length > 0) {
      return { plays: store.currentTrick, winner: null };
    }
    return { plays: [], winner: null };
  });

  onUnmounted(clearTimer);

  return { boardTrick };
}
