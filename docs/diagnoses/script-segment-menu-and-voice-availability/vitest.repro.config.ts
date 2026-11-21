import { defineConfig } from 'vitest/config';
import base from '../../../vitest.config';

// 独立诊断入口，不加入默认回归测试集。
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['docs/diagnoses/script-segment-menu-and-voice-availability/repro.test.tsx'],
    fileParallelism: false,
  },
});
