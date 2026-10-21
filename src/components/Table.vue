<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGameStore } from '../store/game';
import { getSide, type Position } from '../models/gameState';
import { getSuit } from '../models/card';
import { isCardLegal } from '../core/playing';
import Hand from './Hand.vue';
import BidHistory from './BidHistory.vue';
import ContractDisplay from './ContractDisplay.vue';
import PlayingCard from './PlayingCard.vue';
import SouthPlayed from './SouthPlayed.vue';
import { useScoringCardsVisible } from '../composables/useScoringCardsVisible';
import { useBoardTrick } from '../composables/useBoardTrick';

const store = useGameStore();
/** 一局结束后桌面上的牌只再显示 1 秒 */
const cardsVisible = useScoringCardsVisible();
/** 第四家出牌后，完整一墩只再显示 1 秒，然后清空等待下一轮 */
const { boardTrick } = useBoardTrick();

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

/** 当前是否轮到该座位出牌（用于显示指向其手牌的闪烁箭头） */
function showTurnArrow(pos: Position): boolean {
  const playing = store.phase === 'play' || store.phase === 'play_waiting_lead';
  return playing && store.nextPlayer === pos;
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

/** 牌桌左上角信息栏：副序、局况、定约、赢墩数 */
const vulnerabilityText = computed(() => {
  const labels = { none: '无局', NS: '南北有局', EW: '东西有局', both: '双方有局' } as const;
  return labels[store.vulnerability];
});
const contractEmptyText = computed(() => (store.phase === 'scoring' ? '流局' : '—'));
const tricksBySide = computed(() => {
  const counts = { NS: 0, EW: 0 };
  for (const trick of store.tricks) counts[getSide(trick.winner)] += 1;
  return counts;
});

/** 出牌阶段把叫牌过程停靠到北家手牌右侧，与左侧信息栏对称 */
const isPlaying = computed(() => store.phase === 'play' || store.phase === 'play_waiting_lead');
const showPlayBidHistory = computed(() => isPlaying.value && store.biddingHistory.length > 0);
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
        :show-turn-arrow="showTurnArrow('N')"
        :selected-card="selectedCard"
        @card-click="(c) => onCardClick('N', c)"
        @card-confirm="(c) => onCardConfirm('N', c)"
        @card-dblclick="(c) => onCardDoubleClick('N', c)"
      />
    </div>

    <!-- 左上角牌局信息：副序、局况、定约、赢墩数 -->
    <div v-if="store.phase !== 'idle'" class="play-info-panel" aria-label="牌局信息">
      <div class="info-row">
        <span class="info-label">副序</span>
        <span class="info-value">{{ store.gamesPlayed }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">局况</span>
        <span class="info-value">{{ vulnerabilityText }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">定约</span>
        <span class="info-value">
          <ContractDisplay :contract="store.contract" :empty-text="contractEmptyText" />
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">赢墩数</span>
        <span class="info-value" title="南北 / 东西">
          {{ tricksBySide.NS }} / {{ tricksBySide.EW }}
        </span>
      </div>
    </div>

    <!-- 出牌时叫牌过程停靠在北家手牌右侧，与左侧信息栏对称 -->
    <aside v-if="showPlayBidHistory" class="play-bid-history" aria-label="叫牌过程">
      <BidHistory variant="table" />
    </aside>

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
        :show-turn-arrow="showTurnArrow('W')"
        :selected-card="selectedCard"
        @card-click="(c) => onCardClick('W', c)"
        @card-confirm="(c) => onCardConfirm('W', c)"
        @card-dblclick="(c) => onCardDoubleClick('W', c)"
      />
    </div>

    <!-- 中央：叫牌时显示叫牌过程，打牌时按出牌次序叠放本墩牌面 -->
    <div class="center">
      <BidHistory v-if="store.phase === 'bidding'" class="center-bid-history" variant="table" />

      <div v-else-if="store.phase !== 'idle' && cardsVisible" class="trick-board">
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
      </div>
    </div>

    <!-- 南家已出牌（右下角）+ 计分表 / 摊牌 / 定约卡 / 托管 -->
    <SouthPlayed />

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
        :show-turn-arrow="showTurnArrow('E')"
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
        :show-turn-arrow="showTurnArrow('S')"
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
  --table-pad: 14px;
  position: relative;
  display: grid;
  grid-template-areas:
    'north north north'
    'west center east'
    'south south south';
  grid-template-columns: minmax(0, 1fr) clamp(320px, 26vw, 360px) minmax(0, 1fr);
  grid-template-rows: auto minmax(280px, 1fr) auto;
  gap: 8px 12px;
  min-height: clamp(620px, calc(100vh - 140px), 920px);
  overflow: hidden;
  background:
    radial-gradient(ellipse at 50% 42%, rgba(72, 167, 112, 0.36), transparent 58%),
    radial-gradient(circle at 50% 12%, #2d8a5d 0%, #1d6d49 42%, #12482f 100%);
  border-radius: 22px;
  padding: var(--table-pad);
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
/* 轮到出牌的座位略高于中央出牌区，保证指向手牌的箭头不被牌面遮住 */
.seat.active {
  z-index: 2;
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
  justify-self: center;
  align-self: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  max-width: 360px;
  min-height: 0;
}
/* 左右两块信息与北家手牌上沿平齐：左侧牌局信息，右侧叫牌过程 */
.play-info-panel,
.play-bid-history {
  position: absolute;
  top: calc(var(--table-pad) + 18px);
  z-index: 2;
  box-sizing: border-box;
  width: clamp(200px, 22%, 300px);
}
.play-info-panel {
  left: var(--table-pad);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px 12px;
  border-radius: 4px;
  border: 1px solid rgba(80, 66, 26, 0.55);
  background: linear-gradient(180deg, rgba(255, 252, 232, 0.97), rgba(242, 232, 196, 0.96));
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.28);
  color: #2f2a1a;
  font-size: 13px;
  line-height: 1.8;
}
.info-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.info-label {
  flex: none;
  color: #6b5e33;
  font-weight: 600;
}
.info-label::after {
  content: '：';
}
.info-value {
  min-width: 0;
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.play-bid-history {
  right: var(--table-pad);
  max-height: 220px;
  overflow: hidden;
}
.play-bid-history :deep(.variant-table) {
  gap: 4px;
  padding: 0;
  border-radius: 0;
}
.play-bid-history :deep(.bid-header span) {
  padding: 4px 0;
  font-size: 13px;
}
.play-bid-history :deep(.bid-cell) {
  min-height: 24px;
  padding: 2px 0;
}
.play-bid-history :deep(.bid-level) {
  font-size: 15px;
}
.play-bid-history :deep(.bid-suit) {
  font-size: 20px;
}
.play-bid-history :deep(.bid-suit.nt) {
  font-size: 11px;
}
.play-bid-history :deep(.bid-label) {
  font-size: 12px;
}
.play-bid-history :deep(.bid-scroll) {
  --bid-scroll-max: 168px;
  min-height: 168px;
}
/* 叫牌过程按内容高度展示，不随中央区域一起拉高 */
.center-bid-history {
  flex: 0 1 auto;
  min-height: 0;
  max-height: 230px;
  overflow: hidden;
  --bid-scroll-max: 172px;
}
/* 中央叫牌纸采用参考界面的分色表头与较大字号，同时保持紧凑 */
.center-bid-history :deep(.variant-table) {
  gap: 6px;
  padding: 0;
  border-radius: 0;
}
.center-bid-history :deep(.bid-scroll) {
  /* 固定显示 6 轮叫牌，和参考界面的表格高度一致 */
  min-height: 172px;
}
.center-bid-history :deep(.bid-header span) {
  padding: 5px 0;
  font-size: 15px;
}
.center-bid-history :deep(.bid-cell) {
  min-height: 24px;
  padding: 2px 0;
}
.center-bid-history :deep(.bid-level) {
  font-size: 16px;
}
.center-bid-history :deep(.bid-suit) {
  font-size: 20px;
}
.center-bid-history :deep(.bid-suit.nt) {
  font-size: 12px;
}
.center-bid-history :deep(.bid-label) {
  font-size: 13px;
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
.muted {
  color: rgba(234, 245, 238, 0.55);
}
@media (max-width: 900px) {
  .table {
    --table-pad: 10px;
    grid-template-columns: minmax(0, 1fr) 320px minmax(0, 1fr);
    grid-template-rows: auto minmax(280px, 1fr) auto;
    min-height: 600px;
    padding: var(--table-pad);
    gap: 6px;
  }
  .trick-board {
    min-height: 252px;
  }
  .center {
    max-width: 320px;
  }
  .center-bid-history {
    max-height: 210px;
    --bid-scroll-max: 172px;
  }
}

@media (max-width: 880px) {
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
    width: min(100%, 340px);
    max-width: 340px;
  }
  .play-info-panel,
  .play-bid-history {
    display: none;
  }
}
</style>
