import { onUnmounted, ref, watch } from 'vue';
import { PLAY_DISPLAY_MS, useGameStore } from '../store/game';

/**
 * 一局出牌结束后，桌面上的牌继续展示 1 秒，然后全部消失。
 * 新一局开始后自动恢复显示。
 */
export function useScoringCardsVisible() {
  const store = useGameStore();
  const visible = ref(true);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  watch(
    () => store.phase,
    (phase) => {
      clearTimer();
      visible.value = true;
      if (phase === 'scoring') {
        timer = setTimeout(() => {
          visible.value = false;
          timer = null;
        }, PLAY_DISPLAY_MS);
      }
    },
    { immediate: true },
  );

  onUnmounted(clearTimer);
  return visible;
}
