<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '../store/game';
import { isCallLegal } from '../core/bidding/validator';
import type { BidCall, BidSuit } from '../models/gameState';

const store = useGameStore();

const LEVELS = [1, 2, 3, 4, 5, 6, 7];
const SUITS: BidSuit[] = ['C', 'D', 'H', 'S', 'NT'];
const SUIT_SYMBOL: Record<BidSuit, string> = { C: '♣', D: '♦', H: '♥', S: '♠', NT: 'NT' };
const RED_SUITS = new Set<BidSuit>(['D', 'H']);

const isBidding = computed(() => store.phase === 'bidding');
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
  <div v-if="isBidding || store.phase === 'scoring'" class="panel bidding-box">
    <h3>叫牌面板 <span v-if="store.isAiThinking" class="thinking">AI 思考中…</span></h3>

    <div v-if="isBidding" class="box" :class="{ 'no-events': store.isAiThinking || !isHumanTurn }">
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

    <div v-else class="flow-notice">
      <h4 class="result-title">本局结果</h4>
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
    </div>
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
  margin: 4px 0 0;
  font-size: 12px;
  color: #6b5200;
}
.result-points strong {
  color: #14563a;
}
</style>
