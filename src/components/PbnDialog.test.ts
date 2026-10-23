import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import ElementPlus, { ElDialog } from 'element-plus';
import PbnDialog from './PbnDialog.vue';
import { useGameStore } from '../store/game';

async function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useGameStore();
  store.startNewGame({ autoStart: false, seed: 11 });
  const wrapper = mount(PbnDialog, {
    props: { modelValue: true },
    attachTo: document.body,
    global: { plugins: [pinia, ElementPlus] },
  });
  await nextTick();
  await nextTick();
  return { wrapper };
}

describe('PbnDialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('拖动或误点遮罩不会关闭导入导出窗口', async () => {
    const { wrapper } = await setup();
    const dialog = wrapper.getComponent(ElDialog);
    expect(dialog.props('draggable')).toBe(true);
    expect(dialog.props('closeOnClickModal')).toBe(false);

    const overlay = document.body.querySelector<HTMLElement>('.el-overlay-dialog');
    expect(overlay).not.toBeNull();
    overlay!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    overlay!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    overlay!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
});
