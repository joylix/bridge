<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGameStore, describeCall, describeContract, suitName } from '../store/game';
import type { BidRecord, Position } from '../models/gameState';
import { getSuit, isRedSuit, rankName, suitSymbol } from '../models/card';
import Hand from './Hand.vue';

const store = useGameStore();

const COLUMNS: Position[] = ['N', 'E', 'S', 'W'];

/** 手牌是否摊开（明）：人类自己的座位恒可见；首攻后明手与人类控制的牌可见 */
function isFaceUp(pos: Position): boolean {
  if (store.humanSeats.includes(pos)) return true;
  if (!store.dummyOpen || !store.contract) return false;
  // 明手始终摊牌；人类在定约方时还控制庄家，因此庄家的牌也应可见。
  return store.contract.dummy === pos || store.controlledSeats().includes(pos);
}

/** 该座位当前是否可点击（人类控制 + 轮到其行动 + 非 AI 思考中） */
function isClickable(pos: Position): boolean {
  const playing = store.phase === 'play' || store.phase === 'play_waiting_lead';
  return (
    playing &&
    !store.isAiThinking &&
    store.nextPlayer === pos &&
    store.controlledSeats().includes(pos)
  );
}

/** 当前轮到行动的座位（叫牌看 currentBidder，出牌看 nextPlayer） */
function isActive(pos: Position): boolean {
  if (store.phase === 'bidding') return store.currentBidder === pos;
  if (store.phase === 'play' || store.phase === 'play_waiting_lead') return store.nextPlayer === pos;
  return false;
}

/** 本轮该座位已出的牌（尚未出则 null） */
function playedCardOf(pos: Position): number | null {
  return store.currentTrick.find((p) => p.position === pos)?.card ?? null;
}

function isDummySeat(pos: Position): boolean {
  return !!store.contract && store.contract.dummy === pos;
}

function onCardClick(pos: Position, card: number): void {
  if (store.nextPlayer === pos) void store.humanPlay(card);
}

interface BidCell {
  level: string;
  suit: string;
  red: boolean;
  label: string;
}

/** 将叫品拆成“阶数 + 花色符号”，便于单独放大花色符号 */
function toBidCell(rec: BidRecord | null): BidCell | null {
  if (!rec) return null;
  if (rec.call.type === 'bid') {
    return {
      level: String(rec.call.level),
      suit: suitName(rec.call.suit),
      red: rec.call.suit === 'D' || rec.call.suit === 'H',
      label: '',
    };
  }
  return { level: '', suit: '', red: false, label: describeCall(rec.call) };
}

/** 叫牌历史按 4 个一行（N E S W 列）组织 */
const bidRounds = computed<(BidCell | null)[][]>(() => {
  const rows: (BidCell | null)[][] = [];
  store.biddingHistory.forEach((rec, i) => {
    const r = Math.floor(i / 4);
    if (!rows[r]) rows[r] = [null, null, null, null];
    rows[r][COLUMNS.indexOf(rec.position)] = toBidCell(rec);
  });
  return rows;
});

const declarerTricks = computed(() => store.declarerTricksWon());

const currentTrickLabel = computed(() =>
  store.currentTrick.length ? `第 ${store.tricks.length + 1} 墩` : store.tricks.length ? `本墩已结束` : '等待首攻',
);

/** 上一墩（最近一次完成的墩） */
const lastTrick = computed(() => (store.tricks.length ? store.tricks[store.tricks.length - 1] : null));
const lastTrickVisible = ref(false);

function toggleLastTrick(): void {
  lastTrickVisible.value = !lastTrickVisible.value;
}

</script>

