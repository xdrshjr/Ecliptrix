import { defineConfig } from 'vitest/config';
import base from '../../../vitest.config';

// 诊断入口独立于常规测试，不改变项目默认配置。
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['docs/diagnoses/workspace-media-import-failure/repro.test.tsx'],
  },
});
