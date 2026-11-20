import { defineConfig } from 'vitest/config';
import path from 'node:path';

// 诊断专用：只替换网络响应，执行真实 Agent 工具，不修改生产配置。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['docs/diagnoses/pexels-video-download-routing/repro/*.test.ts'],
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      'server-only': path.resolve(process.cwd(), 'src/test/server-only-stub.ts'),
    },
  },
});
