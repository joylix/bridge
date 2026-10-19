import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Hand from './Hand.vue';
import { parseHand } from '../testing/testUtils';

describe('Hand 分花色 4 行显示', () => {
  it('按 ♠ ♥ ♦ ♣ 分成 4 行，同花色点数降序', () => {
    const wrapper = mount(Hand, {
      props: { cards: parseHand('SAKQ2 HJT9 D5 C876'), position: 'S' },
    });
    const rows = wrapper.findAll('.suit-row');
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.get('.suit-tag').text())).toEqual(['♠', '♥', '♦', '♣']);
    const ranks = (i: number) => rows[i].findAll('.card').map((c) => c.text());
    expect(ranks(0)).toEqual(['A', 'K', 'Q', '2']);
    expect(ranks(1)).toEqual(['J', '10', '9']);
    expect(ranks(2)).toEqual(['5']);
    expect(ranks(3)).toEqual(['8', '7', '6']);
  });

  it('缺门花色显示占位符', () => {
    const wrapper = mount(Hand, {
      props: { cards: parseHand('SAKQJ2 HJT9 D5432'), position: 'N' },
    });
    const rows = wrapper.findAll('.suit-row');
    expect(rows).toHaveLength(4);
    expect(wrapper.findAll('.void')).toHaveLength(1);
    expect(rows[3].findAll('.card')).toHaveLength(0);
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
