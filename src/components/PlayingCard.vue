<script setup lang="ts">
import { computed } from 'vue';
import { cardLabel, getRank, getSuit, isRedSuit, rankName, suitSymbol } from '../models/card';

const props = withDefaults(
  defineProps<{
    card?: number | null;
    /** 牌背（暗手） */
    back?: boolean;
    /** 牌面尺寸：手牌、中央出牌、结果弹窗等共用 */
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    /** 是否可点击 */
    clickable?: boolean;
    /** 当前行动高亮 */
    active?: boolean;
    /**
     * 文本标签：
     * - rank：只输出点数（手牌，兼容既有“按点数排序”的测试/布局）
     * - suit-first：输出“花色 + 点数”（中央出牌、复盘记录）
     */
    labelMode?: 'rank' | 'suit-first';
  }>(),
  {
    card: null,
    back: false,
    size: 'sm',
    clickable: false,
    active: false,
    labelMode: 'rank',
  },
);

const emit = defineEmits<{ (e: 'click'): void }>();

const rank = computed(() => (props.card === null || props.card === undefined ? '' : rankName(props.card)));
const suit = computed(() => (props.card === null || props.card === undefined ? '' : suitSymbol(getSuit(props.card))));
const red = computed(() => props.card !== null && props.card !== undefined && isRedSuit(getSuit(props.card)));
const label = computed(() =>
  props.card === null || props.card === undefined
    ? ''
    : props.labelMode === 'suit-first'
      ? cardLabel(props.card)
      : rank.value,
);

/** 2-10 用点数点阵；J/Q/K/A 用大花色 + 中央字母 */
const pipCount = computed(() => {
  if (props.card === null || props.card === undefined) return 0;
  const r = getRank(props.card);
  return r >= 9 ? 1 : r + 2;
});
const court = computed(() => {
  if (props.card === null || props.card === undefined) return false;
  const r = getRank(props.card);
  return r >= 9 && r <= 11;
});
const ace = computed(() => {
  if (props.card === null || props.card === undefined) return false;
  return getRank(props.card) === 12;
});
</script>

<template>
  <div v-if="back" class="playing-card card back" :class="`size-${size}`" aria-hidden="true" />
  <button
    v-else
    type="button"
    class="playing-card card"
    :class="[
      `size-${size}`,
      red ? 'red' : 'black',
      { clickable, active, court, ace, 'suit-first': labelMode === 'suit-first' },
    ]"
    :data-suit="suit"
    :data-rank="rank"
    :disabled="!clickable"
    @click="emit('click')"
  >
    <span class="pc-label">{{ label }}</span>
    <span class="pc-corner-suit" :data-suit="suit" aria-hidden="true" />
    <span class="pc-pips" :class="`pips-${pipCount}`" aria-hidden="true">
      <i v-for="i in pipCount" :key="i" class="pc-pip" :data-suit="suit" />
    </span>
    <span v-if="court" class="pc-court" :data-court="rank" aria-hidden="true" />
  </button>
</template>

<style scoped>
.playing-card {
  --pc-label-size: 11px;
  --pc-corner-size: 8px;
  --pc-pip-size: 10px;
  --pc-court-size: 22px;
  position: relative;
  display: inline-flex;
  flex: none;
  overflow: hidden;
  padding: 0;
  appearance: none;
  border: 1px solid #cfc6b4;
  background:
    radial-gradient(circle at 30% 18%, rgba(255, 255, 255, 0.95), transparent 45%),
    linear-gradient(145deg, #fffef9 0%, #f8f4e9 58%, #ece5d3 100%);
  color: #1c2b22;
  font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.26), inset 0 0 0 1px rgba(255, 255, 255, 0.55);
  vertical-align: middle;
  user-select: none;
}
.playing-card::before {
  content: '';
  position: absolute;
  inset: 2px;
  border: 1px solid rgba(120, 105, 72, 0.14);
  border-radius: inherit;
  pointer-events: none;
}

.playing-card.red {
  color: #c22b2b;
}
.playing-card.black {
  color: #17241d;
}

