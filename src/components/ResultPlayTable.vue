<script setup lang="ts">
import { computed } from 'vue';
import { getSuit, isRedSuit, rankName, suitSymbol } from '../models/card';
import {
  nextPosition,
  ORDER,
  type CardPlay,
  type Contract,
  type Position,
  type Trick,
} from '../models/gameState';

const props = withDefaults(
  defineProps<{
    tricks: Trick[];
    currentTrick?: CardPlay[];
    contract?: Contract | null;
  }>(),
  { currentTrick: () => [], contract: null },
);

const SEAT_CN: Record<Position, string> = { N: '北', E: '东', S: '南', W: '西' };

/** 从首攻人开始展开两个座位循环，任何一墩都能连续放入 7 列 */
const openingLeader = computed<Position>(() => {
  if (props.tricks.length) return props.tricks[0].leader;
  if (props.currentTrick.length) return props.currentTrick[0].position;
  if (props.contract) return nextPosition(props.contract.declarer);
  return 'W';
});

const playColumns = computed<Position[]>(() => {
  const start = ORDER.indexOf(openingLeader.value);
  return Array.from({ length: 7 }, (_, index) => ORDER[(start + index) % 4]);
});

const playRows = computed<(number | null)[][]>(() => {
  const tricks = props.tricks.map((trick) => ({ plays: trick.plays, leader: trick.leader }));
  if (props.currentTrick.length) {
    tricks.push({ plays: props.currentTrick, leader: props.currentTrick[0].position });
  }
  return tricks.map((trick) => {
    const cells: (number | null)[] = Array.from({ length: 7 }, () => null);
    const start =
      (ORDER.indexOf(trick.leader) - ORDER.indexOf(openingLeader.value) + 4) % 4;
    trick.plays.forEach((play, index) => {
      if (start + index < cells.length) cells[start + index] = play.card;
    });
    return cells;
  });
});

function cardSuit(card: number): string {
  return suitSymbol(getSuit(card));
}

function cardRank(card: number): string {
  return rankName(card);
}

function cardRed(card: number): boolean {
  return isRedSuit(getSuit(card));
}
</script>

<template>
  <div class="play-table-wrap">
    <table class="play-table">
      <thead>
        <tr>
          <th v-for="(column, index) in playColumns" :key="`play-head-${index}`">
            {{ SEAT_CN[column] }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, rowIndex) in playRows" :key="`play-row-${rowIndex}`">
          <td v-for="(card, columnIndex) in row" :key="`play-${rowIndex}-${columnIndex}`">
            <span v-if="card !== null" class="play-card" :class="{ red: cardRed(card) }">
              <span class="suit-symbol" :class="{ 'suit-club': cardSuit(card) === '♣' }">{{ cardSuit(card) }}</span>{{ cardRank(card) }}
            </span>
          </td>
        </tr>
        <tr v-if="playRows.length === 0">
          <td :colspan="playColumns.length" class="play-empty">尚无出牌</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.play-table-wrap {
  flex: 1;
  min-height: 0;
  max-height: 330px;
  overflow: auto;
}
.play-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
  line-height: 1.1;
}
.play-table th,
.play-table td {
  height: 21px;
  padding: 0 1px;
  border: 1px solid rgba(255, 255, 255, 0.36);
  text-align: center;
  vertical-align: middle;
}
.play-table th {
  background: linear-gradient(#fbfbfb, #ececec);
  color: #111;
  font-weight: 700;
}
.play-table td {
  background: #006b3f;
}
.play-card {
  --club-color: var(--club-on-dark);
  color: #fff;
  font-weight: 700;
  white-space: nowrap;
}
.play-card.red {
  color: #ff7f7f;
}
.play-empty {
  padding: 10px !important;
  color: rgba(255, 255, 255, 0.72) !important;
  text-align: center !important;
}
</style>
