<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGameStore, vulName } from '../store/game';
import type { Position } from '../models/gameState';
import BidHistory from './BidHistory.vue';
import ContractDisplay from './ContractDisplay.vue';
import ResultDistribution from './ResultDistribution.vue';
import ResultPlayTable from './ResultPlayTable.vue';
import DdAnalysisPanel from './DdAnalysisPanel.vue';

const open = defineModel<boolean>({ default: false });
const store = useGameStore();

/** 双明手分析放在最后，默认折叠；每次重新打开结果窗口都回到折叠状态 */
const ddOpen = ref(false);
watch(open, (visible) => {
  if (visible) ddOpen.value = false;
});

const COLUMNS: Position[] = ['N', 'E', 'S', 'W'];
const VUL_TEXT: Record<string, string> = {
  none: '无局',
  NS: '南北有局',
  EW: '东西有局',
  both: '双方有局',
};

const declarerTricks = computed(() => store.declarerTricksWon());
const requiredTricks = computed(() => (store.contract ? store.contract.level + 6 : 0));

const outcomeText = computed(() => {
  if (!store.contract) return '无定约';
  const diff = declarerTricks.value - requiredTricks.value;
  if (diff === 0) return '正好成约';
  if (diff > 0) return `超 ${diff} 墩`;
  return `宕 ${-diff} 墩`;
});

const dealPointsLabel = computed(() => {
  const p = store.pointsSummary.dealPoints;
  const base = p > 0 ? `NS +${p}` : p < 0 ? `EW +${-p}` : '平';
  const adj = store.pointsSummary.dealAdjust;
  if (store.useHcpAdjust && adj !== 0) {
    return `${base}（贴点 ${adj > 0 ? `NS +${adj}` : `EW +${-adj}`}）`;
  }
  return base;
});

const dealImpLabel = computed(() => {
  const p = store.pointsSummary.dealImp;
  if (p > 0) return `NS +${p}`;
  if (p < 0) return `EW +${-p}`;
  return '平';
});

const dealAdjustLabel = computed(() => {
  const a = store.pointsSummary.dealAdjust;
  if (a === 0) return '0';
  return a > 0 ? `NS +${a}` : `EW +${-a}`;
});

/** 紧凑结果格式：= / +N / -N，与计分表一致 */
const compactOutcome = computed(() => {
  if (!store.contract) return '';
  const diff = declarerTricks.value - requiredTricks.value;
  if (diff === 0) return '=';
  return diff > 0 ? `+${diff}` : String(diff);
});

const vulnerabilityText = computed(() => VUL_TEXT[store.vulnerability] ?? '无局');
const resultEmptyText = computed(() => (store.phase === 'scoring' ? '流局' : '未定约'));

/** 结算后 state.hands 已被出牌消耗，优先使用发牌快照 */
const hands = computed(() => {
  const snapshot = store.dealHands;
  const hasCards = COLUMNS.some((pos) => (snapshot[pos]?.length ?? 0) > 0);
  return hasCards ? snapshot : store.hands;
});
</script>

