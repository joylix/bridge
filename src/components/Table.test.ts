import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import Table from './Table.vue';
import { useGameStore } from '../store/game';
import { cardLabel, rankName, suitSymbol, getSuit } from '../models/card';
import { parseHand } from '../testing/testUtils';

function newStoreAndTable() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useGameStore();
  store.startNewGame({ autoStart: false, seed: 99 });
  const wrapper = mount(Table, { global: { plugins: [pinia] } });
  return { store, wrapper };
}

/** Hand 组件渲染的已出牌文本，如 "A♠" */
function playedText(card: number): string {
  return `${rankName(card)}${suitSymbol(getSuit(card))}`;
}

describe('Table 叫牌高亮', () => {
  let store: ReturnType<typeof useGameStore>;
  let wrapper: ReturnType<typeof mount>;

  beforeEach(() => {
    ({ store, wrapper } = newStoreAndTable());
  });

  it('轮到某家叫牌时，其座位字母高亮（active）', async () => {
    store.phase = 'bidding';
    store.currentBidder = 'E';
    await nextTick();

    expect(wrapper.find('.hand.pos-E').classes()).toContain('active');
    expect(wrapper.find('.hand.pos-E .hand-label').text()).toContain('E');
    // 非当前叫牌人不高亮
    expect(wrapper.find('.hand.pos-S').classes()).not.toContain('active');
    expect(wrapper.find('.hand.pos-N').classes()).not.toContain('active');
  });

  it('轮到南家叫牌时，南家（你）座位高亮', async () => {
    store.phase = 'bidding';
    store.currentBidder = 'S';
    await nextTick();

    expect(wrapper.find('.hand.pos-S').classes()).toContain('active');
    expect(wrapper.find('.hand.pos-S .hand-label').text()).toContain('南');
  });
});

describe('Table 叫牌过程', () => {
  it('叫品拆分为阶数与花色符号，花色符号单独放大', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'bidding';
    store.biddingHistory = [
      { position: 'N', call: { type: 'bid', level: 1, suit: 'H' } },
      { position: 'E', call: { type: 'pass' } },
      { position: 'S', call: { type: 'bid', level: 2, suit: 'S' } },
    ];
    await nextTick();

    const cells = wrapper.findAll('.bid-cell');
    expect(cells[0].get('.bid-level').text()).toBe('1');
    expect(cells[0].get('.bid-suit').text()).toBe('♥');
    expect(cells[0].get('.bid-suit').classes()).toContain('red');
    expect(cells[1].get('.bid-label').text()).toBe('Pass');
    expect(cells[2].get('.bid-suit').text()).toBe('♠');
  });
});

describe('Table 出牌显示', () => {
  it('本轮出牌显示在对应座位手牌旁边', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play';
    store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    const card = parseHand('SA')[0];
    store.currentTrick = [{ position: 'S', card }];
    await nextTick();

    const played = wrapper.find('.hand.pos-S .played-out');
    expect(played.exists()).toBe(true);
    expect(played.get('.played-card').text()).toBe(playedText(card));
    // 其他座位本轮未出牌，不显示已出牌
    expect(wrapper.find('.hand.pos-W .played-out').exists()).toBe(false);
  });
});

describe('Table 明手与庄家手牌可见性', () => {
  it('南家为明手、北家做庄时，首攻后同时显示北家与南家的牌', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play';
    store.contract = { level: 4, suit: 'H', doubled: false, redoubled: false, declarer: 'N', dummy: 'S' };
    store.dummyOpen = true;
    store.nextPlayer = 'N';
    await nextTick();

    expect(wrapper.find('.hand.pos-N .suits').exists()).toBe(true);
    expect(wrapper.find('.hand.pos-N .cards.backs').exists()).toBe(false);
    expect(wrapper.find('.hand.pos-S .suits').exists()).toBe(true);
    expect(wrapper.find('.hand.pos-N .suits').classes()).toContain('clickable');
  });

  it('人类为防守方时，庄家的牌保持牌背，明手仍然可见', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play';
    store.contract = { level: 2, suit: 'S', doubled: false, redoubled: false, declarer: 'E', dummy: 'W' };
    store.dummyOpen = true;
    store.nextPlayer = 'E';
    await nextTick();

    expect(wrapper.find('.hand.pos-E .cards.backs').exists()).toBe(true);
    expect(wrapper.find('.hand.pos-E .suits').exists()).toBe(false);
    expect(wrapper.find('.hand.pos-W .suits').exists()).toBe(true);
  });
});

describe('Table 上一墩回顾', () => {
  it('无已完成墩时按钮禁用', async () => {
    const { wrapper } = newStoreAndTable();
    expect(wrapper.get('.last-trick-btn').attributes('disabled')).toBeDefined();
  });

  it('点击“看上一墩”按钮展示上一墩出牌与赢家', async () => {
    const { store, wrapper } = newStoreAndTable();
    const plays = [
      { position: 'S' as const, card: parseHand('SA')[0] },
      { position: 'W' as const, card: parseHand('H2')[0] },
      { position: 'N' as const, card: parseHand('D3')[0] },
      { position: 'E' as const, card: parseHand('C4')[0] },
    ];
    store.tricks = [{ plays, leader: 'S', winner: 'S' }];
    await nextTick();

    const btn = wrapper.get('.last-trick-btn');
    expect(btn.attributes('disabled')).toBeUndefined();
    expect(wrapper.find('.last-trick').exists()).toBe(false);

    await btn.trigger('click');
    await nextTick();

    const panel = wrapper.get('.last-trick');
    expect(panel.text()).toContain('赢家 S');
    for (const play of plays) {
      expect(panel.text()).toContain(playedText(play.card));
    }
    expect(panel.get('.trick-card.is-winner').text()).toContain('S');
    expect(panel.findAll('.trick-card')).toHaveLength(4);
    expect(cardLabel(plays[0].card)).toBe('♠A');
  });
});