<template>
  <div class="table">
    <!-- 北家 -->
    <div class="seat north">
      <Hand
        :cards="store.hands.N"
        position="N"
        :face-down="!isFaceUp('N')"
        :is-dummy="isDummySeat('N')"
        :clickable="isClickable('N')"
        :active="isActive('N')"
        :played-card="playedCardOf('N')"
        @card-click="(c) => onCardClick('N', c)"
      />
    </div>

    <!-- 西家 -->
    <div class="seat west">
      <Hand
        :cards="store.hands.W"
        position="W"
        compact
        :face-down="!isFaceUp('W')"
        :is-dummy="isDummySeat('W')"
        :clickable="isClickable('W')"
        :active="isActive('W')"
        :played-card="playedCardOf('W')"
        @card-click="(c) => onCardClick('W', c)"
      />
    </div>

    <!-- 中央 -->
    <div class="center">
      <div class="center-top">
        <span class="contract">{{ describeContract(store.contract) }}</span>
        <span class="trick-label">{{ currentTrickLabel }}</span>
        <button
          type="button"
          class="last-trick-btn"
          :class="{ on: lastTrickVisible }"
          :disabled="!lastTrick"
          @click="toggleLastTrick"
        >{{ lastTrickVisible ? '隐藏上一墩' : '看上一墩' }}</button>
        <span v-if="store.contract" class="tricks-won">定约方 {{ declarerTricks }} 墩</span>
      </div>

      <div class="current-trick">
        <div v-for="play in store.currentTrick" :key="play.card" class="trick-card">
          <span class="seat-tag">{{ play.position }}</span>
          <span class="mini-card" :class="{ red: isRedSuit(getSuit(play.card)) }">
            {{ rankName(play.card) }}{{ suitSymbol(getSuit(play.card)) }}
          </span>
        </div>
        <div v-if="store.currentTrick.length === 0" class="muted">—</div>
      </div>

      <!-- 上一墩出牌情况 -->
      <div v-if="lastTrickVisible" class="last-trick">
        <div class="last-trick-head">
          <span>上一墩（第 {{ store.tricks.length }} 墩）</span>
          <span class="winner-tag">赢家 {{ lastTrick?.winner }}</span>
        </div>
        <div class="current-trick">
          <div
            v-for="play in lastTrick?.plays ?? []"
            :key="play.card"
            class="trick-card"
            :class="{ 'is-winner': play.position === lastTrick?.winner }"
          >
            <span class="seat-tag">{{ play.position }}</span>
            <span class="mini-card" :class="{ red: isRedSuit(getSuit(play.card)) }">
              {{ rankName(play.card) }}{{ suitSymbol(getSuit(play.card)) }}
            </span>
          </div>
          <div v-if="!lastTrick" class="muted">尚无已完成的墩</div>
        </div>
      </div>

      <div class="bid-history">
        <div class="bid-header">
          <span v-for="c in COLUMNS" :key="c">{{ c }}</span>
        </div>
        <div v-for="(row, i) in bidRounds" :key="i" class="bid-row">
          <span v-for="(cell, j) in row" :key="j" class="bid-cell">
            <template v-if="cell">
              <template v-if="cell.suit">
                <span class="bid-level">{{ cell.level }}</span>
                <span class="bid-suit" :class="{ red: cell.red, nt: cell.suit === 'NT' }">{{ cell.suit }}</span>
              </template>
              <span v-else class="bid-label">{{ cell.label }}</span>
            </template>
          </span>
        </div>
        <div v-if="bidRounds.length === 0" class="muted">尚未开始叫牌</div>
      </div>

      <div v-if="store.phase === 'scoring'" class="result">
        {{ store.message }}
      </div>
    </div>

    <!-- 东家 -->
    <div class="seat east">
      <Hand
        :cards="store.hands.E"
        position="E"
        compact
        :face-down="!isFaceUp('E')"
        :is-dummy="isDummySeat('E')"
        :clickable="isClickable('E')"
        :active="isActive('E')"
        :played-card="playedCardOf('E')"
        @card-click="(c) => onCardClick('E', c)"
      />
    </div>

    <!-- 南家（人类） -->
    <div class="seat south">
      <Hand
        :cards="store.hands.S"
        position="S"
        label="南 (你)"
        :face-down="!isFaceUp('S')"
        :is-dummy="isDummySeat('S')"
        :clickable="isClickable('S')"
        :active="isActive('S')"
        :played-card="playedCardOf('S')"
        @card-click="(c) => onCardClick('S', c)"
      />
    </div>
  </div>
