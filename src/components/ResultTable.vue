<script setup lang="ts">
import { computed } from 'vue';
import {
  FINAL_PASS_TEXT,
  PASS_TEXT,
  describeCall,
  suitName,
  useGameStore,
  type DealRecord,
} from '../store/game';
import { getSide, ORDER, type BidRecord, type Position } from '../models/gameState';
import { hcpAdjustedPoints, impsFromScoreDiff } from '../core/imps';
import type { Hand } from '../models/hand';
import ResultDistribution from './ResultDistribution.vue';
import ResultPlayTable from './ResultPlayTable.vue';
import ResultText from './ResultText.vue';

const store = useGameStore();

const SEAT_CN: Record<Position, string> = { N: '北', E: '东', S: '南', W: '西' };
const VUL_TEXT: Record<string, string> = {
  none: '无局',
  NS: '南北有局',
  EW: '东西有局',
  both: '双方有局',
};

/* ------------------------------------------------------------------ *
 * 对局数据
 * ------------------------------------------------------------------ */

/** 当前进行中的对局快照（无任何动作时为 null） */
const currentDeal = computed<DealRecord | null>(() => {
  const active =
    store.biddingHistory.length > 0 ||
    store.tricks.length > 0 ||
    store.currentTrick.length > 0 ||
    !!store.contract;
  if (!active) return null;
  return {
    index: store.gamesPlayed,
    dealer: store.dealer,
    vulnerability: store.vulnerability,
    biddingHistory: store.biddingHistory,
    contract: store.contract,
    tricks: store.tricks,
    currentTrick: store.currentTrick,
    hcp: { ...store.dealHcp },
    hands: store.dealHands,
    score: store.score,
    phase: store.phase,
  };
});

/** 历史 + 本局，按局序排列 */
const deals = computed<DealRecord[]>(() => {
  const list = [...store.dealHistory].sort((a, b) => a.index - b.index);
  if (currentDeal.value) list.push(currentDeal.value);
  return list;
});

const displayDeal = computed<DealRecord | null>(() => deals.value[deals.value.length - 1] ?? null);

const displayHands = computed<Record<Position, Hand>>(
  () => displayDeal.value?.hands ?? store.dealHands,
);

/** 本局点数（与计分表一致：开启贴点时按 IMP − 胜方大牌点贴点） */
function pointsOf(deal: DealRecord): number {
  const diff = deal.score.NS - deal.score.EW;
  const hcp = deal.hcp ?? { NS: 20, EW: 20 };
  return store.useHcpAdjust
    ? hcpAdjustedPoints(diff, hcp.NS, hcp.EW)
    : impsFromScoreDiff(diff);
}

function rawText(value: number): string {
  return value === 0 ? '' : String(value);
}

function signedText(value: number): string {
  return String(value);
}

/** 整副结果：S 1NT +3 / N 3NT = / W 2H -2 */
function declarerTricksOf(deal: DealRecord): number {
  if (!deal.contract) return 0;
  const side = getSide(deal.contract.declarer);
  return deal.tricks.filter((trick) => getSide(trick.winner) === side).length;
}

function resultOutcome(deal: DealRecord): string {
  if (!deal.contract) return '';
  if (deal.phase !== 'scoring') return '进行中';
  const diff = declarerTricksOf(deal) - (deal.contract.level + 6);
  if (diff === 0) return '=';
  return diff > 0 ? `+${diff}` : String(diff);
}

/** 无定约时的占位：结算阶段为流局，进行中则为未定约 */
function resultEmptyText(deal: DealRecord | null): string {
  if (!deal) return '—';
  return deal.phase === 'scoring' ? '流局' : '未定约';
}

/** 本桌累计得分：一副汇总行，原始分与双方累计点数 */
const summary = computed(() => {
  const all = deals.value;
  const scoring = all.filter((deal) => deal.phase === 'scoring');
  const totalNS = all.reduce((sum, deal) => sum + deal.score.NS, 0);
  const totalEW = all.reduce((sum, deal) => sum + deal.score.EW, 0);
  const our = scoring.reduce((sum, deal) => sum + pointsOf(deal), 0);
  return {
    no: 1,
    ns: rawText(totalNS),
    ew: rawText(totalEW),
    our: signedText(our),
    opp: signedText(-our),
  };
});

