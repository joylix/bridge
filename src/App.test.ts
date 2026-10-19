import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import App from './App.vue';

describe('App 冒烟测试', () => {
  it('可挂载并渲染牌桌与叫牌面板', () => {
    vi.useFakeTimers();
    try {
      const wrapper = mount(App, { global: { plugins: [createPinia(), ElementPlus] } });
      expect(wrapper.text()).toContain('桥牌 MVP');
      expect(wrapper.get('.app-header .suit-red').text()).toBe('♥');
      expect(wrapper.find('.table').exists()).toBe(true);
      // 四个座位的手牌组件均应渲染
      expect(wrapper.findAll('.hand').length).toBeGreaterThanOrEqual(4);
      wrapper.unmount();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
