<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { PLAY_DISPLAY_MS, describeCall, useGameStore } from '../store/game';
import { isCallLegal } from '../core/bidding/validator';
import type { BidCall, BidSuit } from '../models/gameState';
import BidHistory from './BidHistory.vue';
import ContractDisplay from './ContractDisplay.vue';
import DealResultDialog from './DealResultDialog.vue';

const store = useGameStore();

const LEVELS = [1, 2, 3, 4, 5, 6, 7];
const SUITS: BidSuit[] = ['C', 'D', 'H', 'S', 'NT'];
const SUIT_SYMBOL: Record<BidSuit, string> = { C: '♣', D: '♦', H: '♥', S: '♠', NT: 'NT' };
const RED_SUITS = new Set<BidSuit>(['D', 'H']);

const isBidding = computed(() => store.phase === 'bidding');
const showBidHistory = computed(
  () => store.phase === 'play' || store.phase === 'play_waiting_lead' || store.phase === 'scoring',
);
const isHumanTurn = computed(
  () => isBidding.value && store.controlledSeats().includes(store.currentBidder),
);

/** 叫牌卡当前选中的叫品；点击“确认”后才真正提交 */
const selectedCall = ref<BidCall | null>(null);
/** “确认+提醒”可附带的提醒说明 */
const alertText = ref('');

/** 本局点数文案（结算后展示；启用贴点时附上调整量） */
const dealPointsLabel = computed(() => {
  const p = store.pointsSummary.dealPoints;
  const base = p > 0 ? `NS +${p}` : p < 0 ? `EW +${-p}` : '平';
  const adj = store.pointsSummary.dealAdjust;
  if (store.useHcpAdjust && adj !== 0) {
    return `${base}（贴点 ${adj > 0 ? `NS +${adj}` : `EW +${-adj}`}）`;
  }
  return base;
});

const outcomeText = computed(() => {
  if (store.phase !== 'scoring') return '';
  if (!store.contract) return '无定约';
  const need = store.contract.level + 6;
  const won = store.declarerTricksWon();
  const diff = won - need;
  if (diff === 0) return '正好成约';
  if (diff > 0) return `超 ${diff} 墩`;
  return `宕 ${-diff} 墩`;
});

/** 单局详细结果弹窗：结算时自动打开，也可从结果摘要重新打开 */
const resultVisible = ref(false);
/** 结算弹窗延后打开，先让最后一墩牌展示满 1 秒 */
let resultTimer: ReturnType<typeof setTimeout> | null = null;
function clearResultTimer(): void {
  if (resultTimer !== null) {
    clearTimeout(resultTimer);
    resultTimer = null;
  }
}
watch(
  () => store.phase,
  (phase, previous) => {
    clearResultTimer();
    if (phase === 'scoring' && previous !== 'scoring') {
      resultTimer = setTimeout(() => {
        resultTimer = null;
        resultVisible.value = true;
      }, PLAY_DISPLAY_MS);
    }
  },
  { immediate: true },
);
watch(
  () => store.gamesPlayed,
  () => {
    clearResultTimer();
    resultVisible.value = false;
  },
);
onBeforeUnmount(clearResultTimer);

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
</script>

<template>
  <div class="panel bidding-box" :class="{ 'bidding-card': isBidding }">
    <template v-if="isBidding">
      <div class="box-title">叫牌卡</div>

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
    </template>

    <template v-else>
      <h3>
        本局信息
        <span v-if="store.isAiThinking" class="thinking">AI 思考中…</span>
      </h3>

      <template v-if="showBidHistory">
        <BidHistory class="side-bid-history" />

        <div v-if="store.phase === 'scoring'" class="flow-notice">
          <h4 class="result-title">最终结果</h4>
          <div class="final-hero">
            <strong class="final-contract">
              <ContractDisplay :contract="store.contract" empty-text="流局" />
            </strong>
            <span class="final-outcome">{{ outcomeText }}</span>
          </div>
          <div class="final-score">
            <div class="score-side">
              <span class="score-name">NS</span>
              <span class="score-value">{{ store.score.NS }}</span>
            </div>
            <div class="score-side">
              <span class="score-name">EW</span>
              <span class="score-value">{{ store.score.EW }}</span>
            </div>
          </div>
          <p class="result-text">{{ store.message }}</p>
          <p class="result-points">
            本局点数 <strong>{{ dealPointsLabel }}</strong>
            · 本循环总点数差 <strong>{{ store.pointsSummary.roundDiff >= 0 ? '+' : '' }}{{ store.pointsSummary.roundDiff }}</strong>
          </p>
          <el-button size="small" type="primary" @click="resultVisible = true">查看详细结果</el-button>
        </div>
      </template>

      <div v-else class="muted">尚未开始</div>
    </template>

    <DealResultDialog v-model="resultVisible" />
  </div>
</template>

<style scoped>
.bidding-box {
  width: 100%;
  background:
    radial-gradient(circle at 12% 0%, rgba(255, 255, 255, 0.85), transparent 38%),
    linear-gradient(165deg, #fffdf7 0%, #f4eddd 100%);
  border: 1px solid #d7cdb5;
}
.bidding-box h3 {
  color: #14563a;
  border-left-color: #b98a2e;
}
.thinking {
  font-size: 11px;
  color: #c0392b;
  font-weight: 400;
}

/* —— 叫牌卡：按 image/叫牌卡.png 的紧凑样式 —— */
.bidding-card {
  width: 100%;
  max-width: 248px;
  margin: 0 auto;
  padding: 5px 6px 6px;
  border-radius: 1px;
  border: 1px solid #858585;
  background: #ededed;
  box-shadow:
    inset 0 0 0 1px #f8f8f8,
    0 3px 8px rgba(0, 0, 0, 0.22);
  color: #000;
}
.box-title {
  margin: 0 0 4px 1px;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.1;
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

/* —— 打牌/结算阶段保留原来的信息面板样式 —— */
.side-bid-history {
  margin-bottom: 8px;
}
.flow-notice {
  font-size: 13px;
  color: #6b5200;
  background: #fff6d8;
  border: 1px solid #e6cf7a;
  border-radius: 8px;
  padding: 9px;
}
.result-title {
  margin: 0 0 6px;
  font-size: 13px;
  color: #8a5a00;
}
.final-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.final-contract {
  color: #14563a;
  font-size: 16px;
}
.final-outcome {
  font-size: 12px;
  font-weight: 600;
  color: #8a5a00;
  background: #fff;
  border: 1px solid #e6cf7a;
  border-radius: 999px;
  padding: 1px 8px;
}
.final-score {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.score-side {
  text-align: center;
  background: #fff;
  border: 1px solid #e6cf7a;
  border-radius: 6px;
  padding: 4px;
}
.score-name {
  display: block;
  font-size: 11px;
  color: #8a9790;
}
.score-value {
  font-size: 20px;
  font-weight: 700;
  color: #14563a;
}
.result-text {
  margin: 8px 0 0;
  font-size: 12px;
  color: #6b5200;
}
.result-points {
  margin: 4px 0 8px;
  font-size: 12px;
  color: #6b5200;
}
.result-points strong {
  color: #14563a;
}
.muted {
  color: #9aa7a0;
  font-size: 13px;
}
</style>
