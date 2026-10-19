<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore, describeContract, vulName } from '../store/game';
import BidHistory from './BidHistory.vue';

const open = defineModel<boolean>({ default: false });
const store = useGameStore();

const contractText = computed(() => (store.contract ? describeContract(store.contract) : '流局'));
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
</script>

<template>
  <el-dialog v-model="open" :title="`第 ${store.gamesPlayed} 局详细结果`" width="560px">
    <div class="result-hero" :class="{ passed: !store.contract }">
      <div class="hero-main">
        <span class="hero-label">定约</span>
        <strong class="hero-contract">{{ contractText }}</strong>
      </div>
      <span class="hero-outcome">{{ outcomeText }}</span>
    </div>

    <div class="meta-row">
      <span>局况 {{ vulName(store.vulnerability) }}</span>
      <span>发牌人 {{ store.dealer }}</span>
      <span v-if="store.contract">庄家 {{ store.contract.declarer }} · 明手 {{ store.contract.dummy }}</span>
    </div>

    <div class="score-grid">
      <div class="score-card">
        <span>NS 得分</span>
        <strong>{{ store.score.NS }}</strong>
      </div>
      <div class="score-card">
        <span>EW 得分</span>
        <strong>{{ store.score.EW }}</strong>
      </div>
    </div>

    <div class="detail-list">
      <div v-if="store.contract" class="detail-row">
        <span>定约方赢墩</span>
        <strong>{{ declarerTricks }} / {{ requiredTricks }}</strong>
      </div>
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
        <span>本局点数</span>
        <strong>{{ dealPointsLabel }}</strong>
      </div>
    </div>

    <section class="dialog-section">
      <h4>叫牌过程</h4>
      <BidHistory />
    </section>

    <section v-if="store.tricks.length" class="dialog-section">
      <h4>赢墩顺序</h4>
      <div class="trick-winners">
        <span v-for="(trick, i) in store.tricks" :key="i" class="trick-winner">
          <span class="trick-no">{{ i + 1 }}</span>
          <span class="winner">{{ trick.winner }}</span>
        </span>
      </div>
    </section>

    <template #footer>
      <el-button type="primary" @click="open = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.result-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: linear-gradient(160deg, #e8f5ec, #d7ecdf);
  border: 1px solid #b6dcc4;
}
.result-hero.passed {
  background: #eef1ef;
  border-color: #dfe5e1;
}
.hero-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hero-label {
  font-size: 11px;
  color: #6a7770;
}
.hero-contract {
  font-size: 22px;
  color: #14563a;
}
.hero-outcome {
  font-size: 13px;
  font-weight: 700;
  color: #8a5a00;
  background: #fff6d8;
  border: 1px solid #e6cf7a;
  border-radius: 5px;
  padding: 3px 8px;
}
.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
  font-size: 12px;
  color: #6a7770;
}
.score-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
}
.score-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px;
  border-radius: 7px;
  background: #f3f7f4;
  border: 1px solid #dfe8e2;
}
.score-card span {
  font-size: 11px;
  color: #8a9790;
}
.score-card strong {
  font-size: 20px;
  color: #14563a;
}
.detail-list {
  margin-top: 10px;
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
.dialog-section {
  margin-top: 12px;
}
.dialog-section h4 {
  margin: 0 0 6px;
  font-size: 12px;
  color: #3a4a40;
}
.trick-winners {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.trick-winner {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #f3f7f4;
  border: 1px solid #dfe8e2;
  font-size: 11px;
}
.trick-no {
  color: #8a9790;
}
.winner {
  font-weight: 700;
  color: #14563a;
}
</style>
