<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGameStore, describeContract } from '../store/game';
import { isCallLegal } from '../core/bidding/validator';
import type { BidCall, BidSuit } from '../models/gameState';
import BidHistory from './BidHistory.vue';
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

const finalContractText = computed(() => (store.contract ? describeContract(store.contract) : '流局'));

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
watch(
  () => store.phase,
  (phase, previous) => {
    if (phase === 'scoring' && previous !== 'scoring') resultVisible.value = true;
  },
  { immediate: true },
);
watch(
  () => store.gamesPlayed,
  () => {
    resultVisible.value = false;
  },
);

/** 是否应禁用某按钮：AI 思考中 / 非人类回合 / 叫品不合法 */
function isDisabled(call: BidCall): boolean {
  if (store.isAiThinking || !isHumanTurn.value) return true;
  return !isCallLegal(store.biddingHistory, store.currentBid, store.currentBidder, call);
}

function makeBid(level: number, suit: BidSuit): void {
  void store.humanBid({ type: 'bid', level, suit });
}

function makeSimple(type: 'pass' | 'double' | 'redouble'): void {
  void store.humanBid({ type });
}
</script>

<template>
  <div class="panel bidding-box">
    <h3>
      {{ isBidding ? '叫牌面板' : '本局信息' }}
      <span v-if="store.isAiThinking" class="thinking">AI 思考中…</span>
    </h3>

    <template v-if="isBidding">
      <div class="box" :class="{ 'no-events': store.isAiThinking || !isHumanTurn }">
        <div class="grid">
          <div class="row head">
            <span class="row-head" />
            <span v-for="level in LEVELS" :key="level" class="col-head">{{ level }}</span>
          </div>
          <div v-for="suit in SUITS" :key="suit" class="row">
            <span class="row-head" :class="{ red: RED_SUITS.has(suit) }">{{ SUIT_SYMBOL[suit] }}</span>
            <button
              v-for="level in LEVELS"
              :key="level"
              type="button"
              class="bid-btn"
              :class="{ red: RED_SUITS.has(suit) }"
              :disabled="isDisabled({ type: 'bid', level, suit })"
              @click="makeBid(level, suit)"
            >{{ level }}</button>
          </div>
        </div>

        <div class="special">
          <button
            type="button"
            class="bid-btn pass"
            :disabled="isDisabled({ type: 'pass' })"
            @click="makeSimple('pass')"
          >Pass</button>
          <button
            type="button"
            class="bid-btn dbl"
            :disabled="isDisabled({ type: 'double' })"
            @click="makeSimple('double')"
          >加倍</button>
          <button
            type="button"
            class="bid-btn rdbl"
            :disabled="isDisabled({ type: 'redouble' })"
            @click="makeSimple('redouble')"
          >再加倍</button>
        </div>

        <p class="hint">
          {{ isHumanTurn ? '轮到你叫牌（可自由诈叫，仅受法律约束）' : '等待其他玩家叫牌…' }}
        </p>
      </div>
    </template>

    <template v-else-if="showBidHistory">
      <BidHistory class="side-bid-history" />

      <div v-if="store.phase === 'scoring'" class="flow-notice">
        <h4 class="result-title">最终结果</h4>
        <div class="final-hero">
          <strong class="final-contract">{{ finalContractText }}</strong>
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

    <DealResultDialog v-model="resultVisible" />
  </div>
</template>

<style scoped>
.bidding-box {
  width: 100%;
}
.thinking {
  font-size: 11px;
  color: #c0392b;
  font-weight: 400;
}
.box.no-events {
  pointer-events: none;
  opacity: 0.6;
}
.grid {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.row {
  display: grid;
  grid-template-columns: 24px repeat(7, 1fr);
  gap: 3px;
  align-items: center;
}
.row-head {
  font-size: 16px;
  line-height: 1.2;
  font-weight: 700;
  text-align: center;
  color: #3a4a40;
}
.row-head.red {
  color: #c0392b;
}
.col-head {
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  color: #8a9790;
}
.special {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  margin-top: 6px;
}
.bid-btn {
  padding: 3px 0;
  border: 1px solid #b9c4bd;
  border-radius: 5px;
  background: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  color: #1c2b22;
}
.bid-btn.red {
  color: #c0392b;
}
.bid-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.bid-btn.pass {
  background: #e8f1ea;
  font-size: 12px;
  padding: 4px 0;
}
.bid-btn.dbl {
  background: #fdecea;
  color: #c0392b;
  padding: 4px 0;
  font-size: 12px;
}
.bid-btn.rdbl {
  background: #fff4d6;
  color: #8a5a00;
  padding: 4px 0;
  font-size: 12px;
}
.hint {
  font-size: 11px;
  color: #6a7770;
  margin: 6px 0 0;
}
.side-bid-history {
  margin-bottom: 8px;
}
.flow-notice {
  font-size: 13px;
  color: #6b5200;
  background: #fff6d8;
  border: 1px solid #e6cf7a;
  border-radius: 6px;
  padding: 8px;
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
  border-radius: 4px;
  padding: 1px 6px;
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
