import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import ElementPlus from 'element-plus';
import BiddingBox from './BiddingBox.vue';
import { useGameStore } from '../store/game';
import { parseHand } from '../testing/testUtils';

function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useGameStore();
  store.startNewGame({ autoStart: false, seed: 9 });
  const wrapper = mount(BiddingBox, { global: { plugins: [pinia, ElementPlus] } });
  return { store, wrapper };
}

describe('BiddingBox 叫牌浮窗', () => {
  it('人类回合自动选中并高亮推荐叫品，悬停合法叫品时把含义和推荐同步到浮动层', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useGameStore();
    store.startNewGame({ autoStart: false, seed: 9 });
    store.setShowHints(true);
    store.biddingHistory = [];
    store.currentBid = null;
    store.currentBidder = 'S';
    store.hands.S = parseHand('SAKQ2 HAK3 D5432 C87'); // 16 HCP 均型
    const wrapper = mount(BiddingBox, { global: { plugins: [pinia, ElementPlus] } });
    await nextTick();

    const oneClub = wrapper.get('button.bid-btn[data-level="1"][data-suit="C"]');
    const oneSpade = wrapper.get('button.bid-btn[data-level="1"][data-suit="S"]');
    expect(oneClub.classes()).toContain('recommended');
    expect(oneClub.classes()).toContain('selected');
    expect(wrapper.get('.confirm-btn').attributes('disabled')).toBeUndefined();
    // 叫牌卡内不再保留含义预览和“恢复推荐”按钮
    expect(wrapper.find('.meaning-preview').exists()).toBe(false);
    expect(wrapper.find('.restore-recommended').exists()).toBe(false);

    // 悬停非推荐叫品：浮动层数据同时带出该叫品和推荐叫品含义
    await oneSpade.trigger('mouseenter');
    expect(store.bidPreview?.call).toEqual({ type: 'bid', level: 1, suit: 'S' });
    expect(store.bidPreview?.recommended).toBe(false);
    expect(store.bidPreview?.recommendedCall).toEqual({ type: 'bid', level: 1, suit: 'C' });
    expect(store.bidPreview?.recommendedMeaning).toContain('精确 1C 开叫');
    await oneSpade.trigger('mouseleave');
    expect(store.bidPreview).toBeNull();

    // 改选其他叫品：推荐标记保留在 1C，选中切换到新叫品
    await oneSpade.trigger('click');
    expect(oneSpade.classes()).toContain('selected');
    expect(oneClub.classes()).toContain('recommended');
    expect(oneClub.classes()).not.toContain('selected');

    // 悬停推荐叫品：浮动层标注推荐
    await oneClub.trigger('mouseenter');
    expect(store.bidPreview?.call).toEqual({ type: 'bid', level: 1, suit: 'C' });
    expect(store.bidPreview?.recommended).toBe(true);
    expect(store.bidPreview?.meaning).toContain('精确 1C 开叫');
    expect(store.bidPreview?.recommendedCall).toBeUndefined();
  });

  it('关闭提示后不再自动选中、不显示推荐与含义', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useGameStore();
    store.startNewGame({ autoStart: false, seed: 9 });
    store.biddingHistory = [];
    store.currentBid = null;
    store.currentBidder = 'S';
    store.hands.S = parseHand('SAKQ2 HAK3 D5432 C87');
    store.setShowHints(false);
    const wrapper = mount(BiddingBox, { global: { plugins: [pinia, ElementPlus] } });
    await nextTick();

    expect(wrapper.find('.recommended').exists()).toBe(false);
    expect(wrapper.find('.meaning-preview').exists()).toBe(false);
    expect(wrapper.get('.confirm-btn').attributes('disabled')).toBeDefined();

    const oneSpade = wrapper.get('button.bid-btn[data-level="1"][data-suit="S"]');
    await oneSpade.trigger('mouseenter');
    expect(store.bidPreview).toBeNull();
    store.setShowHints(true);
  });

  it('只包含叫牌卡控件，不再内嵌叫牌过程或最终结果', () => {
    const { wrapper } = setup();
    expect(wrapper.find('.bidding-popup').exists()).toBe(true);
    expect(wrapper.findAll('.bid-btn').length).toBeGreaterThan(0);
    expect(wrapper.find('.popup-bar').exists()).toBe(true);
    expect(wrapper.find('.bid-history').exists()).toBe(false);
    expect(wrapper.find('.flow-notice').exists()).toBe(false);
    expect(wrapper.find('.final-contract').exists()).toBe(false);
    expect(wrapper.find('.contract').exists()).toBe(false);
  });

  it('拖动标题栏可移动浮窗，松开后结束拖动', async () => {
    const { wrapper } = setup();
    const bar = wrapper.get('.popup-bar');
    const popup = wrapper.get('.bidding-popup');
    const before = popup.attributes('style');

    bar.element.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 120, clientY: 120, bubbles: true }));
    await nextTick();
    expect(bar.classes()).toContain('dragging');

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 190, clientY: 170 }));
    await nextTick();
    expect(popup.attributes('style')).not.toBe(before);

    window.dispatchEvent(new MouseEvent('pointerup'));
    await nextTick();
    expect(bar.classes()).not.toContain('dragging');
  });

  it('上家叫 1♣ 后，同阶更高的 1♠ 可以叫', async () => {
    const { store, wrapper } = setup();
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
    const { store, wrapper } = setup();
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

  it('“确认+提醒”提交时标记该次叫牌（不弹提醒框）', async () => {
    const { store, wrapper } = setup();
    store.biddingHistory = [];
    store.currentBid = null;
    store.currentBidder = 'S';
    await nextTick();

    await wrapper.get('button.bid-btn[data-level="1"][data-suit="S"]').trigger('click');
    const confirms = wrapper.findAll('.confirm-btn');
    await confirms[1].trigger('click');

    expect(store.biddingHistory[0]?.alerted).toBe(true);
    expect(store.biddingHistory[0]?.call).toEqual({ type: 'bid', level: 1, suit: 'S' });
  });

  it('双击叫牌卡直接提交，无需再点确认', async () => {
    const { store, wrapper } = setup();
    store.biddingHistory = [];
    store.currentBid = null;
    store.currentBidder = 'S';
    await nextTick();

    const oneSpade = wrapper.get('button.bid-btn[data-level="1"][data-suit="S"]');
    await oneSpade.trigger('dblclick');
    expect(store.biddingHistory[0]?.call).toEqual({ type: 'bid', level: 1, suit: 'S' });
  });

  it('双击 Pass 直接提交', async () => {
    const { store, wrapper } = setup();
    store.biddingHistory = [];
    store.currentBid = null;
    store.currentBidder = 'S';
    await nextTick();

    const pass = wrapper.get('.special-btn.pass');
    expect(pass.attributes('disabled')).toBeUndefined();
    await pass.trigger('dblclick');
    expect(store.biddingHistory[0]?.call).toEqual({ type: 'pass' });
  });

  it('双击 X 直接提交', async () => {
    const { store, wrapper } = setup();
    store.biddingHistory = [{ position: 'E', call: { type: 'bid', level: 1, suit: 'S' } }];
    store.currentBid = { level: 1, suit: 'S' };
    store.currentBidder = 'S';
    await nextTick();

    const double = wrapper.get('.special-btn.x');
    expect(double.attributes('disabled')).toBeUndefined();
    await double.trigger('dblclick');
    expect(store.biddingHistory[1]?.call).toEqual({ type: 'double' });
  });

  it('双击 XX 直接提交', async () => {
    const { store, wrapper } = setup();
    store.biddingHistory = [
      { position: 'S', call: { type: 'bid', level: 1, suit: 'S' } },
      { position: 'W', call: { type: 'double' } },
      { position: 'N', call: { type: 'pass' } },
      { position: 'E', call: { type: 'pass' } },
    ];
    store.currentBid = { level: 1, suit: 'S' };
    store.currentBidder = 'S';
    await nextTick();

    const redouble = wrapper.get('.special-btn.xx');
    expect(redouble.attributes('disabled')).toBeUndefined();
    await redouble.trigger('dblclick');
    expect(store.biddingHistory[4]?.call).toEqual({ type: 'redouble' });
  });
});
