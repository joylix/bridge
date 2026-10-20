<script setup lang="ts">
import { computed } from 'vue';
import { getSuit, isRedSuit, suitSymbol, type SuitIndex } from '../models/card';
import { sortHand } from '../models/hand';
import type { Position } from '../models/gameState';
import PlayingCard from './PlayingCard.vue';

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

/** 按 ♠ ♥ ♦ ♣ 分组，缺门不占位 */
const singleRowGroups = computed(() => rows.value.filter((row) => row.cards.length > 0));

/**
 * 东西家（紧凑模式）分成两行：♠♥ 一行、♦♣ 一行，
 * 既保持牌张可读尺寸，又避免横向占满侧栏。
 */
const displayRows = computed(() => {
  if (!props.compact) return [singleRowGroups.value];
  const high = singleRowGroups.value.filter((row) => row.suit >= 2);
  const low = singleRowGroups.value.filter((row) => row.suit < 2);
  return [high, low].filter((row) => row.length > 0);
});

/** 本轮已出牌的可展示信息（无则 null） */
const played = computed(() => {
  const card = props.playedCard;
  if (card === undefined || card === null) return null;
  return { card, red: isRedSuit(getSuit(card)) };
});
</script>

<template>
  <div class="hand" :class="[{ 'is-dummy': isDummy, active, compact }, `pos-${position}`]">
    <div class="hand-inner">
      <div v-if="faceDown" class="cards backs">
        <PlayingCard
          v-for="i in cards.length"
          :key="i"
          back
          :size="compact ? 'lg' : 'xxl'"
        />
      </div>

      <div
        v-else
        class="suits"
        :class="{ clickable, 'no-events': !clickable, 'single-row': !compact, 'compact-rows': compact }"
      >
        <!-- 手牌按花色分组叠放；东西家分成 ♠♥ / ♦♣ 两行 -->
        <div v-for="(row, rowIndex) in displayRows" :key="rowIndex" class="hand-row">
          <span
            v-for="group in row"
            :key="group.suit"
            class="suit-group"
          >
            <PlayingCard
              v-for="card in group.cards"
              :key="card"
              :card="card"
              :size="compact ? 'lg' : 'xxl'"
              :clickable="clickable"
              :active="active && clickable"
              @click="emit('card-click', card)"
            />
          </span>
        </div>
      </div>
    </div>

    <!-- 本轮该座位已出的牌：显示在手牌旁边 -->
    <div v-if="played" class="played-out" :class="{ red: played.red }">
      <span class="played-tag">本轮</span>
      <PlayingCard class="played-card" :card="played.card" size="xs" label-mode="suit-first" />
    </div>
  </div>
</template>

<style scoped>
.hand {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
/* 手牌主体 */
.hand-inner {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
/* 东家：已出牌显示在手牌左侧（朝向中央） */
.pos-E {
  flex-direction: row-reverse;
}

/* 手牌：按花色分组叠放 */
.suits {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.suits.single-row {
  gap: 0;
}
.hand-row {
  display: flex;
  align-items: flex-end;
  min-height: 118px;
  padding-left: 3px;
  max-width: 100%;
}
.suit-group {
  display: flex;
  align-items: flex-end;
  flex: none;
}
.suit-group + .suit-group {
  margin-left: 8px;
}
.suit-group .playing-card + .playing-card {
  margin-left: -52px;
}
.suits.no-events {
  pointer-events: none;
  opacity: 0.74;
}

/* 暗手：横向叠放牌背 */
.cards.backs {
  display: flex;
  align-items: center;
  min-height: 118px;
}
.cards.backs .playing-card + .playing-card {
  margin-left: -52px;
}

/* 东/西家紧凑模式：两行、牌张稍小、叠放更紧 */
.hand.compact {
  gap: 4px;
}
.compact .hand-row {
  min-height: 90px;
  padding-left: 2px;
}
.compact .suit-group + .suit-group {
  margin-left: 5px;
}
.compact .suit-group .playing-card + .playing-card {
  margin-left: -52px;
}
.compact .cards.backs {
  min-height: 90px;
}
.compact .cards.backs .playing-card + .playing-card {
  margin-left: -56px;
}

/* 窄屏时进一步加大叠放，避免 13 张牌横向溢出 */
@media (max-width: 760px) {
  .hand:not(.compact) .suit-group .playing-card + .playing-card {
    margin-left: -58px;
  }
  .hand:not(.compact) .cards.backs .playing-card + .playing-card {
    margin-left: -58px;
  }
}
@media (max-width: 560px) {
  .hand:not(.compact) .suit-group + .suit-group {
    margin-left: 4px;
  }
  .hand:not(.compact) .suit-group .playing-card + .playing-card {
    margin-left: -68px;
  }
  .hand:not(.compact) .cards.backs .playing-card + .playing-card {
    margin-left: -66px;
  }
}
@media (max-width: 440px) {
  .hand:not(.compact) .hand-row {
    flex-wrap: wrap;
    row-gap: 4px;
  }
}

/* 主动高亮可点击的手牌 */
.active .suits.clickable :deep(.playing-card) {
  outline: 1px solid rgba(255, 214, 102, 0.65);
}

/* 本轮已出牌：手牌旁的小牌面 */
.played-out {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex: none;
}
.played-tag {
  font-size: 9px;
  color: #ffe9a8;
  opacity: 0.9;
  letter-spacing: 0.5px;
}
</style>
