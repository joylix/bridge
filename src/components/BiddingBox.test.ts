import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import ElementPlus from 'element-plus';
import BiddingBox from './BiddingBox.vue';
import { useGameStore } from '../store/game';

function setup(phase: 'bidding' | 'play' | 'scoring') {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useGameStore();
  store.startNewGame({ autoStart: false, seed: 9 });
  store.phase = phase;
  if (phase !== 'bidding') {
    store.contract = { level: 4, suit: 'H', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    store.biddingHistory = [
      { position: 'N', call: { type: 'pass' } },
      { position: 'E', call: { type: 'pass' } },
      { position: 'S', call: { type: 'bid', level: 4, suit: 'H' } },
      { position: 'W', call: { type: 'pass' } },
    ];
  }
  if (phase === 'scoring') {
    store.score = { NS: 420, EW: 0 };
  }
  const wrapper = mount(BiddingBox, { global: { plugins: [pinia, ElementPlus] } });
  return { store, wrapper };
}

describe('BiddingBox 阶段切换', () => {
  it('叫牌阶段显示叫牌按钮，不显示叫牌过程', () => {
    const { wrapper } = setup('bidding');
    expect(wrapper.findAll('.bid-btn').length).toBeGreaterThan(0);
    expect(wrapper.find('.bid-history').exists()).toBe(false);
  });

  it('上家叫 1♣ 后，同阶更高的 1♠ 可以叫', async () => {
    const { store, wrapper } = setup('bidding');
    store.biddingHistory = [
      { position: 'N', call: { type: 'bid', level: 1, suit: 'C' } },
      { position: 'E', call: { type: 'pass' } },
    ];
    store.currentBid = { level: 1, suit: 'C' };
    store.currentBidder = 'S';
    await nextTick();

    const oneSpade = wrapper.get('button.bid-btn[data-level="1"][data-suit="S"]');
    expect(oneSpade.attributes('disabled')).toBeUndefined();
  });

  it('选择叫品后点击“确认”才提交', async () => {
    const { store, wrapper } = setup('bidding');
    store.biddingHistory = [];
    store.currentBid = null;
    store.currentBidder = 'S';
    await nextTick();

    const oneSpade = wrapper.get('button.bid-btn[data-level="1"][data-suit="S"]');
    await oneSpade.trigger('click');
    expect(store.biddingHistory).toHaveLength(0);
    expect(oneSpade.classes()).toContain('selected');

    const confirm = wrapper.get('.confirm-btn');
    expect(confirm.attributes('disabled')).toBeUndefined();
    await confirm.trigger('click');
    expect(store.biddingHistory[0]?.call).toEqual({ type: 'bid', level: 1, suit: 'S' });
  });

  it('叫牌结束后显示叫牌过程，不再显示叫牌按钮', () => {
    const { wrapper } = setup('play');
    expect(wrapper.find('.bid-history').exists()).toBe(true);
    expect(wrapper.findAll('.bid-btn')).toHaveLength(0);
    expect(wrapper.get('.bid-title-row').text()).toContain('局况');
    const labels = wrapper.findAll('.bid-label').map((node) => node.text());
    expect(labels).toEqual(['—', '—', '——']);
  });

  it('打牌结束后显示最终结果和查看详细结果入口', () => {
    const { wrapper } = setup('scoring');
    expect(wrapper.find('.bid-history').exists()).toBe(true);
    const notice = wrapper.get('.flow-notice');
    expect(notice.text()).toContain('最终结果');
    expect(notice.text()).toContain('查看详细结果');
    expect(notice.text()).toContain('S 4♥');
    expect(notice.get('.final-contract .suit').classes()).toContain('red');
  });
});
