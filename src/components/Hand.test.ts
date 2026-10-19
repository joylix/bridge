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

  it('东西家紧凑模式仍按花色分 4 行', () => {
    const wrapper = mount(Hand, {
      props: { cards: parseHand('SAKQJ2 HJT9 D5432'), position: 'E', compact: true },
    });
    const rows = wrapper.findAll('.suit-row');
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.get('.suit-tag').text())).toEqual(['♠', '♥', '♦', '♣']);
    expect(wrapper.findAll('.void')).toHaveLength(1);
  });

  it('暗手只渲染牌背，不泄露牌型', () => {
    const wrapper = mount(Hand, {
      props: { cards: parseHand('SAKQ2 HJT9 D543 C876'), position: 'E', faceDown: true },
    });
    expect(wrapper.findAll('.suit-row')).toHaveLength(0);
    expect(wrapper.findAll('.card.back')).toHaveLength(13);
  });

  it('可点击时派发 card-click 事件', async () => {
    const wrapper = mount(Hand, {
      props: { cards: parseHand('SAKQ HJT9 D5432 C87'), position: 'S', clickable: true },
    });
    await wrapper.find('.card').trigger('click');
    expect(wrapper.emitted('card-click')).toBeTruthy();
  });
});
