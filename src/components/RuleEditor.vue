<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGameStore } from '../store/game';
import { parseBiddingRules, parseLeadRules, parseSignalRules } from '../engine/loader';
import type { BiddingRule, LeadRule, SignalRule } from '../engine/types';

const open = defineModel<boolean>({ default: false });
const store = useGameStore();

type Tab = 'bidding' | 'lead' | 'signal';
type Mode = 'list' | 'edit';

const activeTab = ref<Tab>('bidding');
const biddingFile = ref(store.biddingRuleFile.name);
const leadFile = ref(store.leadRuleFile.name);
const signalFile = ref(store.signalRuleFile.name);
const mode = ref<Mode>('list');
const draft = ref('');
const errors = ref<string[]>([]);
const notice = ref('');

const files = computed(() => {
  if (activeTab.value === 'bidding') return store.availableBiddingFiles;
  if (activeTab.value === 'lead') return store.availableLeadFiles;
  return store.availableSignalFiles;
});
const currentFile = computed(() => {
  if (activeTab.value === 'bidding') return biddingFile.value;
  if (activeTab.value === 'lead') return leadFile.value;
  return signalFile.value;
});
const source = computed(() => store.getRuleSource(activeTab.value, currentFile.value));
const overridden = computed(() => store.isRuleOverridden(activeTab.value, currentFile.value));
const isActiveFile = computed(() => {
  if (activeTab.value === 'bidding') return store.biddingRuleFile.name === biddingFile.value;
  if (activeTab.value === 'lead') return store.leadRuleFile.name === leadFile.value;
  return store.signalRuleFile.name === signalFile.value;
});

/** 浏览用：解析当前文件（失败时返回空表，错误在编辑模式下提示） */
const biddingRules = computed<BiddingRule[]>(() => {
  if (activeTab.value !== 'bidding') return [];
  try {
    return parseBiddingRules(source.value);
  } catch {
    return [];
  }
});
const leadRules = computed<LeadRule[]>(() => {
  if (activeTab.value !== 'lead') return [];
  try {
    return parseLeadRules(source.value);
  } catch {
    return [];
  }
});
const parsedSignalRules = computed(() => {
  if (activeTab.value !== 'signal') return { rules: [] as SignalRule[], settings: {} };
  try {
    return parseSignalRules(source.value);
  } catch {
    return { rules: [] as SignalRule[], settings: {} };
  }
});
const signalRules = computed(() => parsedSignalRules.value.rules);
const signalSettings = computed(() => parsedSignalRules.value.settings);
const ruleCount = computed(() => {
  if (activeTab.value === 'bidding') return biddingRules.value.length;
  if (activeTab.value === 'lead') return leadRules.value.length;
  return signalRules.value.length;
});

const PHASE_LABEL: Record<SignalRule['phase'], string> = {
  follow: '跟牌',
  discard: '垫牌',
  signal: '信号',
};

function phaseLabel(phase: string): string {
  return PHASE_LABEL[phase as SignalRule['phase']] ?? phase;
}

function formatWhen(when: Record<string, unknown> | undefined): string {
  if (!when || Object.keys(when).length === 0) return '—';
  return Object.entries(when)
    .map(([key, value]) => `${key}: ${value}`)
    .join('，');
}

function resetView(): void {
  mode.value = 'list';
  errors.value = [];
  notice.value = '';
  draft.value = '';
}

function onFileChange(name: string): void {
  if (activeTab.value === 'bidding') biddingFile.value = name;
  else if (activeTab.value === 'lead') leadFile.value = name;
  else signalFile.value = name;
}

function openEdit(): void {
  if (!store.canEditRules) return;
  draft.value = source.value;
  errors.value = [];
  notice.value = '';
  mode.value = 'edit';
}

function save(): void {
  errors.value = [];
  notice.value = '';
  try {
    store.saveRuleSource(activeTab.value, currentFile.value, draft.value);
    draft.value = source.value;
    notice.value = '已保存并应用';
    mode.value = 'list';
  } catch (error) {
    errors.value = [error instanceof Error ? error.message : String(error)];
  }
}

function resetDefault(): void {
  errors.value = [];
  notice.value = '';
  try {
    store.resetRuleSource(activeTab.value, currentFile.value);
    draft.value = source.value;
    notice.value = '已恢复内置默认规则';
    mode.value = 'list';
  } catch (error) {
    errors.value = [error instanceof Error ? error.message : String(error)];
  }
}

function useAsActive(): void {
  if (activeTab.value === 'bidding') store.setBiddingRuleFile(biddingFile.value);
  else if (activeTab.value === 'lead') store.setLeadRuleFile(leadFile.value);
  else store.setSignalRuleFile(signalFile.value);
  const label =
    activeTab.value === 'bidding'
      ? '叫牌'
      : activeTab.value === 'lead'
        ? '首攻'
        : '跟牌/垫牌';
  notice.value = `已设为当前使用的${label}规则`;
}

function clearAll(): void {
  errors.value = [];
  notice.value = '';
  try {
    store.resetAllRuleOverrides();
    resetView();
    notice.value = '已清除全部本地规则修改';
  } catch (error) {
    errors.value = [error instanceof Error ? error.message : String(error)];
  }
}

watch(open, (visible) => {
  if (visible) resetView();
});
watch([activeTab, biddingFile, leadFile, signalFile], () => resetView());
</script>

