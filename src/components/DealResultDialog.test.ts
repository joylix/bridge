import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, nextTick } from 'vue';
import ElementPlus, { ElDialog } from 'element-plus';
import DealResultDialog from './DealResultDialog.vue';
import { useGameStore } from '../store/game';
import { parseHand } from '../testing/testUtils';
import type { CardPlay, Trick } from '../models/gameState';

/** 测试只验证折叠/展开结构，不启动真实 DDS Worker */
const DdAnalysisPanelStub = defineComponent({
  name: 'DdAnalysisPanel',
  props: {
    showHeader: { type: Boolean, default: true },
  },
  setup(props) {
    return () =>
      h('section', {
        class: 'dd-analysis',
        'data-show-header': String(props.showHeader),
      });
  },
});

async function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useGameStore();
  store.startNewGame({ autoStart: false, seed: 41 });
  store.phase = 'scoring';
  store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
  store.biddingHistory = [
    { position: 'W', call: { type: 'bid', level: 1, suit: 'H' } },
    { position: 'N', call: { type: 'bid', level: 1, suit: 'S' } },
    { position: 'E', call: { type: 'pass' } },
    { position: 'S', call: { type: 'bid', level: 1, suit: 'NT' } },
    { position: 'W', call: { type: 'pass' } },
    { position: 'N', call: { type: 'pass' } },
    { position: 'E', call: { type: 'pass' } },
  ];
  store.score = { NS: 180, EW: 0 };
  store.dealHcp = { NS: 20, EW: 20 };
  const plays: CardPlay[] = [
    { position: 'W', card: parseHand('D3')[0] },
    { position: 'N', card: parseHand('DJ')[0] },
    { position: 'E', card: parseHand('DA')[0] },
    { position: 'S', card: parseHand('D2')[0] },
  ];
  store.tricks = Array.from({ length: 13 }, (_, index): Trick => ({
    plays,
    leader: 'W',
    winner: index < 10 ? 'N' : 'E',
  }));

  const wrapper = mount(DealResultDialog, {
    props: { modelValue: true },
    attachTo: document.body,
    global: {
      plugins: [pinia, ElementPlus],
      stubs: { DdAnalysisPanel: DdAnalysisPanelStub },
    },
  });
  await nextTick();
  await nextTick();
  return { store, wrapper };
}

describe('DealResultDialog 紧凑结果', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('牌型分布使用计分表的小牌面', async () => {
    await setup();
    const root = document.body;
    expect(root.querySelector('.distribution-card .distribution')).not.toBeNull();
    expect(root.querySelectorAll('.distribution-card .rh-tile:not(.rh-suit)')).toHaveLength(52);
    expect(root.querySelector('.distribution-card .hand-diagram')).toBeNull();
  });

  it('开启贴点时明确区分原始分与贴点后的本局点数', async () => {
    const { store } = await setup();
    store.score = { NS: 420, EW: 0 };
    store.dealHcp = { NS: 26, EW: 14 };
    await nextTick();

    const text = document.body.textContent ?? '';
    expect(text).toContain('NS 原始分');
    expect(text).toContain('420');
    expect(text).toContain('本局点数（已贴点）');
    expect(text).toContain('NS +3');
    expect(text).toContain('贴点 EW +6');

    store.setUseHcpAdjust(false);
    await nextTick();
    const plainText = document.body.textContent ?? '';
    expect(plainText).toContain('本局点数（原始 IMP）');
    expect(plainText).toContain('NS +9');
  });

  it('按结果信息、牌型/叫牌、打牌、双明手的顺序排列，双明手默认折叠', async () => {
    await setup();
    const cards = Array.from(document.body.querySelectorAll<HTMLElement>('.result-card'));
    expect(cards[0].classList.contains('result-summary')).toBe(true);
    expect(cards.some((card) => card.classList.contains('distribution-card'))).toBe(true);
    expect(cards.some((card) => card.classList.contains('bidding-card'))).toBe(true);
    expect(cards.some((card) => card.classList.contains('play-card-panel'))).toBe(true);
    expect(cards[cards.length - 1].classList.contains('dd-card')).toBe(true);

    expect(document.body.querySelector('.dd-analysis')).toBeNull();
    const toggle = document.body.querySelector<HTMLButtonElement>('.dd-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');

    toggle!.click();
    await nextTick();
    await nextTick();
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
    const panel = document.body.querySelector('.dd-analysis');
    expect(panel).not.toBeNull();
    // 外部分栏已经提供标题，内部不再重复标题行
    expect(panel!.getAttribute('data-show-header')).toBe('false');
  });

  it('拖动或误点遮罩不会关闭结果窗口', async () => {
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

  it('打牌过程使用文字牌名，不显示实际牌图标', async () => {
    await setup();
    const panel = document.body.querySelector<HTMLElement>('.play-card-panel');
    expect(panel).not.toBeNull();
    expect(panel!.querySelector('.playing-card')).toBeNull();
    expect(
      Array.from(panel!.querySelectorAll('.play-table thead th')).map((cell) => cell.textContent?.trim()),
    ).toEqual(['西', '北', '东', '南', '西', '北', '东']);
    expect(panel!.querySelector('.play-table tbody')?.textContent).toContain('♦3');
    expect(panel!.querySelector('.play-table tbody')?.textContent).toContain('♦J');
  });
});
