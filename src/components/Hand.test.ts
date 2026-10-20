import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Hand from './Hand.vue';
import { parseHand } from '../testing/testUtils';

describe('Hand 牌面布局', () => {
  it('南家单行显示，按 ♠ ♥ ♦ ♣ 从大到小排列', () => {
    const wrapper = mount(Hand, {
      props: { cards: parseHand('SAKQ2 HJT9 D5 C876'), position: 'S' },
    });
    const suits = wrapper.get('.suits');
    expect(suits.classes()).toContain('single-row');
    expect(wrapper.findAll('.suit-row')).toHaveLength(0);
    expect(wrapper.findAll('.suit-group')).toHaveLength(4);
    expect(wrapper.findAll('.card').map((c) => c.text())).toEqual([
      'A',
      'K',
      'Q',
      '2',
      'J',
      '10',
      '9',
      '5',
      '8',
      '7',
      '6',
    ]);
  });

  it('北家单行显示，缺门不渲染占位符', () => {
    const wrapper = mount(Hand, {
      props: { cards: parseHand('SAKQJ2 HJT9 D5432'), position: 'N' },
    });
    expect(wrapper.findAll('.suit-row')).toHaveLength(0);
    expect(wrapper.findAll('.suit-group')).toHaveLength(3);
    expect(wrapper.findAll('.void')).toHaveLength(0);
    expect(wrapper.findAll('.card')).toHaveLength(12);
  });

  it('东西家与南北家一致：单行全尺寸牌面，不渲染空花色占位', () => {
    const wrapper = mount(Hand, {
      props: { cards: parseHand('SAKQJ2 HJT9 D5432 C8'), position: 'E' },
    });
    expect(wrapper.get('.suits').classes()).toContain('single-row');
    expect(wrapper.findAll('.suit-row')).toHaveLength(0);
    expect(wrapper.findAll('.hand-row')).toHaveLength(1);
    expect(wrapper.findAll('.suit-group')).toHaveLength(4);
    expect(wrapper.findAll('.void')).toHaveLength(0);
    expect(wrapper.findAll('.card').every((card) => card.classes().includes('size-xxl'))).toBe(true);
  });

  it('暗手只渲染牌背，不泄露牌型', () => {
    const wrapper = mount(Hand, {
      props: { cards: parseHand('SAKQ2 HJT9 D543 C876'), position: 'E', faceDown: true },
    });
    expect(wrapper.findAll('.suit-row')).toHaveLength(0);
    expect(wrapper.findAll('.card.back')).toHaveLength(13);
    expect(wrapper.findAll('.card.back').every((card) => card.classes().includes('size-xxl'))).toBe(true);
  });

  it('可点击时派发 card-click 事件', async () => {
    const wrapper = mount(Hand, {
      props: { cards: parseHand('SAKQ HJT9 D5432 C87'), position: 'S', clickable: true },
    });
    await wrapper.find('.card').trigger('click');
    expect(wrapper.emitted('card-click')).toBeTruthy();
  });

  it('双击卡牌派发 card-dblclick 事件', async () => {
    const cards = parseHand('SAKQ HJT9 D5432 C87');
    const wrapper = mount(Hand, {
      props: { cards, position: 'S', clickable: true },
    });
    await wrapper.find('.card').trigger('dblclick');
    expect(wrapper.emitted('card-dblclick')?.[0]).toEqual([cards[0]]);
  });

  it('选中的牌带 selected 样式，右键派发 card-confirm 事件', async () => {
    const cards = parseHand('SAKQ HJT9 D5432 C87');
    const wrapper = mount(Hand, {
      props: {
        cards,
        position: 'S',
        clickable: true,
        selectedCard: cards[0],
      },
    });
    expect(wrapper.get('.card').classes()).toContain('selected');
    await wrapper.get('.card').trigger('contextmenu');
    expect(wrapper.emitted('card-confirm')?.[0]).toEqual([cards[0]]);
  });
});