/* 尺寸 */
.size-xs {
  --pc-label-size: 8px;
  --pc-corner-size: 6px;
  --pc-pip-size: 7px;
  --pc-court-size: 13px;
  width: 22px;
  height: 30px;
  border-radius: 3px;
}
.size-sm {
  --pc-label-size: 10px;
  --pc-corner-size: 7px;
  --pc-pip-size: 9px;
  --pc-court-size: 20px;
  width: 34px;
  height: 48px;
  border-radius: 4px;
}
.size-md {
  --pc-label-size: 13px;
  --pc-corner-size: 10px;
  --pc-pip-size: 14px;
  --pc-court-size: 30px;
  width: 54px;
  height: 76px;
  border-radius: 6px;
}
.size-lg {
  --pc-label-size: 15px;
  --pc-corner-size: 11px;
  --pc-pip-size: 17px;
  --pc-court-size: 36px;
  width: 64px;
  height: 90px;
  border-radius: 7px;
}
.size-xl {
  --pc-label-size: 17px;
  --pc-corner-size: 12px;
  --pc-pip-size: 20px;
  --pc-court-size: 42px;
  width: 76px;
  height: 106px;
  border-radius: 8px;
}

/* 左上角点数与花色 */
.pc-label {
  position: absolute;
  top: 2px;
  left: 4px;
  z-index: 2;
  font-size: var(--pc-label-size);
  line-height: 1;
  font-weight: 800;
  letter-spacing: -0.03em;
}
.pc-corner-suit {
  position: absolute;
  top: calc(2px + var(--pc-label-size) + 1px);
  left: 4px;
  z-index: 2;
  font-size: var(--pc-corner-size);
  line-height: 1;
  font-weight: 700;
}
.pc-corner-suit::before {
  content: attr(data-suit);
}
.suit-first .pc-label {
  left: 3px;
  font-size: calc(var(--pc-label-size) - 1px);
  letter-spacing: -0.08em;
}
.suit-first .pc-corner-suit {
  display: none;
}

/* 中央点阵 */
.pc-pips {
  position: absolute;
  inset: 21% 18% 13% 18%;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(5, 1fr);
  align-items: center;
  justify-items: center;
  pointer-events: none;
}
.pc-pip::before {
  content: attr(data-suit);
  display: block;
  font-size: var(--pc-pip-size);
  line-height: 1;
  font-weight: 700;
}
.pips-1 .pc-pip {
  grid-area: 3 / 2;
}
.pips-2 .pc-pip:nth-child(1) {
  grid-area: 1 / 2;
}
.pips-2 .pc-pip:nth-child(2) {
  grid-area: 5 / 2;
}
.pips-3 .pc-pip:nth-child(1) {
  grid-area: 1 / 2;
}
.pips-3 .pc-pip:nth-child(2) {
  grid-area: 3 / 2;
}
.pips-3 .pc-pip:nth-child(3) {
  grid-area: 5 / 2;
}
.pips-4 .pc-pip:nth-child(1) {
  grid-area: 1 / 1;
}
.pips-4 .pc-pip:nth-child(2) {
  grid-area: 1 / 3;
}
.pips-4 .pc-pip:nth-child(3) {
  grid-area: 5 / 1;
}
.pips-4 .pc-pip:nth-child(4) {
  grid-area: 5 / 3;
}
.pips-5 .pc-pip:nth-child(1) {
  grid-area: 1 / 1;
}
.pips-5 .pc-pip:nth-child(2) {
  grid-area: 1 / 3;
}
.pips-5 .pc-pip:nth-child(3) {
  grid-area: 3 / 2;
}
.pips-5 .pc-pip:nth-child(4) {
  grid-area: 5 / 1;
}
.pips-5 .pc-pip:nth-child(5) {
  grid-area: 5 / 3;
}
.pips-6 .pc-pip:nth-child(1) {
  grid-area: 1 / 1;
}
.pips-6 .pc-pip:nth-child(2) {
  grid-area: 1 / 3;
}
.pips-6 .pc-pip:nth-child(3) {
  grid-area: 3 / 1;
}
.pips-6 .pc-pip:nth-child(4) {
  grid-area: 3 / 3;
}
.pips-6 .pc-pip:nth-child(5) {
  grid-area: 5 / 1;
}
.pips-6 .pc-pip:nth-child(6) {
  grid-area: 5 / 3;
}
.pips-7 .pc-pip:nth-child(1) {
  grid-area: 1 / 1;
}
.pips-7 .pc-pip:nth-child(2) {
  grid-area: 1 / 3;
}
.pips-7 .pc-pip:nth-child(3) {
  grid-area: 2 / 2;
}
.pips-7 .pc-pip:nth-child(4) {
  grid-area: 3 / 1;
}
.pips-7 .pc-pip:nth-child(5) {
  grid-area: 3 / 3;
}
.pips-7 .pc-pip:nth-child(6) {
  grid-area: 5 / 1;
}
.pips-7 .pc-pip:nth-child(7) {
  grid-area: 5 / 3;
}
.pips-8 .pc-pip:nth-child(1) {
  grid-area: 1 / 1;
}
.pips-8 .pc-pip:nth-child(2) {
  grid-area: 1 / 3;
}
.pips-8 .pc-pip:nth-child(3) {
  grid-area: 2 / 2;
}
.pips-8 .pc-pip:nth-child(4) {
  grid-area: 3 / 1;
}
.pips-8 .pc-pip:nth-child(5) {
  grid-area: 3 / 3;
}
.pips-8 .pc-pip:nth-child(6) {
  grid-area: 4 / 2;
}
.pips-8 .pc-pip:nth-child(7) {
  grid-area: 5 / 1;
}
.pips-8 .pc-pip:nth-child(8) {
  grid-area: 5 / 3;
}
.pips-9 .pc-pip:nth-child(1) {
  grid-area: 1 / 1;
}
.pips-9 .pc-pip:nth-child(2) {
  grid-area: 1 / 3;
}
.pips-9 .pc-pip:nth-child(3) {
  grid-area: 2 / 1;
}
.pips-9 .pc-pip:nth-child(4) {
  grid-area: 2 / 3;
}
.pips-9 .pc-pip:nth-child(5) {
  grid-area: 3 / 2;
}
.pips-9 .pc-pip:nth-child(6) {
  grid-area: 4 / 1;
}
.pips-9 .pc-pip:nth-child(7) {
  grid-area: 4 / 3;
}
.pips-9 .pc-pip:nth-child(8) {
  grid-area: 5 / 1;
}
.pips-9 .pc-pip:nth-child(9) {
  grid-area: 5 / 3;
}
.pips-10 .pc-pip:nth-child(1) {
  grid-area: 1 / 1;
}
.pips-10 .pc-pip:nth-child(2) {
  grid-area: 1 / 3;
}
.pips-10 .pc-pip:nth-child(3) {
  grid-area: 2 / 1;
}
.pips-10 .pc-pip:nth-child(4) {
  grid-area: 2 / 2;
}
.pips-10 .pc-pip:nth-child(5) {
  grid-area: 2 / 3;
}
.pips-10 .pc-pip:nth-child(6) {
  grid-area: 3 / 1;
}
.pips-10 .pc-pip:nth-child(7) {
  grid-area: 3 / 3;
}
.pips-10 .pc-pip:nth-child(8) {
  grid-area: 4 / 1;
}
.pips-10 .pc-pip:nth-child(9) {
  grid-area: 4 / 3;
}
.pips-10 .pc-pip:nth-child(10) {
  grid-area: 5 / 2;
}

