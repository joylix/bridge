<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore, describeCall, suitName, vulName } from '../store/game';
import type { BidRecord, Position } from '../models/gameState';

const props = withDefaults(defineProps<{ title?: string; variant?: 'panel' | 'table' }>(), {
  title: '叫牌过程',
  variant: 'panel',
});

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
  <div class="bid-history" :class="`variant-${props.variant}`">
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

/* 中央牌桌样式：羊皮纸叫牌卡，接近线下叫牌盒/叫牌纸 */
.variant-table {
  gap: 6px;
  padding: 10px 12px;
  border-radius: 12px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.42), transparent 30%),
    #f2e8cc;
  border: 1px solid #c9b98e;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.55),
    0 8px 20px rgba(0, 0, 0, 0.22);
  color: #252017;
  font-size: 16px;
}
.variant-table .bid-title-row {
  padding-bottom: 5px;
  border-bottom: 1px solid #d8c9a3;
}
.variant-table .bid-title {
  color: #5b4315;
  font-size: 13px;
  letter-spacing: 0.4px;
}
.variant-table .bid-meta {
  color: #7a6840;
  font-size: 11px;
}
.variant-table .vul-tag {
  color: #5b4315;
  background: rgba(255, 255, 255, 0.55);
  border-color: #d8c9a3;
}
.variant-table .bid-scroll {
  max-height: none;
  border: 1px solid #d8c9a3;
  border-radius: 8px;
  overflow: auto;
  background: rgba(255, 252, 242, 0.55);
}
.variant-table .bid-header {
  position: sticky;
  top: 0;
  z-index: 1;
  gap: 0;
  background: #d9c79a;
  border-bottom: 1px solid #c9b98e;
}
.variant-table .bid-header span {
  padding: 4px 0;
  color: #4e3a10;
  font-size: 12px;
  border-right: 1px solid rgba(120, 95, 38, 0.18);
}
.variant-table .bid-header span:last-child {
  border-right: 0;
}
.variant-table .bid-row {
  gap: 0;
  border-bottom: 1px solid rgba(120, 95, 38, 0.14);
}
.variant-table .bid-row:nth-child(even) {
  background: rgba(217, 199, 154, 0.16);
}
.variant-table .bid-row:last-child {
  border-bottom: 0;
}
.variant-table .bid-cell {
  min-height: 30px;
  padding: 4px 0;
  border-right: 1px solid rgba(120, 95, 38, 0.1);
}
.variant-table .bid-cell:last-child {
  border-right: 0;
}
.variant-table .bid-level {
  font-size: 15px;
  color: #3a2b0b;
}
.variant-table .bid-suit {
  font-size: 24px;
}
.variant-table .bid-label {
  font-size: 13px;
  color: #5b4315;
}
.variant-table .muted {
  padding: 10px;
  color: #9b8a61;
}
</style>
