import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import ElementPlus from 'element-plus';
import App from './App.vue';
import DealResultDialog from './components/DealResultDialog.vue';
import { useGameStore } from './store/game';

type AppWrapper = ReturnType<typeof mount>;

let wrapper: AppWrapper | null = null;

function setupApp() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const appWrapper = mount(App, { global: { plugins: [pinia, ElementPlus] } });
  wrapper = appWrapper;
  return { store: useGameStore(), wrapper: appWrapper };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('App 冒烟测试', () => {
  it('可挂载并渲染全宽牌桌，不显示右侧信息栏', () => {
    const { wrapper } = setupApp();
    expect(wrapper.text()).toContain('桥牌 MVP');
    expect(wrapper.get('.app-header .suit-red').text()).toBe('♥');
    expect(wrapper.find('.table').exists()).toBe(true);
    expect(wrapper.find('aside').exists()).toBe(false);
    expect(wrapper.findAll('.hand')).toHaveLength(4);
  });

  it('叫牌浮窗只在轮到人类叫牌时出现，其他时间自动关闭', async () => {
    const { store, wrapper } = setupApp();

    store.phase = 'bidding';
    store.currentBidder = 'N';
    await nextTick();
    expect(wrapper.find('.bidding-popup').exists()).toBe(false);

    store.currentBidder = 'S';
    await nextTick();
    expect(wrapper.find('.bidding-popup').exists()).toBe(true);

    store.currentBidder = 'W';
    await nextTick();
    expect(wrapper.find('.bidding-popup').exists()).toBe(false);

    store.currentBidder = 'S';
    await nextTick();
    expect(wrapper.find('.bidding-popup').exists()).toBe(true);

    store.phase = 'play';
    store.contract = { level: 4, suit: 'H', doubled: false, redoubled: false, declarer: 'N', dummy: 'S' };
    await nextTick();
    expect(wrapper.find('.bidding-popup').exists()).toBe(false);
  });

  it('牌桌左上角显示副序、局况、定约和赢墩数，流局后显示流局', async () => {
    const { store, wrapper } = setupApp();

    store.phase = 'play';
    store.contract = { level: 4, suit: 'H', doubled: false, redoubled: false, declarer: 'N', dummy: 'S' };
    await nextTick();

    const info = wrapper.get('.play-info-panel');
    expect(info.text()).toContain('副序');
    expect(info.text()).toContain('局况');
    expect(info.text()).toContain('定约');
    expect(info.text()).toContain('4♥');
    expect(info.text()).toContain('赢墩数');
    expect(info.get('.contract-display .suit').classes()).toContain('red');

    store.contract = null;
    store.phase = 'scoring';
    await nextTick();
    expect(wrapper.get('.play-info-panel').text()).toContain('流局');
  });

  it('结算后自动弹出本局结果，并可关闭', async () => {
    const { store, wrapper } = setupApp();
    const result = wrapper.getComponent(DealResultDialog);
    expect(result.props('modelValue')).toBe(false);

    store.contract = { level: 4, suit: 'H', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    store.phase = 'scoring';
    await nextTick();
    expect(wrapper.getComponent(DealResultDialog).props('modelValue')).toBe(true);

    store.phase = 'bidding';
    await nextTick();
    expect(wrapper.getComponent(DealResultDialog).props('modelValue')).toBe(false);
  });
});
