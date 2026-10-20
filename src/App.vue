<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useGameStore } from './store/game';
import Table from './components/Table.vue';
import BiddingBox from './components/BiddingBox.vue';
import ContractDisplay from './components/ContractDisplay.vue';
import DealResultDialog from './components/DealResultDialog.vue';
import GameHistory from './components/GameHistory.vue';
import RuleEditor from './components/RuleEditor.vue';
import type { Position, StyleLevel } from './models/gameState';

const store = useGameStore();

const settingsVisible = ref(false);
const historyVisible = ref(false);
const rulesVisible = ref(false);
const resultVisible = ref(false);
const ROBOT_SEATS: Position[] = ['N', 'E', 'W'];
const SEAT_LABEL: Record<Position, string> = { N: '北家机器人', E: '东家机器人', S: '南家 (你)', W: '西家机器人' };
const STYLE_OPTIONS: { label: string; value: StyleLevel }[] = [
  { label: '0 保守', value: 0 },
  { label: '1 正常', value: 1 },
  { label: '2 激进', value: 2 },
];

const phaseLabel = computed(
  () =>
    ({
      idle: '待开始',
      bidding: '叫牌中',
      play_waiting_lead: '等待首攻',
      play: '打牌中',
      scoring: '已结算',
    })[store.phase] ?? store.phase,
);

/** 只有轮到人类叫牌时才挂载叫牌弹窗，其他时间自动关闭 */
const showBiddingPopup = computed(
  () => store.phase === 'bidding' && store.isHumanControlled(store.currentBidder),
);

/** 左上角精简定约信息 */
const contractEmptyText = computed(() => (store.phase === 'scoring' ? '流局' : '—'));

onMounted(() => store.startNewGame());

watch(
  () => store.phase,
  (phase) => {
    if (phase === 'scoring') resultVisible.value = true;
    if (phase === 'bidding') resultVisible.value = false;
  },
);

function onNewGame(): void {
  resultVisible.value = false;
  store.startNewGame();
}

function onRandomness(pos: Position, value: number | number[]): void {
  store.setSeatStyle(pos, { randomness: Array.isArray(value) ? value[0] : value });
}

function toggleAutoPilot(value: boolean): void {
  store.setAutoPilot(value);
}

function onRoundSize(value: number): void {
  store.setRoundSize(value === 16 ? 16 : 8);
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="header-left">
        <h1><span class="suit-black">♠</span> 桥牌 MVP · 人机对战 <span class="suit-red">♥</span></h1>
        <div class="contract-chip" :class="{ pending: !store.contract && store.phase !== 'scoring' }">
          <span class="contract-chip-label">定约</span>
          <strong class="contract-chip-value">
            <ContractDisplay :contract="store.contract" :empty-text="contractEmptyText" />
          </strong>
          <span v-if="store.contract" class="contract-chip-sub">需 {{ store.contract.level + 6 }} 墩</span>
        </div>
      </div>

      <div class="status">
        <strong>{{ phaseLabel }}</strong> · {{ store.message }}
      </div>
      <el-button type="primary" @click="onNewGame">新一局</el-button>
      <el-button :disabled="store.phase !== 'scoring'" @click="resultVisible = true">本局结果</el-button>
      <el-button @click="historyVisible = true">对局记录</el-button>
      <el-button @click="rulesVisible = true">规则管理</el-button>
      <el-button @click="settingsVisible = true">风格 / 规则设置</el-button>
    </header>

    <main class="app-body">
      <Table />
    </main>

    <!-- 叫牌卡改为可拖动浮窗，只在轮到人类叫牌时出现 -->
    <BiddingBox v-if="showBiddingPopup" />

    <DealResultDialog v-model="resultVisible" />
    <GameHistory v-model="historyVisible" />
    <RuleEditor v-model="rulesVisible" />

    <el-dialog v-model="settingsVisible" title="机器人风格与规则设置" width="620px">
      <div v-for="pos in ROBOT_SEATS" :key="pos" class="seat-setting">
        <h4>{{ SEAT_LABEL[pos] }}</h4>
        <div class="seat-fields">
          <label>
            叫牌风格
            <el-select
              :model-value="store.styles[pos].bid"
              size="small"
              @update:model-value="(v: StyleLevel) => store.setSeatStyle(pos, { bid: v })"
            >
              <el-option v-for="o in STYLE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </label>
          <label>
            打牌风格
            <el-select
              :model-value="store.styles[pos].play"
              size="small"
              @update:model-value="(v: StyleLevel) => store.setSeatStyle(pos, { play: v })"
            >
              <el-option v-for="o in STYLE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </label>
          <label class="slider">
            随机度 {{ store.styles[pos].randomness.toFixed(2) }}
            <el-slider
              :model-value="store.styles[pos].randomness"
              :min="0"
              :max="1"
              :step="0.05"
              @update:model-value="(v: number | number[]) => onRandomness(pos, v)"
            />
          </label>
        </div>
      </div>

      <el-divider />

      <div class="rule-setting">
        <label>
          叫牌体系（规则文件）
          <el-select
            :model-value="store.biddingRuleFile.name"
            size="small"
            @update:model-value="store.setBiddingRuleFile"
          >
            <el-option v-for="f in store.availableBiddingFiles" :key="f" :label="f" :value="f" />
          </el-select>
        </label>
        <label>
          首攻约定（规则文件）
          <el-select
            :model-value="store.leadRuleFile.name"
            size="small"
            @update:model-value="store.setLeadRuleFile"
          >
            <el-option v-for="f in store.availableLeadFiles" :key="f" :label="f" :value="f" />
          </el-select>
        </label>
        <label>
          计点循环（副数）
          <el-select
            :model-value="store.roundSize"
            size="small"
            @update:model-value="onRoundSize"
          >
            <el-option :value="8" label="8 副" />
            <el-option :value="16" label="16 副" />
          </el-select>
        </label>
      </div>

      <el-divider />

      <div class="game-options">
        <label class="switch-row">
          <el-switch :model-value="store.autoPilot" @update:model-value="toggleAutoPilot" />
          <span>自动托管南家（全机器演示）</span>
        </label>
        <label class="switch-row">
          <el-switch
            :model-value="store.useHcpAdjust"
            @update:model-value="store.setUseHcpAdjust"
          />
          <span>计点贴点制</span>
        </label>
      </div>

      <template #footer>
        <el-button type="primary" @click="settingsVisible = false">完成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.app-header h1 .suit-black {
  color: #eaf5ee;
}
.app-header h1 .suit-red {
  color: #ff7b6b;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.contract-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 999px;
  background: linear-gradient(160deg, rgba(255, 241, 190, 0.98), rgba(255, 225, 154, 0.92));
  border: 1px solid rgba(255, 241, 190, 0.9);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22);
  color: #3b2a00;
  white-space: nowrap;
}
.contract-chip.pending {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.18);
  color: rgba(234, 245, 238, 0.66);
  box-shadow: none;
}
.contract-chip-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  opacity: 0.72;
}
.contract-chip-value {
  font-size: 15px;
  line-height: 1.1;
}
.contract-chip-sub {
  font-size: 10px;
  opacity: 0.68;
}
.game-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.switch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #3a4a40;
}
.seat-setting {
  margin-bottom: 12px;
}
.seat-setting h4 {
  margin: 0 0 6px;
  font-size: 13px;
  color: #14563a;
}
.seat-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.seat-fields > label {
  font-size: 12px;
  color: #5a6a61;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.seat-fields .slider {
  grid-column: 1 / -1;
}
.rule-setting {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.rule-setting > label {
  font-size: 12px;
  color: #5a6a61;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
