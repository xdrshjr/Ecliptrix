import { defineConfig } from 'vitest/config';
import path from 'node:path';
import base from '../../../../vitest.config';

// 独立诊断入口，不改变项目默认测试集。
// 运行：
//   npx vitest run --config docs/diagnoses/youtube-desktop-add-material-download-failed/repro/vitest.repro.config.ts
export default defineConfig({
  ...base,
  resolve: {
    ...base.resolve,
    alias: {
      '@': path.resolve(__dirname, '../../../../src'),
      'server-only': path.resolve(__dirname, '../../../../src/test/server-only-stub.ts'),
    },
  },
  test: {
    ...base.test,
    include: [
      'docs/diagnoses/youtube-desktop-add-material-download-failed/repro/*.repro.test.tsx',
    ],
  },
});
