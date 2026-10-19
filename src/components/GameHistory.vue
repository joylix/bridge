<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore, describeCall, vulName, type DealRecord } from '../store/game';
import ContractDisplay from './ContractDisplay.vue';
import { cardLabel, getSuit, isRedSuit } from '../models/card';
import { impsFromScoreDiff, hcpAdjustedPoints } from '../core/imps';
import type { BidRecord, Position } from '../models/gameState';

const open = defineModel<boolean>({ default: false });
const store = useGameStore();

const COLUMNS: Position[] = ['N', 'E', 'S', 'W'];

/** 当前进行中的对局快照（无任何动作时为 null） */
const currentDeal = computed<DealRecord | null>(() => {
  const active =
    store.biddingHistory.length > 0 || store.tricks.length > 0 || store.currentTrick.length > 0 || !!store.contract;
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

/** 展示列表：本局在前，历史对局按时间倒序 */
const records = computed(() => {
  const list = [...store.dealHistory]
    .reverse()
    .map((r) => ({ key: `h-${r.index}`, label: `第 ${r.index} 局`, record: r }));
  if (currentDeal.value) {
    list.unshift({ key: 'current', label: `本局（第 ${currentDeal.value.index} 局）`, record: currentDeal.value });
  }
  return list;
});

function bidText(rec: BidRecord | null): string {
  return rec ? describeCall(rec.call) : '';
}

function bidRounds(history: BidRecord[]): (BidRecord | null)[][] {
  const rows: (BidRecord | null)[][] = [];
  history.forEach((rec, i) => {
    const r = Math.floor(i / 4);
    if (!rows[r]) rows[r] = [null, null, null, null];
    rows[r][COLUMNS.indexOf(rec.position)] = rec;
  });
  return rows;
}

function cardText(card: number): string {
  return cardLabel(card);
}

/** 单局点数文案（启用贴点时按「IMP −（胜方大牌点 − 20）」折算） */
function dealPointsText(rec: DealRecord): string {
  if (rec.phase !== 'scoring') return '本局点数 未结算';
  const diff = rec.score.NS - rec.score.EW;
  const hcp = rec.hcp ?? { NS: 20, EW: 20 };
  const points = store.useHcpAdjust ? hcpAdjustedPoints(diff, hcp.NS, hcp.EW) : impsFromScoreDiff(diff);
  if (points > 0) return `本局点数 NS +${points}`;
  if (points < 0) return `本局点数 EW +${-points}`;
  return '本局点数 平';
}
</script>

<template>
  <el-dialog v-model="open" title="对局记录（叫牌 / 出牌复盘）" width="760px">
    <div v-if="records.length === 0" class="empty">尚无对局记录，开始新一局后即可查看。</div>

    <div v-for="item in records" :key="item.key" class="deal">
      <div class="deal-head">
        <span class="deal-title">{{ item.label }}</span>
        <span class="deal-meta">局况 {{ vulName(item.record.vulnerability) }} · 发牌人 {{ item.record.dealer }}</span>
        <span class="deal-points">{{ dealPointsText(item.record) }}</span>
        <span class="deal-contract">
          <ContractDisplay :contract="item.record.contract" empty-text="未定约" />
        </span>
      </div>

      <div class="deal-cols">
        <section class="col">
          <h4>叫牌记录</h4>
          <div v-if="item.record.biddingHistory.length" class="bid-table">
            <div class="bid-header">
              <span v-for="c in COLUMNS" :key="c">{{ c }}</span>
            </div>
            <div v-for="(row, i) in bidRounds(item.record.biddingHistory)" :key="i" class="bid-row">
              <span v-for="(rec, j) in row" :key="j" class="bid-cell">{{ bidText(rec) }}</span>
            </div>
          </div>
          <div v-else class="muted">尚无叫牌</div>
        </section>

        <section class="col">
          <h4>出牌过程（{{ item.record.tricks.length }} 墩已完成）</h4>
          <div v-if="item.record.tricks.length || item.record.currentTrick.length" class="tricks-log">
            <div v-for="(trick, ti) in item.record.tricks" :key="ti" class="trick-line">
              <span class="trick-no">#{{ ti + 1 }}</span>
              <span
                v-for="play in trick.plays"
                :key="play.card"
                class="play"
                :class="{ winner: play.position === trick.winner }"
              >
                <span class="play-seat">{{ play.position }}</span>
                <span class="play-card" :class="{ red: isRedSuit(getSuit(play.card)) }">{{ cardText(play.card) }}</span>
              </span>
            </div>
            <div v-if="item.record.currentTrick.length" class="trick-line current">
              <span class="trick-no">本轮</span>
              <span v-for="play in item.record.currentTrick" :key="play.card" class="play">
                <span class="play-seat">{{ play.position }}</span>
                <span class="play-card" :class="{ red: isRedSuit(getSuit(play.card)) }">{{ cardText(play.card) }}</span>
              </span>
            </div>
          </div>
          <div v-else class="muted">尚无出牌</div>
        </section>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.empty {
  color: #8a9790;
  font-size: 13px;
  padding: 12px 0;
}
.deal {
  border: 1px solid #e2e8e4;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.deal-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  border-bottom: 1px solid #e2e8e4;
  padding-bottom: 6px;
  margin-bottom: 8px;
}
.deal-title {
  font-weight: 700;
  color: #14563a;
}
.deal-meta {
  font-size: 12px;
  color: #6a7770;
}
.deal-points {
  font-size: 12px;
  font-weight: 600;
  color: #14563a;
  background: #e8f5ec;
  border-radius: 3px;
  padding: 0 6px;
}
.deal-contract {
  margin-left: auto;
  font-weight: 600;
  color: #8a5a00;
}
.deal-cols {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 16px;
}
@media (max-width: 620px) {
  .deal-cols {
    grid-template-columns: 1fr;
  }
}
.col h4 {
  margin: 0 0 6px;
  font-size: 12px;
  color: #3a4a40;
}
.bid-table {
  font-size: 14px;
}
.bid-header,
.bid-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.bid-header span {
  font-weight: 700;
  color: #8a9790;
  text-align: center;
}
.bid-cell {
  text-align: center;
  padding: 1px 0;
  color: #1c2b22;
}
.tricks-log {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 320px;
  overflow: auto;
}
.trick-line {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.trick-line.current {
  background: #fff6d8;
  border-radius: 4px;
  padding: 0 4px;
}
.trick-no {
  width: 34px;
  color: #8a9790;
  flex: none;
}
.play {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.play-seat {
  color: #77857c;
  font-size: 11px;
}
.play-card {
  background: #fff;
  border: 1px solid #b9c4bd;
  border-radius: 3px;
  padding: 0 5px;
  font-weight: 700;
  color: #1c2b22;
}
.play-card.red {
  color: #c0392b;
}
.play.winner .play-card {
  border-color: #d9a300;
  background: #fff8e2;
  box-shadow: 0 0 0 2px rgba(217, 163, 0, 0.4);
}
.muted {
  color: #9aa7a0;
  font-size: 12px;
}
</style>