/* 小尺寸牌不展开点阵，只保留一个中央花色 */
.size-xs .pc-pips {
  inset: 20% 22% 16% 22%;
}
.size-xs .pc-pip {
  display: none;
}
.size-xs .pc-pip:first-child {
  display: block;
  grid-area: 3 / 2;
}
.size-xs .pc-pip:first-child::before {
  font-size: 12px;
}

/* J/Q/K：中央字母 + 淡淡的底纹花色 */
.pc-court {
  position: absolute;
  inset: 18% 10% 12% 10%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--pc-court-size);
  font-weight: 900;
  line-height: 1;
  opacity: 0.9;
  pointer-events: none;
}
.pc-court::before {
  content: attr(data-court);
}
.court .pc-pips {
  opacity: 0.14;
}
.ace .pc-pip::before {
  font-size: calc(var(--pc-pip-size) * 1.55);
}

/* 可点击与高亮 */
.playing-card.clickable {
  cursor: pointer;
  transition: transform 0.1s ease, box-shadow 0.1s ease;
}
.playing-card.clickable:hover {
  transform: translateY(-5px);
  box-shadow: 0 7px 14px rgba(0, 0, 0, 0.38);
  z-index: 5;
}
.playing-card.active {
  outline: 2px solid #ffd666;
  outline-offset: 1px;
}
.playing-card:disabled {
  cursor: default;
}

/* 牌背 */
.playing-card.back {
  background:
    radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.92) 0 12%, transparent 13%),
    repeating-linear-gradient(45deg, #1b357d 0 5px, #274b9e 5px 10px);
  border: 2px solid #f8f3e7;
  box-shadow: inset 0 0 0 2px #10265f, 0 2px 5px rgba(0, 0, 0, 0.35);
}
.playing-card.back::before {
  content: '';
  position: absolute;
  inset: 14%;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 2px;
}
.playing-card.back::after {
  content: '♠';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.9);
  font-size: calc(var(--pc-pip-size) * 1.6);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
</style>