<template>
  <el-dialog v-model="open" title="叫牌 / 打牌规则" width="920px" top="6vh">
    <el-alert
      v-if="!store.canEditRules"
      type="info"
      :closable="false"
      show-icon
      title="当前账号为只读权限：仅系统管理员可修改规则。"
      class="tip"
    />

    <el-tabs v-model="activeTab">
      <el-tab-pane label="叫牌规则" name="bidding" />
      <el-tab-pane label="打牌规则（首攻）" name="lead" />
      <el-tab-pane label="打牌细则（跟牌/垫牌）" name="signal" />
    </el-tabs>

    <div class="toolbar">
      <el-select
        :model-value="currentFile"
        size="small"
        style="width: 170px"
        @update:model-value="onFileChange"
      >
        <el-option v-for="f in files" :key="f" :label="f" :value="f" />
      </el-select>
      <el-tag v-if="overridden" type="warning" effect="plain">本地已修改</el-tag>
      <el-tag v-if="isActiveFile" type="success" effect="plain">当前使用</el-tag>
      <el-button v-else size="small" @click="useAsActive">设为当前使用</el-button>
      <span class="spacer" />
      <el-button size="small" :type="mode === 'list' ? 'primary' : ''" @click="resetView">浏览细则</el-button>
      <el-button
        size="small"
        :type="mode === 'edit' ? 'primary' : ''"
        :disabled="!store.canEditRules"
        @click="openEdit"
      >
        编辑源码
      </el-button>
      <el-button v-if="store.canEditRules" size="small" :disabled="!overridden" @click="resetDefault">
        恢复默认
      </el-button>
    </div>

    <el-alert v-if="notice" :title="notice" type="success" :closable="false" class="tip" />
    <el-alert v-for="(err, i) in errors" :key="i" :title="err" type="error" :closable="false" class="tip" />

    <div v-if="mode === 'list'" class="list-view">
      <el-table
        v-if="activeTab === 'bidding'"
        :data="biddingRules"
        size="small"
        border
        height="400"
        empty-text="该文件没有可展示的规则"
      >
        <el-table-column prop="id" label="规则 ID" width="170" />
        <el-table-column prop="description" label="说明" min-width="200" />
        <el-table-column prop="sequence" label="序列" width="140" />
        <el-table-column label="条件（when）" min-width="170">
          <template #default="{ row }">{{ formatWhen(row.when) }}</template>
        </el-table-column>
        <el-table-column prop="action" label="动作" width="80" />
        <el-table-column prop="priority" label="优先级" width="80" />
      </el-table>

      <el-table
        v-else-if="activeTab === 'lead'"
        :data="leadRules"
        size="small"
        border
        height="400"
        empty-text="该文件没有可展示的规则"
      >
        <el-table-column prop="id" label="规则 ID" width="180" />
        <el-table-column prop="description" label="说明" min-width="220" />
        <el-table-column label="定约类型" width="90">
          <template #default="{ row }">{{ row.context?.contract_type === 'NT' ? 'NT' : '有将' }}</template>
        </el-table-column>
        <el-table-column label="适用方" width="90">
          <template #default="{ row }">
            {{ row.role === 'defender' ? '防守方' : row.role === 'declarer' ? '庄家侧' : '不限' }}
          </template>
        </el-table-column>
        <el-table-column label="条件（when）" min-width="160">
          <template #default="{ row }">{{ formatWhen(row.when) }}</template>
        </el-table-column>
        <el-table-column prop="lead" label="首攻策略" width="190" />
        <el-table-column prop="priority" label="优先级" width="80" />
      </el-table>

      <el-table
        v-else
        :data="signalRules"
        size="small"
        border
        height="400"
        empty-text="该文件没有可展示的打牌细则"
      >
        <el-table-column prop="id" label="细则 ID" width="220" />
        <el-table-column prop="description" label="说明" min-width="260" />
        <el-table-column label="阶段" width="80">
          <template #default="{ row }">{{ phaseLabel(row.phase) }}</template>
        </el-table-column>
        <el-table-column label="条件（when）" min-width="150">
          <template #default="{ row }">{{ formatWhen(row.when) }}</template>
        </el-table-column>
        <el-table-column prop="action" label="策略" width="190" />
        <el-table-column prop="priority" label="优先级" width="80" />
      </el-table>

      <p v-if="activeTab === 'signal'" class="signal-settings">
        可执行阈值：张数信号最大牌面 {{ signalSettings.signal_spot_max_rank ?? '默认 10' }}；
        有将鼓励垫牌最小牌面 {{ signalSettings.encourage_discard_min_rank ?? '默认 8' }}。
        规则列表由 AI 解释执行，阈值修改后会立即影响打牌。
      </p>

      <p class="hint">共 {{ ruleCount }} 条{{ activeTab === 'signal' ? '细则' : '规则' }}，按优先级从高到低排列（与 AI 裁决顺序一致）。</p>
    </div>

    <div v-else class="edit-view">
      <el-input v-model="draft" type="textarea" :rows="20" spellcheck="false" class="yaml-editor" />
      <p class="hint">修改后点击“保存并应用”；保存前会做 YAML 语法与必备字段校验，失败则不会写入。</p>
      <div class="edit-actions">
        <el-button type="primary" @click="save">保存并应用</el-button>
        <el-button @click="resetView">取消</el-button>
      </div>
    </div>

    <template #footer>
      <div class="footer">
        <el-button v-if="store.canEditRules" size="small" type="danger" plain @click="clearAll">
          清除全部本地修改
        </el-button>
        <el-button type="primary" @click="open = false">关闭</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.spacer {
  flex: 1;
}
.tip {
  margin-bottom: 8px;
}
.hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: #6a7770;
}
.signal-settings {
  margin: 8px 0 0;
  padding: 6px 8px;
  border-left: 3px solid #188a55;
  background: #f3fbf6;
  color: #345846;
  font-size: 12px;
}
.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.yaml-editor :deep(textarea) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
}
.footer {
  display: flex;
  justify-content: space-between;
}
</style>
