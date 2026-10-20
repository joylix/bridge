<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { describeCall, useGameStore } from '../store/game';
import { isCallLegal } from '../core/bidding/validator';
import type { BidCall, BidSuit } from '../models/gameState';
import { getSavedBiddingPopupPosition, saveBiddingPopupPosition } from './biddingPopupPosition';

const store = useGameStore();

const LEVELS = [1, 2, 3, 4, 5, 6, 7];
const SUITS: BidSuit[] = ['C', 'D', 'H', 'S', 'NT'];
const SUIT_SYMBOL: Record<BidSuit, string> = { C: '♣', D: '♦', H: '♥', S: '♠', NT: 'NT' };
const RED_SUITS = new Set<BidSuit>(['D', 'H']);

const isHumanTurn = computed(
  () => store.phase === 'bidding' && store.isHumanControlled(store.currentBidder),
);

/** 叫牌卡当前选中的叫品；点击“确认”后才真正提交 */
const selectedCall = ref<BidCall | null>(null);
/** “确认+提醒”可附带的提醒说明 */
const alertText = ref('');

/** 回合或阶段变化后清空选择，避免把旧叫品带到下一手 */
watch(
  [() => store.currentBidder, () => store.phase, () => store.isAiThinking],
  () => {
    selectedCall.value = null;
  },
);

/** 是否应禁用某按钮：AI 思考中 / 非人类回合 / 叫品不合法 */
function isDisabled(call: BidCall): boolean {
  if (store.isAiThinking || !isHumanTurn.value) return true;
  return !isCallLegal(store.biddingHistory, store.currentBid, store.currentBidder, call);
}

function sameCall(a: BidCall, b: BidCall): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'bid' && b.type === 'bid') return a.level === b.level && a.suit === b.suit;
  return true;
}

function isSelected(call: BidCall): boolean {
  return selectedCall.value !== null && sameCall(selectedCall.value, call);
}

function selectBid(level: number, suit: BidSuit): void {
  selectedCall.value = { type: 'bid', level, suit };
}

/** 双击叫牌卡：直接提交，无需再点确认 */
function submitImmediately(call: BidCall): void {
  if (isDisabled(call)) return;
  selectedCall.value = null;
  void store.humanBid(call);
}

function bidImmediately(level: number, suit: BidSuit): void {
  submitImmediately({ type: 'bid', level, suit });
}

function specialImmediately(type: 'pass' | 'double' | 'redouble'): void {
  submitImmediately({ type });
}

function selectSimple(type: 'pass' | 'double' | 'redouble'): void {
  selectedCall.value = { type };
}

const confirmDisabled = computed(() => {
  const call = selectedCall.value;
  if (!call) return true;
  return isDisabled(call);
});

function confirmBid(withAlert = false): void {
  const call = selectedCall.value;
  if (!call || isDisabled(call)) return;

  if (withAlert) {
    const detail = alertText.value ? `${describeCall(call)}（${alertText.value}）` : describeCall(call);
    ElMessage({ message: `已提醒：${detail}`, type: 'info', duration: 1600 });
  }

  selectedCall.value = null;
  void store.humanBid(call);
}

/* ---------------------------------------------------------------- *
 * 可拖动弹出窗口
 * ---------------------------------------------------------------- */
const popupRef = ref<HTMLElement | null>(null);
const position = ref(getSavedBiddingPopupPosition() ?? { x: 16, y: 80 });
const dragging = ref(false);
let dragOrigin = { pointerX: 0, pointerY: 0, left: 0, top: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function moveDrag(event: PointerEvent): void {
  const rect = popupRef.value?.getBoundingClientRect();
  const width = rect?.width || 260;
  const height = rect?.height || 360;
  const next = {
    x: clamp(dragOrigin.left + event.clientX - dragOrigin.pointerX, 8, window.innerWidth - width - 8),
    y: clamp(dragOrigin.top + event.clientY - dragOrigin.pointerY, 8, window.innerHeight - height - 8),
  };
  position.value = next;
  saveBiddingPopupPosition(next);
}

function stopDrag(): void {
  dragging.value = false;
  window.removeEventListener('pointermove', moveDrag);
  window.removeEventListener('pointerup', stopDrag);
}

function startDrag(event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  dragging.value = true;
  dragOrigin = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    left: position.value.x,
    top: position.value.y,
  };
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', stopDrag);
}

