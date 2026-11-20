import { defineConfig } from 'vitest/config';
import path from 'node:path';

// 诊断专用：真实路由和工具 + 离线上游，不加载全局 jsdom。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['docs/diagnoses/agent-capability-execution-failures/repro/*.test.ts'],
    env: { NODE_ENV: 'test', BACKEND_URL: 'http://127.0.0.1:18000' },
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      'server-only': path.resolve(process.cwd(), 'src/test/server-only-stub.ts'),
    },
  },
});
