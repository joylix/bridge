import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { ElDialog } from 'element-plus';
import SouthPlayed from './SouthPlayed.vue';
import { PLAY_DISPLAY_MS, useGameStore } from '../store/game';
import { parseHand } from '../testing/testUtils';
import type { CardPlay, Position, Trick } from '../models/gameState';

function makeTrick(southCard: string, winner: Position, filler: string[]): Trick {
  const plays: CardPlay[] = [
    { position: 'W', card: parseHand(filler[0])[0] },
    { position: 'N', card: parseHand(filler[1])[0] },
    { position: 'E', card: parseHand(filler[2])[0] },
    { position: 'S', card: parseHand(southCard)[0] },
  ];
  return { plays, leader: 'W', winner };
}

function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useGameStore();
  store.startNewGame({ autoStart: false, seed: 31 });
  store.phase = 'play';
  store.contract = { level: 3, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
  store.tricks = [
    makeTrick('S5', 'N', ['C2', 'C3', 'C4']),
    makeTrick('H9', 'E', ['C6', 'C7', 'C8']),
  ];
  const wrapper = mount(SouthPlayed, { global: { plugins: [pinia] } });
  return { store, wrapper };
}

describe('SouthPlayed 右下角已出牌与操作', () => {
  it('按出牌顺序叠放，赢墩竖直、输墩平躺', () => {
    const { wrapper } = setup();
    const cards = wrapper.findAll('.pile-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].classes()).not.toContain('flat');
    expect(cards[1].classes()).toContain('flat');
    expect(cards[0].attributes('title')).toContain('南北赢墩');
    expect(cards[1].attributes('title')).toContain('东西赢墩');
  });

  it('悬停已出牌时浮出上一墩，并按出牌顺序动画展示；移开即消失', async () => {
    const { wrapper } = setup();
    const pile = wrapper.get('.pile-wrap');
    expect(wrapper.find('.last-trick-pop').exists()).toBe(false);

    await pile.trigger('mouseenter');
    const pop = wrapper.get('.last-trick-pop');
    expect(pop.text()).toContain('上一墩 · 第 2 墩');
    expect(pop.get('.pop-winner').text()).toBe('赢家 E');

    const popCards = pop.findAll('.pop-card');
    expect(popCards.map((card) => card.get('.playing-card').text())).toEqual(['♣6', '♣7', '♣8', '♥9']);
    expect(popCards.map((card) => card.classes().find((name) => name.startsWith('slot-')))).toEqual([
      'slot-W',
      'slot-N',
      'slot-E',
      'slot-S',
    ]);
    expect(popCards.map((card) => card.get('.pop-order').text())).toEqual(['1', '2', '3', '4']);
    expect(popCards.map((card) => card.get('.pop-card-inner').attributes('style'))).toEqual([
      'animation-delay: 0s;',
      'animation-delay: 0.16s;',
      'animation-delay: 0.32s;',
      'animation-delay: 0.48s;',
    ]);

    await pile.trigger('mouseleave');
    expect(wrapper.find('.last-trick-pop').exists()).toBe(false);
  });

  it('已出牌下方放置计分表、摊牌、定约卡与托管按钮', () => {
    const { wrapper } = setup();
    const labels = wrapper.findAll('.pile-actions .action-btn').map((button) => button.text());
    expect(labels).toEqual(['计分表', '摊牌', '定约卡', '托管']);
  });

  it('计分表结果窗口支持鼠标拖拽', () => {
    const { wrapper } = setup();
    const dialogs = wrapper.findAllComponents(ElDialog);
    expect(dialogs[0].props('title')).toBe('结果');
    expect(dialogs[0].props('draggable')).toBe(true);
    // 拖动后松手或误点遮罩不能把窗口关掉
    expect(dialogs[0].props('closeOnClickModal')).toBe(false);
  });

  it('一局出牌结束后，已出牌堆叠只再显示 1 秒', async () => {
    vi.useFakeTimers();
    try {
      const { store, wrapper } = setup();
      expect(wrapper.findAll('.pile-card')).toHaveLength(2);

      store.phase = 'scoring';
      await nextTick();
      expect(wrapper.findAll('.pile-card')).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(PLAY_DISPLAY_MS - 1);
      await nextTick();
      expect(wrapper.findAll('.pile-card')).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(1);
      await nextTick();
      expect(wrapper.findAll('.pile-card')).toHaveLength(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
