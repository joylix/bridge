<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGameStore } from '../store/game';
import type { CardPlay, Position } from '../models/gameState';
import { getSuit, isRedSuit } from '../models/card';
import Hand from './Hand.vue';
import BidHistory from './BidHistory.vue';
import ContractDisplay from './ContractDisplay.vue';
import PlayingCard from './PlayingCard.vue';

const store = useGameStore();

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

/** 该座位本轮是否已经出牌（手牌旁的小提示） */
function playedCardOf(pos: Position): number | null {
  return store.currentTrick.find((p) => p.position === pos)?.card ?? null;
}

function isDummySeat(pos: Position): boolean {
  return !!store.contract && store.contract.dummy === pos;
}

function onCardClick(pos: Position, card: number): void {
  if (store.nextPlayer === pos) void store.humanPlay(card);
}

const declarerTricks = computed(() => store.declarerTricksWon());

/** 定约占位：未成约前不显示“流局”，用灰色占位避免误导 */
const contractDisplay = computed(() => {
  if (store.contract) return { emptyText: '', pending: false };
  if (store.phase === 'scoring') return { emptyText: '流局', pending: false };
  return { emptyText: '尚未定约', pending: true };
});

/** 出牌阶段文案：未进入打牌前只显示灰色占位 */
const playStatus = computed(() => {
  if (store.phase === 'idle' || store.phase === 'bidding') {
    return { text: '尚未开始出牌', pending: true };
  }
  if (store.phase === 'scoring') return { text: '本局结束', pending: false };
  if (store.currentTrick.length) return { text: `第 ${store.tricks.length + 1} 墩`, pending: false };
  if (store.tricks.length) return { text: '等待出牌', pending: false };
  return { text: '等待首攻', pending: false };
});

/** 上一墩（最近一次完成的墩） */
const lastTrick = computed(() => (store.tricks.length ? store.tricks[store.tricks.length - 1] : null));
const lastTrickVisible = ref(false);

/** 新一墩开始后自动回到“本轮”视图 */
watch(
  () => store.currentTrick.length,
  (length) => {
    if (length === 1) lastTrickVisible.value = false;
  },
);

/** 中央牌桌当前展示的墩：本轮优先；本轮为空时自动展示上一墩 */
interface BoardTrick {
  plays: CardPlay[];
  label: string;
  winner: Position | null;
  isLast: boolean;
}

const boardTrick = computed<BoardTrick>(() => {
  if (store.currentTrick.length > 0 && !lastTrickVisible.value) {
    return {
      plays: store.currentTrick,
      label: `第 ${store.tricks.length + 1} 墩`,
      winner: null,
      isLast: false,
    };
  }
  if (lastTrick.value) {
    return {
      plays: lastTrick.value.plays,
      label: `上一墩 · 第 ${store.tricks.length} 墩`,
      winner: lastTrick.value.winner,
      isLast: true,
    };
  }
  return {
    plays: [],
    label: playStatus.value.text,
    winner: null,
    isLast: false,
  };
});

/** 只有本轮正在进行时，才需要“看上一墩”切换 */
const canReviewLast = computed(() => store.currentTrick.length > 0 && !!lastTrick.value);

function toggleLastTrick(): void {
  if (canReviewLast.value) lastTrickVisible.value = !lastTrickVisible.value;
}

interface SlotInfo {
  card: number | null;
  red: boolean;
}

function slotInfo(pos: Position): SlotInfo {
  const card = boardTrick.value.plays.find((p) => p.position === pos)?.card ?? null;
  return {
    card,
    red: card !== null && isRedSuit(getSuit(card)),
  };
}

function isSlotActive(pos: Position): boolean {
  if (boardTrick.value.isLast) return false;
  return (
    (store.phase === 'play' || store.phase === 'play_waiting_lead') && store.nextPlayer === pos
  );
}

const POSITIONS: Position[] = ['N', 'E', 'S', 'W'];
</script>

