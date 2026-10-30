<script setup lang="ts">
import { computed } from 'vue';
import { FINAL_PASS_TEXT, useGameStore, describeCall, suitName } from '../store/game';
import { auctionRows } from '../core/bidding/auctionGrid';
import { meaningForBidRecord, type BidMeaningRow } from '../engine/bidMeaning';
import type { BidCall, BidRecord, Position } from '../models/gameState';

const props = withDefaults(
  defineProps<{
    variant?: 'panel' | 'table';
    /** 悬停已完成叫牌时，向外发出该叫品的含义 */
    showMeanings?: boolean;
  }>(),
  {
    variant: 'panel',
    showMeanings: false,
  },
);

const emit = defineEmits<{
  (e: 'bid-hover', row: BidMeaningRow | null): void;
}>();

const store = useGameStore();
const COLUMNS: Position[] = ['N', 'E', 'S', 'W'];
/** 叫牌表头直接显示座位中文名（北 东 南 西） */
const SEAT_LABEL: Record<Position, string> = { N: '北', E: '东', S: '南', W: '西' };

interface BidCell {
  position: Position;
  call?: BidCall;
  level: string;
  suit: string;
  red: boolean;
  label: string;
  final: boolean;
  /** 该叫品的规则含义（仅在开启提示时计算） */
  meaning?: string;
  /** “确认+提醒”提交的叫牌：白底突出 */
  alerted?: boolean;
  alertText?: string;
  /** 该家正在考虑叫牌：显示问号 */
  thinking?: boolean;
}

/** 叫牌结束时的最后一个 Pass 用等号（上下双横杠）表示 */
const finalPassIndex = computed(() => {
  if (store.phase === 'bidding') return -1;
  const last = store.biddingHistory.length - 1;
  if (last < 0) return -1;
  return store.biddingHistory[last]?.call.type === 'pass' ? last : -1;
});

/** 将叫品拆成“阶数 + 花色符号”，便于单独放大花色符号 */
function toBidCell(rec: BidRecord | null, index: number, final = false): BidCell | null {
  if (!rec) return null;
  const meaning =
    props.showMeanings && store.showHints
      ? meaningForBidRecord(
          rec,
          index,
          store.biddingHistory,
          store.hands[rec.position],
          store.styles[rec.position].bid,
          store.activeBiddingRules,
        )
      : undefined;

  if (rec.call.type === 'bid') {
    return {
      position: rec.position,
      call: rec.call,
      level: String(rec.call.level),
      suit: suitName(rec.call.suit),
      red: rec.call.suit === 'D' || rec.call.suit === 'H',
      label: '',
      final: false,
      meaning,
      alerted: rec.alerted,
      alertText: rec.alertText,
    };
  }
  return {
    position: rec.position,
    call: rec.call,
    level: '',
    suit: '',
    red: false,
    label: final ? FINAL_PASS_TEXT : describeCall(rec.call),
    final,
    meaning,
    alerted: rec.alerted,
    alertText: rec.alertText,
  };
}

/** 叫牌历史按座位列（N E S W）组织，列号回绕时换行 */
const bidRounds = computed<(BidCell | null)[][]>(() => {
  const rows: (BidCell | null)[][] = [];
  const rowIndices = auctionRows(
    store.biddingHistory.map((rec) => rec.position),
    COLUMNS,
  );
  store.biddingHistory.forEach((rec, i) => {
    const r = rowIndices[i] ?? 0;
    if (!rows[r]) rows[r] = [null, null, null, null];
    rows[r][COLUMNS.indexOf(rec.position)] = toBidCell(rec, i, i === finalPassIndex.value);
  });

  // 叫牌进行中：当前叫牌人的空档填问号，表示“正在考虑”
  if (store.phase === 'bidding') {
    const positions = [...store.biddingHistory.map((rec) => rec.position), store.currentBidder];
    const nextRows = auctionRows(positions, COLUMNS);
    const row = nextRows[nextRows.length - 1] ?? 0;
    const col = COLUMNS.indexOf(store.currentBidder);
    if (col >= 0) {
      if (!rows[row]) rows[row] = [null, null, null, null];
      if (!rows[row][col]) {
        rows[row][col] = {
          position: store.currentBidder,
          level: '',
          suit: '',
          red: false,
          label: '？',
          final: false,
          thinking: true,
        };
      }
    }
  }
  return rows;
});

/** 白底提醒的悬停说明 */
function cellTitle(cell: BidCell): string | undefined {
  if (cell.thinking) return `${SEAT_LABEL[store.currentBidder]}家正在考虑叫牌`;
  if (cell.alerted) return cell.alertText ? `提醒：${cell.alertText}` : '提醒';
  return undefined;
}

