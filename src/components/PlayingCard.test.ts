import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PlayingCard from './PlayingCard.vue';
import { parseHand } from '../testing/testUtils';

describe('PlayingCard 双角标', () => {
  it('中央出牌模式在左上角与右下角都提供完整牌名', () => {
    const wrapper = mount(PlayingCard, {
      props: { card: parseHand('SA')[0], size: 'xl', labelMode: 'suit-first' },
    });

    expect(wrapper.get('.pc-label:not(.pc-label-bottom)').text()).toBe('♠A');
    expect(wrapper.get('.pc-label-bottom').attributes('data-label')).toBe('♠A');
    expect(wrapper.get('.pc-corner-suit-bottom').attributes('data-suit')).toBe('♠');
  });

  it('手牌模式在右下角同样提供点数与花色', () => {
    const wrapper = mount(PlayingCard, {
      props: { card: parseHand('HK')[0], size: 'xxl' },
    });

    expect(wrapper.get('.pc-label:not(.pc-label-bottom)').text()).toBe('K');
    expect(wrapper.get('.pc-label-bottom').attributes('data-label')).toBe('K');
    expect(wrapper.get('.pc-corner-suit-bottom').attributes('data-suit')).toBe('♥');
    expect(wrapper.classes()).toContain('red');
  });
});
