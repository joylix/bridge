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
  /** 强制单行显示（东西家成为明手时使用，仍采用紧凑牌面尺寸） */
  singleRow?: boolean;
  /** 高亮当前行动（叫牌或出牌轮到该座位） */
  active?: boolean;
  /** 本轮该座位已出的牌（无则为 null） */
  playedCard?: number | null;
  /** 当前被左键选中的牌（再次点击取消选择） */
  selectedCard?: number | null;
}>();

const emit = defineEmits<{
  (e: 'card-click', card: number): void;
  (e: 'card-confirm', card: number): void;
  (e: 'card-dblclick', card: number): void;
}>();

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

/** 非紧凑手牌始终单行；东西家成为明手时也强制回到单行 */
const singleRowLayout = computed(() => !props.compact || !!props.singleRow);

/**
 * 东西家（紧凑模式）分成两行：♠♥ 一行、♦♣ 一行，
 * 既保持牌张可读尺寸，又避免横向占满侧栏。
 */
const displayRows = computed(() => {
  if (singleRowLayout.value) return [singleRowGroups.value];
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
          :size="compact ? 'xl' : 'xxl'"
        />
      </div>

      <div
        v-else
        class="suits"
        :class="{ clickable, 'no-events': !clickable, 'single-row': singleRowLayout, 'compact-rows': !singleRowLayout }"
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
              :size="compact ? 'xl' : 'xxl'"
              :clickable="clickable"
              :active="active && clickable"
              :selected="selectedCard === card"
              @click="emit('card-click', card)"
              @dblclick="emit('card-dblclick', card)"
              @contextmenu.prevent="emit('card-confirm', card)"
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
  /* 所有相邻牌（同花色或跨花色）共用同一叠放距离 */
  --card-overlap: -60px;
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
  min-height: 134px;
  padding-left: 3px;
  max-width: 100%;
}
.suit-group {
  display: flex;
  align-items: flex-end;
  flex: none;
}
/* 同花色与跨花色均使用完全相同的叠放距离 */
.suit-group + .suit-group,
.suit-group .playing-card + .playing-card {
  margin-left: var(--card-overlap);
}
.suits.no-events {
  pointer-events: none;
  opacity: 0.74;
}

/* 暗手：横向叠放牌背 */
.cards.backs {
  display: flex;
  align-items: center;
  min-height: 134px;
}
.cards.backs .playing-card + .playing-card {
  margin-left: var(--card-overlap);
}

/* 东/西家紧凑模式：两行、牌张稍小、叠放更紧 */
.hand.compact {
  --card-overlap: -60px;
  gap: 4px;
}
.compact .hand-row {
  min-height: 106px;
  padding-left: 2px;
}
.compact .cards.backs {
  min-height: 106px;
}

/* 窄屏时进一步加大叠放，避免 13 张牌横向溢出 */
@media (max-width: 1320px) {
  .hand.compact {
    --card-overlap: -64px;
  }
}
/* 单列布局东西家拥有整行宽度，恢复较舒展的牌距 */
@media (max-width: 820px) {
  .hand.compact {
    --card-overlap: -54px;
  }
}
@media (max-width: 440px) {
  .hand.compact {
    --card-overlap: -60px;
  }
}
@media (max-width: 600px) {
  .hand:not(.compact) {
    --card-overlap: -70px;
  }
}
@media (max-width: 480px) {
  .hand:not(.compact) {
    --card-overlap: -76px;
  }
}
@media (max-width: 400px) {
  .hand:not(.compact) {
    --card-overlap: -82px;
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
