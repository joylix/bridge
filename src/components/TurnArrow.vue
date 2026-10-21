<script setup lang="ts">
import type { Position } from '../models/gameState';

defineProps<{
  /** 箭头指向的座位 */
  position: Position;
}>();
</script>

<template>
  <span class="turn-arrow" :class="`pos-${position}`" role="img" aria-label="轮到该座位出牌">
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M24 3 44 24H33v21H15V24H4Z" />
    </svg>
  </span>
</template>

<style scoped>
/* 橙色与白色交替闪烁，从内圈指向该座位的手牌 */
.turn-arrow {
  position: absolute;
  z-index: 5;
  width: 30px;
  height: 30px;
  color: #ff9d1f;
  filter: drop-shadow(0 0 7px rgba(255, 145, 15, 0.95));
  animation: turn-arrow-blink 0.8s step-end infinite;
  pointer-events: none;
}
.turn-arrow svg {
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
  transform: rotate(180deg);
}
/* 西家：手牌右侧，箭头朝左指向手牌 */
.turn-arrow.pos-W {
  top: 50%;
  left: calc(100% + 2px);
  margin-top: -15px;
  transform: rotate(-90deg);
}
/* 东家：手牌左侧，箭头朝右指向手牌 */
.turn-arrow.pos-E {
  top: 50%;
  right: calc(100% + 2px);
  margin-top: -15px;
  transform: rotate(90deg);
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
