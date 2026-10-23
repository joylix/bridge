import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import Table from './Table.vue';
import { useGameStore, PLAY_DISPLAY_MS } from '../store/game';
import { parseHand } from '../testing/testUtils';

function newStoreAndTable() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useGameStore();
  store.startNewGame({ autoStart: false, seed: 99 });
  const wrapper = mount(Table, { global: { plugins: [pinia] } });
  return { store, wrapper };
}

function findCardSlot(
  wrapper: ReturnType<typeof mount>,
  position: string,
  card: number,
) {
  return wrapper
    .findAll(`.hand.pos-${position} .card-slot`)
    .find((slot) => slot.attributes('data-card') === String(card));
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

  it('“确认+提醒”提交的叫牌以白底显示', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'bidding';
    store.biddingHistory = [
      { position: 'N', call: { type: 'bid', level: 1, suit: 'H' }, alerted: true },
      { position: 'E', call: { type: 'pass' } },
    ];
    await nextTick();

    expect(wrapper.findAll('.bid-cell.alerted')).toHaveLength(1);
    expect(wrapper.get('.bid-cell.alerted').text()).toBe('1♥');
  });
});

describe('Table 中央状态显示', () => {
  it('定约信息已移出牌桌中央，改在左上角信息栏显示', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'bidding';
    store.contract = null;
    store.vulnerability = 'both';
    await nextTick();

    expect(wrapper.find('.center .contract').exists()).toBe(false);
    expect(wrapper.find('.center .contract-display').exists()).toBe(false);

    const info = wrapper.get('.play-info-panel');
    expect(info.text()).toContain('副序');
    expect(info.text()).toContain('局况');
    expect(info.text()).toContain('双方有局');
    expect(info.text()).toContain('定约');
    expect(info.text()).toContain('—');
    expect(info.text()).toContain('赢墩数');
    expect(info.text()).toContain('0 / 0');

    // 叫牌过程框去掉上面两行（状态行与标题行），直接显示座位与叫牌记录
    expect(wrapper.find('.center-top').exists()).toBe(false);
    expect(wrapper.find('.bid-title-row').exists()).toBe(false);
    expect(wrapper.findAll('.bid-header span').map((s) => s.text())).toEqual(['北', '东', '南', '西']);
    expect(wrapper.get('.bid-cell.thinking .bid-label').text()).toBe('？');
  });

  it('进入等待首攻后，中央不再显示深色提示区', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play_waiting_lead';
    store.contract = { level: 4, suit: 'H', doubled: false, redoubled: false, declarer: 'N', dummy: 'S' };
    store.tricks = [];
    store.currentTrick = [];
    await nextTick();

    expect(wrapper.find('.center-top').exists()).toBe(false);
    expect(wrapper.find('.trick-label').exists()).toBe(false);
    expect(wrapper.find('.last-trick-btn').exists()).toBe(false);
    expect(wrapper.find('.center .contract').exists()).toBe(false);
    expect(wrapper.get('.play-info-panel').text()).toContain('4♥');
  });

  it('四家 Pass 流局后左上角显示流局', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'scoring';
    store.contract = null;
    store.message = '四家不叫，本局流局';
    await nextTick();

    expect(wrapper.find('.center-top').exists()).toBe(false);
    expect(wrapper.find('.center .contract').exists()).toBe(false);
    expect(wrapper.get('.play-info-panel').text()).toContain('流局');
  });
});

describe('Table 出牌显示', () => {
  it('已出牌只显示在中央出牌区，不在手牌旁重复显示', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play';
    store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    const card = parseHand('D4')[0];
    store.currentTrick = [{ position: 'S', card }];
    await nextTick();

    expect(wrapper.find('.hand .played-out').exists()).toBe(false);
    const play = wrapper.get('.trick-stack .trick-play');
    expect(play.classes()).toContain('slot-S');
    expect(play.get('.playing-card').text()).toBe('♦4');
    expect(play.get('.playing-card').classes()).toContain('red');
    expect(play.get('.playing-card').classes()).toContain('size-xxl');
  });
});

