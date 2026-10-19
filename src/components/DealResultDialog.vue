<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore, vulName } from '../store/game';
import type { Position, Trick } from '../models/gameState';
import BidHistory from './BidHistory.vue';
import ContractDisplay from './ContractDisplay.vue';
import HandDiagram from './HandDiagram.vue';
import PlayingCard from './PlayingCard.vue';

const open = defineModel<boolean>({ default: false });
const store = useGameStore();

const COLUMNS: Position[] = ['N', 'E', 'S', 'W'];
const SEAT_LABEL: Record<Position, string> = { N: '北 N', E: '东 E', S: '南 S', W: '西 W' };

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

/** 结算后 state.hands 已被出牌消耗，优先使用发牌快照 */
const hands = computed(() => {
  const snapshot = store.dealHands;
  const hasCards = COLUMNS.some((pos) => (snapshot[pos]?.length ?? 0) > 0);
  return hasCards ? snapshot : store.hands;
});

function roleOf(pos: Position): 'declarer' | 'dummy' | '' {
  if (!store.contract) return '';
  if (store.contract.declarer === pos) return 'declarer';
  if (store.contract.dummy === pos) return 'dummy';
  return '';
}

function cardOf(trick: Trick, pos: Position): number | null {
  return trick.plays.find((play) => play.position === pos)?.card ?? null;
}
</script>

<template>
  <el-dialog
    v-model="open"
    :title="`第 ${store.gamesPlayed} 局详细结果`"
    width="min(1040px, 95vw)"
    class="deal-result-dialog"
  >
    <div class="result-hero" :class="{ passed: !store.contract }">
      <div class="hero-main">
        <span class="hero-label">最终定约</span>
        <strong class="hero-contract">
          <ContractDisplay :contract="store.contract" empty-text="流局" />
        </strong>
        <span class="hero-outcome">{{ outcomeText }}</span>
      </div>
      <div class="hero-points">
        <span>本局点数</span>
        <strong>{{ dealPointsLabel }}</strong>
      </div>
    </div>

    <div class="meta-row">
      <span>局况 {{ vulName(store.vulnerability) }}</span>
      <span>发牌人 {{ store.dealer }}</span>
      <span v-if="store.contract">庄家 {{ store.contract.declarer }} · 明手 {{ store.contract.dummy }}</span>
      <span v-if="store.contract">{{ declarerTricks }} / {{ requiredTricks }} 墩</span>
    </div>

    <div class="result-body">
      <section class="result-card summary-card">
        <h4>计分</h4>
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
      </section>

      <section class="result-card hands-card">
        <h4>牌型分布</h4>
        <div class="hands-grid">
          <HandDiagram
            v-for="pos in COLUMNS"
            :key="pos"
            :cards="hands[pos]"
            :position="pos"
            :label="SEAT_LABEL[pos]"
            :role="roleOf(pos)"
          />
        </div>
      </section>
    </div>

    <div class="result-lower">
      <section class="result-card">
        <h4>叫牌过程</h4>
        <BidHistory variant="table" />
      </section>

      <section v-if="store.tricks.length" class="result-card">
        <h4>打牌过程</h4>
        <div class="trick-table">
          <div class="trick-table-head">
            <span>#</span>
            <span v-for="pos in COLUMNS" :key="pos">{{ pos }}</span>
            <span>赢家</span>
          </div>
          <div v-for="(trick, i) in store.tricks" :key="i" class="trick-table-row">
            <span class="trick-no">{{ i + 1 }}</span>
            <span v-for="pos in COLUMNS" :key="pos" class="trick-cell">
              <PlayingCard
                v-if="cardOf(trick, pos) !== null"
                :card="cardOf(trick, pos)"
                size="xs"
                label-mode="suit-first"
              />
              <span v-else class="trick-empty">—</span>
            </span>
            <span class="trick-winner">{{ trick.winner }}</span>
          </div>
        </div>
      </section>
    </div>

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
  gap: 18px;
  padding: 12px 16px;
  border-radius: 12px;
  background:
    radial-gradient(circle at 12% 20%, rgba(255, 255, 255, 0.65), transparent 35%),
    linear-gradient(160deg, #e8f5ec, #d7ecdf);
  border: 1px solid #b6dcc4;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}
.result-hero.passed {
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
.result-body {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
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
  margin-top: 8px;
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
.hands-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.result-lower {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 12px;
  margin-top: 12px;
}
.trick-table {
  max-height: 330px;
  overflow: auto;
  border: 1px solid #e0e7e2;
  border-radius: 8px;
}
.trick-table-head,
.trick-table-row {
  display: grid;
  grid-template-columns: 24px repeat(4, minmax(0, 1fr)) 38px;
  align-items: center;
  gap: 3px;
  padding: 2px 5px;
}
.trick-table-head {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #edf4ef;
  border-bottom: 1px solid #dfe8e2;
  font-size: 10px;
  font-weight: 700;
  color: #5a6a61;
  text-align: center;
}
.trick-table-row {
  border-bottom: 1px dashed #e6ece8;
}
.trick-table-row:last-child {
  border-bottom: 0;
}
.trick-table-row:nth-child(odd) {
  background: #fafcfb;
}
.trick-no {
  font-size: 10px;
  color: #8a9790;
  text-align: center;
}
.trick-cell {
  display: flex;
  justify-content: center;
}
.trick-empty {
  color: #c1cac4;
  font-size: 11px;
}
.trick-winner {
  font-size: 11px;
  font-weight: 700;
  color: #14563a;
  text-align: center;
}
@media (max-width: 780px) {
  .result-body,
  .result-lower {
    grid-template-columns: 1fr;
  }
}
</style>
