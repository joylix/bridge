<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { PLAY_DISPLAY_MS, useGameStore } from './store/game';
import Table from './components/Table.vue';
import BiddingBox from './components/BiddingBox.vue';
import DealResultDialog from './components/DealResultDialog.vue';
import GameHistory from './components/GameHistory.vue';
import PbnDialog from './components/PbnDialog.vue';
import RuleEditor from './components/RuleEditor.vue';
import type { Position, StyleLevel } from './models/gameState';

const store = useGameStore();

const settingsVisible = ref(false);
const historyVisible = ref(false);
const pbnVisible = ref(false);
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

onMounted(() => store.startNewGame());

/** 最后一墩先在桌面停留 1 秒，清除牌后再弹出结算结果 */
let resultTimer: ReturnType<typeof setTimeout> | null = null;
function clearResultTimer(): void {
  if (resultTimer !== null) {
    clearTimeout(resultTimer);
    resultTimer = null;
  }
}

watch(
  () => store.phase,
  (phase) => {
    clearResultTimer();
    if (phase === 'scoring') {
      resultVisible.value = false;
      resultTimer = setTimeout(() => {
        resultVisible.value = true;
        resultTimer = null;
      }, PLAY_DISPLAY_MS);
    }
    if (phase === 'bidding') resultVisible.value = false;
  },
);

onUnmounted(clearResultTimer);

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
      <h1><span class="suit-black suit-symbol">♠</span> 桥牌 MVP · 人机对战 <span class="suit-red suit-symbol">♥</span></h1>

      <div class="status">
        <strong>{{ phaseLabel }}</strong> · {{ store.message }}
      </div>
      <el-button type="primary" @click="onNewGame">新一局</el-button>
      <el-button :disabled="store.phase !== 'scoring'" @click="resultVisible = true">本局结果</el-button>
      <el-button @click="historyVisible = true">对局记录</el-button>
      <el-button @click="pbnVisible = true">PBN 导入/导出</el-button>
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
    <PbnDialog v-model="pbnVisible" />
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
          跟牌/垫牌细则（规则文件）
          <el-select
            :model-value="store.signalRuleFile.name"
            size="small"
            @update:model-value="store.setSignalRuleFile"
          >
            <el-option v-for="f in store.availableSignalFiles" :key="f" :label="f" :value="f" />
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
          <el-switch :model-value="store.showHints" @update:model-value="store.setShowHints" />
          <span>显示提示与推荐（叫牌含义 / 推荐叫品 / 推荐出牌）</span>
        </label>
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
        <label class="switch-row">
          <el-switch
            :model-value="store.useDdsPlayAI"
            @update:model-value="store.setDdsPlayEnabled"
          />
          <span>DDS 深度打牌（隐藏牌抽样，较慢但更强）</span>
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