onMounted(() => {
  const width = popupRef.value?.offsetWidth || 260;
  const height = popupRef.value?.offsetHeight || 360;
  const maxX = window.innerWidth - width - 8;
  const maxY = window.innerHeight - height - 8;
  const saved = getSavedBiddingPopupPosition();
  position.value = saved
    ? {
        x: clamp(saved.x, 8, maxX),
        y: clamp(saved.y, 8, maxY),
      }
    : {
        x: Math.max(12, window.innerWidth - width - 24),
        y: 84,
      };
  saveBiddingPopupPosition(position.value);
});

onBeforeUnmount(stopDrag);
</script>

<template>
  <div
    ref="popupRef"
    class="bidding-popup"
    role="dialog"
    aria-label="叫牌"
    :style="{ left: `${position.x}px`, top: `${position.y}px` }"
  >
    <div class="popup-bar" :class="{ dragging }" @pointerdown="startDrag">
      <strong>叫牌 · {{ store.currentBidder }}</strong>
      <span>拖动移动</span>
    </div>

    <div class="bidding-card">
      <div class="bid-grid">
        <div v-for="level in LEVELS" :key="level" class="level-row">
          <button
            v-for="suit in SUITS"
            :key="suit"
            type="button"
            class="bid-btn"
            :class="{
              red: RED_SUITS.has(suit),
              nt: suit === 'NT',
              selected: isSelected({ type: 'bid', level, suit }),
            }"
            :data-level="level"
            :data-suit="suit"
            :disabled="isDisabled({ type: 'bid', level, suit })"
            @click="selectBid(level, suit)"
            @dblclick="bidImmediately(level, suit)"
          >
            <span class="bid-level">{{ level }}</span>
            <span class="bid-suit" :class="{ red: RED_SUITS.has(suit), nt: suit === 'NT' }">
              {{ SUIT_SYMBOL[suit] }}
            </span>
          </button>
        </div>
      </div>

      <select v-model="alertText" class="bid-combo" :disabled="!isHumanTurn" aria-label="提醒内容（可选）">
        <option value=""></option>
        <option value="约定叫">约定叫</option>
        <option value="问叫">问叫</option>
        <option value="转移叫">转移叫</option>
        <option value="阻击叫">阻击叫</option>
      </select>

      <div class="special-row">
        <button
          type="button"
          class="special-btn x"
          :class="{ selected: isSelected({ type: 'double' }) }"
          :disabled="isDisabled({ type: 'double' })"
          @click="selectSimple('double')"
          @dblclick="specialImmediately('double')"
        >X</button>
        <button
          type="button"
          class="special-btn xx"
          :class="{ selected: isSelected({ type: 'redouble' }) }"
          :disabled="isDisabled({ type: 'redouble' })"
          @click="selectSimple('redouble')"
          @dblclick="specialImmediately('redouble')"
        >XX</button>
        <button
          type="button"
          class="special-btn pass"
          :class="{ selected: isSelected({ type: 'pass' }) }"
          :disabled="isDisabled({ type: 'pass' })"
          @click="selectSimple('pass')"
          @dblclick="specialImmediately('pass')"
        >Pass</button>
      </div>

      <div class="confirm-row">
        <button type="button" class="confirm-btn" :disabled="confirmDisabled" @click="confirmBid(false)">
          确认
        </button>
        <button type="button" class="confirm-btn" :disabled="confirmDisabled" @click="confirmBid(true)">
          确认+提醒
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bidding-popup {
  position: fixed;
  z-index: 4000;
  width: 260px;
  padding: 0 6px 6px;
  border: 1px solid #5f6c63;
  border-radius: 6px;
  background: #ededed;
  box-shadow:
    inset 0 0 0 1px #f8f8f8,
    0 10px 28px rgba(0, 0, 0, 0.42);
  color: #000;
  user-select: none;
}
.popup-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 -6px 5px;
  padding: 5px 8px;
  border-radius: 5px 5px 0 0;
  background: linear-gradient(180deg, #1d6d49, #12482f);
  color: #eaf5ee;
  font-size: 11px;
  cursor: move;
  touch-action: none;
}
.popup-bar strong {
  font-size: 12px;
  letter-spacing: 0.04em;
}
.popup-bar span {
  color: rgba(234, 245, 238, 0.62);
  font-size: 10px;
}
.popup-bar.dragging {
  cursor: grabbing;
}

