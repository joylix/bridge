<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Contract, GameState, Position } from '../models/gameState';
import { ORDER } from '../models/gameState';
import type { Hand } from '../models/hand';
import { toPbnDeal } from '../core/pbn';
import { analyzeDeal, disposeDdsWorker, isDdsAvailable } from '../ai/dds/client';
import {
  DD_SEATS,
  DD_STRAINS,
  formatParScore,
  makeableContracts,
  type DdStrain,
  type DdsAnalysis,
} from '../ai/dds/types';

const props = defineProps<{
  hands: Record<Position, Hand>;
  dealer: Position;
  vulnerability: GameState['vulnerability'];
  contract?: Contract | null;
  /** 外部分栏已经提供标题时，隐藏面板内部的标题行 */
  showHeader?: boolean;
}>();

const analysis = ref<DdsAnalysis | null>(null);
const loading = ref(false);
const error = ref('');
let requestToken = 0;

const pbn = computed(() => {
  try {
    return toPbnDeal(props.hands);
  } catch {
    return '';
  }
});

const canAnalyze = computed(() => {
  if (!pbn.value) return false;
  return ORDER.every((seat) => (props.hands[seat]?.length ?? 0) === 13);
});

const dealKey = computed(
  () => `${props.dealer}|${props.vulnerability}|${canAnalyze.value ? pbn.value : ''}`,
);

const STRAIN_LABEL: Record<DdStrain, string> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
  NT: 'NT',
};

const RED_STRAINS = new Set<DdStrain>(['H', 'D']);

function strainLabel(strain: DdStrain): string {
  return STRAIN_LABEL[strain];
}

const contractCell = computed(() => {
  if (!props.contract) return null;
  const row = DD_STRAINS.indexOf(props.contract.suit);
  const col = DD_SEATS.indexOf(props.contract.declarer);
  if (row < 0 || col < 0) return null;
  return { row, col };
});

function isActual(row: number, col: number): boolean {
  return contractCell.value?.row === row && contractCell.value?.col === col;
}

const makeable = computed(() => (analysis.value ? makeableContracts(analysis.value.table) : []));

const parScoreText = computed(() =>
  analysis.value?.par ? formatParScore(analysis.value.par.score) : '—',
);

const parContractsText = computed(() => analysis.value?.par?.contracts.join(' · ') ?? '');

function run(): void {
  const token = ++requestToken;
  const key = dealKey.value;
  analysis.value = null;
  error.value = '';

  if (!key || !canAnalyze.value) {
    loading.value = false;
    return;
  }
  if (!isDdsAvailable()) {
    loading.value = false;
    error.value = '当前浏览器环境不支持 Web Worker，无法运行双明手分析。';
    return;
  }

  loading.value = true;
  analyzeDeal({
    hands: props.hands,
    dealer: props.dealer,
    vulnerability: props.vulnerability,
  })
    .then((result) => {
      if (token !== requestToken) return;
      analysis.value = result;
    })
    .catch((reason: unknown) => {
      if (token !== requestToken) return;
      error.value = reason instanceof Error ? reason.message : String(reason);
    })
    .finally(() => {
      if (token === requestToken) loading.value = false;
    });
}

watch(dealKey, run, { immediate: true });

onBeforeUnmount(() => {
  requestToken += 1;
  disposeDdsWorker();
});
</script>

<template>
  <section class="dd-analysis">
    <div v-if="props.showHeader !== false" class="dd-head">
      <div class="dd-title-wrap">
        <h4>双明手分析</h4>
        <span class="dd-sub">DDS · 四家明牌的最优结果</span>
      </div>
      <span v-if="analysis" class="dd-time">用时 {{ analysis.elapsedMs }} ms</span>
    </div>

    <div v-if="loading" class="dd-state">
      <span class="dd-spinner" aria-hidden="true"></span>
      <span>正在求解双明手结果…</span>
    </div>

    <div v-else-if="error" class="dd-state dd-error">
      <span>{{ error }}</span>
      <el-button size="small" text type="primary" @click="run">重试</el-button>
    </div>

    <template v-else-if="analysis">
      <div class="dd-body">
        <div class="dd-table-wrap">
          <table class="dd-table">
            <thead>
              <tr>
                <th class="dd-strain-col">定约</th>
                <th v-for="seat in DD_SEATS" :key="seat">{{ seat }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(strain, row) in DD_STRAINS" :key="strain">
                <th class="dd-strain-col" :class="{ red: RED_STRAINS.has(strain) }">
                  {{ strainLabel(strain) }}
                </th>
                <td
                  v-for="(seat, col) in DD_SEATS"
                  :key="seat"
                  :class="{
                    makes: (analysis.table[row]?.[col] ?? 0) >= 7,
                    actual: isActual(row, col),
                  }"
                  :title="`${seat} 打 ${strainLabel(strain)} 可赢 ${analysis.table[row]?.[col] ?? 0} 墩`"
                >
                  {{ analysis.table[row]?.[col] ?? '—' }}
                </td>
              </tr>
            </tbody>
          </table>
          <p class="dd-table-note">表中为各庄家在各将牌下的可赢墩数；绿色 ≥ 7 墩（可成约），描边为实际定约。</p>
        </div>

        <aside class="dd-side">
          <div class="dd-par">
            <span class="dd-par-label">Par 定约</span>
            <strong class="dd-par-score">{{ parScoreText }}</strong>
            <span v-if="parContractsText" class="dd-par-contracts">{{ parContractsText }}</span>
            <span v-else class="dd-par-contracts muted">本副未返回 Par 结果</span>
          </div>

          <div class="dd-makeable">
            <span class="dd-makeable-label">可成约定约</span>
            <div v-if="makeable.length" class="dd-chips">
              <span
                v-for="item in makeable"
                :key="item.strain"
                class="dd-chip"
                :class="{ red: RED_STRAINS.has(item.strain) }"
              >
                {{ item.tricks - 6 }}{{ strainLabel(item.strain) }} {{ item.seats.join('/') }} · {{ item.tricks }} 墩
              </span>
            </div>
            <span v-else class="muted">无 7 墩以上定约</span>
          </div>
        </aside>
      </div>
      <p class="dd-note">双明手假设四家明牌且双方最优攻防，仅用于复盘参考，不代表实际对局结果。</p>
    </template>

    <div v-else class="dd-state muted">牌局数据不完整，暂时无法进行双明手分析。</div>
  </section>
