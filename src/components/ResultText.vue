<script setup lang="ts">
import { computed } from 'vue';
import { suitName } from '../store/game';
import type { Contract, Position } from '../models/gameState';

const props = withDefaults(
  defineProps<{
    contract: Contract | null;
    /** 成约结果：= / +N / -N / 进行中 */
    outcome?: string;
    /** 是否使用中文座位（牌型分布中的“南 1NT +3”） */
    chinese?: boolean;
    emptyText?: string;
  }>(),
  { outcome: '', chinese: false, emptyText: '流局' },
);

const SEAT_CN: Record<Position, string> = { N: '北', E: '东', S: '南', W: '西' };

const declarer = computed(() =>
  props.contract ? (props.chinese ? SEAT_CN[props.contract.declarer] : props.contract.declarer) : '',
);
const suit = computed(() => (props.contract ? suitName(props.contract.suit) : ''));
const red = computed(() => props.contract?.suit === 'H' || props.contract?.suit === 'D');
const nt = computed(() => props.contract?.suit === 'NT');
const doubled = computed(() =>
  props.contract?.redoubled ? '×4' : props.contract?.doubled ? '×2' : '',
);
const outcomeClass = computed(() => {
  if (!props.outcome || props.outcome === '进行中') return 'pending';
  if (props.outcome === '=') return 'exact';
  if (props.outcome.startsWith('+')) return 'made';
  if (props.outcome.startsWith('-')) return 'down';
  return 'pending';
});
</script>

<template>
  <span v-if="!contract" class="rt-empty">{{ emptyText }}</span>
  <span v-else class="result-text" :class="{ chinese }">
    <span class="rt-declarer">{{ declarer }}</span>
    <span class="rt-contract">
      <span class="rt-level">{{ contract.level }}</span>
      <span class="rt-suit" :class="{ red, nt, 'suit-symbol': !nt, 'suit-club': suit === '♣' }">{{ suit }}</span>
      <span v-if="doubled" class="rt-double">{{ doubled }}</span>
    </span>
    <span v-if="outcome" class="rt-outcome" :class="outcomeClass">{{ outcome }}</span>
  </span>
</template>

<style scoped>
.rt-empty {
  color: inherit;
  font-weight: 700;
}
.result-text {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  white-space: nowrap;
}
.rt-declarer {
  font-weight: 800;
}
.rt-contract {
  display: inline-flex;
  align-items: baseline;
  gap: 0;
}
.rt-level {
  font-weight: 800;
}
.rt-suit {
  font-weight: 900;
  font-size: 1.12em;
  line-height: 1;
}
.rt-suit.red {
  color: #d52b2b;
}
.rt-suit.nt {
  font-size: 0.92em;
}
.rt-double {
  margin-left: 1px;
  font-size: 0.9em;
  font-weight: 800;
}
.rt-outcome {
  margin-left: 2px;
  font-weight: 800;
}
.rt-outcome.made {
  color: #ff5f9e;
}
.rt-outcome.exact {
  color: inherit;
}
.rt-outcome.down {
  color: #ffc1c1;
}
.rt-outcome.pending {
  color: inherit;
  font-size: 0.9em;
  font-weight: 600;
}
</style>
