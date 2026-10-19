<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGameStore, describeContract } from '../store/game';
import type { CardPlay, Position } from '../models/gameState';
import { cardLabel, getSuit, isRedSuit } from '../models/card';
import Hand from './Hand.vue';
import BidHistory from './BidHistory.vue';

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

/** 定约文案：未成约前不显示“流局”，用灰色占位避免误导 */
const contractDisplay = computed(() => {
  if (store.contract) return { text: describeContract(store.contract), pending: false };
  if (store.phase === 'scoring') return { text: '流局', pending: false };
  return { text: '尚未定约', pending: true };
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
  text: string;
  red: boolean;
}

function slotInfo(pos: Position): SlotInfo {
  const card = boardTrick.value.plays.find((p) => p.position === pos)?.card ?? null;
  return {
    card,
    text: card === null ? '' : cardLabel(card),
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

    <!-- 中央：叫牌时显示叫牌过程，打牌时显示四家方向的出牌 -->
    <div class="center">
      <div class="center-top">
        <span class="contract" :class="{ pending: contractDisplay.pending }">{{ contractDisplay.text }}</span>
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

      <BidHistory v-if="store.phase === 'bidding'" class="center-bid-history" />

      <div v-else-if="store.phase !== 'idle'" class="trick-board" :class="{ 'is-last': boardTrick.isLast }">
        <div
          v-for="pos in POSITIONS"
          :key="pos"
          class="trick-slot"
          :class="[`slot-${pos}`, { active: isSlotActive(pos), winner: boardTrick.winner === pos }]"
        >
          <span class="slot-seat">{{ pos }}</span>
          <span v-if="slotInfo(pos).card !== null" class="board-card" :class="{ red: slotInfo(pos).red }">
            {{ slotInfo(pos).text }}
          </span>
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
  grid-template-rows: auto minmax(280px, auto) auto;
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
  min-height: 280px;
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
.contract.pending,
.trick-label.pending {
  color: #9aa7a0;
  font-weight: 500;
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
.last-trick-btn:hover {
  background: #eef4ef;
}
.last-trick-btn.on {
  background: #14563a;
  color: #fff;
  border-color: #14563a;
}
.center-bid-history {
  flex: 1;
  min-height: 0;
}
.center-idle {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.trick-board {
  flex: 1;
  display: grid;
  grid-template-areas:
    '. north .'
    'west center east'
    '. south .';
  grid-template-columns: minmax(70px, 1fr) minmax(110px, 1.2fr) minmax(70px, 1fr);
  grid-template-rows: repeat(3, minmax(58px, 1fr));
  gap: 6px;
  min-height: 240px;
}
.trick-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: 1px dashed #c9d6cf;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.5);
  padding: 4px;
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
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
  border-color: #d9a300;
  background: #fff8e2;
  box-shadow: 0 0 0 2px rgba(217, 163, 0, 0.35);
}
.trick-slot.winner {
  border-color: #d9a300;
  background: #fff8e2;
  box-shadow: 0 0 0 2px rgba(217, 163, 0, 0.4);
}
.slot-seat {
  font-size: 10px;
  font-weight: 700;
  color: #8a9790;
}
.board-card {
  min-width: 52px;
  min-height: 64px;
  border: 2px solid #14563a;
  border-radius: 7px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  font-size: 18px;
  font-weight: 700;
  color: #1c2b22;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.18);
}
.board-card.red {
  color: #c0392b;
}
.slot-empty {
  color: #c9d6cf;
  font-size: 20px;
  line-height: 1;
}
.trick-center {
  grid-area: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: 10px;
  background: rgba(20, 86, 58, 0.06);
  border: 1px solid #d6ded9;
  padding: 8px;
  text-align: center;
}
.board-label {
  font-weight: 700;
  color: #14563a;
  font-size: 14px;
}
.board-note {
  font-size: 11px;
  color: #8a9790;
}
.winner-tag {
  font-size: 12px;
  color: #8a5a00;
  font-weight: 600;
}
.muted {
  color: #9aa7a0;
}
</style>
