import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ElementPlus from 'element-plus';
import { nextTick } from 'vue';
import GameHistory from './GameHistory.vue';
import { useGameStore } from '../store/game';
import { parseHand } from '../testing/testUtils';
import type { Position } from '../models/gameState';

function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useGameStore();
  store.startNewGame({ autoStart: false, seed: 9 });
  return { store, pinia };
}

async function mountOpen() {
  const ctx = setup();
  const wrapper = mount(GameHistory, {
    props: { modelValue: true },
    global: { plugins: [ctx.pinia, ElementPlus] },
  });
  await nextTick();
  await nextTick();
  return { ...ctx, wrapper };
}

function bodyText(wrapper: { text: () => string }): string {
  return wrapper.text();
}

describe('GameHistory 对局记录', () => {
  it('展示局况（英文）、定约、叫牌与出牌过程', async () => {
    const { store, wrapper } = await mountOpen();
    store.phase = 'play';
    store.vulnerability = 'both';
    store.contract = { level: 4, suit: 'H', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    store.biddingHistory = [
      { position: 'N', call: { type: 'pass' } },
      { position: 'E', call: { type: 'bid', level: 1, suit: 'H' } },
      { position: 'S', call: { type: 'bid', level: 4, suit: 'H' } },
      { position: 'W', call: { type: 'pass' } },
    ];
    const cards = parseHand('SA HK D2 C3');
    const plays = (['N', 'E', 'S', 'W'] as Position[]).map((position, i) => ({
      position,
      card: cards[i],
    }));
    store.tricks = [{ plays, leader: 'N', winner: 'S' }];
    await nextTick();

    const text = bodyText(wrapper);
    expect(text).toContain('局况');
    expect(text).toContain('Both'); // 局况英文
    expect(text).toContain('S 4♥'); // 定约
    expect(text).toContain('1♥'); // 叫牌记录
    expect(text).toContain('出牌过程');
    expect(text).toContain('A♠'); // 出牌记录
    expect(text).toContain('本局点数 未结算'); // 未到结算阶段

    wrapper.unmount();
  });

  it('无任何动作时提示尚无记录', async () => {
    const { store, wrapper } = await mountOpen();
    // 清空开局产生的自动动作（本测试不启动 AI，故无动作）
    store.biddingHistory = [];
    store.contract = null;
    await nextTick();
    expect(bodyText(wrapper)).toContain('尚无对局记录');

    wrapper.unmount();
  });
});