<template>
  <div class="table">
    <!-- 北家 -->
    <div class="seat north" :class="{ active: isActive('N') }">
      <div class="seat-profile">
        <span class="seat-name">北N_机器人</span>
        <span v-if="isDummySeat('N')" class="dummy-tag">明手</span>
      </div>
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
    <div class="seat west" :class="{ active: isActive('W') }">
      <div class="seat-profile">
        <span class="seat-name">西W_机器人</span>
        <span v-if="isDummySeat('W')" class="dummy-tag">明手</span>
      </div>
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

    <!-- 中央：叫牌时显示叫牌过程，打牌时显示四家方向的出牌 -->
    <div class="center">
      <div class="center-top">
        <ContractDisplay
          class="contract"
          :class="{ pending: contractDisplay.pending }"
          :contract="store.contract"
          :empty-text="contractDisplay.emptyText"
        />
        <span class="trick-label" :class="{ pending: playStatus.pending }">{{ playStatus.text }}</span>
        <button
          v-if="canReviewLast"
          type="button"
          class="last-trick-btn"
          :class="{ on: lastTrickVisible }"
          @click="toggleLastTrick"
        >{{ lastTrickVisible ? '看本轮' : '看上一墩' }}</button>
        <span v-if="store.contract" class="tricks-won">定约方 {{ declarerTricks }} 墩</span>
      </div>

      <BidHistory v-if="store.phase === 'bidding'" class="center-bid-history" variant="table" />

      <div v-else-if="store.phase !== 'idle'" class="trick-board" :class="{ 'is-last': boardTrick.isLast }">
        <div
          v-for="pos in POSITIONS"
          :key="pos"
          class="trick-slot"
          :class="[`slot-${pos}`, { active: isSlotActive(pos), winner: boardTrick.winner === pos }]"
        >
          <span class="slot-seat">{{ pos }}</span>
          <PlayingCard
            v-if="slotInfo(pos).card !== null"
            class="board-card"
            :card="slotInfo(pos).card"
            size="lg"
            label-mode="suit-first"
          />
          <span v-else class="slot-empty">·</span>
        </div>

        <div class="trick-center">
          <span class="board-label">{{ boardTrick.label }}</span>
          <span v-if="boardTrick.winner" class="winner-tag">赢家 {{ boardTrick.winner }}</span>
          <span v-else-if="boardTrick.plays.length === 0" class="board-note">等待出牌</span>
        </div>
      </div>

      <div v-else class="muted center-idle">等待开始</div>
    </div>

    <!-- 东家 -->
    <div class="seat east" :class="{ active: isActive('E') }">
      <div class="seat-profile">
        <span class="seat-name">东E_机器人</span>
        <span v-if="isDummySeat('E')" class="dummy-tag">明手</span>
      </div>
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
    <div class="seat south" :class="{ active: isActive('S') }">
      <Hand
        :cards="store.hands.S"
        position="S"
        :face-down="!isFaceUp('S')"
        :is-dummy="isDummySeat('S')"
        :clickable="isClickable('S')"
        :active="isActive('S')"
        :played-card="playedCardOf('S')"
        @card-click="(c) => onCardClick('S', c)"
      />
      <div class="seat-profile">
        <span class="seat-name">南S_你</span>
        <span v-if="isDummySeat('S')" class="dummy-tag">明手</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table {
  position: relative;
  display: grid;
  grid-template-areas:
    'north north north'
    'west center east'
    'south south south';
  grid-template-columns: 250px minmax(0, 1fr) 250px;
  grid-template-rows: auto minmax(320px, 1fr) auto;
  gap: 8px 12px;
  min-height: 640px;
  overflow: hidden;
  background:
    radial-gradient(ellipse at 50% 42%, rgba(72, 167, 112, 0.36), transparent 58%),
    radial-gradient(circle at 50% 12%, #2d8a5d 0%, #1d6d49 42%, #12482f 100%);
  border-radius: 22px;
  padding: 14px;
  border: 3px solid #0b2f21;
  box-shadow:
    inset 0 0 0 2px rgba(255, 235, 180, 0.12),
    inset 0 0 90px rgba(0, 0, 0, 0.38),
    0 18px 40px rgba(0, 0, 0, 0.36);
}
.table::before {
  content: '';
  position: absolute;
  inset: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 50% / 42%;
  pointer-events: none;
}
.seat,
.center {
  position: relative;
  z-index: 1;
}
.north {
  grid-area: north;
  justify-self: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.south {
  grid-area: south;
  justify-self: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.west {
  grid-area: west;
  align-self: center;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.east {
  grid-area: east;
  align-self: center;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.seat-profile {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 2px;
  color: #eaf5ee;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.2;
  white-space: nowrap;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
.seat-name {
  color: inherit;
}
.dummy-tag {
  background: #d9a300;
  color: #2c2200;
  border-radius: 3px;
  padding: 0 4px;
  font-size: 9px;
  font-weight: 700;
  text-shadow: none;
}
.seat.active .seat-profile {
  color: #ffe19a;
  text-shadow:
    0 0 10px rgba(255, 214, 102, 0.7),
    0 1px 3px rgba(0, 0, 0, 0.85);
}
.center {
  grid-area: center;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 320px;
  padding: 8px;
  border-radius: 14px;
  background: rgba(3, 34, 22, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 0 24px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(2px);
}
.center-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 24px;
  padding: 1px 3px 5px;
  font-size: 12px;
  color: #eaf5ee;
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
}
.contract {
  font-weight: 800;
  color: #ffe19a;
  font-size: 15px;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
}
.contract.pending,
.trick-label.pending {
  color: rgba(234, 245, 238, 0.5);
  font-weight: 500;
}
.trick-label {
  color: rgba(234, 245, 238, 0.82);
}
.tricks-won {
  margin-left: auto;
  color: #ffe19a;
  font-weight: 700;
  font-size: 12px;
}
.last-trick-btn {
  padding: 3px 9px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.18);
  font-size: 11px;
  font-weight: 600;
  color: #eaf5ee;
  cursor: pointer;
}
.last-trick-btn:hover {
  background: rgba(255, 255, 255, 0.14);
}
.last-trick-btn.on {
  background: #d9a300;
  color: #2c2200;
  border-color: #ffe19a;
}
/* 叫牌过程按内容高度展示，不随中央区域一起拉高 */
.center-bid-history {
  flex: 0 1 auto;
  min-height: 0;
  max-height: 240px;
  overflow: hidden;
  --bid-scroll-max: 170px;
}
/* 中央叫牌纸压缩为紧凑表格，避免占据过多牌桌空间 */
.center-bid-history :deep(.variant-table) {
  gap: 3px;
  padding: 6px 8px;
  border-radius: 9px;
}
.center-bid-history :deep(.bid-title-row) {
  padding-bottom: 3px;
}
.center-bid-history :deep(.bid-title) {
  font-size: 12px;
}
.center-bid-history :deep(.bid-meta) {
  font-size: 10px;
}
.center-bid-history :deep(.bid-header span) {
  padding: 2px 0;
  font-size: 10px;
}
.center-bid-history :deep(.bid-cell) {
  min-height: 21px;
  padding: 1px 0;
}
.center-bid-history :deep(.bid-level) {
  font-size: 12px;
}
.center-bid-history :deep(.bid-suit) {
  font-size: 18px;
}
.center-bid-history :deep(.bid-suit.nt) {
  font-size: 11px;
}
.center-bid-history :deep(.bid-label) {
  font-size: 11px;
}
.center-idle {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(234, 245, 238, 0.55);
}
.trick-board {
  flex: 1;
  display: grid;
  grid-template-areas:
    '. north .'
    'west center east'
    '. south .';
  grid-template-columns: minmax(84px, 1fr) minmax(130px, 1.1fr) minmax(84px, 1fr);
  grid-template-rows: repeat(3, minmax(86px, 1fr));
  gap: 4px;
  min-height: 280px;
}
.trick-slot {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  padding: 2px;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
.trick-slot.slot-N {
  grid-area: north;
}
.trick-slot.slot-E {
  grid-area: east;
}
.trick-slot.slot-S {
  grid-area: south;
}
.trick-slot.slot-W {
  grid-area: west;
}
.trick-slot.active {
  background: radial-gradient(circle, rgba(255, 214, 102, 0.18), transparent 68%);
}
.trick-slot.winner {
  background: radial-gradient(circle, rgba(255, 214, 102, 0.24), transparent 70%);
}
.slot-seat {
  position: absolute;
  top: 2px;
  left: 5px;
  z-index: 2;
  min-width: 17px;
  padding: 0 4px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.24);
  color: rgba(234, 245, 238, 0.7);
  font-size: 9px;
  font-weight: 700;
  text-align: center;
}
.trick-slot.active .slot-seat,
.trick-slot.winner .slot-seat {
  background: #d9a300;
  color: #2c2200;
}
.board-card {
  filter: drop-shadow(0 5px 7px rgba(0, 0, 0, 0.32));
}
.trick-slot.active .board-card {
  outline: 2px solid rgba(255, 214, 102, 0.8);
  outline-offset: 1px;
}
.trick-slot.winner .board-card {
  outline: 2px solid #ffe19a;
  outline-offset: 2px;
}
.slot-empty {
  color: rgba(234, 245, 238, 0.22);
  font-size: 22px;
  line-height: 1;
}
.trick-center {
  grid-area: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0, 0, 0, 0.28), rgba(0, 0, 0, 0.1) 68%, transparent 72%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 8px;
  text-align: center;
}
.board-label {
  font-weight: 700;
  color: #eaf5ee;
  font-size: 13px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
}
.board-note {
  font-size: 10px;
  color: rgba(234, 245, 238, 0.55);
}
.winner-tag {
  font-size: 11px;
  color: #2c2200;
  background: #ffe19a;
  border-radius: 999px;
  padding: 1px 7px;
  font-weight: 700;
}
.muted {
  color: rgba(234, 245, 238, 0.55);
}
:deep(.contract .suit.red) {
  color: #ff8b7d;
}

@media (max-width: 900px) {
  .table {
    grid-template-columns: 220px minmax(0, 1fr) 220px;
    grid-template-rows: auto minmax(300px, 1fr) auto;
    min-height: 600px;
    padding: 10px;
    gap: 6px;
  }
  .trick-board {
    grid-template-columns: 76px minmax(112px, 1fr) 76px;
    grid-template-rows: repeat(3, minmax(80px, 1fr));
    min-height: 270px;
  }
  .center {
    min-height: 300px;
    padding: 6px;
  }
  .center-bid-history {
    max-height: 220px;
    --bid-scroll-max: 150px;
  }
}

@media (max-width: 720px) {
  .table {
    grid-template-areas:
      'north'
      'west'
      'center'
      'east'
      'south';
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto;
    min-height: 0;
    border-radius: 16px;
  }
  .west,
  .east {
    align-self: auto;
    align-items: center;
  }
  .center {
    min-height: 300px;
  }
}
</style>
