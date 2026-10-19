import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ElementPlus from 'element-plus';
import { nextTick } from 'vue';
import RuleEditor from './RuleEditor.vue';
import { useGameStore } from '../store/game';
import { clearRuleOverrides } from '../engine/loader';

async function openEditor() {
  clearRuleOverrides();
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useGameStore();
  store.startNewGame({ autoStart: false, seed: 1 });
  const wrapper = mount(RuleEditor, {
    props: { modelValue: true },
    global: { plugins: [pinia, ElementPlus] },
  });
  for (let i = 0; i < 5; i++) await nextTick();
  return { store, wrapper };
}

/** 弹窗可能被 teleport 到 body，统一读取整页文本 */
function pageText(wrapper: { text: () => string }): string {
  return `${wrapper.text()} ${document.body.textContent ?? ''}`;
}

describe('RuleEditor 规则浏览', () => {
  it('展示叫牌规则文件与每条规则的细则', async () => {
    const { wrapper } = await openEditor();
    const text = pageText(wrapper);

    expect(text).toContain('叫牌规则');
    expect(text).toContain('precision');
    expect(text).toContain('open_1c');
    expect(text).toContain('16+ 任意牌型（逼叫）');
    expect(text).toContain('优先级');

    wrapper.unmount();
  });

  it('当前阶段普通用户可编辑（显示编辑入口）', async () => {
    const { store, wrapper } = await openEditor();
    expect(store.canEditRules).toBe(true);
    expect(pageText(wrapper)).toContain('编辑源码');

    wrapper.unmount();
  });
});
