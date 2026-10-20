<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGameStore } from '../store/game';
import type { CardPlay, Position } from '../models/gameState';
import { getSuit } from '../models/card';
import { isCardLegal } from '../core/playing';
import Hand from './Hand.vue';
import BidHistory from './BidHistory.vue';
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

function isDummySeat(pos: Position): boolean {
  return !!store.contract && store.contract.dummy === pos;
}

/** 左键选中的牌（再次点击取消）；轮到下一手或新一局时自动清空 */
const selectedCard = ref<number | null>(null);

watch(
  [() => store.nextPlayer, () => store.phase, () => store.gamesPlayed, () => store.isAiThinking],
  () => {
    selectedCard.value = null;
  },
);

/** 当前墩的领出花色；本轮为空时返回 null（首攻/领出） */
function currentLeadSuit() {
  return store.currentTrick.length ? getSuit(store.currentTrick[0].card) : null;
}

/** 该牌是否允许在本轮打出（必须跟出领出花色） */
function isCardPlayable(pos: Position, card: number): boolean {
  return isCardLegal(card, store.hands[pos], currentLeadSuit());
}

function onCardClick(pos: Position, card: number): void {
  if (!isClickable(pos) || store.nextPlayer !== pos) return;
  // 不允许出的牌不弹出、不进入待选状态
  if (!isCardPlayable(pos, card)) return;
  selectedCard.value = selectedCard.value === card ? null : card;
}

/** 右键确认：仅当该牌已用左键选中时才真正出牌 */
function onCardConfirm(pos: Position, card: number): void {
  if (!isClickable(pos) || store.nextPlayer !== pos) return;
  if (!isCardPlayable(pos, card)) return;
  if (selectedCard.value !== card) {
    selectedCard.value = card;
    return;
  }
  selectedCard.value = null;
  void store.humanPlay(card);
}

/** 双击卡牌：跳过“先选中再右键”的步骤，直接出牌 */
function onCardDoubleClick(pos: Position, card: number): void {
  if (!isClickable(pos) || store.nextPlayer !== pos) return;
  if (!isCardPlayable(pos, card)) return;
  selectedCard.value = null;
  void store.humanPlay(card);
}

const declarerTricks = computed(() => store.declarerTricksWon());

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

/** 中央顶部墩序文案：查看上一墩时给出明确提示 */
const trickHeading = computed(() => {
  if (lastTrickVisible.value && lastTrick.value) return `上一墩 · 第 ${store.tricks.length} 墩`;
  return playStatus.value.text;
});

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
  winner: Position | null;
  isLast: boolean;
}

const boardTrick = computed<BoardTrick>(() => {
  if (store.currentTrick.length > 0 && !lastTrickVisible.value) {
    return {
      plays: store.currentTrick,
      winner: null,
      isLast: false,
    };
  }
  if (lastTrick.value) {
    return {
      plays: lastTrick.value.plays,
      winner: lastTrick.value.winner,
      isLast: true,
    };
  }
  return {
    plays: [],
    winner: null,
    isLast: false,
  };
});

/** 只有本轮正在进行时，才需要“看上一墩”切换 */
const canReviewLast = computed(() => store.currentTrick.length > 0 && !!lastTrick.value);

function toggleLastTrick(): void {
  if (canReviewLast.value) lastTrickVisible.value = !lastTrickVisible.value;
}