const comparisonRows = computed(() =>
  deals.value.map((deal) => {
    const points = deal.phase === 'scoring' ? pointsOf(deal) : null;
    return {
      key: `result-deal-${deal.index}`,
      no: deal.index,
      deal,
      ns: rawText(deal.score.NS),
      ew: rawText(deal.score.EW),
      nsPoints: points === null ? '' : signedText(points),
      ewPoints: points === null ? '' : signedText(-points),
      current: deal.index === displayDeal.value?.index,
    };
  }),
);

/* ------------------------------------------------------------------ *
 * 叫牌过程（从发牌人开始，按西/北/东/南循环）
 * ------------------------------------------------------------------ */

interface BidCell {
  level?: number;
  suit?: string;
  red?: boolean;
  label?: string;
  final?: boolean;
  alerted?: boolean;
  alertText?: string;
}

const bidColumns = computed<Position[]>(() => {
  const dealer = displayDeal.value?.dealer ?? 'W';
  const start = ORDER.indexOf(dealer);
  return [0, 1, 2, 3].map((offset) => ORDER[(start + offset) % 4]);
});

function toBidCell(rec: BidRecord): BidCell {
  if (rec.call.type === 'bid') {
    return {
      level: rec.call.level,
      suit: suitName(rec.call.suit),
      red: rec.call.suit === 'H' || rec.call.suit === 'D',
      alerted: rec.alerted,
      alertText: rec.alertText,
    };
  }
  if (rec.call.type === 'pass') {
    return { label: PASS_TEXT, alerted: rec.alerted };
  }
  return { label: describeCall(rec.call), alerted: rec.alerted, alertText: rec.alertText };
}

const bidRows = computed<(BidCell | null)[][]>(() => {
  const deal = displayDeal.value;
  if (!deal) return [];
  const history = deal.biddingHistory;
  const endIndex =
    deal.phase !== 'bidding' &&
    history.length > 0 &&
    history[history.length - 1]?.call.type === 'pass'
      ? history.length - 1
      : -1;
  // 结束时的最后一个 Pass 不再填在座位格中，改由下一行的“=”表示
  const calls = endIndex >= 0 ? history.slice(0, endIndex) : history;
  const rows: (BidCell | null)[][] = [];
  calls.forEach((rec, index) => {
    const row = Math.floor(index / 4);
    if (!rows[row]) rows[row] = [null, null, null, null];
    const column = bidColumns.value.indexOf(rec.position);
    if (column >= 0) rows[row][column] = toBidCell(rec);
  });
  if (endIndex >= 0) {
    // “=”另起一行，固定写在第一列
    const row = Math.floor(endIndex / 4) + 1;
    if (!rows[row]) rows[row] = [null, null, null, null];
    rows[row][0] = { label: FINAL_PASS_TEXT, final: true };
  }
  return rows;
});

const vulnerabilityText = computed(() =>
  displayDeal.value ? (VUL_TEXT[displayDeal.value.vulnerability] ?? '无局') : '无局',
);
</script>

