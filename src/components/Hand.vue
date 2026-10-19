<script setup lang="ts">
import { computed } from 'vue';
import { cardLabel, getSuit, isRedSuit, rankName, suitSymbol, type SuitIndex } from '../models/card';
import { sortHand } from '../models/hand';
import type { Position } from '../models/gameState';

const props = defineProps<{
  cards: number[];
  position: Position;
  /** 是否可点击（由父组件依据 controllableSeats 计算） */
  clickable?: boolean;
  /** 显示牌背（暗手） */
  faceDown?: boolean;
  /** 是否为明手区 */
  isDummy?: boolean;
  /** 紧凑模式（东西家） */
  compact?: boolean;
  /** 高亮当前行动（叫牌或出牌轮到该座位） */
  active?: boolean;
  label?: string;
  /** 本轮该座位已出的牌（无则为 null） */
  playedCard?: number | null;
}>();

const emit = defineEmits<{ (e: 'card-click', card: number): void }>();

/** 展示顺序：♠ > ♥ > ♦ > ♣，每行一个花色 */
const SUIT_ROWS: SuitIndex[] = [3, 2, 1, 0];

const rows = computed(() =>
  SUIT_ROWS.map((suit) => ({
    suit,
    symbol: suitSymbol(suit),
    red: isRedSuit(suit),
    cards: sortHand(props.cards).filter((card) => getSuit(card) === suit),
  })),
);

/** 本轮已出牌的可展示信息（无则 null） */
const played = computed(() => {
  const card = props.playedCard;
  if (card === undefined || card === null) return null;
  const suit = getSuit(card);
  return { text: cardLabel(card), red: isRedSuit(suit) };
});
</script>

<template>
  <div class="hand" :class="[{ 'is-dummy': isDummy, active, compact }, `pos-${position}`]">
    <div class="hand-inner">
      <div class="hand-label">
        <span>{{ label ?? position }}</span>
        <span v-if="isDummy" class="dummy-tag">明手</span>
        <span v-if="!faceDown" class="count">({{ cards.length }})</span>
      </div>

      <div v-if="faceDown" class="cards backs">
        <div v-for="i in cards.length" :key="i" class="card back" />
      </div>

      <div v-else class="suits" :class="{ clickable, 'no-events': !clickable }">
        <div v-for="row in rows" :key="row.suit" class="suit-row">
          <span class="suit-tag" :class="{ red: row.red }">{{ row.symbol }}</span>
          <div class="suit-cards">
            <button
              v-for="card in row.cards"
              :key="card"
              type="button"
              class="card"
              :class="row.red ? 'red' : 'black'"
              :disabled="!clickable"
              @click="emit('card-click', card)"
            >
              {{ rankName(card) }}
            </button>
            <span v-if="row.cards.length === 0" class="void">—</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 本轮该座位已出的牌：显示在手牌旁边 -->
    <div v-if="played" class="played-out" :class="{ red: played.red }">
      <span class="played-tag">本轮</span>
      <span class="played-card">{{ played.text }}</span>
    </div>
  </div>
</template>

<style scoped>
.hand {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
}
/* 手牌主体（座位字母 + 牌型）竖向排列 */
.hand-inner {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* 东家：已出牌显示在手牌左侧（朝向中央） */
.pos-E {
  flex-direction: row-reverse;
}
.hand-label {
  font-size: 12px;
  font-weight: 600;
  color: #e9f4ec;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 轮到该座位行动：座位字母背景/前景交替闪烁 */
.hand.active .hand-label {
  border-radius: 4px;
  padding: 1px 6px;
  animation: hand-active-pulse 0.9s ease-in-out infinite;
}
@keyframes hand-active-pulse {
  0%,
  100% {
    background: #ffd666;
    color: #2c2200;
    box-shadow: 0 0 0 2px rgba(255, 214, 102, 0.75);
  }
  50% {
    background: rgba(255, 214, 102, 0.12);
    color: #ffe9a8;
    box-shadow: none;
  }
}
.dummy-tag {
  background: #d9a300;
  color: #2c2200;
  border-radius: 3px;
  padding: 0 4px;
  font-size: 10px;
}
.count {
  opacity: 0.75;
  font-weight: 400;
}

/* 4 行分花色：S / H / D / C */
.suits {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.suit-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 22px;
}
.suit-tag {
  width: 18px;
  text-align: center;
  font-size: 17px;
  line-height: 1;
  font-weight: 700;
  color: #eaf5ee;
  flex: none;
}
.suit-tag.red {
  color: #ff9a8a;
}
.suit-cards {
  display: flex;
  align-items: center;
  gap: 2px;
}
.void {
  color: rgba(234, 245, 238, 0.35);
  font-size: 12px;
  padding-left: 2px;
}
.suits.no-events {
  pointer-events: none;
  opacity: 0.72;
}

.card {
  width: 26px;
  height: 34px;
  border-radius: 5px;
  border: 1px solid rgba(0, 0, 0, 0.35);
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  cursor: default;
  transition: transform 0.08s ease, box-shadow 0.08s ease;
}
.card.red {
  color: #c0392b;
}
.card.black {
  color: #1c2b22;
}

/* 暗手：单行牌背，不泄露牌型 */
.cards.backs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}
.card.back {
  background: repeating-linear-gradient(45deg, #2b4a8b, #2b4a8b 4px, #24407a 4px, #24407a 8px);
}

/* 紧凑模式（东西家） */
.compact .suit-row {
  gap: 2px;
  min-height: 22px;
}
.compact .suit-tag {
  width: 14px;
  font-size: 14px;
}
.compact .suit-cards {
  gap: 1px;
}
.compact .card {
  width: 15px;
  height: 22px;
  border-radius: 3px;
  font-size: 9px;
}
.compact .card.back {
  width: 20px;
  height: 28px;
}

.suits.clickable .card:enabled {
  cursor: pointer;
}
.suits.clickable .card:enabled:hover {
  transform: translateY(-4px);
  box-shadow: 0 5px 10px rgba(0, 0, 0, 0.35);
}
.active .suits.clickable .card:enabled {
  outline: 2px solid #ffd666;
  outline-offset: 1px;
}

/* 本轮已出牌：手牌旁的大字提示 */
.played-out {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex: none;
}
.played-tag {
  font-size: 10px;
  color: #ffe9a8;
  opacity: 0.9;
}
.played-card {
  width: 36px;
  height: 48px;
  border-radius: 6px;
  background: #fff;
  border: 2px solid #14563a;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 700;
  color: #1c2b22;
}
.played-out.red .played-card {
  color: #c0392b;
}
.compact .played-card {
  width: 28px;
  height: 38px;
  font-size: 12px;
}
</style>
