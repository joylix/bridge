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

/** 北/南家用单行牌面：按 ♠ ♥ ♦ ♣ 分组，缺门不占位 */
const singleRowGroups = computed(() => rows.value.filter((row) => row.cards.length > 0));

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
          :size="compact ? 'xs' : 'sm'"
        />
      </div>

      <div
        v-else
        class="suits"
        :class="{ clickable, 'no-events': !clickable, 'single-row': !compact }"
      >
        <!-- 北/南家：单行，按 ♠ ♥ ♦ ♣ 从大到小排列 -->
        <div v-if="!compact" class="single-row-cards">
          <span
            v-for="row in singleRowGroups"
            :key="row.suit"
            class="suit-group"
          >
            <PlayingCard
              v-for="card in row.cards"
              :key="card"
              :card="card"
              size="sm"
              :clickable="clickable"
              :active="active && clickable"
              @click="emit('card-click', card)"
            />
          </span>
        </div>

        <!-- 东/西家：紧凑模式仍按花色分 4 行 -->
        <template v-else>
          <div v-for="row in rows" :key="row.suit" class="suit-row">
            <span class="suit-tag" :class="{ red: row.red }">{{ row.symbol }}</span>
            <div class="suit-cards">
              <PlayingCard
                v-for="card in row.cards"
                :key="card"
                :card="card"
                :size="compact ? 'xs' : 'sm'"
                :clickable="clickable"
                :active="active && clickable"
                @click="emit('card-click', card)"
              />
              <span v-if="row.cards.length === 0" class="void">—</span>
            </div>
          </div>
        </template>
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

/* 4 行分花色：S / H / D / C */
.suits {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.suits.single-row {
  display: block;
}
.single-row-cards {
  display: flex;
  align-items: flex-end;
  min-height: 48px;
  padding-left: 3px;
  max-width: 100%;
}
.suit-group {
  display: flex;
  align-items: flex-end;
  flex: none;
}
.suit-group + .suit-group {
  margin-left: 9px;
}
.suit-group .playing-card + .playing-card {
  margin-left: -14px;
}
.suit-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 48px;
}
.suit-tag {
  width: 17px;
  text-align: center;
  font-size: 16px;
  line-height: 1;
  font-weight: 700;
  color: #eaf5ee;
  flex: none;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}
.suit-tag.red {
  color: #ff9a8a;
}
.suit-cards {
  display: flex;
  align-items: flex-end;
  min-height: 48px;
  padding-left: 3px;
  min-width: 0;
}
.suit-cards .playing-card + .playing-card {
  margin-left: -12px;
}
.void {
  color: rgba(234, 245, 238, 0.35);
  font-size: 12px;
  padding-left: 2px;
}
.suits.no-events {
  pointer-events: none;
  opacity: 0.74;
}

/* 暗手：横向牌背；东西家改为纵向叠牌 */
.cards.backs {
  display: flex;
  align-items: center;
  min-height: 48px;
}
.cards.backs .playing-card + .playing-card {
  margin-left: -14px;
}
.pos-E .cards.backs,
.pos-W .cards.backs {
  flex-direction: column;
  min-height: 0;
}
.pos-E .cards.backs .playing-card + .playing-card,
.pos-W .cards.backs .playing-card + .playing-card {
  margin-left: 0;
  margin-top: -18px;
}

/* 紧凑模式（东西家） */
.compact .suit-row {
  gap: 2px;
  min-height: 30px;
}
.compact .suit-tag {
  width: 13px;
  font-size: 13px;
}
.compact .suit-cards {
  min-height: 30px;
  padding-left: 1px;
}
.compact .suit-cards .playing-card + .playing-card {
  margin-left: -14px;
}
.compact .cards.backs {
  min-height: 30px;
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
