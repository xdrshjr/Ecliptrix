/**
 * Agent Toolkit 集成用例。
 *
 * 运行方式（**必须**显式指定集成配置，否则 0 用例、退出码 0）：
 *   npx vitest run --config vitest.integration.config.ts tests/integration/agent-toolkit.test.ts
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §8 / AC-29。
 *
 * 这一层验证的是**跨模块接线**，不重复单测里的边界断言：
 *   1. 默认 `vitest.config.ts` 不收本文件（防止用例被挪到不被执行的位置）；
 *   2. BFF 白名单与后端 `/api/agent-toolkit` 前缀真的拼得上；
 *   3. 工具注册 → 类别披露 → 系统提示 这条链在一个进程里完整成立；
 *   4. 12 个工具的 schema 合计真的在按需类别额度内。
 */
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import defaultConfig from '../../vitest.config';
import { createToolRegistry } from '@/lib/video-editing-agent/tools/index';
import { buildSystemPrompt } from '@/lib/video-editing-agent/systemPrompt';
import { ON_DEMAND_CATEGORY_IDS } from '@/lib/video-editing-agent/registry';
import type { ToolContext } from '@/lib/video-editing-agent/types';
import type { TimelineState } from '@/types';

const TOOLKIT_CATEGORIES = [
  'workspace_tools', 'document_tools', 'analysis_tools', 'memory_tools',
];

const TOOLKIT_TOOLS = [
  'update_plan', 'ask_user', 'workspace_list', 'workspace_read',
  'workspace_write', 'workspace_delete', 'workspace_import_material',
  'read_document', 'run_analysis', 'memory_write', 'memory_search',
  'memory_forget',
];

function makeContext(): ToolContext {
  const timelineState: TimelineState = {
    currentTime: 0, totalDuration: 0, snapToGrid: false, gridSize: 1,
    zoomLevel: 1, scrollLeft: 0, tracks: [], selectedItems: [],
    playbackRate: 1, isPlaying: false,
  };
  return {
    timelineState, materials: [], apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(), updateTimeline: () => undefined,
    recordOperation: () => undefined, turnState: {},
  };
}

describe('agent toolkit wiring', () => {
  it('keeps this integration file out of the default unit-test config', () => {
    const exclude = (defaultConfig.test?.exclude ?? []) as string[];
    expect(exclude.some(pattern => pattern.includes('tests/integration'))).toBe(true);
    const include = (defaultConfig.test?.include ?? []) as string[];
    expect(include.some(pattern => pattern.includes('src/'))).toBe(true);
    expect(include.some(pattern => pattern.includes('tests/integration'))).toBe(false);
  });

  it('registers all 12 toolkit tools across 4 on-demand categories', () => {
    const registry = createToolRegistry(makeContext());
    const names = registry.getAllTools().map(tool => tool.name);
    for (const name of TOOLKIT_TOOLS) expect(names).toContain(name);
    for (const category of TOOLKIT_CATEGORIES) {
      expect(ON_DEMAND_CATEGORY_IDS).toContain(category);
      expect(registry.getCategoryToolInfo(category)).toBeTruthy();
    }
  });

  it('keeps the 12 tool schemas inside the measured 8 KiB budget', () => {
    const registry = createToolRegistry(makeContext());
    const names = new Set(TOOLKIT_TOOLS);
    const bytes = registry.getAllTools()
      .filter(tool => names.has(tool.name))
      .reduce((total, tool) => total + new TextEncoder().encode(
        JSON.stringify({ name: tool.name, description: tool.description,
          parameters: tool.parameters })).length, 0);
    // AC-05 实测值（spec §13 D-14）：8079 字节。上界按 8 KiB 钉住；
    // L1 的硬额度是 48 KiB，这条断言防的是「12 个工具悄悄长成 48 KiB 的一半」。
    expect(bytes).toBeLessThanOrEqual(8 * 1024);
  });

  it('keeps every new category discoverable from the L0 prompt', () => {
    const context = makeContext();
    const registry = createToolRegistry(context);
    const prompt = buildSystemPrompt({
      timelineState: context.timelineState, materials: [], registry,
      exploredCategories: [], plan: null, memoryDigest: null,
    });
    for (const category of TOOLKIT_CATEGORIES) {
      expect(prompt).toContain(category);
    }
  });

  it('proxies the toolkit prefix the tools actually call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: true, data: { files: [] } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const route = await import('@/app/api/agent-toolkit/[...path]/route');
      const request = new NextRequest(
        'http://localhost:3000/api/agent-toolkit/workspace/list?project_id=p1',
        { headers: { origin: 'http://localhost:3000',
          'x-tool-call-id': 'call-1' } },
      );
      const response = await route.GET(request, {
        params: Promise.resolve({ path: ['workspace', 'list'] }),
      });
      expect(response.status).toBe(200);
      const [url] = fetchMock.mock.calls[0];
      // 后端真前缀 + 工具使用的相对路径。
      expect(String(url)).toContain('/api/agent-toolkit/workspace/list');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
