<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElDialog } from 'element-plus';
import { useGameStore, vulName } from '../store/game';
import { getSide, type Position, type Trick } from '../models/gameState';
import { cardLabel } from '../models/card';
import PlayingCard from './PlayingCard.vue';
import ResultTable from './ResultTable.vue';
import ContractDisplay from './ContractDisplay.vue';
import HandDiagram from './HandDiagram.vue';
import { useScoringCardsVisible } from '../composables/useScoringCardsVisible';

const store = useGameStore();
/** 一局结束后桌面上的牌只再显示 1 秒 */
const cardsVisible = useScoringCardsVisible();
const COLUMNS: Position[] = ['N', 'E', 'S', 'W'];
const SEAT_LABEL: Record<Position, string> = { N: '北 N', E: '东 E', S: '南 S', W: '西 W' };
const VUL_TEXT: Record<string, string> = { none: '无局', NS: '南北有局', EW: '东西有局', both: '双方有局' };
const PHASE_TEXT: Record<string, string> = {
  idle: '待开始',
  bidding: '叫牌中',
  play_waiting_lead: '等待首攻',
  play: '打牌中',
  scoring: '已结算',
};

const hovering = ref(false);
const scoreVisible = ref(false);
const exposeVisible = ref(false);
const contractVisible = ref(false);

/* ---------------------------------------------------------------- *
 * 右下角：南家已出的牌（按出牌顺序：赢墩竖直、输墩平躺）
 * ---------------------------------------------------------------- */
interface PileItem {
  key: string;
  card: number;
  /** 平躺（本墩由东西方赢，输墩） */
  flat: boolean;
  /** 本墩由南北方赢（赢墩） */
  won: boolean;
  left: number;
  width: number;
  trickNo: number;
  title: string;
}

/** 每张牌叠放的水平步进：越小越紧凑 */
const PILE_STEP = 13;

const pileItems = computed<PileItem[]>(() => {
  const items: PileItem[] = [];
  let x = 0;
  store.tricks.forEach((trick, index) => {
    const play = trick.plays.find((p) => p.position === 'S');
    if (!play) return;
    const won = getSide(trick.winner) === 'NS';
    const flat = !won;
    const width = flat ? 48 : 34;
    items.push({
      key: `${index}-${play.card}`,
      card: play.card,
      flat,
      won,
      left: x,
      width,
      trickNo: index + 1,
      title: `第 ${index + 1} 墩 · 南家出 ${cardLabel(play.card)} · ${won ? '南北赢墩' : '东西赢墩'}`,
    });
    x += PILE_STEP;
  });
  return items;
});

const pileWidth = computed(() => {
  const last = pileItems.value[pileItems.value.length - 1];
  return last ? last.left + last.width : 34;
});

/** 上一墩（鼠标悬停时回放其出牌顺序） */
const lastTrick = computed<Trick | null>(() =>
  store.tricks.length ? store.tricks[store.tricks.length - 1] : null,
);

/** 悬停浮动层：本轮为空时也可查看最近完成的墩 */
const showLastTrick = computed(() => hovering.value && !!lastTrick.value && lastTrick.value.plays.length > 0);

/* ---------------------------------------------------------------- *
 * 计分表 / 摊牌 / 定约卡 / 托管
 * ---------------------------------------------------------------- */
/** 摊牌展示当前余牌；一局结束后手牌已打空，回退到发牌快照 */
const exposeHands = computed(() => {
  const hasRemaining = COLUMNS.some((pos) => (store.hands[pos]?.length ?? 0) > 0);
  return hasRemaining ? store.hands : store.dealHands;
});

function roleOf(pos: Position): 'declarer' | 'dummy' | '' {
  if (!store.contract) return '';
  if (store.contract.declarer === pos) return 'declarer';
  if (store.contract.dummy === pos) return 'dummy';
  return '';
}

const contractEmptyText = computed(() => (store.phase === 'scoring' ? '流局' : '—'));
const doubleText = computed(() => {
  const c = store.contract;
  if (!c) return '—';
  return c.redoubled ? '再加倍 ×4' : c.doubled ? '加倍 ×2' : '无';
});
const vulnerabilityText = computed(() => VUL_TEXT[store.vulnerability] ?? vulName(store.vulnerability));
const phaseText = computed(() => PHASE_TEXT[store.phase] ?? store.phase);

function toggleAutoPilot(): void {
  store.setAutoPilot(!store.autoPilot);
}
</script>

