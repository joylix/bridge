import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ResultTable from './ResultTable.vue';
import { useGameStore } from '../store/game';
import type { CardPlay, Trick } from '../models/gameState';
import { parseHand } from '../testing/testUtils';

function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useGameStore();
  store.startNewGame({ autoStart: false, seed: 31 });
  store.phase = 'scoring';
  store.dealer = 'W';
  store.vulnerability = 'both';
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
  const wrapper = mount(ResultTable, { global: { plugins: [pinia] } });
  return { store, wrapper };
}

describe('ResultTable 结果窗口', () => {
  it('按结果显示窗口提供五个区域与完整汇总列', () => {
    const { wrapper } = setup();
    expect(wrapper.findAll('.res-title').map((title) => title.text())).toEqual([
      '本桌累计得分',
      '牌型分布',
      '比较得分',
      '叫牌过程',
      '打牌过程',
    ]);
    expect(wrapper.get('.summary-table').text()).toContain('我方得分');
    expect(wrapper.get('.summary-table').text()).toContain('对方得分');
    expect(wrapper.get('.comparison-table').text()).toContain('NS得分');
    expect(wrapper.get('.comparison-table').text()).toContain('EW得分');
  });

  it('显示定约结果、牌型分布与当前得分行', () => {
    const { wrapper } = setup();
    const summary = wrapper.get('.summary-table').text();
    expect(summary).toContain('S');
    expect(summary).toContain('1NT');
    expect(summary).toContain('+3');
    expect(summary).toContain('180');

    expect(wrapper.get('.distribution').text()).toContain('双方有局');
    expect(wrapper.get('.distribution').text()).toContain('南');
    expect(wrapper.get('.distribution').text()).toContain('1NT');
    expect(wrapper.findAll('.result-hand .rh-tile:not(.rh-suit)')).toHaveLength(52);
    expect(wrapper.find('.comparison-table tr.current').exists()).toBe(true);
  });

  it('叫牌进行中时显示未定约而不是流局', () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useGameStore();
    store.startNewGame({ autoStart: false, seed: 32 });
    store.phase = 'bidding';
    store.contract = null;
    store.biddingHistory = [{ position: 'N', call: { type: 'pass' } }];
    store.dealer = 'N';

    const wrapper = mount(ResultTable, { global: { plugins: [pinia] } });
    expect(wrapper.get('.summary-table').text()).toContain('未定约');
    expect(wrapper.get('.distribution').text()).toContain('未定约');
    expect(wrapper.text()).not.toContain('流局');
  });

  it('叫牌与打牌过程按发牌人/首攻人展开两轮座位列', () => {
    const { wrapper } = setup();
    expect(wrapper.findAll('.bid-table thead th').map((cell) => cell.text())).toEqual([
      '西',
      '北',
      '东',
      '南',
    ]);
    expect(wrapper.findAll('.play-table thead th').map((cell) => cell.text())).toEqual([
      '西',
      '北',
      '东',
      '南',
      '西',
      '北',
      '东',
    ]);
    expect(wrapper.get('.bid-table tbody').text()).toContain('1♥');
    expect(wrapper.get('.bid-table tbody').text()).toContain('1NT');
    expect(wrapper.findAll('.play-table tbody tr')).toHaveLength(13);
  });

  it('东家开叫后结束符写在下一行第一列，而不是首行北家格', () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useGameStore();
    store.startNewGame({ autoStart: false, seed: 33 });
    store.phase = 'scoring';
    store.dealer = 'E';
    store.contract = { level: 1, suit: 'H', doubled: false, redoubled: false, declarer: 'E', dummy: 'W' };
    store.biddingHistory = [
      { position: 'E', call: { type: 'bid', level: 1, suit: 'H' } },
      { position: 'S', call: { type: 'pass' } },
      { position: 'W', call: { type: 'pass' } },
      { position: 'N', call: { type: 'pass' } },
    ];

    const wrapper = mount(ResultTable, { global: { plugins: [pinia] } });
    expect(wrapper.findAll('.bid-table thead th').map((cell) => cell.text())).toEqual([
      '东',
      '南',
      '西',
      '北',
    ]);
    const rows = wrapper.findAll('.bid-table tbody tr');
    expect(rows).toHaveLength(2);
    // 首行北家格留空
    expect(rows[0].findAll('td').map((cell) => cell.text())).toEqual(['1♥', '—', '—', '']);
    // 结束符另起一行，写在第一列
    expect(rows[1].findAll('td').map((cell) => cell.text())).toEqual(['=', '', '', '']);
  });
});
