import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import Table from './Table.vue';
import { useGameStore } from '../store/game';
import { cardLabel } from '../models/card';
import { parseHand } from '../testing/testUtils';

function newStoreAndTable() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useGameStore();
  store.startNewGame({ autoStart: false, seed: 99 });
  const wrapper = mount(Table, { global: { plugins: [pinia] } });
  return { store, wrapper };
}

/** Hand 组件渲染的已出牌文本，如 "♠A" */
function playedText(card: number): string {
  return cardLabel(card);
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
    expect(wrapper.get('.seat.east .seat-profile').text()).toContain('E');
    // 非当前叫牌人不高亮
    expect(wrapper.find('.hand.pos-S').classes()).not.toContain('active');
    expect(wrapper.find('.hand.pos-N').classes()).not.toContain('active');
  });

  it('轮到南家叫牌时，南家（你）座位高亮', async () => {
    store.phase = 'bidding';
    store.currentBidder = 'S';
    await nextTick();

    expect(wrapper.find('.hand.pos-S').classes()).toContain('active');
    expect(wrapper.get('.seat.south .seat-profile').text()).toContain('S');
  });

  it('座位只用文字标识，南家标签显示在手牌下方', () => {
    expect(wrapper.find('.avatar').exists()).toBe(false);
    expect(wrapper.get('.seat.north .seat-profile').text()).toBe('北N_机器人');
    expect(wrapper.get('.seat.west .seat-profile').text()).toBe('西W_机器人');
    expect(wrapper.get('.seat.east .seat-profile').text()).toBe('东E_机器人');

    const south = wrapper.get('.seat.south');
    expect(south.get('.seat-profile').text()).toBe('南S_你');
    const children = Array.from(south.element.children);
    expect(children[0].className).toContain('hand');
    expect(children[children.length - 1].className).toContain('seat-profile');
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
    expect(cells[1].get('.bid-label').text()).toBe('—');
    expect(cells[2].get('.bid-suit').text()).toBe('♠');
  });
});

describe('Table 状态与局况显示', () => {
  it('叫牌阶段未成约时显示灰色占位，不提前显示“流局”或“等待首攻”', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'bidding';
    store.contract = null;
    store.vulnerability = 'both';
    await nextTick();

    const contract = wrapper.get('.contract');
    expect(contract.text()).toBe('尚未定约');
    expect(contract.classes()).toContain('pending');
    expect(contract.text()).not.toBe('流局');

    const trickLabel = wrapper.get('.trick-label');
    expect(trickLabel.text()).toBe('尚未开始出牌');
    expect(trickLabel.classes()).toContain('pending');
    expect(trickLabel.text()).not.toBe('等待首攻');

    expect(wrapper.get('.bid-title-row').text()).toContain('局况 Both');
  });

  it('进入等待首攻后，“等待首攻”以正常颜色显示', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play_waiting_lead';
    store.contract = { level: 4, suit: 'H', doubled: false, redoubled: false, declarer: 'N', dummy: 'S' };
    store.tricks = [];
    store.currentTrick = [];
    await nextTick();

    const trickLabel = wrapper.get('.trick-label');
    expect(trickLabel.text()).toBe('等待首攻');
    expect(trickLabel.classes()).not.toContain('pending');
    const contract = wrapper.get('.contract');
    expect(contract.text()).toBe('N 4♥');
    expect(contract.get('.suit').text()).toBe('♥');
    expect(contract.get('.suit').classes()).toContain('red');
  });

  it('四家 Pass 流局后才显示“流局”', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'scoring';
    store.contract = null;
    store.message = '四家不叫，本局流局';
    await nextTick();

    const contract = wrapper.get('.contract');
    expect(contract.text()).toBe('流局');
    expect(contract.classes()).not.toContain('pending');
  });
});