<template>
  <div class="south-played" aria-label="南家已出牌与常用操作">
    <div
      v-if="cardsVisible"
      class="pile-wrap"
      @mouseenter="hovering = true"
      @mouseleave="hovering = false"
    >
      <div class="pile" :style="{ width: `${pileWidth}px` }">
        <span
          v-for="item in pileItems"
          :key="item.key"
          class="pile-card"
          :class="{ flat: item.flat }"
          :style="{ left: `${item.left}px`, zIndex: item.trickNo }"
          :title="item.title"
        >
          <span class="pile-card-inner">
            <PlayingCard back size="sm" />
          </span>
        </span>
        <span v-if="pileItems.length === 0" class="pile-empty">尚未出牌</span>
      </div>

      <!-- 悬停：回放上一墩的出牌顺序（出现动画与实际出牌一致） -->
      <transition name="last-trick-fade">
        <div v-if="showLastTrick && lastTrick" class="last-trick-pop" aria-label="上一墩出牌顺序">
          <div class="pop-heading">
            <span>上一墩 · 第 {{ store.tricks.length }} 墩</span>
            <span class="pop-winner">赢家 {{ lastTrick.winner }}</span>
          </div>
          <div class="pop-board">
            <span
              v-for="(play, index) in lastTrick.plays"
              :key="`${play.position}-${play.card}`"
              class="pop-card"
              :class="[`slot-${play.position}`, { winner: lastTrick.winner === play.position }]"
              :style="{ zIndex: index + 1 }"
            >
              <span class="pop-card-inner" :style="{ animationDelay: `${index * 0.16}s` }">
                <PlayingCard :card="play.card" size="md" label-mode="suit-first" />
                <span class="pop-order" aria-hidden="true">{{ index + 1 }}</span>
              </span>
            </span>
          </div>
        </div>
      </transition>
    </div>

    <!-- 已出牌下方的四个常用按钮，见 image/出牌.PNG -->
    <div class="pile-actions">
      <button type="button" class="action-btn" @click="scoreVisible = true">计分表</button>
      <button type="button" class="action-btn" @click="exposeVisible = true">摊牌</button>
      <button type="button" class="action-btn" @click="contractVisible = true">定约卡</button>
      <button
        type="button"
        class="action-btn"
        :class="{ on: store.autoPilot }"
        @click="toggleAutoPilot"
      >
        {{ store.autoPilot ? '托管中' : '托管' }}
      </button>
    </div>

    <ElDialog
      v-model="scoreVisible"
      title="结果"
      width="min(1040px, 96vw)"
      append-to-body
      draggable
      :close-on-click-modal="false"
      class="result-dialog"
    >
      <ResultTable />
      <template #footer>
        <button type="button" class="result-close" @click="scoreVisible = false">关闭(C)</button>
      </template>
    </ElDialog>

    <ElDialog v-model="exposeVisible" title="摊牌 · 四家持牌" width="min(760px, 94vw)" append-to-body>
      <div class="expose-grid">
        <HandDiagram
          v-for="pos in COLUMNS"
          :key="pos"
          :cards="exposeHands[pos]"
          :position="pos"
          :label="SEAT_LABEL[pos]"
          :role="roleOf(pos)"
        />
      </div>
    </ElDialog>

    <ElDialog v-model="contractVisible" title="定约卡" width="360px" append-to-body>
      <div class="contract-card">
        <div class="cc-hero">
          <span class="cc-hero-label">定约</span>
          <strong class="cc-hero-value">
            <ContractDisplay :contract="store.contract" :empty-text="contractEmptyText" />
          </strong>
        </div>
        <dl class="cc-list">
          <div class="cc-row"><dt>发牌人</dt><dd>{{ store.dealer }}</dd></div>
          <div class="cc-row"><dt>局况</dt><dd>{{ vulnerabilityText }}</dd></div>
          <div v-if="store.contract" class="cc-row">
            <dt>庄家 / 明手</dt><dd>{{ store.contract.declarer }} / {{ store.contract.dummy }}</dd>
          </div>
          <div v-if="store.contract" class="cc-row"><dt>加倍</dt><dd>{{ doubleText }}</dd></div>
          <div v-if="store.contract" class="cc-row">
            <dt>需赢墩</dt><dd>{{ store.contract.level + 6 }}</dd>
          </div>
          <div v-if="store.contract" class="cc-row">
            <dt>定约方已赢墩</dt><dd>{{ store.declarerTricksWon() }}</dd>
          </div>
          <div class="cc-row"><dt>阶段</dt><dd>{{ phaseText }}</dd></div>
        </dl>
      </div>
    </ElDialog>
  </div>
</template>

