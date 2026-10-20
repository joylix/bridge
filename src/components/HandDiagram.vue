<script setup lang="ts">
import { computed } from 'vue';
import { getSuit, isRedSuit, rankName, suitSymbol, type SuitIndex } from '../models/card';
import { sortHand } from '../models/hand';
import { hcp } from '../core/evaluate';
import type { Position } from '../models/gameState';

const props = withDefaults(
  defineProps<{
    cards: number[];
    position: Position;
    label?: string;
    /** 定约方标记 */
    role?: 'declarer' | 'dummy' | '';
  }>(),
  { label: '', role: '' },
);

/** 展示顺序与牌桌一致：♠ ♥ ♣ ♦ */
const SUIT_ROWS: SuitIndex[] = [3, 2, 0, 1];

const rows = computed(() =>
  SUIT_ROWS.map((suit) => ({
    suit,
    symbol: suitSymbol(suit),
    red: isRedSuit(suit),
    ranks: sortHand(props.cards)
      .filter((card) => getSuit(card) === suit)
      .map((card) => rankName(card)),
  })),
);

const hcpValue = computed(() => hcp(props.cards));
const displayLabel = computed(() => props.label || props.position);
</script>

<template>
  <div class="hand-diagram" :class="[`pos-${position}`, { declarer: role === 'declarer', dummy: role === 'dummy' }]">
    <header class="hd-head">
      <span class="hd-pos">{{ displayLabel }}</span>
      <span v-if="role" class="hd-role">{{ role === 'declarer' ? '庄家' : '明手' }}</span>
      <span class="hd-hcp">{{ hcpValue }} 点</span>
    </header>
    <div class="hd-body">
      <div v-for="row in rows" :key="row.suit" class="hd-row">
        <span class="hd-suit suit-symbol" :class="{ red: row.red, 'suit-club': row.symbol === '♣' }">{{ row.symbol }}</span>
        <span class="hd-ranks" :class="{ red: row.red }">
          <template v-if="row.ranks.length">{{ row.ranks.join(' ') }}</template>
          <span v-else class="hd-void">—</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hand-diagram {
  border: 1px solid #d8dfd9;
  border-radius: 9px;
  background: linear-gradient(160deg, #fbfdfb, #f1f6f2);
  padding: 7px 9px;
  min-width: 0;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}
.hand-diagram.declarer {
  border-color: #d8b75d;
  background: linear-gradient(160deg, #fffdf4, #fbf3d9);
}
.hand-diagram.dummy {
  border-color: #9fc7ad;
  background: linear-gradient(160deg, #f7fdf8, #eaf6ed);
}
.hd-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 5px;
  margin-bottom: 5px;
  border-bottom: 1px dashed #dbe4dd;
}
.hd-pos {
  font-size: 12px;
  font-weight: 800;
  color: #14563a;
}
.hd-role {
  font-size: 9px;
  color: #6b5200;
  background: #ffe9a8;
  border-radius: 3px;
  padding: 0 4px;
}
.hd-hcp {
  margin-left: auto;
  font-size: 10px;
  color: #7a877f;
}
.hd-row {
  display: grid;
  grid-template-columns: 15px 1fr;
  align-items: baseline;
  gap: 4px;
  line-height: 1.35;
}
.hd-suit {
  font-size: 13px;
  font-weight: 700;
  color: #2b3a31;
  text-align: center;
}
.hd-suit.red,
.hd-ranks.red {
  color: #c0392b;
}
.hd-suit.suit-club {
  color: var(--club-ink);
}
.hd-ranks {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.2px;
  color: #24352b;
  word-spacing: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hd-void {
  color: #b3bdb6;
}
</style>
