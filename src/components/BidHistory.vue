<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore, describeCall, suitName, vulName } from '../store/game';
import type { BidRecord, Position } from '../models/gameState';

const props = withDefaults(defineProps<{ title?: string }>(), { title: '叫牌过程' });

const store = useGameStore();
const COLUMNS: Position[] = ['N', 'E', 'S', 'W'];

interface BidCell {
  level: string;
  suit: string;
  red: boolean;
  label: string;
}

/** 将叫品拆成“阶数 + 花色符号”，便于单独放大花色符号 */
function toBidCell(rec: BidRecord | null): BidCell | null {
  if (!rec) return null;
  if (rec.call.type === 'bid') {
    return {
      level: String(rec.call.level),
      suit: suitName(rec.call.suit),
      red: rec.call.suit === 'D' || rec.call.suit === 'H',
      label: '',
    };
  }
  return { level: '', suit: '', red: false, label: describeCall(rec.call) };
}

/** 叫牌历史按 4 个一行（N E S W 列）组织 */
const bidRounds = computed<(BidCell | null)[][]>(() => {
  const rows: (BidCell | null)[][] = [];
  store.biddingHistory.forEach((rec, i) => {
    const r = Math.floor(i / 4);
    if (!rows[r]) rows[r] = [null, null, null, null];
    rows[r][COLUMNS.indexOf(rec.position)] = toBidCell(rec);
  });
  return rows;
});
</script>

<template>
  <div class="bid-history">
    <div class="bid-title-row">
      <span class="bid-title">{{ props.title }}</span>
      <span class="bid-meta">
        <span>发牌 {{ store.dealer }}</span>
        <span class="vul-tag">局况 {{ vulName(store.vulnerability) }}</span>
      </span>
    </div>

    <div class="bid-scroll">
      <div class="bid-header">
        <span v-for="c in COLUMNS" :key="c">{{ c }}</span>
      </div>
      <div v-for="(row, i) in bidRounds" :key="i" class="bid-row">
        <span v-for="(cell, j) in row" :key="j" class="bid-cell">
          <template v-if="cell">
            <template v-if="cell.suit">
              <span class="bid-level">{{ cell.level }}</span>
              <span class="bid-suit" :class="{ red: cell.red, nt: cell.suit === 'NT' }">{{ cell.suit }}</span>
            </template>
            <span v-else class="bid-label">{{ cell.label }}</span>
          </template>
        </span>
      </div>
      <div v-if="bidRounds.length === 0" class="muted">尚未开始叫牌</div>
    </div>
  </div>
</template>

<style scoped>
.bid-history {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  width: 100%;
  font-size: 14px;
}
.bid-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.bid-title {
  font-weight: 700;
  color: #14563a;
}
.bid-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #6a7770;
}
.vul-tag {
  color: #3a4a40;
  background: #eef4ef;
  border: 1px solid #c9d6cf;
  border-radius: 4px;
  padding: 0 6px;
  font-weight: 600;
}
.bid-scroll {
  flex: 1;
  min-height: 0;
  max-height: 220px;
  overflow: auto;
}
.bid-header,
.bid-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.bid-header span {
  font-weight: 700;
  color: #8a9790;
  text-align: center;
}
.bid-cell {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 1px;
  padding: 2px 0;
  color: #1c2b22;
}
.bid-level {
  font-size: 13px;
  font-weight: 600;
}
.bid-suit {
  font-size: 19px;
  font-weight: 700;
  line-height: 1;
}
.bid-suit.red {
  color: #c0392b;
}
.bid-suit.nt {
  font-size: 14px;
  letter-spacing: -0.5px;
}
.bid-label {
  font-size: 12px;
  color: #3a4a40;
}
.muted {
  color: #9aa7a0;
}
</style>