const isPlaying = computed(() => store.phase === 'play' || store.phase === 'play_waiting_lead');
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
        :selected-card="selectedCard"
        @card-click="(c) => onCardClick('N', c)"
        @card-confirm="(c) => onCardConfirm('N', c)"
        @card-dblclick="(c) => onCardDoubleClick('N', c)"
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
        :face-down="!isFaceUp('W')"
        :is-dummy="isDummySeat('W')"
        :clickable="isClickable('W')"
        :active="isActive('W')"
        :selected-card="selectedCard"
        @card-click="(c) => onCardClick('W', c)"
        @card-confirm="(c) => onCardConfirm('W', c)"
        @card-dblclick="(c) => onCardDoubleClick('W', c)"
      />
    </div>

    <!-- 中央：叫牌时显示叫牌过程，打牌时按出牌次序叠放本墩牌面 -->
    <div class="center">
      <div class="center-top">
        <span class="trick-label" :class="{ pending: playStatus.pending }">{{ trickHeading }}</span>
        <span v-if="boardTrick.winner" class="winner-tag">赢家 {{ boardTrick.winner }}</span>
        <span v-else-if="isPlaying && store.nextPlayer" class="turn-tag">轮到 {{ store.nextPlayer }}</span>
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
        <div v-if="boardTrick.plays.length" class="trick-stack">
          <div
            v-for="(play, index) in boardTrick.plays"
            :key="`${play.position}-${play.card}`"
            class="trick-play"
            :class="[`slot-${play.position}`, { winner: boardTrick.winner === play.position }]"
            :style="{ zIndex: index + 1 }"
          >
            <PlayingCard :card="play.card" size="xxl" label-mode="suit-first" />
            <span class="play-order" aria-hidden="true">{{ index + 1 }}</span>
          </div>
        </div>
        <span v-else class="trick-empty">等待出牌</span>
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
        :face-down="!isFaceUp('E')"
        :is-dummy="isDummySeat('E')"
        :clickable="isClickable('E')"
        :active="isActive('E')"
        :selected-card="selectedCard"
        @card-click="(c) => onCardClick('E', c)"
        @card-confirm="(c) => onCardConfirm('E', c)"
        @card-dblclick="(c) => onCardDoubleClick('E', c)"
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
        :selected-card="selectedCard"
        @card-click="(c) => onCardClick('S', c)"
        @card-confirm="(c) => onCardConfirm('S', c)"
        @card-dblclick="(c) => onCardDoubleClick('S', c)"
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
  grid-template-columns: minmax(0, 1fr) minmax(240px, 280px) minmax(0, 1fr);
  grid-template-rows: auto minmax(290px, 1fr) auto;
  gap: 8px 12px;
  min-height: clamp(620px, calc(100vh - 140px), 920px);
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
  gap: 4px;
  min-height: 290px;
  padding: 6px;
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
  min-height: 22px;
  padding: 1px 3px 4px;
  font-size: 12px;
  color: #eaf5ee;
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
}
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
  max-height: 210px;
  overflow: hidden;
  --bid-scroll-max: 150px;
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
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 252px;
  padding: 8px 0;
}
/* 四家牌保持固定方位，按出牌次序决定叠放层次并标出序号 */
.trick-stack {
  position: relative;
  flex: none;
  width: 240px;
  height: 244px;
}
.trick-play {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 96px;
  height: 134px;
  line-height: 0;
  transform: translate(-50%, -50%);
}
/* 西左、东右，同一水平线；北在上、南在下，同一垂直线 */
.trick-play.slot-W {
  transform: translate(calc(-50% - 64px), -50%);
}
.trick-play.slot-E {
  transform: translate(calc(-50% + 64px), -50%);
}
.trick-play.slot-N {
  transform: translate(-50%, calc(-50% - 48px));
}
.trick-play.slot-S {
  transform: translate(-50%, calc(-50% + 48px));
}
.trick-play.winner :deep(.playing-card) {
  outline: 2px solid #ffe19a;
  outline-offset: 2px;
}
.play-order {
  position: absolute;
  z-index: 2;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: 999px;
  background: #ffe19a;
  color: #2c2200;
  font-size: 10px;
  font-weight: 800;
  line-height: 15px;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
}
/* 序号放在各自外侧且避开牌名所在的角 */
.slot-W .play-order {
  bottom: -6px;
  left: -6px;
}
.slot-E .play-order {
  top: -6px;
  right: -6px;
}
.slot-N .play-order {
  top: -6px;
  right: -6px;
}
.slot-S .play-order {
  bottom: -6px;
  left: -6px;
}
.trick-empty {
  color: rgba(234, 245, 238, 0.55);
  font-size: 12px;
}
.winner-tag {
  font-size: 11px;
  color: #2c2200;
  background: #ffe19a;
  border-radius: 999px;
  padding: 1px 7px;
  font-weight: 700;
}
.turn-tag {
  font-size: 11px;
  color: #ffe19a;
  font-weight: 700;
}
.muted {
  color: rgba(234, 245, 238, 0.55);
}
@media (max-width: 900px) {
  .table {
    grid-template-columns: minmax(0, 1fr) minmax(240px, 252px) minmax(0, 1fr);
    grid-template-rows: auto minmax(290px, 1fr) auto;
    min-height: 600px;
    padding: 10px;
    gap: 6px;
  }
  .trick-board {
    min-height: 252px;
  }
  .center {
    min-height: 290px;
    padding: 4px;
  }
  .center-bid-history {
    max-height: 190px;
    --bid-scroll-max: 130px;
  }
}

@media (max-width: 820px) {
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
    min-height: 290px;
  }
}
</style>