describe('Table 出牌阶段叫牌过程', () => {
  it('叫牌过程移到北家手牌右侧，左侧保留牌局信息', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play';
    store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    store.biddingHistory = [
      { position: 'N', call: { type: 'pass' } },
      { position: 'E', call: { type: 'bid', level: 1, suit: 'H' } },
      { position: 'S', call: { type: 'pass' } },
      { position: 'W', call: { type: 'pass' } },
    ];
    await nextTick();

    const panel = wrapper.get('.play-bid-history');
    expect(panel.text()).toContain('北');
    expect(panel.text()).toContain('1♥');
    // 标题行已取消，叫牌过程框只保留座位表头与叫牌记录
    expect(panel.find('.bid-title-row').exists()).toBe(false);
    expect(wrapper.get('.play-info-panel').text()).toContain('副序');
    // 中央区域出牌时只显示牌墩，不再占用空间显示叫牌过程
    expect(wrapper.find('.center .bid-history').exists()).toBe(false);
  });

  it('叫牌阶段仍将叫牌过程显示在中央区域', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'bidding';
    store.biddingHistory = [{ position: 'N', call: { type: 'bid', level: 1, suit: 'H' } }];
    await nextTick();

    expect(wrapper.find('.play-bid-history').exists()).toBe(false);
    expect(wrapper.find('.center .bid-history').exists()).toBe(true);
  });

  it('左上角按南北 / 东西统计已赢墩数', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play';
    store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    store.tricks = [
      { plays: [], leader: 'S', winner: 'N' },
      { plays: [], leader: 'E', winner: 'E' },
      { plays: [], leader: 'S', winner: 'N' },
    ];
    await nextTick();

    expect(wrapper.get('.play-info-panel').text()).toContain('2 / 1');
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
  it('四家出牌保持固定方位，按出牌次序叠放并标出序号', async () => {
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

    const plays = wrapper.findAll('.trick-stack .trick-play');
    expect(plays.map((p) => p.get('.playing-card').text())).toEqual(['♠A', '♥2', '♦3']);
    expect(plays[1].get('.playing-card').classes()).toContain('red');
    expect(plays.map((p) => p.get('.play-order').text())).toEqual(['1', '2', '3']);
    expect(plays[0].classes()).toContain('slot-N');
    expect(plays[1].classes()).toContain('slot-E');
    expect(plays[2].classes()).toContain('slot-S');
    expect(plays[0].attributes('style')).toContain('z-index: 1');
    expect(plays[1].attributes('style')).toContain('z-index: 2');
    expect(plays[2].attributes('style')).toContain('z-index: 3');
    // 中央不再有深色提示区，牌面直接显示在牌桌背景上
    expect(wrapper.find('.center-top').exists()).toBe(false);
    expect(wrapper.find('.trick-label').exists()).toBe(false);
    // 中央不再使用四格方位布局
    expect(wrapper.find('.trick-slot').exists()).toBe(false);
    expect(wrapper.find('.trick-center').exists()).toBe(false);
  });

  it('本轮为空时立即展示刚完成的上一墩与赢家，不显示切换按钮', async () => {
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
    expect(cards.map((c) => c.get('.playing-card').text())).toEqual(['♠A', '♥2', '♦3', '♣4']);
    expect(cards.map((c) => c.get('.play-order').text())).toEqual(['1', '2', '3', '4']);
    expect(cards[0].classes()).toContain('winner');
    expect(cards[0].classes()).toContain('slot-S');
    expect(cards[1].classes()).toContain('slot-W');
    expect(cards[2].classes()).toContain('slot-N');
    expect(cards[3].classes()).toContain('slot-E');
    expect(wrapper.find('.center-top').exists()).toBe(false);
    expect(wrapper.find('.last-trick-btn').exists()).toBe(false);
  });

  it('轮到南家且只剩唯一合法牌时自动打出，完整一墩展示 1 秒后清空', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const { store, wrapper } = newStoreAndTable();
      store.phase = 'play';
      store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
      store.currentTrick = [
        { position: 'W', card: parseHand('C5')[0] },
        { position: 'N', card: parseHand('C4')[0] },
        { position: 'E', card: parseHand('C3')[0] },
      ];
      store.trickLeader = 'W';
      store.nextPlayer = 'S';
      // 领出草花，南家手中只有一张草花 CA，其余红桃均不合法
      store.hands.S = parseHand('CA H3 H4');
      await nextTick();

      expect(wrapper.findAll('.trick-play')).toHaveLength(3);

      const loop = store.runAILoop();
      await vi.advanceTimersByTimeAsync(PLAY_DISPLAY_MS - 1);
      await nextTick();

      // 1 秒内仍展示上一张牌，且没有自动打出南家的唯一合法牌
      expect(wrapper.findAll('.trick-play')).toHaveLength(3);
      expect(store.hands.S).toEqual(parseHand('CA H3 H4'));

      await vi.advanceTimersByTimeAsync(1);
      await nextTick();

      // 唯一合法的 CA 自动打出并结算本墩，完整一墩继续展示 1 秒
      expect(store.hands.S).toEqual(parseHand('H3 H4'));
      expect(store.currentTrick).toHaveLength(0);
      expect(store.tricks).toHaveLength(1);
      expect(store.tricks[0].winner).toBe('S');
      expect(wrapper.findAll('.trick-play')).toHaveLength(4);
      expect(wrapper.get('.trick-stack').text()).toContain('♣A');

      await vi.advanceTimersByTimeAsync(PLAY_DISPLAY_MS);
      await nextTick();

      // 展示满 1 秒后清除所有已出的牌
      expect(wrapper.findAll('.trick-play')).toHaveLength(0);
      await loop;
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('本轮有牌时只显示本轮牌面，不再提供上一墩切换按钮', async () => {
    // 先在 store 中构造“上一墩已完成、当前墩已有牌”的加载态，再挂载组件，
    // 避免把“刚完成的墩优先展示 1 秒”的规则误判为当前墩展示。
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useGameStore();
    store.startNewGame({ autoStart: false, seed: 99 });
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
    const wrapper = mount(Table, { global: { plugins: [pinia] } });
    await nextTick();

    const currentPlays = wrapper.findAll('.trick-stack .trick-play');
    expect(currentPlays.map((c) => c.get('.playing-card').text())).toEqual(['♣2']);
    expect(currentPlays[0].classes()).toContain('slot-W');
    expect(wrapper.find('.last-trick-btn').exists()).toBe(false);
    expect(wrapper.find('.center-top').exists()).toBe(false);
  });

  it('第四家出牌完成后，完整一墩停留 1 秒再全部清除', async () => {
    vi.useFakeTimers();
    try {
      const { store, wrapper } = newStoreAndTable();
      store.phase = 'play';
      store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
      store.currentTrick = [
        { position: 'N', card: parseHand('SA')[0] },
        { position: 'E', card: parseHand('H2')[0] },
        { position: 'S', card: parseHand('D3')[0] },
      ];
      store.nextPlayer = 'W';
      store.trickLeader = 'N';
      await nextTick();

      // 第四家出牌，本墩结束
      store.applyPlay('W', store.hands.W[0]);
      await nextTick();
      expect(store.tricks).toHaveLength(1);
      expect(wrapper.findAll('.trick-play')).toHaveLength(4);

      await vi.advanceTimersByTimeAsync(PLAY_DISPLAY_MS - 1);
      await nextTick();
      expect(wrapper.findAll('.trick-play')).toHaveLength(4);

      // 停留 1 秒后清除所有已出的牌
      await vi.advanceTimersByTimeAsync(1);
      await nextTick();
      expect(wrapper.findAll('.trick-play')).toHaveLength(0);

      // 下一轮出牌时只显示新的一墩
      store.currentTrick = [{ position: 'W', card: parseHand('C7')[0] }];
      await nextTick();
      expect(wrapper.findAll('.trick-play')).toHaveLength(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('下一墩第一张牌提前落地时，上一墩仍完整展示满 1 秒', async () => {
    vi.useFakeTimers();
    try {
      const { store, wrapper } = newStoreAndTable();
      store.phase = 'play';
      store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
      store.currentTrick = [
        { position: 'N', card: parseHand('SA')[0] },
        { position: 'E', card: parseHand('H2')[0] },
        { position: 'S', card: parseHand('D3')[0] },
      ];
      store.nextPlayer = 'W';
      store.trickLeader = 'N';
      await nextTick();

      // 第四家出牌，本墩结束
      store.applyPlay('W', store.hands.W[0]);
      await nextTick();
      expect(store.tricks).toHaveLength(1);
      expect(wrapper.findAll('.trick-play')).toHaveLength(4);

      // 模拟竞态：下一墩第一张牌在 1 秒内提前写入 currentTrick
      store.currentTrick = [{ position: 'N', card: parseHand('C7')[0] }];
      await nextTick();
      expect(wrapper.findAll('.trick-play')).toHaveLength(4);
      expect(wrapper.get('.trick-stack').text()).toContain('♠A');

      await vi.advanceTimersByTimeAsync(PLAY_DISPLAY_MS - 1);
      await nextTick();
      expect(wrapper.findAll('.trick-play')).toHaveLength(4);

      // 展示满 1 秒后才切换到下一墩
      await vi.advanceTimersByTimeAsync(1);
      await nextTick();
      const nextPlays = wrapper.findAll('.trick-play');
      expect(nextPlays).toHaveLength(1);
      expect(nextPlays[0].get('.playing-card').text()).toContain('♣7');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('一局出牌结束后，桌面上的牌只再显示 1 秒', async () => {
    vi.useFakeTimers();
    try {
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
      await nextTick();
      expect(wrapper.findAll('.trick-play')).toHaveLength(4);

      store.phase = 'scoring';
      await nextTick();
      expect(wrapper.findAll('.trick-play')).toHaveLength(4);

      await vi.advanceTimersByTimeAsync(PLAY_DISPLAY_MS - 1);
      await nextTick();
      expect(wrapper.findAll('.trick-play')).toHaveLength(4);

      await vi.advanceTimersByTimeAsync(1);
      await nextTick();
      expect(wrapper.findAll('.trick-play')).toHaveLength(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('Table 叫牌过程（座位与提醒）', () => {
  it('当前叫牌人的空档显示问号，表示正在考虑叫牌', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'bidding';
    store.biddingHistory = [
      { position: 'N', call: { type: 'pass' } },
      { position: 'E', call: { type: 'bid', level: 1, suit: 'H' } },
    ];
    store.currentBidder = 'S';
    await nextTick();

    const cells = wrapper.findAll('.bid-cell');
    expect(cells[2].classes()).toContain('thinking');
    expect(cells[2].get('.bid-label').text()).toBe('？');
    expect(cells[0].classes()).not.toContain('thinking');
  });

  it('“确认+提醒”提交的叫牌以白底突出，不弹提醒框', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'bidding';
    store.biddingHistory = [
      { position: 'N', call: { type: 'bid', level: 1, suit: 'H' }, alerted: true, alertText: '约定叫' },
    ];
    store.currentBid = { level: 1, suit: 'H' };
    store.currentBidder = 'E';
    await nextTick();

    const cell = wrapper.findAll('.bid-cell')[0];
    expect(cell.classes()).toContain('alerted');
    expect(cell.attributes('title')).toContain('约定叫');
  });
});

describe('Table 南家已出牌与常用操作', () => {
  function setupPlay() {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play';
    store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    store.tricks = [
      {
        plays: [
          { position: 'S', card: parseHand('SA')[0] },
          { position: 'W', card: parseHand('H2')[0] },
          { position: 'N', card: parseHand('D3')[0] },
          { position: 'E', card: parseHand('C4')[0] },
        ],
        leader: 'S',
        winner: 'N',
      },
      {
        plays: [
          { position: 'S', card: parseHand('SK')[0] },
          { position: 'W', card: parseHand('HA')[0] },
          { position: 'N', card: parseHand('D5')[0] },
          { position: 'E', card: parseHand('C6')[0] },
        ],
        leader: 'S',
        winner: 'W',
      },
    ];
    return { store, wrapper };
  }

  it('南家的牌按出牌顺序堆在右下，赢墩竖直、输墩平躺', async () => {
    const { wrapper } = setupPlay();
    await nextTick();

    const cards = wrapper.findAll('.south-played .pile-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].classes()).not.toContain('flat');
    expect(cards[1].classes()).toContain('flat');
    expect(cards[0].attributes('title')).toContain('第 1 墩');
    expect(cards[0].attributes('title')).toContain('南北赢墩');
    expect(cards[1].attributes('title')).toContain('东西赢墩');
  });

  it('悬停已出牌时浮出上一墩顺序动画，移开后消失', async () => {
    const { wrapper } = setupPlay();
    await nextTick();

    const wrap = wrapper.get('.pile-wrap');
    expect(wrapper.find('.last-trick-pop').exists()).toBe(false);

    await wrap.trigger('mouseenter');
    await nextTick();

    const pop = wrapper.get('.last-trick-pop');
    const cards = pop.findAll('.pop-card');
    expect(cards).toHaveLength(4);
    expect(cards.map((c) => c.get('.pop-order').text())).toEqual(['1', '2', '3', '4']);
    expect(cards[0].get('.pop-card-inner').attributes('style')).toContain('animation-delay: 0s');
    expect(cards[3].get('.pop-card-inner').attributes('style')).toContain('0.48s');

    await wrap.trigger('mouseleave');
    await nextTick();
    expect(wrapper.find('.last-trick-pop').exists()).toBe(false);
  });

  it('已出牌下方提供计分表 / 摊牌 / 定约卡 / 托管按钮', async () => {
    const { store, wrapper } = newStoreAndTable();
    await nextTick();

    const buttons = wrapper.findAll('.south-played .action-btn');
    expect(buttons.map((b) => b.text())).toEqual(['计分表', '摊牌', '定约卡', '托管']);

    await buttons[3].trigger('click');
    expect(store.autoPilot).toBe(true);
    await buttons[3].trigger('click');
    expect(store.autoPilot).toBe(false);
  });
});

describe('Table 选牌与出牌', () => {
  it('左键选中/取消，右键直接出牌', async () => {
    vi.useFakeTimers();
    const { store, wrapper } = newStoreAndTable();
    try {
      // 本用例只验证普通选牌，关闭推荐提示避免误点推荐牌
      store.setShowHints(false);
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
    store.setShowHints(false);
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

describe('Table 当前出牌座位箭头', () => {
  it('只在轮到出牌的座位手牌旁显示一个指向手牌的闪烁箭头', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play';
    store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    store.nextPlayer = 'E';
    await nextTick();

    expect(wrapper.findAll('.turn-arrow')).toHaveLength(1);
    expect(wrapper.find('.hand.pos-E .turn-arrow').exists()).toBe(true);
    expect(wrapper.get('.turn-arrow').classes()).toContain('pos-E');

    store.nextPlayer = 'S';
    await nextTick();
    expect(wrapper.findAll('.turn-arrow')).toHaveLength(1);
    expect(wrapper.find('.hand.pos-S .turn-arrow').exists()).toBe(true);
    expect(wrapper.find('.hand.pos-E .turn-arrow').exists()).toBe(false);
  });

  it('等待首攻时显示箭头，叫牌和结算阶段不显示', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    store.phase = 'play_waiting_lead';
    store.nextPlayer = 'W';
    await nextTick();
    expect(wrapper.find('.hand.pos-W .turn-arrow').exists()).toBe(true);

    store.phase = 'bidding';
    await nextTick();
    expect(wrapper.findAll('.turn-arrow')).toHaveLength(0);

    store.phase = 'scoring';
    await nextTick();
    expect(wrapper.findAll('.turn-arrow')).toHaveLength(0);
  });
});

describe('Table 明手显示', () => {
  it('东家成为明手时手牌与其余三家一样单行全尺寸显示', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.phase = 'play';
    store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'E' };
    store.dummyOpen = true;
    await nextTick();

    const east = wrapper.get('.hand.pos-E');
    expect(east.classes()).not.toContain('compact');
    expect(east.get('.suits').classes()).toContain('single-row');
    expect(east.findAll('.hand-row')).toHaveLength(1);
    expect(east.findAll('.card').every((card) => card.classes().includes('size-xxl'))).toBe(true);
  });
});

describe('Table 叫牌含义浮层', () => {
  it('默认不显示，悬停已完成的叫品时在中央显示含义，移开记录格即隐去', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.setShowHints(true);
    store.phase = 'bidding';
    store.biddingHistory = [
      { position: 'N', call: { type: 'bid', level: 1, suit: 'H' }, ruleId: 'open_1h' },
      { position: 'E', call: { type: 'pass' }, ruleId: 'fallback_pass' },
      { position: 'S', call: { type: 'bid', level: 1, suit: 'S' }, ruleId: 'open_1s' },
    ];
    await nextTick();

    expect(wrapper.find('.bid-meanings').exists()).toBe(false);

    const northCell = wrapper.get('.bid-cell[data-position="N"]:not(.thinking)');
    await northCell.trigger('mouseenter');
    const panel = wrapper.get('.bid-meanings');
    expect(panel.text()).toContain('北');
    expect(panel.text()).toContain('1♥');
    expect(panel.text()).toContain('5+ 红桃');
    // 新浮层没有边框和题头，只保留座位、叫品和含义
    expect(panel.find('.bm-title').exists()).toBe(false);

    await northCell.trigger('mouseleave');
    expect(wrapper.find('.bid-meanings').exists()).toBe(false);
  });

  it('悬停自己的叫品也会显示，移开后隐去', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.setShowHints(true);
    store.phase = 'bidding';
    store.biddingHistory = [
      { position: 'S', call: { type: 'bid', level: 1, suit: 'S' }, ruleId: 'open_1s' },
    ];
    await nextTick();

    const southCell = wrapper.get('.bid-cell[data-position="S"]:not(.thinking)');
    await southCell.trigger('mouseenter');
    expect(wrapper.get('.bid-meanings').text()).toContain('1S 开叫');
    await southCell.trigger('mouseleave');
    expect(wrapper.find('.bid-meanings').exists()).toBe(false);
  });

  it('叫牌卡悬停合法叫品时，中央浮层显示该叫品含义和推荐叫品', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.setShowHints(true);
    store.phase = 'bidding';
    store.currentBidder = 'S';
    store.setBidPreview({
      position: 'S',
      call: { type: 'bid', level: 1, suit: 'S' },
      meaning: '1S 自然叫品',
      recommended: false,
      recommendedCall: { type: 'bid', level: 1, suit: 'C' },
      recommendedMeaning: '精确 1C 开叫',
    });
    await nextTick();

    const panel = wrapper.get('.bid-meanings');
    expect(panel.text()).toContain('1♠');
    expect(panel.text()).toContain('1S 自然叫品');
    expect(panel.text()).toContain('推荐');
    expect(panel.text()).toContain('1♣');
    expect(panel.text()).toContain('精确 1C 开叫');

    store.setBidPreview(null);
    await nextTick();
    expect(wrapper.find('.bid-meanings').exists()).toBe(false);
  });

  it('关闭提示后悬停也不显示含义浮层', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.setShowHints(true);
    store.phase = 'bidding';
    store.biddingHistory = [
      { position: 'N', call: { type: 'bid', level: 1, suit: 'H' }, ruleId: 'open_1h' },
    ];
    await nextTick();

    const northCell = wrapper.get('.bid-cell[data-position="N"]:not(.thinking)');
    await northCell.trigger('mouseenter');
    expect(wrapper.find('.bid-meanings').exists()).toBe(true);

    store.setShowHints(false);
    await nextTick();
    expect(wrapper.find('.bid-meanings').exists()).toBe(false);
    await northCell.trigger('mouseenter');
    expect(wrapper.find('.bid-meanings').exists()).toBe(false);
  });

  it('叫牌结束后悬停也不再显示含义浮层', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.setShowHints(true);
    store.phase = 'bidding';
    store.biddingHistory = [
      { position: 'N', call: { type: 'bid', level: 1, suit: 'H' }, ruleId: 'open_1h' },
    ];
    await nextTick();

    const northCell = wrapper.get('.bid-cell[data-position="N"]:not(.thinking)');
    await northCell.trigger('mouseenter');
    expect(wrapper.find('.bid-meanings').exists()).toBe(true);

    store.phase = 'play';
    await nextTick();
    expect(wrapper.find('.bid-meanings').exists()).toBe(false);
  });
});

describe('Table 推荐出牌', () => {
  it('人类可选时箭头指向推荐牌并显示理由，关闭提示后回到固定回合位置', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.setShowHints(true);
    store.phase = 'play';
    store.contract = { level: 3, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    store.hands.S = parseHand('SAKQ2 HJT98 D543 C87');
    store.currentTrick = [];
    store.nextPlayer = 'S';
    store.tricks = [];
    await nextTick();

    const details = store.recommendPlayDetails('S');
    expect(details).not.toBeNull();
    const slot = findCardSlot(wrapper, 'S', details!.card);
    expect(slot).toBeDefined();
    const arrow = slot!.get('.turn-arrow');
    expect(arrow.classes()).toContain('has-reason');
    expect(arrow.attributes('aria-label')).toContain('推荐');
    expect(slot!.get('.turn-arrow-tip').text()).toContain(details!.reason);
    // 推荐牌本身不再自动弹起
    expect(slot!.get('.playing-card').classes()).not.toContain('selected');
    // 固定回合箭头与推荐箭头不会同时出现
    expect(wrapper.findAll('.hand.pos-S .turn-arrow')).toHaveLength(1);

    store.setShowHints(false);
    await nextTick();
    expect(wrapper.find('.hand.pos-S .card-slot .turn-arrow').exists()).toBe(false);
    // 关闭提示后仍保留固定位置的回合箭头
    expect(wrapper.find('.hand.pos-S > .turn-arrow').exists()).toBe(true);
    store.setShowHints(true);
  });

  it('推荐牌不再自动弹起，左键选中/取消正常，箭头保持指向推荐牌', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.setShowHints(true);
    store.phase = 'play';
    store.contract = { level: 3, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    store.hands.S = parseHand('SAKQ2 HJT98 D543 C87');
    store.currentTrick = [];
    store.nextPlayer = 'S';
    store.tricks = [];
    await nextTick();

    const details = store.recommendPlayDetails('S');
    expect(details).not.toBeNull();
    const slot = findCardSlot(wrapper, 'S', details!.card)!;
    const card = slot.get('.playing-card');
    expect(card.classes()).not.toContain('selected');

    await card.trigger('click');
    expect(card.classes()).toContain('selected');
    expect(slot.find('.turn-arrow').exists()).toBe(true);

    await card.trigger('click');
    expect(card.classes()).not.toContain('selected');
    expect(wrapper.findAll('.hand.pos-S .playing-card.selected')).toHaveLength(0);
  });

  it('右键点击推荐牌会一次直接打出', async () => {
    vi.useFakeTimers();
    const { store, wrapper } = newStoreAndTable();
    try {
      store.setShowHints(true);
      store.phase = 'play';
      store.contract = { level: 3, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
      store.hands.S = parseHand('SAKQ2 HJT98 D543 C87');
      store.currentTrick = [];
      store.nextPlayer = 'S';
      store.tricks = [];
      await nextTick();

      const details = store.recommendPlayDetails('S');
      expect(details).not.toBeNull();
      const slot = findCardSlot(wrapper, 'S', details!.card)!;
      await slot.get('.playing-card').trigger('contextmenu');
      await nextTick();

      expect(store.currentTrick).toHaveLength(1);
      expect(store.currentTrick[0].position).toBe('S');
      expect(wrapper.find('.hand.pos-S .playing-card.selected').exists()).toBe(false);
      // 出牌后推荐箭头随该牌一起离开手牌
      expect(wrapper.find('.hand.pos-S .turn-arrow').exists()).toBe(false);
    } finally {
      store.startNewGame({ autoStart: false, seed: 102 });
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('改选其他牌时只有选中牌弹起，推荐箭头仍指向推荐牌', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.setShowHints(true);
    store.phase = 'play';
    store.contract = { level: 3, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    store.hands.S = parseHand('SAKQ2 HJT98 D543 C87');
    store.currentTrick = [];
    store.nextPlayer = 'S';
    store.tricks = [];
    await nextTick();

    const details = store.recommendPlayDetails('S');
    expect(details).not.toBeNull();
    const recommendedSlot = findCardSlot(wrapper, 'S', details!.card)!;
    const otherSlot = wrapper
      .findAll('.hand.pos-S .card-slot')
      .find((slot) => slot.attributes('data-card') !== String(details!.card));
    expect(otherSlot).toBeDefined();

    await otherSlot!.get('.playing-card').trigger('click');
    expect(otherSlot!.get('.playing-card').classes()).toContain('selected');
    expect(recommendedSlot.get('.playing-card').classes()).not.toContain('selected');
    expect(wrapper.findAll('.hand.pos-S .playing-card.selected')).toHaveLength(1);
    expect(recommendedSlot.find('.turn-arrow').exists()).toBe(true);
  });

  it('非人类回合箭头停在固定位置，不指向具体牌张', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.setShowHints(true);
    store.phase = 'play';
    store.contract = { level: 3, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    store.nextPlayer = 'E';
    store.currentTrick = [];
    store.tricks = [];
    await nextTick();

    expect(wrapper.find('.hand.pos-E > .turn-arrow').exists()).toBe(true);
    expect(wrapper.find('.hand.pos-E .card-slot .turn-arrow').exists()).toBe(false);
  });

  it('人类坐庄操作明手时，箭头也指向明手的推荐牌', async () => {
    const { store, wrapper } = newStoreAndTable();
    store.setShowHints(true);
    store.phase = 'play';
    store.contract = { level: 3, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    store.dummyOpen = true;
    store.hands.N = parseHand('SAKQ2 HJT98 D543 C87');
    store.currentTrick = [{ position: 'W', card: parseHand('C2')[0] }];
    store.nextPlayer = 'N';
    store.tricks = [];
    await nextTick();

    expect(store.isHumanControlled('N')).toBe(true);
    const details = store.recommendPlayDetails('N');
    expect(details).not.toBeNull();
    const slot = findCardSlot(wrapper, 'N', details!.card);
    expect(slot).toBeDefined();
    expect(slot!.find('.turn-arrow').exists()).toBe(true);
    expect(wrapper.find('.hand.pos-N > .turn-arrow').exists()).toBe(false);
  });
});