<template>
  <div class="result-table">
    <!-- 左上：本桌累计得分 -->
    <section class="res-panel cumulative-panel">
      <h4 class="res-title">本桌累计得分</h4>
      <div class="res-table-wrap">
        <table class="res-table summary-table">
          <colgroup>
            <col class="col-no" />
            <col class="col-result" />
            <col class="col-score" />
            <col class="col-score" />
            <col class="col-points" />
            <col class="col-points" />
          </colgroup>
          <thead>
            <tr>
              <th>No</th>
              <th>结果</th>
              <th>NS</th>
              <th>EW</th>
              <th>我方得分</th>
              <th>对方得分</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{{ summary.no }}</td>
              <td class="res-result-cell">
                <ResultText
                  :contract="displayDeal?.contract ?? null"
                  :outcome="displayDeal ? resultOutcome(displayDeal) : ''"
                  :empty-text="resultEmptyText(displayDeal)"
                />
              </td>
              <td>{{ summary.ns }}</td>
              <td>{{ summary.ew }}</td>
              <td>{{ summary.our }}</td>
              <td>{{ summary.opp }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 右上：牌型分布 -->
    <section class="res-panel distribution-panel">
      <h4 class="res-title">牌型分布</h4>
      <ResultDistribution
        v-if="displayDeal"
        :hands="displayHands"
        :vulnerability="vulnerabilityText"
        :contract="displayDeal.contract"
        :outcome="resultOutcome(displayDeal)"
        :empty-text="resultEmptyText(displayDeal)"
      />
      <div v-else class="res-empty">尚无牌局</div>
    </section>

    <!-- 左下：比较得分 -->
    <section class="res-panel comparison-panel">
      <h4 class="res-title">比较得分</h4>
      <div class="res-table-wrap">
        <table class="res-table comparison-table">
          <colgroup>
            <col class="col-no" />
            <col class="col-result" />
            <col class="col-score" />
            <col class="col-score" />
            <col class="col-points" />
            <col class="col-points" />
          </colgroup>
          <thead>
            <tr>
              <th>No</th>
              <th>结果</th>
              <th>NS</th>
              <th>EW</th>
              <th>NS得分</th>
              <th>EW得分</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in comparisonRows"
              :key="row.key"
              :class="{ current: row.current }"
            >
              <td>{{ row.no }}</td>
              <td class="res-result-cell">
                <ResultText
                  :contract="row.deal.contract"
                  :outcome="resultOutcome(row.deal)"
                  :empty-text="resultEmptyText(row.deal)"
                />
              </td>
              <td>{{ row.ns }}</td>
              <td>{{ row.ew }}</td>
              <td>{{ row.nsPoints }}</td>
              <td>{{ row.ewPoints }}</td>
            </tr>
            <tr v-if="comparisonRows.length === 0">
              <td colspan="6" class="res-empty-cell">尚无记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 右中：叫牌过程 -->
    <section class="res-panel bidding-panel">
      <h4 class="res-title">叫牌过程</h4>
      <div class="bid-table-wrap">
        <table class="bid-table">
          <thead>
            <tr>
              <th v-for="column in bidColumns" :key="column">{{ SEAT_CN[column] }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in bidRows" :key="`bid-row-${rowIndex}`">
              <td
                v-for="(cell, columnIndex) in row"
                :key="`bid-${rowIndex}-${columnIndex}`"
                class="result-bid-cell"
                :class="{ alerted: cell?.alerted }"
                :title="cell?.alerted ? (cell.alertText ? `提醒：${cell.alertText}` : '提醒') : undefined"
              >
                <template v-if="cell">
                  <template v-if="cell.suit">
                    <span class="result-bid-level">{{ cell.level }}</span>
                    <span
                      class="result-bid-suit"
                      :class="{
                        red: cell.red,
                        'suit-symbol': cell.suit !== 'NT',
                        'suit-club': cell.suit === '♣',
                      }"
                    >{{ cell.suit }}</span>
                  </template>
                  <span v-else class="result-bid-label" :class="{ final: cell.final }">
                    {{ cell.label }}
                  </span>
                </template>
              </td>
            </tr>
            <tr v-if="bidRows.length === 0">
              <td :colspan="bidColumns.length" class="res-empty-cell">尚无叫牌</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 右下：打牌过程 -->
    <section class="res-panel playing-panel">
      <h4 class="res-title">打牌过程</h4>
      <ResultPlayTable
        v-if="displayDeal"
        :tricks="displayDeal.tricks"
        :current-trick="displayDeal.currentTrick"
        :contract="displayDeal.contract"
      />
      <div v-else class="res-empty">尚无出牌</div>
    </section>
  </div>
</template>

<style scoped>
.result-table {
  --res-green: #006b3f;
  --res-green-current: #0d8d7b;
  --res-line: rgba(255, 255, 255, 0.36);
  --club-color: var(--club-on-dark);
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-rows: minmax(250px, 1.15fr) minmax(106px, 0.52fr) minmax(158px, 1fr);
  grid-template-areas:
    'cumulative distribution'
    'comparison bidding'
    'comparison playing';
  gap: 5px;
  height: min(78vh, 660px);
  min-height: 560px;
  padding: 4px;
  border: 1px solid #7c7c7c;
  background: #d7d7d7;
  color: #fff;
  font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  box-sizing: border-box;
}
.res-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid #818181;
  background: var(--res-green);
}
.cumulative-panel {
  grid-area: cumulative;
}
.distribution-panel {
  grid-area: distribution;
}
.comparison-panel {
  grid-area: comparison;
}
.bidding-panel {
  grid-area: bidding;
}
.playing-panel {
  grid-area: playing;
}
.res-title {
  flex: none;
  margin: 0;
  padding: 2px 5px;
  border-bottom: 1px solid #8a8a8a;
  background: linear-gradient(#f4f4f4, #e5e5e5);
  color: #111;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.3;
}
.res-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.res-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
  line-height: 1.15;
}
.res-table th,
.res-table td {
  height: 20px;
  padding: 1px 3px;
  border: 1px solid var(--res-line);
  text-align: center;
  vertical-align: middle;
  white-space: nowrap;
}
.res-table th {
  background: linear-gradient(#fbfbfb, #ececec);
  color: #111;
  font-weight: 700;
}
.res-table td {
  background: var(--res-green);
  color: #fff;
}
.res-table .col-no {
  width: 38px;
}
.res-table .col-result {
  width: 28%;
}
.res-table .col-score {
  width: 13%;
}
.res-table .col-points {
  width: 17%;
}
.res-result-cell {
  text-align: left !important;
  padding-left: 7px !important;
}
.res-table tr.current td {
  background: var(--res-green-current);
}
.res-table tr.current td:first-child {
  background: #ff8b8b;
  color: #3b0000;
  font-weight: 800;
}
.res-empty-cell {
  padding: 10px !important;
  color: rgba(255, 255, 255, 0.72) !important;
  text-align: center !important;
}

.res-empty {
  padding: 12px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
}

/* 叫牌过程 */
.bid-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.bid-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
  line-height: 1.1;
}
.bid-table th,
.bid-table td {
  height: 19px;
  padding: 0 2px;
  border: 1px solid var(--res-line);
  text-align: center;
  vertical-align: middle;
}
.bid-table th {
  background: linear-gradient(#fbfbfb, #ececec);
  color: #111;
  font-weight: 700;
}
.bid-table td {
  background: var(--res-green);
  color: #fff;
}
.result-bid-cell.alerted {
  --club-color: var(--club-ink);
  background: #fff;
  color: #111;
}
.result-bid-level {
  font-weight: 700;
}
.result-bid-suit {
  margin-left: 1px;
  font-size: 1.2em;
  font-weight: 900;
  line-height: 1;
}
.result-bid-suit.red {
  color: #ff8c8c;
}
.result-bid-cell.alerted .result-bid-suit.red {
  color: #c21b1b;
}
.result-bid-label.final {
  display: inline-block;
  font-weight: 800;
  line-height: 1;
  vertical-align: middle;
  /* 把“=”横向拉长，使其与 Pass 的横杠基本等长 */
  transform: scaleX(1.5);
  transform-origin: center;
}

@media (max-width: 860px) {
  .result-table {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: none;
    grid-template-areas:
      'cumulative'
      'distribution'
      'comparison'
      'bidding'
      'playing';
    height: auto;
    max-height: 76vh;
    overflow: auto;
  }
  .cumulative-panel,
  .distribution-panel,
  .comparison-panel,
  .bidding-panel,
  .playing-panel {
    min-height: 180px;
  }
  .comparison-panel {
    min-height: 240px;
  }
}
</style>
