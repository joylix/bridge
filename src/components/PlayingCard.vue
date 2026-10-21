<script setup lang="ts">
import { computed } from 'vue';
import { cardLabel, getRank, getSuit, isRedSuit, rankName, suitSymbol } from '../models/card';

const props = withDefaults(
  defineProps<{
    card?: number | null;
    /** 牌背（暗手） */
    back?: boolean;
    /** 牌面尺寸：手牌、中央出牌、结果弹窗等共用 */
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
    /** 是否可点击 */
    clickable?: boolean;
    /** 当前行动高亮 */
    active?: boolean;
    /** 左键选中：牌面微微上移 */
    selected?: boolean;
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
    selected: false,
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
      { clickable, active, selected, court, ace, 'suit-first': labelMode === 'suit-first' },
    ]"
    :data-suit="suit"
    :data-rank="rank"
    :disabled="!clickable"
    @click="emit('click')"
  >
    <span class="pc-label">
      <template v-if="labelMode === 'suit-first'">
        <span class="suit-symbol">{{ suit }}</span><span>{{ rank }}</span>
      </template>
      <template v-else>{{ label }}</template>
    </span>
    <span class="pc-corner-suit suit-symbol" :data-suit="suit" aria-hidden="true" />
    <span
      class="pc-label pc-label-bottom"
      :class="{ 'split-label': labelMode === 'suit-first' }"
      :data-label="label"
      :data-suit="suit"
      :data-rank="rank"
      aria-hidden="true"
    ></span>
    <span class="pc-corner-suit pc-corner-suit-bottom suit-symbol" :data-suit="suit" aria-hidden="true" />
    <span class="pc-pips" :class="`pips-${pipCount}`" aria-hidden="true">
      <i v-for="i in pipCount" :key="i" class="pc-pip suit-symbol" :data-suit="suit" />
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
  /* 把角标/点阵的 z-index 限制在单张牌内，叠牌时不会透出盖住后面的牌 */
  isolation: isolate;
  overflow: hidden;
  padding: 0;
  appearance: none;
  border: 1px solid #c8bfae;
  background:
    radial-gradient(circle at 30% 16%, #ffffff 0%, rgba(255, 255, 255, 0) 54%),
    linear-gradient(145deg, #ffffff 0%, #fffefa 64%, #fdf9f2 100%);
  color: #111;
  font-family: 'Ubuntu Sans', 'Segoe UI', 'Helvetica Neue', Arial, 'PingFang SC',
    'Microsoft YaHei', system-ui, sans-serif;
  font-synthesis: none;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18), inset 0 0 0 1px rgba(255, 255, 255, 0.92);
  vertical-align: middle;
  user-select: none;
}
.playing-card::before {
  content: '';
  position: absolute;
  inset: 2px;
  border: 1px solid rgba(120, 105, 72, 0.07);
  border-radius: inherit;
  pointer-events: none;
}

.playing-card.red {
  color: #c51f2a;
}
.playing-card.black {
  color: #101010;
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
.size-xxl {
  --pc-label-size: 21px;
  /* 手牌角部的花色比点数略小即可；太小时草花/黑桃不易辨认 */
  --pc-corner-size: 17px;
  --pc-pip-size: 21px;
  --pc-court-size: 52px;
  --pc-back-spade-size: 34px;
  width: 96px;
  height: 134px;
  border-radius: 10px;
}
/* 手牌（xxl）中间点阵向内侧收，给角部花色留出空间 */
.size-xxl .pc-pips {
  inset: 22% 24% 20% 24%;
}

/* 左上角点数与花色 */
.pc-label {
  position: absolute;
  top: 2px;
  left: 4px;
  z-index: 2;
  font-size: var(--pc-label-size);
  line-height: 1;
  font-weight: 500;
  letter-spacing: -0.015em;
  /* 角部索引与中央点阵接近时，用极浅描边隔开，避免变糊 */
  text-shadow: 0 0 1px rgba(255, 255, 255, 0.9);
}
.pc-corner-suit {
  position: absolute;
  top: calc(2px + var(--pc-label-size) + 1px);
  left: 4px;
  z-index: 2;
  font-size: var(--pc-corner-size);
  line-height: 1;
  font-weight: 500;
  text-shadow: 0 0 1px rgba(255, 255, 255, 0.9);
}
/* 花色符号比数字更细，接近参考图的清秀字形 */
.pc-label .suit-symbol,
.pc-label-bottom.split-label::before {
  font-weight: 400;
}

/* 草花：只把花色符号改成蓝黑色，点数保持黑色 */
.playing-card[data-suit='♣'] .pc-label .suit-symbol,
.playing-card[data-suit='♣'] .pc-corner-suit,
.playing-card[data-suit='♣'] .pc-pip::before,
.playing-card[data-suit='♣'] .pc-label-bottom.split-label::before {
  color: var(--club-ink);
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

/* 右下角再显示一份同尺寸的牌名与花色，任意叠放顺序下至少有一侧可见 */
.pc-label-bottom {
  top: auto;
  right: 4px;
  bottom: 2px;
  left: auto;
}
.pc-label-bottom::before {
  content: attr(data-label);
}
/* suit-first 模式把花色和点数拆成两个伪元素，只有花色使用符号字体 */
.pc-label-bottom.split-label::before {
  content: attr(data-suit);
  font-family: var(--suit-font);
  font-variant-emoji: text;
}
.pc-label-bottom.split-label::after {
  content: attr(data-rank);
}
.pc-corner-suit-bottom {
  top: auto;
  right: 4px;
  bottom: calc(2px + var(--pc-label-size) + 1px);
  left: auto;
}
.suit-first .pc-label-bottom {
  right: 3px;
  left: auto;
  font-size: calc(var(--pc-label-size) - 1px);
  letter-spacing: -0.08em;
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
  font-weight: 400;
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
  font-weight: 600;
  line-height: 1;
  opacity: 0.92;
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
/* 左键选中的牌：上移弹出，再次点击或出牌后复原 */
.playing-card.selected,
.playing-card.selected:hover {
  transform: translateY(-12px);
  box-shadow: 0 10px 18px rgba(0, 0, 0, 0.42);
  outline: 2px solid #ffd666;
  outline-offset: 1px;
  z-index: 9;
}
.playing-card.active {
  outline: 2px solid #ffd666;
  outline-offset: 1px;
}
.playing-card:disabled {
  cursor: default;
}

/* 牌背：深蓝底 + 斜交浅色暗网纹；细黑轮廓 + 粗白边，内部不再加白线框 */
.playing-card.back {
  --pc-back-border: 4px;
  background-color: #12376f;
  background-image:
    repeating-linear-gradient(
      45deg,
      transparent 0 6px,
      rgba(185, 219, 255, 0.42) 6px 7px
    ),
    repeating-linear-gradient(
      -45deg,
      transparent 0 6px,
      rgba(185, 219, 255, 0.42) 6px 7px
    ),
    radial-gradient(circle at 50% 45%, rgba(76, 132, 205, 0.72) 0 24%, transparent 62%),
    linear-gradient(155deg, #0e2b5f 0%, #174785 58%, #0d2c61 100%);
  border: 1px solid #0b0b0b;
  box-shadow:
    inset 0 0 0 var(--pc-back-border) #f7f7f2,
    0 2px 5px rgba(0, 0, 0, 0.36);
}
.size-xs.back {
  --pc-back-border: 3px;
}
.size-sm.back {
  --pc-back-border: 4px;
}
.size-md.back {
  --pc-back-border: 5px;
}
.size-lg.back {
  --pc-back-border: 5px;
}
.size-xl.back,
.size-xxl.back {
  --pc-back-border: 6px;
}
.playing-card.back::before {
  content: none;
}
.playing-card.back::after {
  content: '♠';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.78);
  font-family: var(--suit-font);
  font-variant-emoji: text;
  font-size: var(--pc-back-spade-size, calc(var(--pc-pip-size) * 1.35));
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
}
</style>