/* —— 叫牌卡：按 image/叫牌卡.png 的紧凑样式 —— */
.bidding-card {
  width: 100%;
  padding: 4px 0 0;
  color: #000;
}
.bid-grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.level-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 2px;
}
.bid-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 1px;
  height: 20px;
  min-width: 0;
  padding: 0 2px;
  border: 1px solid #858585;
  border-radius: 0;
  background: #ffff99;
  box-shadow:
    inset 1px 1px 0 rgba(255, 255, 255, 0.7),
    inset -1px -1px 0 rgba(120, 120, 120, 0.24);
  color: #000;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}
.bid-btn:hover:not(:disabled) {
  background: #ffffc4;
}
.bid-btn.selected {
  background: #fff36b;
  box-shadow:
    inset 0 0 0 2px #111,
    inset 1px 1px 0 rgba(255, 255, 255, 0.7);
}
.bid-btn:disabled {
  border-color: #b0b0b0;
  background: #d8d8d8;
  box-shadow: none;
  color: #8f8f8f;
  cursor: not-allowed;
}
.bid-level {
  font-size: 11px;
  line-height: 1;
}
.bid-suit {
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
}
.bid-suit.red {
  color: #d00000;
}
.bid-suit.nt {
  font-size: 9px;
  letter-spacing: -0.4px;
}
.bid-btn:disabled .bid-level,
.bid-btn:disabled .bid-suit {
  color: #8f8f8f;
}
.bid-combo {
  width: 100%;
  height: 20px;
  margin: 3px 0 2px;
  padding: 0 2px;
  border: 1px solid #7e7e7e;
  border-radius: 0;
  background: #fff;
  color: #000;
  font-family: inherit;
  font-size: 10px;
}
.bid-combo:disabled {
  color: #8f8f8f;
  background: #f2f2f2;
}
.special-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px;
}
.special-btn {
  height: 20px;
  min-width: 0;
  padding: 0;
  border: 1px solid #858585;
  border-radius: 0;
  background: #ffff99;
  box-shadow:
    inset 1px 1px 0 rgba(255, 255, 255, 0.7),
    inset -1px -1px 0 rgba(120, 120, 120, 0.24);
  color: #000;
  font-family: inherit;
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
}
.special-btn.x {
  color: #d00000;
}
.special-btn.pass {
  color: #008000;
}
.special-btn:hover:not(:disabled) {
  background: #ffffc4;
}
.special-btn.selected {
  background: #fff36b;
  box-shadow:
    inset 0 0 0 2px #111,
    inset 1px 1px 0 rgba(255, 255, 255, 0.7);
}
.special-btn:disabled {
  border-color: #b0b0b0;
  background: #d8d8d8;
  box-shadow: none;
  color: #8f8f8f;
  cursor: not-allowed;
}
.confirm-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  margin-top: 2px;
}
.confirm-btn {
  height: 20px;
  min-width: 0;
  padding: 0;
  border: 1px solid #858585;
  border-radius: 0;
  background: #ffff99;
  box-shadow:
    inset 1px 1px 0 rgba(255, 255, 255, 0.7),
    inset -1px -1px 0 rgba(120, 120, 120, 0.24);
  color: #000;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}
.confirm-btn:hover:not(:disabled) {
  background: #ffffc4;
}
.confirm-btn:disabled {
  border-color: #b0b0a8;
  background: #e6e6b8;
  box-shadow: none;
  color: #8a8a6a;
  cursor: not-allowed;
}
</style>