</template>

<style scoped>
.table {
  display: grid;
  grid-template-areas:
    'north north north'
    'west center east'
    'south south south';
  grid-template-columns: 228px minmax(0, 1fr) 228px;
  grid-template-rows: auto minmax(200px, auto) auto;
  gap: 10px;
  background: linear-gradient(160deg, var(--felt), var(--felt-dark));
  border-radius: 14px;
  padding: 14px;
  border: 2px solid #0d3323;
}
.north {
  grid-area: north;
  justify-self: center;
}
.south {
  grid-area: south;
  justify-self: center;
}
.west {
  grid-area: west;
  align-self: center;
}
.east {
  grid-area: east;
  align-self: center;
}
.center {
  grid-area: center;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 200px;
}
.center-top {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  border-bottom: 1px solid #d6ded9;
  padding-bottom: 6px;
}
.contract {
  font-weight: 700;
  color: #14563a;
}
.trick-label {
  color: #5a6a61;
}
.tricks-won {
  margin-left: auto;
  color: #8a5a00;
  font-weight: 600;
}
.last-trick-btn {
  padding: 2px 8px;
  border: 1px solid #b9c4bd;
  border-radius: 5px;
  background: #fff;
  font-size: 12px;
  font-weight: 600;
  color: #14563a;
  cursor: pointer;
}
.last-trick-btn:hover:enabled {
  background: #eef4ef;
}
.last-trick-btn.on {
  background: #14563a;
  color: #fff;
  border-color: #14563a;
}
.last-trick-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.last-trick {
  border: 1px dashed #c9d6cf;
  border-radius: 8px;
  padding: 6px 8px;
  background: #f6faf7;
}
.last-trick-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #5a6a61;
  margin-bottom: 4px;
}
.winner-tag {
  color: #8a5a00;
  font-weight: 600;
}
.trick-card.is-winner .mini-card {
  border-color: #d9a300;
  background: #fff8e2;
  box-shadow: 0 0 0 2px rgba(217, 163, 0, 0.4);
}
.current-trick {
  display: flex;
  gap: 8px;
  min-height: 40px;
  align-items: center;
  flex-wrap: wrap;
}
.trick-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 11px;
}
.seat-tag {
  color: #6a7770;
  font-size: 10px;
}
.mini-card {
  background: #fff;
  border: 1px solid #b9c4bd;
  border-radius: 4px;
  padding: 2px 6px;
  font-weight: 700;
}
.mini-card.red {
  color: #c0392b;
}
.bid-history {
  flex: 1;
  font-size: 14px;
  overflow: auto;
  max-height: 160px;
}
.bid-header,
.bid-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.bid-header span {
  font-weight: 700;
  color: #8a9790;
  text-align: center;
}
.bid-cell {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 1px;
  padding: 2px 0;
  color: #1c2b22;
}
.bid-level {
  font-size: 13px;
  font-weight: 600;
}
.bid-suit {
  font-size: 19px;
  font-weight: 700;
  line-height: 1;
}
.bid-suit.red {
  color: #c0392b;
}
.bid-suit.nt {
  font-size: 14px;
  letter-spacing: -0.5px;
}
.bid-label {
  font-size: 12px;
  color: #3a4a40;
}
.muted {
  color: #9aa7a0;
}
.result {
  margin-top: 6px;
  padding: 6px 8px;
  background: #fff6d8;
  border: 1px solid #e6cf7a;
  border-radius: 6px;
  font-size: 13px;
  color: #6b5200;
}
</style>
