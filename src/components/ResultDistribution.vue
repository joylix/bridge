<script setup lang="ts">
import type { Contract, Position } from '../models/gameState';
import type { Hand } from '../models/hand';
import ResultHand from './ResultHand.vue';
import ResultText from './ResultText.vue';

withDefaults(
  defineProps<{
    hands: Record<Position, Hand>;
    vulnerability: string;
    contract: Contract | null;
    outcome: string;
    emptyText?: string;
  }>(),
  { emptyText: '流局' },
);

const SEAT_NAME: Record<Position, string> = {
  N: '北N_机器人',
  E: '东E_机器人',
  S: '南S_你',
  W: '西W_机器人',
};
</script>

<template>
  <div class="distribution">
    <div class="dist-info">
      <div class="dist-vul">{{ vulnerability }}</div>
      <div class="dist-result-label">结果:</div>
      <div class="dist-result">
        <ResultText
          :contract="contract"
          :outcome="outcome"
          :empty-text="emptyText"
          chinese
        />
      </div>
      <div class="dist-name dist-west-name">{{ SEAT_NAME.W }}</div>
    </div>

    <div class="dist-north">
      <ResultHand :cards="hands.N" />
    </div>

    <div class="dist-west">
      <ResultHand :cards="hands.W" />
    </div>

    <div class="dist-center" aria-hidden="true">
      <span class="center-label center-n">北</span>
      <span class="center-label center-w">西</span>
      <span class="center-label center-e">东</span>
      <span class="center-label center-s">南</span>
    </div>

    <div class="dist-east">
      <div class="dist-name dist-east-name">{{ SEAT_NAME.E }}</div>
      <ResultHand :cards="hands.E" />
    </div>

    <div class="dist-south">
      <ResultHand :cards="hands.S" />
    </div>
  </div>
</template>

<style scoped>
.distribution {
  --club-color: var(--club-on-dark);
  display: grid;
  flex: 1;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.12fr) minmax(0, 1fr);
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    'info north east'
    'west center east'
    'south south south';
  gap: 2px 4px;
  min-height: 0;
  padding: 5px 6px 4px;
  overflow: auto;
  background: #006b3f;
  color: #fff;
  box-sizing: border-box;
}
.dist-info {
  grid-area: info;
  align-self: start;
  min-width: 0;
  font-size: 11px;
  line-height: 1.45;
}
.dist-vul,
.dist-result-label {
  color: #f2f2f2;
}
.dist-result {
  color: #fff;
  font-size: 12px;
}
.dist-name {
  display: inline-block;
  max-width: 100%;
  margin-top: 2px;
  padding: 0 3px;
  border-radius: 1px;
  background: #0a6d70;
  color: #3ff4ff;
  font-size: 10px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dist-west-name {
  margin-top: 3px;
}
.dist-north {
  grid-area: north;
  align-self: start;
  justify-self: center;
}
.dist-west {
  grid-area: west;
  align-self: start;
  justify-self: start;
}
.dist-east {
  grid-area: east;
  align-self: start;
  justify-self: end;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.dist-east-name {
  margin: 0 0 2px;
}
.dist-south {
  grid-area: south;
  align-self: end;
  justify-self: center;
  padding-top: 2px;
}
.dist-center {
  position: relative;
  grid-area: center;
  min-height: 38px;
}
.center-label {
  position: absolute;
  color: #f0fff7;
  font-size: 11px;
  line-height: 1;
}
.center-n {
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
}
.center-w {
  top: 50%;
  left: 2px;
  transform: translateY(-50%);
}
.center-e {
  top: 50%;
  right: 2px;
  transform: translateY(-50%);
}
.center-s {
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
}
</style>
