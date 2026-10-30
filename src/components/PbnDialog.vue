<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useGameStore } from '../store/game';
import type { ExchangeIssue } from '../exchange';

const open = defineModel<boolean>({ default: false });
const store = useGameStore();

type Format = 'json' | 'pbn' | 'csv';

const format = ref<Format>('pbn');
const text = ref('');
const error = ref('');
const info = ref('');

const FORMAT_LABEL: Record<Format, string> = { json: 'JSON', pbn: 'PBN', csv: 'CSV' };
const FORMAT_EXT: Record<Format, string> = { json: 'json', pbn: 'pbn', csv: 'csv' };
const FORMAT_MIME: Record<Format, string> = {
  json: 'application/json;charset=utf-8',
  pbn: 'text/plain;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
};

function fillCurrentDeal(): void {
  error.value = '';
  info.value = '';
  try {
    if (format.value === 'json') {
      text.value = store.exportTableBoardJson();
      info.value = '已读取当前牌局的完整 TableBoard JSON（含引擎快照）。';
    } else if (format.value === 'pbn') {
      const result = store.exportTableBoardPbn();
      text.value = result.text;
      info.value =
        result.losses.length > 0
          ? `已生成 PBN；有 ${result.losses.length} 项信息未写入 PBN，完整信息请用 JSON。`
          : '已生成完整 PBN。';
    } else {
      text.value = store.exportTableBoardCsv();
      info.value = '已生成历史 + 当前副的 CSV 计分汇总。';
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

watch(open, (value) => {
  if (value) fillCurrentDeal();
});

watch(format, () => {
  if (open.value) fillCurrentDeal();
});

async function copyText(): Promise<void> {
  error.value = '';
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text.value);
      info.value = `${FORMAT_LABEL[format.value]} 已复制到剪贴板。`;
      return;
    }
  } catch {
    // 浏览器拒绝剪贴板权限时退回手动复制
  }
  info.value = '无法自动复制，请在文本框中手动选择并复制。';
}

function hasFullPbnTags(value: string): boolean {
  return /\[(Deal|Dealer|Auction|Contract|Play|Score)\b/i.test(value);
}

function reportIssues(issues: ExchangeIssue[]): void {
  const notable = issues.filter((issue) => issue.severity !== 'info');
  if (notable.length === 0) return;
  ElMessage.warning({
    message: notable.map((issue) => `${issue.code}: ${issue.message}`).join('；'),
    duration: 6000,
    showClose: true,
  });
}

function importText(): void {
  error.value = '';
  info.value = '';
  if (format.value === 'csv') {
    error.value = 'CSV 只支持导出；请用 JSON 或 PBN 导入完整牌局。';
    return;
  }
  try {
    const value = text.value.trim();
    if (!value) {
      error.value = '请先粘贴要导入的内容。';
      return;
    }
    if (format.value === 'json' || value.startsWith('{')) {
      reportIssues(store.importTableBoardJson(value));
      open.value = false;
      return;
    }
    if (hasFullPbnTags(value)) {
      reportIssues(store.importTableBoardPbn(value));
      open.value = false;
      return;
    }
    // 兼容只含发牌字符串的简单 PBN。
    store.importDealPbn(value);
    open.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function downloadFile(): void {
  error.value = '';
  try {
    const blob = new Blob([text.value], { type: FORMAT_MIME[format.value] });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bridge-board-${store.gamesPlayed}.${FORMAT_EXT[format.value]}`;
    link.click();
    URL.revokeObjectURL(url);
    info.value = `已下载 ${FORMAT_LABEL[format.value]} 文件。`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}
</script>

<template>
  <el-dialog
    v-model="open"
    title="牌局导入 / 导出"
    width="min(760px, 94vw)"
    draggable
    :close-on-click-modal="false"
  >
    <div class="exchange-toolbar">
      <el-radio-group v-model="format" size="small">
        <el-radio-button value="json">JSON</el-radio-button>
        <el-radio-button value="pbn">PBN</el-radio-button>
        <el-radio-button value="csv">CSV</el-radio-button>
      </el-radio-group>
      <span class="exchange-hint">
        {{
          format === 'json'
            ? '完整 TableBoard 记录，含叫牌、出牌、计分与引擎快照。'
            : format === 'pbn'
              ? 'PBN 2.1 子集；不可保留的信息以损失报告说明。'
              : '历史与当前副的计分汇总（UTF-8 BOM）；只支持导出。'
        }}
      </span>
    </div>

    <p class="pbn-tip">
      <template v-if="format === 'pbn'">
        导入支持完整 PBN（含 <code>[Deal]</code> / <code>[Auction]</code> /
        <code>[Contract]</code> / <code>[Play]</code>），也兼容只粘贴发牌字符串。
      </template>
      <template v-else-if="format === 'json'">导入后按记录恢复当前副；已完成的牌局进入结算视图。</template>
      <template v-else>每副一行，包含定约、结果、原始分、双方大牌点与 IMP。</template>
    </p>

    <el-input v-model="text" type="textarea" :rows="9" spellcheck="false" resize="vertical" />

    <p v-if="error" class="pbn-error">{{ error }}</p>
    <p v-else-if="info" class="pbn-info">{{ info }}</p>

    <template #footer>
      <el-button @click="fillCurrentDeal">读取当前牌局</el-button>
      <el-button @click="downloadFile">下载 .{{ FORMAT_EXT[format] }}</el-button>
      <el-button @click="copyText">复制</el-button>
      <el-button type="primary" :disabled="format === 'csv'" @click="importText">导入并开始</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.exchange-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.exchange-hint {
  color: #909399;
  font-size: 12px;
}

.pbn-tip {
  margin: 0 0 12px;
  color: #606266;
  font-size: 13px;
  line-height: 1.6;
}

.pbn-tip code {
  padding: 1px 4px;
  border-radius: 3px;
  background: #f4f4f5;
}

.pbn-info {
  margin: 10px 0 0;
  color: #67c23a;
  font-size: 13px;
}

.pbn-error {
  margin: 10px 0 0;
  color: #f56c6c;
  font-size: 13px;
}
</style>