<template>
  <el-dialog
    v-model="open"
    :title="`第 ${store.gamesPlayed} 局详细结果`"
    width="min(1040px, 95vw)"
    draggable
    :close-on-click-modal="false"
    class="deal-result-dialog"
  >
    <!-- 定约、局况、结果与计分项整合为一个信息块 -->
    <section class="result-card result-summary">
      <div class="summary-hero" :class="{ passed: !store.contract }">
        <div class="hero-main">
          <span class="hero-label">最终定约</span>
          <strong class="hero-contract">
            <ContractDisplay :contract="store.contract" empty-text="流局" />
          </strong>
          <span class="hero-outcome">{{ outcomeText }}</span>
        </div>
        <div class="hero-points">
          <span>本局点数{{ store.useHcpAdjust ? '（已贴点）' : '（原始 IMP）' }}</span>
          <strong>{{ dealPointsLabel }}</strong>
        </div>
      </div>

      <div class="meta-row">
        <span>局况 {{ vulName(store.vulnerability) }}</span>
        <span>发牌人 {{ store.dealer }}</span>
        <span v-if="store.contract">庄家 {{ store.contract.declarer }} · 明手 {{ store.contract.dummy }}</span>
        <span v-if="store.contract">{{ declarerTricks }} / {{ requiredTricks }} 墩</span>
      </div>

      <div class="summary-grid">
        <div class="score-grid">
          <div class="score-card">
            <span>NS 原始分</span>
            <strong>{{ store.score.NS }}</strong>
          </div>
          <div class="score-card">
            <span>EW 原始分</span>
            <strong>{{ store.score.EW }}</strong>
          </div>
        </div>

        <div class="detail-list">
          <div class="detail-row">
            <span>双方大牌点</span>
            <strong>{{ store.pointsSummary.dealHcp.NS }} : {{ store.pointsSummary.dealHcp.EW }}</strong>
          </div>
          <div class="detail-row">
            <span>原始 IMP</span>
            <strong>{{ dealImpLabel }}</strong>
          </div>
          <div class="detail-row">
            <span>贴点调整</span>
            <strong>{{ dealAdjustLabel }}</strong>
          </div>
          <div class="detail-row total">
            <span>本局点数{{ store.useHcpAdjust ? '（已贴点）' : '（原始 IMP）' }}</span>
            <strong>{{ dealPointsLabel }}</strong>
          </div>
        </div>
      </div>
    </section>

    <!-- 牌型分布与叫牌过程左右分列 -->
    <div class="result-two-col">
      <section class="result-card distribution-card">
        <h4>牌型分布</h4>
        <ResultDistribution
          :hands="hands"
          :vulnerability="vulnerabilityText"
          :contract="store.contract"
          :outcome="compactOutcome"
          :empty-text="resultEmptyText"
        />
      </section>

      <section class="result-card bidding-card">
        <h4>叫牌过程</h4>
        <BidHistory variant="table" />
      </section>
    </div>

    <!-- 打牌过程单独占一行，超出高度时内部滚动 -->
    <section
      v-if="store.tricks.length || store.currentTrick.length"
      class="result-card play-card-panel play-panel"
    >
      <h4>打牌过程</h4>
      <ResultPlayTable
        :tricks="store.tricks"
        :current-trick="store.currentTrick"
        :contract="store.contract"
      />
    </section>

    <!-- 双明手分析固定在最后，默认折叠，点击后才开始计算 -->
    <section class="result-card dd-card">
      <button
        type="button"
        class="dd-toggle"
        :aria-expanded="ddOpen"
        aria-controls="deal-result-dd-content"
        @click="ddOpen = !ddOpen"
      >
        <span class="dd-toggle-title">双明手分析</span>
        <span class="dd-toggle-sub">DDS · 四家明牌的最优结果</span>
        <span class="dd-toggle-icon" :class="{ open: ddOpen }" aria-hidden="true">⌄</span>
      </button>
      <div v-if="ddOpen" id="deal-result-dd-content" class="dd-content">
        <DdAnalysisPanel
          :hands="hands"
          :dealer="store.dealer"
          :vulnerability="store.vulnerability"
          :contract="store.contract"
          :show-header="false"
        />
      </div>
    </section>

    <template #footer>
      <el-button type="primary" @click="open = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.result-summary {
  padding: 12px 14px;
}
.summary-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 12px 16px;
  border-radius: 12px;
  background:
    radial-gradient(circle at 12% 20%, rgba(255, 255, 255, 0.65), transparent 35%),
    linear-gradient(160deg, #e8f5ec, #d7ecdf);
  border: 1px solid #b6dcc4;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}
.summary-hero.passed {
  background: #eef1ef;
  border-color: #dfe5e1;
}
.hero-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.hero-label {
  font-size: 11px;
  color: #6a7770;
}
.hero-contract {
  font-size: 26px;
  color: #14563a;
  line-height: 1;
}
.hero-outcome {
  font-size: 13px;
  font-weight: 700;
  color: #8a5a00;
  background: #fff6d8;
  border: 1px solid #e6cf7a;
  border-radius: 999px;
  padding: 3px 10px;
}
.hero-points {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  padding-left: 18px;
  border-left: 1px dashed #b6dcc4;
}
.hero-points span {
  font-size: 11px;
  color: #6a7770;
}
.hero-points strong {
  font-size: 20px;
  color: #8a5a00;
}
.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 8px;
  font-size: 12px;
  color: #6a7770;
}
.summary-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: 12px;
  margin-top: 10px;
}
.result-two-col {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  gap: 12px;
  margin-top: 12px;
}
.result-card {
  min-width: 0;
  border: 1px solid #e0e7e2;
  border-radius: 10px;
  background: #fbfdfb;
  padding: 10px 12px;
}
.result-card h4 {
  margin: 0 0 8px;
  font-size: 12px;
  color: #14563a;
  letter-spacing: 0.4px;
}
/* 牌型分布 / 打牌过程沿用计分表的紧凑面板 */
.distribution-card,
.play-card-panel {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
  border-color: #00552f;
  background: #006b3f;
}
.bidding-card {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
.distribution-card h4,
.bidding-card h4,
.play-card-panel h4 {
  margin: 0;
  padding: 3px 8px;
  border-bottom: 1px solid #8a8a8a;
  background: linear-gradient(#f4f4f4, #e5e5e5);
  color: #111;
}
.distribution-card :deep(.distribution) {
  min-height: 216px;
}
.bidding-card :deep(.bid-scroll) {
  margin: 8px;
  max-height: 216px;
}
.play-card-panel :deep(.play-table-wrap) {
  max-height: 260px;
}
.play-panel {
  margin-top: 12px;
}
.score-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.score-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 7px;
  border-radius: 8px;
  background: #f3f7f4;
  border: 1px solid #dfe8e2;
}
.score-card span {
  font-size: 11px;
  color: #8a9790;
}
.score-card strong {
  font-size: 22px;
  color: #14563a;
}
.detail-list {
  display: flex;
  flex-direction: column;
}
.detail-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
  border-bottom: 1px dashed #e2e8e4;
  font-size: 13px;
  color: #5a6a61;
}
.detail-row strong {
  color: #24352b;
}
.detail-row.total {
  border-bottom: none;
  color: #14563a;
  font-weight: 600;
}
.detail-row.total strong {
  color: #8a5a00;
  font-size: 15px;
}
.dd-card {
  margin-top: 12px;
  padding: 0;
  overflow: hidden;
}
.dd-toggle {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  background: #f3f7f4;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.dd-toggle:hover {
  background: #eaf2ed;
}
.dd-toggle:focus-visible {
  outline: 2px solid #2f8f63;
  outline-offset: -2px;
}
.dd-toggle-title {
  color: #14563a;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.4px;
}
.dd-toggle-sub {
  color: #8a9790;
  font-size: 11px;
}
.dd-toggle-icon {
  margin-left: auto;
  color: #55705f;
  font-size: 16px;
  line-height: 1;
  transition: transform 0.15s ease;
}
.dd-toggle-icon.open {
  transform: rotate(180deg);
}
.dd-content {
  padding: 10px 12px 12px;
  border-top: 1px solid #e0e7e2;
}
@media (max-width: 780px) {
  .summary-grid,
  .result-two-col {
    grid-template-columns: 1fr;
  }
}
</style>