describe('Table 出牌显示', () => {
  it('本轮出牌显示在对应座位手牌旁边', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play';
    store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    const card = parseHand('D4')[0];
    store.currentTrick = [{ position: 'S', card }];
    await nextTick();

    const played = wrapper.find('.hand.pos-S .played-out');
    expect(played.exists()).toBe(true);
    expect(played.get('.played-card').text()).toBe('♦4');
    expect(played.get('.played-card').text()).toBe(playedText(card));
    expect(played.classes()).toContain('red');
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

describe('Table 中央出牌区', () => {
  it('四家出牌按出牌次序斜向叠放，状态信息显示在中央顶部', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play';
    store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    store.tricks = [];
    store.currentTrick = [
      { position: 'N', card: parseHand('SA')[0] },
      { position: 'E', card: parseHand('H2')[0] },
      { position: 'S', card: parseHand('D3')[0] },
    ];
    store.nextPlayer = 'W';
    await nextTick();

    const cards = wrapper.findAll('.trick-stack .trick-play');
    expect(cards.map((c) => c.text())).toEqual(['♠A', '♥2', '♦3']);
    expect(cards[1].classes()).toContain('red');
    expect(wrapper.get('.center-top .trick-label').text()).toBe('第 1 墩');
    expect(wrapper.get('.center-top .turn-tag').text()).toBe('轮到 W');
    expect(wrapper.find('.center-top .winner-tag').exists()).toBe(false);
    // 中央不再使用四格方位布局
    expect(wrapper.find('.trick-slot').exists()).toBe(false);
    expect(wrapper.find('.trick-center').exists()).toBe(false);
  });

  it('本轮为空时自动展示上一墩与赢家，不显示切换按钮', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play_waiting_lead';
    store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    const plays = [
      { position: 'S' as const, card: parseHand('SA')[0] },
      { position: 'W' as const, card: parseHand('H2')[0] },
      { position: 'N' as const, card: parseHand('D3')[0] },
      { position: 'E' as const, card: parseHand('C4')[0] },
    ];
    store.tricks = [{ plays, leader: 'S', winner: 'S' }];
    store.currentTrick = [];
    store.nextPlayer = 'S';
    await nextTick();

    const cards = wrapper.findAll('.trick-stack .trick-play');
    expect(cards.map((c) => c.text())).toEqual(['♠A', '♥2', '♦3', '♣4']);
    expect(cards[0].classes()).toContain('winner');
    expect(wrapper.get('.center-top .winner-tag').text()).toBe('赢家 S');
    expect(wrapper.find('.last-trick-btn').exists()).toBe(false);
  });

  it('本轮进行中可切换到上一墩查看，再切回本轮', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play';
    store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    const plays = [
      { position: 'S' as const, card: parseHand('SA')[0] },
      { position: 'W' as const, card: parseHand('H2')[0] },
      { position: 'N' as const, card: parseHand('D3')[0] },
      { position: 'E' as const, card: parseHand('C4')[0] },
    ];
    store.tricks = [{ plays, leader: 'S', winner: 'S' }];
    store.currentTrick = [{ position: 'W', card: parseHand('C2')[0] }];
    store.nextPlayer = 'N';
    await nextTick();

    expect(wrapper.findAll('.trick-stack .trick-play').map((c) => c.text())).toEqual(['♣2']);
    const btn = wrapper.get('.last-trick-btn');
    expect(btn.text()).toBe('看上一墩');

    await btn.trigger('click');
    await nextTick();

    expect(wrapper.findAll('.trick-stack .trick-play').map((c) => c.text())).toEqual([
      '♠A',
      '♥2',
      '♦3',
      '♣4',
    ]);
    expect(wrapper.get('.center-top .winner-tag').text()).toBe('赢家 S');
    expect(btn.text()).toBe('看本轮');
  });
});

describe('Table 选牌与出牌', () => {
  it('左键选中/取消，右键确认后才出牌', async () => {
    vi.useFakeTimers();
    const { store, wrapper } = newStoreAndTable();
    try {
      store.phase = 'play';
      store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
      store.tricks = [];
      store.currentTrick = [];
      store.nextPlayer = 'S';
      await nextTick();

      const first = wrapper.get('.hand.pos-S .playing-card');
      await first.trigger('click');
      expect(first.classes()).toContain('selected');
      expect(store.currentTrick).toHaveLength(0);

      await first.trigger('click');
      expect(first.classes()).not.toContain('selected');
      expect(store.currentTrick).toHaveLength(0);

      await first.trigger('click');
      expect(first.classes()).toContain('selected');

      await first.trigger('contextmenu');
      await nextTick();

      expect(store.currentTrick).toHaveLength(1);
      expect(store.currentTrick[0].position).toBe('S');
      expect(wrapper.find('.hand.pos-S .playing-card.selected').exists()).toBe(false);
    } finally {
      store.startNewGame({ autoStart: false, seed: 100 });
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('点击本轮不允许出的牌不会弹出选中', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play';
    store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    store.tricks = [];
    store.hands.S = parseHand('SAK H2 D3 C4');
    store.currentTrick = [{ position: 'W', card: parseHand('SQ')[0] }];
    store.nextPlayer = 'S';
    await nextTick();

    const illegal = wrapper.get('.hand.pos-S .playing-card[data-suit="♥"]');
    await illegal.trigger('click');
    expect(illegal.classes()).not.toContain('selected');

    const legal = wrapper.get('.hand.pos-S .playing-card[data-suit="♠"]');
    await legal.trigger('click');
    expect(legal.classes()).toContain('selected');
  });

  it('双击卡牌直接出牌', async () => {
    vi.useFakeTimers();
    const { store, wrapper } = newStoreAndTable();
    try {
      store.phase = 'play';
      store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
      store.tricks = [];
      store.currentTrick = [];
      store.nextPlayer = 'S';
      await nextTick();

      const first = wrapper.get('.hand.pos-S .playing-card');
      await first.trigger('dblclick');
      await nextTick();

      expect(store.currentTrick).toHaveLength(1);
      expect(store.currentTrick[0].position).toBe('S');
      expect(wrapper.find('.hand.pos-S .playing-card.selected').exists()).toBe(false);
    } finally {
      store.startNewGame({ autoStart: false, seed: 101 });
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('Table 明手显示', () => {
  it('东家成为明手时手牌改为单行显示', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play';
    store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'E' };
    store.dummyOpen = true;
    await nextTick();

    const east = wrapper.get('.hand.pos-E');
    expect(east.classes()).toContain('compact');
    expect(east.get('.suits').classes()).toContain('single-row');
    expect(east.findAll('.hand-row')).toHaveLength(1);
  });
});
