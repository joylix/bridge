<script setup lang="ts">
import { computed } from 'vue';
import type { Position } from '../models/gameState';
import { cardLabel } from '../models/card';

const props = defineProps<{
  /** 箭头指向的座位 */
  position: Position;
  /** 推荐牌；有值时箭头移动到这张牌的位置 */
  card?: number | null;
  /** 推荐理由；有值时箭头可悬停/聚焦显示浮层 */
  reason?: string | null;
}>();

const hasCardTarget = computed(() => props.card !== null && props.card !== undefined);
const cardText = computed(() => (hasCardTarget.value ? cardLabel(props.card as number) : '推荐牌'));
const ariaLabel = computed(() =>
  props.reason ? `推荐出 ${cardText.value}：${props.reason}` : '轮到该座位出牌',
);
</script>

<template>
  <span
    class="turn-arrow"
    :class="[`pos-${position}`, { 'has-reason': !!reason, 'card-target': hasCardTarget }]"
    role="img"
    :tabindex="reason ? 0 : undefined"
    :aria-label="ariaLabel"
  >
    <span class="turn-arrow-glyph" aria-hidden="true">
      <svg viewBox="0 0 48 48" focusable="false">
        <path d="M24 3 44 24H33v21H15V24H4Z" />
      </svg>
    </span>

    <!-- 推荐理由浮层：只有推荐箭头才有，悬停或键盘聚焦时显示 -->
    <span v-if="reason" class="turn-arrow-tip" role="tooltip">
      <span class="tip-title">推荐 {{ cardText }}</span>
      <span class="tip-text">{{ reason }}</span>
    </span>
  </span>
</template>

<style scoped>
/* 橙色与白色交替闪烁，从内圈指向该座位的手牌或具体推荐牌 */
.turn-arrow {
  position: absolute;
  z-index: 40;
  width: 30px;
  height: 30px;
  pointer-events: none;
}
/* 推荐箭头可悬停/聚焦；用透明热区扩大命中范围 */
.turn-arrow.has-reason {
  pointer-events: auto;
  cursor: help;
}
.turn-arrow.has-reason::before {
  content: '';
  position: absolute;
  inset: -7px;
}
.turn-arrow:focus-visible {
  border-radius: 6px;
  outline: 2px solid #ffffff;
  outline-offset: 2px;
}
.turn-arrow-glyph {
  display: block;
  width: 100%;
  height: 100%;
  color: #ff9d1f;
  filter: drop-shadow(0 0 7px rgba(255, 145, 15, 0.95));
  animation: turn-arrow-blink 0.8s step-end infinite;
}
.turn-arrow-glyph svg {
  display: block;
  width: 100%;
  height: 100%;
  fill: currentColor;
}
/* 北家：手牌下方，箭头朝上指向手牌 */
.turn-arrow.pos-N {
  top: calc(100% + 2px);
  left: 50%;
  margin-left: -15px;
}
/* 南家：手牌上方，箭头朝下指向手牌 */
.turn-arrow.pos-S {
  bottom: calc(100% + 2px);
  left: 50%;
  margin-left: -15px;
}
/* 西家：手牌右侧，箭头朝左指向手牌 */
.turn-arrow.pos-W {
  top: 50%;
  left: calc(100% + 2px);
  margin-top: -15px;
}
/* 东家：手牌左侧，箭头朝右指向手牌 */
.turn-arrow.pos-E {
  top: 50%;
  right: calc(100% + 2px);
  margin-top: -15px;
}
.turn-arrow.pos-S .turn-arrow-glyph {
  transform: rotate(180deg);
}
.turn-arrow.pos-W .turn-arrow-glyph {
  transform: rotate(-90deg);
}
.turn-arrow.pos-E .turn-arrow-glyph {
  transform: rotate(90deg);
}

/* 推荐牌：箭头贴在该牌上方（北家贴下方），直接指向牌面 */
.turn-arrow.card-target.pos-N,
.turn-arrow.card-target.pos-S,
.turn-arrow.card-target.pos-W,
.turn-arrow.card-target.pos-E {
  top: auto;
  right: auto;
  bottom: calc(100% + 2px);
  /* 手牌横向叠放时只露出左侧约 30px，箭头对准露出的牌角而不是被盖住的牌中心 */
  left: 15px;
  margin: 0 0 0 -15px;
}
.turn-arrow.card-target.pos-N {
  top: calc(100% + 2px);
  bottom: auto;
}
.turn-arrow.card-target.pos-S .turn-arrow-glyph,
.turn-arrow.card-target.pos-W .turn-arrow-glyph,
.turn-arrow.card-target.pos-E .turn-arrow-glyph {
  transform: rotate(180deg);
}
.turn-arrow.card-target.pos-N .turn-arrow-glyph {
  transform: rotate(0deg);
}

/* 推荐理由浮层：高于牌面与手牌区域 */
.turn-arrow-tip {
  position: absolute;
  z-index: 60;
  bottom: calc(100% + 8px);
  left: 50%;
  display: flex;
  flex-direction: column;
  gap: 3px;
  box-sizing: border-box;
  width: max-content;
  max-width: 260px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(10, 38, 28, 0.94);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
  color: #f2fff9;
  font-size: 12px;
  line-height: 1.5;
  text-align: left;
  white-space: normal;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transform: translateX(-50%);
  transition: opacity 0.12s ease;
}
.turn-arrow.card-target.pos-N .turn-arrow-tip {
  top: calc(100% + 8px);
  bottom: auto;
}
/* 东西家靠近牌桌边缘：浮层向桌内展开，避免被牌桌裁切 */
.turn-arrow.card-target.pos-W .turn-arrow-tip {
  left: 0;
  transform: none;
}
.turn-arrow.card-target.pos-E .turn-arrow-tip {
  right: 0;
  left: auto;
  transform: none;
}
.turn-arrow:hover .turn-arrow-tip,
.turn-arrow:focus-visible .turn-arrow-tip {
  opacity: 1;
  visibility: visible;
}
.tip-title {
  color: #9ff0c5;
  font-weight: 700;
}
.tip-text {
  color: #e6fff5;
}

@keyframes turn-arrow-blink {
  0%,
  49.9% {
    color: #ff9d1f;
    filter: drop-shadow(0 0 7px rgba(255, 145, 15, 0.95));
  }
  50%,
  100% {
    color: #ffffff;
    filter: drop-shadow(0 0 7px rgba(255, 255, 255, 0.95));
  }
}
</style>
