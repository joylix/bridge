import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // 规则文件以 ?raw 构建期内联加载（见 MVP 设计文档 4.4），
  // .yml 的 raw 导入由 Vite 原生支持，无需额外插件。
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    globals: true,
  },
});
