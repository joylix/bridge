<script setup lang="ts">
import { ref, watch } from 'vue';
import { useGameStore } from '../store/game';

const open = defineModel<boolean>({ default: false });
const store = useGameStore();

const text = ref('');
const error = ref('');
const info = ref('');

function fillCurrentDeal(): void {
  error.value = '';
  info.value = '';
  try {
    text.value = store.exportDealPbn();
    info.value = '已读取当前牌局；可直接复制，或修改后导入。';
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

watch(open, (value) => {
  if (value) fillCurrentDeal();
});

async function copyPbn(): Promise<void> {
  error.value = '';
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text.value);
      info.value = 'PBN 已复制到剪贴板。';
      return;
    }
  } catch {
    // 浏览器拒绝剪贴板权限时退回手动复制
  }
  info.value = '无法自动复制，请在文本框中手动选择并复制。';
}

function importPbn(): void {
  error.value = '';
  info.value = '';
  try {
    store.importDealPbn(text.value);
    open.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function downloadPbn(): void {
  error.value = '';
  try {
    const blob = new Blob([text.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bridge-deal-${store.gamesPlayed}.pbn`;
    link.click();
    URL.revokeObjectURL(url);
    info.value = '已下载 PBN 文件。';
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}
</script>

<template>
  <el-dialog
    v-model="open"
    title="PBN 导入 / 导出"
    width="min(720px, 94vw)"
    draggable
    :close-on-click-modal="false"
  >
    <p class="pbn-tip">
      使用标准 PBN 发牌格式，例如
      <code>N:AKQ2.KJ3.AKQ4.A2 ...</code>。导入后会立即作为新一局开始叫牌。
    </p>

    <el-input v-model="text" type="textarea" :rows="7" spellcheck="false" resize="vertical" />

    <p v-if="error" class="pbn-error">{{ error }}</p>
    <p v-else-if="info" class="pbn-info">{{ info }}</p>

    <template #footer>
      <el-button @click="fillCurrentDeal">读取当前牌局</el-button>
      <el-button @click="downloadPbn">下载 .pbn</el-button>
      <el-button @click="copyPbn">复制</el-button>
      <el-button type="primary" @click="importPbn">导入并开始</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
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
