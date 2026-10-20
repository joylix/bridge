<script setup lang="ts">
import { computed } from 'vue';
import { getSuit, isRedSuit, rankName, suitSymbol, type SuitIndex } from '../models/card';
import { sortHand } from '../models/hand';

const props = defineProps<{ cards: number[] }>();

/** 结果窗口沿用传统排列：♠ ♥ ♦ ♣ */
const SUIT_ORDER: SuitIndex[] = [3, 2, 1, 0];

const rows = computed(() => {
  const hand = sortHand(props.cards);
  return SUIT_ORDER.map((suit) => ({
    suit,
    symbol: suitSymbol(suit),
    red: isRedSuit(suit),
    ranks: hand.filter((card) => getSuit(card) === suit).map(rankName),
  })).filter((row) => row.ranks.length > 0);
});
</script>

<template>
  <div class="result-hand">
    <div v-for="row in rows" :key="row.suit" class="rh-row">
      <span class="rh-tile rh-suit suit-symbol" :class="{ red: row.red, 'suit-club': row.symbol === '♣' }">{{ row.symbol }}</span>
      <span v-for="rank in row.ranks" :key="rank" class="rh-tile" :class="{ red: row.red }">
        {{ rank }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.result-hand {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}
.rh-row {
  display: flex;
  gap: 1px;
  height: 16px;
}
.rh-tile {
  --club-color: var(--club-ink);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 1px;
  border: 1px solid #142018;
  border-radius: 1px;
  background: linear-gradient(#fffef9, #e9e4d7);
  color: #101510;
  font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.45);
}
.rh-tile.red {
  color: #c21b1b;
}
.rh-suit {
  min-width: 18px;
  background: linear-gradient(#fff, #f2eee4);
  font-family: var(--suit-font);
  font-variant-emoji: text;
  font-size: 11px;
}
.rh-suit.suit-club {
  color: var(--club-ink);
}
</style>
