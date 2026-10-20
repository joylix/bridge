import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import ElementPlus from 'element-plus';
import DealResultDialog from './DealResultDialog.vue';
import { useGameStore } from '../store/game';
import { parseHand } from '../testing/testUtils';
import type { CardPlay, Trick } from '../models/gameState';

async function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useGameStore();
  store.startNewGame({ autoStart: false, seed: 41 });
  store.phase = 'scoring';
  store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
  store.biddingHistory = [
    { position: 'W', call: { type: 'bid', level: 1, suit: 'H' } },
    { position: 'N', call: { type: 'bid', level: 1, suit: 'S' } },
    { position: 'E', call: { type: 'pass' } },
    { position: 'S', call: { type: 'bid', level: 1, suit: 'NT' } },
    { position: 'W', call: { type: 'pass' } },
    { position: 'N', call: { type: 'pass' } },
    { position: 'E', call: { type: 'pass' } },
  ];
  store.score = { NS: 180, EW: 0 };
  store.dealHcp = { NS: 20, EW: 20 };
  const plays: CardPlay[] = [
    { position: 'W', card: parseHand('D3')[0] },
    { position: 'N', card: parseHand('DJ')[0] },
    { position: 'E', card: parseHand('DA')[0] },
    { position: 'S', card: parseHand('D2')[0] },
  ];
  store.tricks = Array.from({ length: 13 }, (_, index): Trick => ({
    plays,
    leader: 'W',
    winner: index < 10 ? 'N' : 'E',
  }));

  const wrapper = mount(DealResultDialog, {
    props: { modelValue: true },
    attachTo: document.body,
    global: { plugins: [pinia, ElementPlus] },
  });
  await nextTick();
  await nextTick();
  return { store, wrapper };
}

describe('DealResultDialog 紧凑结果', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('牌型分布使用计分表的小牌面', async () => {
    await setup();
    const root = document.body;
    expect(root.querySelector('.distribution-card .distribution')).not.toBeNull();
    expect(root.querySelectorAll('.distribution-card .rh-tile:not(.rh-suit)')).toHaveLength(52);
    expect(root.querySelector('.distribution-card .hand-diagram')).toBeNull();
  });

  it('打牌过程使用文字牌名，不显示实际牌图标', async () => {
    await setup();
    const panel = document.body.querySelector<HTMLElement>('.play-card-panel');
    expect(panel).not.toBeNull();
    expect(panel!.querySelector('.playing-card')).toBeNull();
    expect(
      Array.from(panel!.querySelectorAll('.play-table thead th')).map((cell) => cell.textContent?.trim()),
    ).toEqual(['西', '北', '东', '南', '西', '北', '东']);
    expect(panel!.querySelector('.play-table tbody')?.textContent).toContain('♦3');
    expect(panel!.querySelector('.play-table tbody')?.textContent).toContain('♦J');
  });
});
