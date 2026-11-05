import { defineConfig } from 'vitest/config';
import base from '../../../vitest.config';

// 单独运行诊断用例，不改变项目默认测试入口。
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['docs/diagnoses/agent-editing-reliability/repro.test.ts'],
  },
});