<style scoped>
.south-played {
  position: absolute;
  right: calc(var(--table-pad) + 4px);
  bottom: calc(var(--table-pad) + 4px);
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.pile-wrap {
  position: relative;
}
.pile {
  position: relative;
  height: 48px;
  min-width: 34px;
}
.pile-card {
  position: absolute;
  bottom: 0;
  display: block;
  width: 34px;
  height: 48px;
  line-height: 0;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.32));
}
.pile-card.flat {
  width: 48px;
  height: 34px;
}
.pile-card-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
.pile-card.flat .pile-card-inner {
  transform: rotate(90deg);
}
.pile-empty {
  position: absolute;
  bottom: 12px;
  left: 0;
  white-space: nowrap;
  color: rgba(234, 245, 238, 0.5);
  font-size: 11px;
}

/* 悬停浮层：上一墩按出牌顺序出现 */
.last-trick-pop {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 20;
  width: 244px;
  padding: 6px 8px 8px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 10px;
  background: rgba(3, 34, 22, 0.9);
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}
.pop-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 4px;
  font-size: 11px;
  color: rgba(234, 245, 238, 0.85);
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
}
.pop-winner {
  color: #2c2200;
  background: #ffe19a;
  border-radius: 999px;
  padding: 0 6px;
  font-weight: 700;
}
.pop-board {
  position: relative;
  width: 228px;
  height: 172px;
  margin-top: 6px;
}
.pop-card {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 54px;
  height: 76px;
  line-height: 0;
}
.pop-card.slot-W {
  transform: translate(calc(-50% - 40px), -50%);
}
.pop-card.slot-E {
  transform: translate(calc(-50% + 40px), -50%);
}
.pop-card.slot-N {
  transform: translate(-50%, calc(-50% - 30px));
}
.pop-card.slot-S {
  transform: translate(-50%, calc(-50% + 30px));
}
.pop-card.winner :deep(.playing-card) {
  outline: 2px solid #ffe19a;
  outline-offset: 2px;
}
.pop-card-inner {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  animation: pop-card-in 0.32s ease-out both;
}
@keyframes pop-card-in {
  from {
    opacity: 0;
    transform: scale(0.72) translateY(-12px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
.pop-order {
  position: absolute;
  z-index: 2;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: 999px;
  background: #ffe19a;
  color: #2c2200;
  font-size: 10px;
  font-weight: 800;
  line-height: 15px;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
}
/* 与中央出牌区一致：序号放在各自外侧，避免被相邻牌遮住 */
.pop-card.slot-W .pop-order {
  bottom: -6px;
  left: -6px;
}
.pop-card.slot-E .pop-order {
  top: -6px;
  right: -6px;
}
.pop-card.slot-N .pop-order {
  top: -6px;
  right: -6px;
}
.pop-card.slot-S .pop-order {
  bottom: -6px;
  left: -6px;
}
.last-trick-fade-enter-active,
.last-trick-fade-leave-active {
  transition: opacity 0.14s ease;
}
.last-trick-fade-enter-from,
.last-trick-fade-leave-to {
  opacity: 0;
}

.pile-actions {
  display: flex;
  gap: 4px;
}
.action-btn {
  min-width: 50px;
  padding: 3px 8px;
  border: 1px solid #f0d9b5;
  border-radius: 3px;
  background: linear-gradient(180deg, #b5471f, #8f3414);
  color: #fff3df;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}
.action-btn:hover {
  background: linear-gradient(180deg, #c9542a, #a03c18);
}
.action-btn.on {
  background: linear-gradient(180deg, #e0a300, #b47d00);
  color: #2c2200;
  border-color: #ffe19a;
}
.result-close {
  min-width: 76px;
  padding: 4px 14px;
  border: 1px solid #9a9a9a;
  border-radius: 2px;
  background: linear-gradient(#f7f7f7, #e4e4e4);
  color: #1c1c1c;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}
.result-close:hover {
  background: linear-gradient(#fff, #ededed);
}
:global(.result-dialog .el-dialog__body) {
  padding: 8px;
  background: #d7d7d7;
}
:global(.result-dialog .el-dialog__header) {
  padding: 8px 12px;
  margin-right: 0;
}
:global(.result-dialog .el-dialog__footer) {
  padding: 6px 12px 10px;
  background: #d7d7d7;
}

.expose-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.contract-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cc-hero {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: linear-gradient(160deg, #e8f5ec, #d7ecdf);
  border: 1px solid #b6dcc4;
}
.cc-hero-label {
  font-size: 12px;
  color: #6a7770;
}
.cc-hero-value {
  font-size: 24px;
  color: #14563a;
}
.cc-list {
  display: flex;
  flex-direction: column;
  margin: 0;
}
.cc-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 2px;
  border-bottom: 1px dashed #e2e8e4;
  font-size: 13px;
}
.cc-row:last-child {
  border-bottom: none;
}
.cc-row dt {
  color: #6a7770;
}
.cc-row dd {
  margin: 0;
  color: #24352b;
  font-weight: 600;
}

@media (max-width: 880px) {
  .south-played {
    display: none;
  }
}
</style>
