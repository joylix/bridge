<script setup lang="ts">
import { computed } from 'vue';
import { suitName } from '../store/game';
import type { Contract } from '../models/gameState';

const props = defineProps<{
  contract: Contract | null;
  emptyText?: string;
}>();

const parts = computed(() => {
  if (!props.contract) return null;
  const c = props.contract;
  return {
    declarer: c.declarer,
    level: c.level,
    suit: suitName(c.suit),
    red: c.suit === 'D' || c.suit === 'H',
    nt: c.suit === 'NT',
    doubled: c.redoubled ? '×4' : c.doubled ? '×2' : '',
  };
});
</script>

<template>
  <span class="contract-display">
    <template v-if="parts">
      <span class="declarer">{{ parts.declarer }}</span>{{ ' ' }}<span class="level">{{ parts.level }}</span>
      <span class="suit" :class="{ red: parts.red, nt: parts.nt }">{{ parts.suit }}</span>
      <span v-if="parts.doubled" class="doubled">{{ parts.doubled }}</span>
    </template>
    <template v-else>{{ emptyText ?? '未定约' }}</template>
  </span>
</template>

<style scoped>
.contract-display {
  display: inline;
  white-space: nowrap;
}
.suit.red {
  color: #c0392b;
}
.suit.nt {
  font-size: 0.82em;
  letter-spacing: -0.5px;
}
.doubled {
  margin-left: 2px;
  font-size: 0.85em;
}
</style>