/** 悬停已完成的叫品：复用牌桌上唯一的含义浮动层 */
function onCellEnter(cell: BidCell): void {
  if (!props.showMeanings || !store.showHints) return;
  if (cell.thinking || !cell.call || !cell.meaning) return;
  emit('bid-hover', {
    position: cell.position,
    call: cell.call,
    meaning: cell.meaning,
  });
}

function onCellLeave(): void {
  if (props.showMeanings) emit('bid-hover', null);
}

function onScroll(): void {
  if (props.showMeanings) emit('bid-hover', null);
}
</script>

<template>
  <div class="bid-history" :class="[`variant-${props.variant}`, { interactive: props.showMeanings }]">
    <div class="bid-scroll" @scroll="onScroll">
      <div class="bid-header">
        <span v-for="c in COLUMNS" :key="c" :title="c">{{ SEAT_LABEL[c] }}</span>
      </div>
      <div v-for="(row, i) in bidRounds" :key="i" class="bid-row">
        <span
          v-for="(cell, j) in row"
          :key="j"
          class="bid-cell"
          :class="{ alerted: cell?.alerted, thinking: cell?.thinking }"
          :data-position="cell?.position"
          :title="cell ? cellTitle(cell) : undefined"
          @mouseenter="cell && onCellEnter(cell)"
          @mouseleave="onCellLeave"
        >
          <template v-if="cell">
            <template v-if="cell.suit">
              <span class="bid-level">{{ cell.level }}</span>
              <span
                class="bid-suit"
                :class="{
                  red: cell.red,
                  nt: cell.suit === 'NT',
                  'suit-symbol': cell.suit !== 'NT',
                  'suit-club': cell.suit === '♣',
                }"
              >{{ cell.suit }}</span>
            </template>
            <span v-else class="bid-label" :class="{ final: cell.final }">{{ cell.label }}</span>
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
  border-radius: 3px;
}
/* “确认+提醒”的叫牌：整格白底，突出显示 */
.bid-cell.alerted {
  background: #ffffff;
}
.bid-cell.thinking .bid-label {
  font-weight: 800;
  color: #10201b;
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
.bid-label.final {
  display: inline-block;
  align-self: center;
  font-size: 16px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.02em;
  /* 把“=”横向拉长，使其与 Pass 的横杠基本等长 */
  transform: scaleX(1.5);
  transform-origin: center;
}
.muted {
  color: #9aa7a0;
}

/* 中央牌桌样式：参考线上桥牌界面，深色描边 + 南北/东西分色表头 */
.variant-table {
  gap: 6px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: none;
  box-shadow: none;
  color: #eaf5ee;
  font-size: 16px;
}
.variant-table .bid-scroll {
  /* 由外层按场景设置上限，避免中央叫牌纸被拉满 */
  max-height: var(--bid-scroll-max, none);
  border: 1px solid #10241b;
  border-radius: 3px;
  overflow: auto;
  background: #92c0bc;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
}
.variant-table .bid-header {
  position: sticky;
  top: 0;
  z-index: 1;
  gap: 0;
  background: #d5dddd;
  border-bottom: 1px solid #10241b;
}
.variant-table .bid-header span {
  padding: 5px 0;
  color: #14211c;
  font-size: 15px;
  font-weight: 700;
  text-align: center;
  border-right: 1px solid rgba(16, 36, 27, 0.6);
}
/* 南北一方用橙色表头，东西一方用浅灰，和参考界面一致 */
.variant-table .bid-header span:nth-child(1),
.variant-table .bid-header span:nth-child(3) {
  background: #fe7b31;
}
.variant-table .bid-header span:last-child {
  border-right: 0;
}
.variant-table .bid-row {
  gap: 0;
}
.variant-table .bid-cell {
  min-height: 26px;
  padding: 3px 0;
  border-right: 0;
  border-radius: 0;
  color: #10201b;
}
.variant-table.interactive .bid-cell:not(.thinking) {
  cursor: help;
}
.variant-table.interactive .bid-cell:not(.thinking):hover {
  background: rgba(255, 255, 255, 0.22);
}
.variant-table .bid-cell.alerted {
  background: #ffffff;
  box-shadow: inset 0 0 0 1px rgba(16, 36, 27, 0.25);
}
.variant-table .bid-level {
  font-size: 16px;
  color: #10201b;
}
.variant-table .bid-suit {
  font-size: 21px;
}
.variant-table .bid-suit.red {
  color: #d81b1b;
}
.variant-table .bid-suit.nt {
  font-size: 13px;
}
.variant-table .bid-label {
  font-size: 14px;
  color: #10201b;
}
.variant-table .bid-cell.thinking .bid-label {
  font-size: 18px;
  font-weight: 800;
}
.variant-table .bid-label.final {
  font-size: 18px;
  color: #10201b;
}
.variant-table .muted {
  padding: 10px;
  color: #3f5f57;
}
</style>
