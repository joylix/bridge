import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ScoreBoard from './ScoreBoard.vue';
import { useGameStore } from '../store/game';
import { parseHand } from '../testing/testUtils';
import type { Position } from '../models/gameState';

function makeTrick(winner: Position) {
  const plays = (['N', 'E', 'S', 'W'] as Position[]).map((position, i) => ({
    position,
    card: parseHand('SA')[0] + i,
  }));
  return { plays, leader: 'N' as Position, winner };
}

function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useGameStore();
  store.startNewGame({ autoStart: false, seed: 5 });
  store.phase = 'play';
  store.contract = { level: 4, suit: 'H', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
  store.tricks = [makeTrick('N'), makeTrick('N'), makeTrick('S'), makeTrick('E'), makeTrick('W')];
  const wrapper = mount(ScoreBoard, { global: { plugins: [pinia] } });
  return { store, wrapper };
}

describe('ScoreBoard 定约与赢墩', () => {
  it('显示当前定约、成约所需墩数与局况', () => {
    const { wrapper } = setup();
    expect(wrapper.get('.contract-value').text()).toBe('S 4♥');
    expect(wrapper.get('.contract-value .suit').classes()).toContain('red');
    const sub = wrapper.get('.contract-sub').text();
    expect(sub).toContain('需 10 墩');
    expect(sub).toContain('局况');
    // 局况用英文名称
    expect(['None', 'NS', 'EW', 'Both'].some((v) => sub.includes(v))).toBe(true);
  });

  it('不再显示牌局信息与得分栏目', () => {
    const { wrapper } = setup();
    expect(wrapper.text()).not.toContain('牌局信息');
    expect(wrapper.text()).not.toContain('得分');
  });

  it('分别显示 NS / EW 已赢墩数并标注定约方', () => {
    const { wrapper } = setup();
    const sides = wrapper.findAll('.tricks .side');
    expect(sides).toHaveLength(2);
    // NS 赢 3 墩（N,N,S），EW 赢 2 墩（E,W）
    expect(sides[0].get('.side-value').text()).toBe('3');
    expect(sides[1].get('.side-value').text()).toBe('2');
    // 定约方为 NS
    expect(sides[0].classes()).toContain('is-decl');
    expect(sides[0].get('.decl-tag').text()).toBe('定约方');
    expect(sides[1].classes()).not.toContain('is-decl');
  });

  it('显示定约方成约进度（还需墩数）', () => {
    const { wrapper } = setup();
    const progress = wrapper.get('.progress').text();
    expect(progress).toContain('NS');
    expect(progress).toContain('已完成 3 / 10 墩');
    expect(progress).toContain('还需 7 墩');
  });

  it('无定约时不显示成约目标', () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useGameStore();
    store.startNewGame({ autoStart: false, seed: 6 });
    store.phase = 'bidding';
    const wrapper = mount(ScoreBoard, { global: { plugins: [pinia] } });
    expect(wrapper.get('.contract-value').text()).toBe('—');
    expect(wrapper.find('.progress').exists()).toBe(false);
  });

  it('显示计点：本局点数、累计点数与总点数差（计点胜负）', () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useGameStore();
    store.startNewGame({ autoStart: false, seed: 7 });
    store.phase = 'scoring';
    store.score = { NS: 420, EW: 0 };
    store.dealHcp = { NS: 20, EW: 20 }; // 双方均势 → 贴点为 0
    const wrapper = mount(ScoreBoard, { global: { plugins: [pinia] } });

    const points = wrapper.get('.points').text();
    expect(points).toContain('本局点数');
    expect(points).toContain('NS +9'); // 420 → 9 点
    expect(points).toContain('NS 累计点数');
    expect(points).toContain('EW 累计点数');
    expect(points).toContain('总点数差（计点胜负）');
    expect(points).toContain('NS 领先 +9');
    expect(points).toContain('本循环已完成 1 / 8 副');
  });

  it('贴点制：显示双方大牌点、原始 IMP 与贴点调整', () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useGameStore();
    store.startNewGame({ autoStart: false, seed: 7 });
    store.phase = 'scoring';
    store.score = { NS: 420, EW: 0 };
    store.dealHcp = { NS: 26, EW: 14 };
    const wrapper = mount(ScoreBoard, { global: { plugins: [pinia] } });

    const points = wrapper.get('.points').text();
    // 9 IMP −（26 − 20）= 3
    expect(points).toContain('本局双方大牌点');
    expect(points).toContain('26 : 14');
    expect(points).toContain('本局原始 IMP');
    expect(points).toContain('NS +9');
    expect(points).toContain('贴点调整');
    expect(points).toContain('EW +6');
    expect(points).toContain('NS 领先 +3');
  });
});
