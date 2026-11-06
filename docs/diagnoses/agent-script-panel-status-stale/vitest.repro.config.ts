import { defineConfig } from 'vitest/config';
import base from '../../../vitest.config';

// 独立诊断入口，不改变项目默认测试集。
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['docs/diagnoses/agent-script-panel-status-stale/repro.test.ts'],
  },
});
