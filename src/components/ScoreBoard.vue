<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore, describeContract, vulName } from '../store/game';
import { getSide } from '../models/gameState';

const store = useGameStore();

/** 定约方（NS / EW），无定约时为 null */
const declSide = computed(() => (store.contract ? getSide(store.contract.declarer) : null));

/** 双方当前已完成的墩数 */
const tricksBySide = computed<Record<'NS' | 'EW', number>>(() => {
  const counts = { NS: 0, EW: 0 };
  for (const t of store.tricks) counts[getSide(t.winner)] += 1;
  return counts;
});

/** 定约方成约所需墩数（定约阶数 + 6） */
const requiredTricks = computed(() => (store.contract ? store.contract.level + 6 : 0));

/** 定约方当前已得墩数 */
const declarerTricks = computed(() => (declSide.value ? tricksBySide.value[declSide.value] : 0));

/** 定约方进度描述 */
const progressText = computed(() => {
  if (!store.contract || !declSide.value) return '';
  const need = requiredTricks.value - declarerTricks.value;
  if (need <= 0) return `已完成 ${declarerTricks.value} 墩，确保成约`;
  return `已完成 ${declarerTricks.value} / ${requiredTricks.value} 墩，还需 ${need} 墩`;
});

/** 本局点数文案 */
const dealPointsLabel = computed(() => {
  if (store.phase !== 'scoring') return '—';
  const p = store.pointsSummary.dealPoints;
  if (p > 0) return `NS +${p}`;
  if (p < 0) return `EW +${-p}`;
  return '平';
});

/** 本局原始 IMP 文案（未贴点） */
const dealImpLabel = computed(() => {
  const p = store.pointsSummary.dealImp;
  if (p > 0) return `NS +${p}`;
  if (p < 0) return `EW +${-p}`;
  return '平';
});

/** 本局贴点调整量文案（带符号，NS 视角） */
const dealAdjustLabel = computed(() => {
  const a = store.pointsSummary.dealAdjust;
  if (a === 0) return '0';
  return a > 0 ? `NS +${a}` : `EW +${-a}`;
});

function toggleHcpAdjust(event: Event): void {
  store.setUseHcpAdjust((event.target as HTMLInputElement).checked);
}

/** 本循环总点数差（计点胜负）文案 */
const roundDiffLabel = computed(() => {
  const d = store.pointsSummary.roundDiff;
  if (d > 0) return `NS 领先 +${d}`;
  if (d < 0) return `EW 领先 +${-d}`;
  return '平';
});

const roundDone = computed(
  () => store.pointsSummary.dealsPlayed >= store.pointsSummary.roundSize,
);
</script>

<template>
  <div class="panel">
    <h3>定约</h3>
    <div class="contract-box" :class="{ empty: !store.contract }">
      <span class="contract-value">{{ store.contract ? describeContract(store.contract) : '—' }}</span>
      <span class="contract-sub">
        <span>局况 {{ vulName(store.vulnerability) }}</span>
        <span v-if="store.contract">需 {{ requiredTricks }} 墩（{{ store.contract.level }} + 6）</span>
        <span v-else>尚未确立定约</span>
      </span>
    </div>

    <h3 class="section-title">赢墩</h3>
    <div class="tricks">
      <div class="side" :class="{ 'is-decl': declSide === 'NS' }">
        <span class="side-name">NS</span>
        <span class="side-value">{{ tricksBySide.NS }}</span>
        <span v-if="declSide === 'NS'" class="decl-tag">定约方</span>
      </div>
      <div class="side" :class="{ 'is-decl': declSide === 'EW' }">
        <span class="side-name">EW</span>
        <span class="side-value">{{ tricksBySide.EW }}</span>
        <span v-if="declSide === 'EW'" class="decl-tag">定约方</span>
      </div>
    </div>
    <p v-if="store.contract" class="progress">{{ declSide }} · {{ progressText }}</p>

    <h3 class="section-title">
      计点（第 {{ store.pointsSummary.roundNumber }} 循环 ·
      {{ store.pointsSummary.roundSize }} 副）
    </h3>
    <div class="points">
      <div class="points-row">
        <span>本局点数</span>
        <strong>{{ dealPointsLabel }}</strong>
      </div>
      <label class="hcp-toggle">
        <input type="checkbox" :checked="store.useHcpAdjust" @change="toggleHcpAdjust" />
        贴点制
      </label>
      <template v-if="store.useHcpAdjust">
        <div class="points-row">
          <span>本局双方大牌点</span>
          <strong>{{ store.pointsSummary.dealHcp.NS }} : {{ store.pointsSummary.dealHcp.EW }}</strong>
        </div>
        <div class="points-row">
          <span>本局原始 IMP</span>
          <strong>{{ dealImpLabel }}</strong>
        </div>
        <div class="points-row">
          <span>贴点调整</span>
          <strong>{{ dealAdjustLabel }}</strong>
        </div>
      </template>
      <div class="points-row">
        <span>NS 累计点数</span>
        <strong>{{ store.pointsSummary.roundNS }}</strong>
      </div>
      <div class="points-row">
        <span>EW 累计点数</span>
        <strong>{{ store.pointsSummary.roundEW }}</strong>
      </div>
      <div class="points-row total">
        <span>总点数差（计点胜负）</span>
        <strong>{{ roundDiffLabel }}</strong>
      </div>
      <p class="points-progress">
        本循环已完成 {{ store.pointsSummary.dealsPlayed }} / {{ store.pointsSummary.roundSize }} 副
        <span v-if="roundDone"> · 循环结束</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.section-title {
  margin-top: 12px;
}
.contract-box {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-radius: 8px;
  background: linear-gradient(160deg, #e8f5ec, #d7ecdf);
  border: 1px solid #b6dcc4;
}
.contract-box.empty {
  background: #eef1ef;
  border-color: #dfe5e1;
}
.contract-value {
  font-size: 18px;
  font-weight: 700;
  color: #14563a;
}
.contract-box.empty .contract-value {
  font-size: 14px;
  color: #8a9790;
}
.contract-sub {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: #5a6a61;
  flex-wrap: wrap;
}
.tricks {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.side {
  position: relative;
  text-align: center;
  border-radius: 8px;
  padding: 8px;
  background: #eef4ef;
}
.side.is-decl {
  background: #fff6d8;
  box-shadow: inset 0 0 0 1px #e6cf7a;
}
.side-name {
  display: block;
  font-size: 12px;
  color: #77857c;
}
.side-value {
  font-size: 22px;
  font-weight: 700;
  color: #14563a;
}
.decl-tag {
  position: absolute;
  top: 4px;
  right: 6px;
  font-size: 10px;
  color: #8a5a00;
  background: #ffe9a8;
  border-radius: 3px;
  padding: 0 4px;
}
.progress {
  margin: 8px 0 0;
  font-size: 12px;
  color: #6b5200;
  background: #fff6d8;
  border: 1px solid #e6cf7a;
  border-radius: 6px;
  padding: 5px 8px;
}
.points {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.points-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #5a6a61;
  padding: 2px 0;
  border-bottom: 1px dashed #e2e8e4;
}
.points-row strong {
  color: #24352b;
}
.points-row.total {
  border-bottom: none;
  color: #14563a;
  font-weight: 600;
}
.points-row.total strong {
  color: #8a5a00;
  font-size: 15px;
}
.hcp-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #5a6a61;
  padding: 4px 0 2px;
  cursor: pointer;
}
.hcp-toggle input {
  accent-color: #2f855a;
}
.points-progress {
  margin: 4px 0 0;
  font-size: 12px;
  color: #6a7770;
}
</style>