</template>

<style scoped>
.dd-analysis {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dd-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.dd-title-wrap {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.dd-title-wrap h4 {
  margin: 0;
  font-size: 12px;
  color: #14563a;
  letter-spacing: 0.4px;
}
.dd-sub {
  font-size: 11px;
  color: #8a9790;
}
.dd-time {
  font-size: 11px;
  color: #55705f;
  background: #eef6f0;
  border: 1px solid #d4e8da;
  border-radius: 999px;
  padding: 1px 8px;
  white-space: nowrap;
}
.dd-state {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 72px;
  padding: 10px 12px;
  border: 1px dashed #d9e4dc;
  border-radius: 8px;
  color: #55705f;
  font-size: 13px;
  background: #fafcfb;
}
.dd-error {
  border-color: #ecd9b5;
  background: #fffbf0;
  color: #8a5a00;
  flex-wrap: wrap;
}
.dd-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #cfe4d6;
  border-top-color: #2f7a52;
  border-radius: 50%;
  animation: dd-spin 0.8s linear infinite;
  flex: none;
}
@keyframes dd-spin {
  to {
    transform: rotate(360deg);
  }
}
.dd-body {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(220px, 0.8fr);
  gap: 14px;
  align-items: start;
}
.dd-table-wrap {
  min-width: 0;
}
.dd-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-variant-numeric: tabular-nums;
  border: 1px solid #dfe8e2;
  border-radius: 8px;
  overflow: hidden;
}
.dd-table th,
.dd-table td {
  text-align: center;
  padding: 5px 8px;
  border-bottom: 1px solid #edf2ee;
  font-size: 13px;
}
.dd-table thead th {
  background: #f2f7f4;
  color: #55705f;
  font-size: 11px;
  font-weight: 600;
}
.dd-table tbody tr:last-child th,
.dd-table tbody tr:last-child td {
  border-bottom: 0;
}
.dd-table .dd-strain-col {
  width: 52px;
  color: #44584b;
  font-weight: 700;
}
.dd-table th.red {
  color: #b0433a;
}
.dd-table td {
  color: #5b6a61;
  background: #fff;
}
.dd-table td.makes {
  color: #14563a;
  font-weight: 700;
  background: #f1faf4;
}
.dd-table td.actual {
  outline: 2px solid #b98a2d;
  outline-offset: -2px;
  background: #fff7df;
}
.dd-table-note {
  margin: 5px 0 0;
  font-size: 11px;
  color: #8a9790;
}
.dd-side {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dd-par {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 11px;
  border-radius: 8px;
  background: linear-gradient(160deg, #f4f9f6, #edf5ef);
  border: 1px solid #d9e8df;
}
.dd-par-label,
.dd-makeable-label {
  font-size: 11px;
  color: #6a7770;
}
.dd-par-score {
  font-size: 20px;
  color: #14563a;
  line-height: 1.2;
}
.dd-par-contracts {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: #8a5a00;
  overflow-wrap: anywhere;
}
.dd-makeable {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px 11px;
  border: 1px solid #e4ebe6;
  border-radius: 8px;
  background: #fcfdfc;
}
.dd-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.dd-chip {
  font-size: 11px;
  color: #14563a;
  background: #eef7f1;
  border: 1px solid #d6eadd;
  border-radius: 999px;
  padding: 1px 7px;
}
.dd-chip.red {
  color: #a23c34;
  background: #fdf2f0;
  border-color: #f0d7d3;
}
.muted {
  color: #8a9790;
  font-size: 12px;
}
.dd-note {
  margin: 0;
  font-size: 11px;
  color: #8a9790;
}
@media (max-width: 720px) {
  .dd-body {
    grid-template-columns: 1fr;
  }
}
</style>
