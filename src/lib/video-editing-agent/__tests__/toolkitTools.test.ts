import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ToolContext } from '../types';
import type { TimelineState } from '@/types';

/**
 * Toolkit 工具的适配层契约：统一信封、12 KiB 裁剪、next_step、取消、降级。
 * agent-general-toolkit spec §4.2 / §3.7 L2 / AC-05。
 */

function makeContext(): ToolContext {
  const timelineState: TimelineState = {
    currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [],
    tracks: [], playbackRate: 1, isPlaying: false, snapToGrid: false,
    gridSize: 0.1, scrollLeft: 0,
  };
  return {
    timelineState,
    materials: [],
    apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(),
    updateTimeline: vi.fn(),
    recordOperation: vi.fn(),
    turnState: {}, callBudget: { used: 0 },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toolkitAdapter', () => {
  it('sends x-tool-call-id and returns the flattened envelope', async () => {
    const { executeToolkitTool } = await import('../tools/toolkitAdapter');
    fetchMock.mockResolvedValue(jsonResponse({
      success: true, data: { name: 'a.txt', bytes: 5 },
    }));
    const result = await executeToolkitTool(makeContext(), 'call-7', {
      path: '/workspace/write', body: { name: 'a.txt' },
    });
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)['x-tool-call-id'])
      .toBe('call-7');
    expect(result.details).toMatchObject({
      success: true, name: 'a.txt', bytes: 5,
    });
    expect(result.content[0].type).toBe('text');
  });

  it('declares Origin on writes so the Origin gate never 403s the agent', async () => {
    const { executeToolkitTool } = await import('../tools/toolkitAdapter');
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
    const context = makeContext();
    await executeToolkitTool(context, 'call-8', {
      path: '/workspace/write', body: { name: 'a.md', content: 'x' },
    });
    const [, writeInit] = fetchMock.mock.calls[0];
    expect((writeInit.headers as Record<string, string>).origin)
      .toBe(context.apiBaseUrl);

    fetchMock.mockClear();
    await executeToolkitTool(context, 'call-9', { path: '/workspace/list' });
    const [, readInit] = fetchMock.mock.calls[0];
    // 读请求不带 Origin：GET 的矩阵里没有写闸门，多带一个头只会让 BFF 多想。
    expect((readInit.headers as Record<string, string>).origin).toBeUndefined();
  });

  it('keeps an oversized result under the byte cap even with many large fields',
    async () => {
      const { executeToolkitTool } = await import('../tools/toolkitAdapter');
      const { RESULT_BYTE_CAP } = await import('../tools/webToolAdapter');
      const bulky = Object.fromEntries(Array.from({ length: 40 }, (_, index) =>
        [`field_${index}`, 'x'.repeat(900)]));
      fetchMock.mockResolvedValue(jsonResponse({
        success: true, data: { files: Array.from({ length: 80 }, (_, index) =>
          ({ name: `f${index}.csv`, blob: 'y'.repeat(300) })), ...bulky },
      }));
      const result = await executeToolkitTool(makeContext(), 'call-10', {
        path: '/workspace/list',
      });
      const bytes = new TextEncoder().encode(
        JSON.stringify(result.details)).length;
      expect(bytes).toBeLessThanOrEqual(RESULT_BYTE_CAP);
      expect(result.details.truncated).toBe(true);
    });

  it('maps a backend error code to a soft failure with next_step', async () => {
    const { executeToolkitTool } = await import('../tools/toolkitAdapter');
    fetchMock.mockResolvedValue(jsonResponse({
      success: false, error_code: 'analysis_disabled',
      message: 'off', error_details: { failure_class: 'configuration' },
    }, 403));
    const result = await executeToolkitTool(makeContext(), 'call-1', {
      path: '/analysis/run', body: { code: 'print(1)' },
    });
    expect(result.details.success).toBe(false);
    expect(result.details.error_code).toBe('analysis_disabled');
    expect(String(result.details.next_step)).toContain('Settings');
    expect(result.details.failureClass).toBe('configuration');
  });

  it('caps an oversized result and tells the model why', async () => {
    const { executeToolkitTool, toolkitResult } = await import(
      '../tools/toolkitAdapter');
    const huge = 'y'.repeat(40_000);
    const direct = toolkitResult({ success: true, content: huge });
    const bytes = new TextEncoder().encode(
      JSON.stringify(direct.details)).length;
    expect(bytes).toBeLessThanOrEqual(12 * 1024);
    expect(direct.details.truncated).toBe(true);

    fetchMock.mockResolvedValue(jsonResponse({
      success: true, data: { content: huge },
    }));
    const result = await executeToolkitTool(makeContext(), 'c', {
      path: '/workspace/read',
    });
    expect(result.details.truncated).toBe(true);
  });

  it('refuses to run once the turn is cancelled', async () => {
    const { executeToolkitTool } = await import('../tools/toolkitAdapter');
    const context = makeContext();
    context.abortSignal = AbortSignal.abort();
    const result = await executeToolkitTool(context, 'c', {
      path: '/workspace/list',
    });
    expect(result.details.error_code).toBe('cancelled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('degrades a network failure to a transient soft failure', async () => {
    const { executeToolkitTool } = await import('../tools/toolkitAdapter');
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const result = await executeToolkitTool(makeContext(), 'c', {
      path: '/workspace/list',
    });
    expect(result.details.success).toBe(false);
    expect(result.details.error_code).toBe('network_error');
  });
});

describe('the 12 toolkit tools', () => {
  it('are all registered with unique names and a category each', async () => {
    const { createToolRegistry } = await import('../tools/index');
    const registry = createToolRegistry(makeContext());
    const names = registry.getAllTools().map(tool => tool.name);
    for (const name of [
      'update_plan', 'ask_user', 'workspace_list', 'workspace_read',
      'workspace_write', 'workspace_delete', 'workspace_import_material',
      'read_document', 'run_analysis', 'memory_write', 'memory_search',
      'memory_forget',
    ]) {
      expect(names).toContain(name);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps update_plan and ask_user available without explore_tools', async () => {
    const { createToolRegistry } = await import('../tools/index');
    const registry = createToolRegistry(makeContext());
    const always = registry.getAlwaysAvailableTools().map(tool => tool.name);
    expect(always).toContain('update_plan');
    expect(always).toContain('ask_user');
    expect(always).not.toContain('workspace_write');
    expect(always).not.toContain('run_analysis');
  });

  it('keeps every new on-demand category discoverable with one line', async () => {
    const { createDefaultCategories } = await import('../registry');
    const categories = createDefaultCategories();
    const wanted = ['workspace_tools', 'document_tools', 'analysis_tools',
      'memory_tools'];
    for (const id of wanted) {
      const category = categories.find(item => item.id === id);
      expect(category).toBeTruthy();
      expect(new TextEncoder().encode(category!.description).length)
        .toBeLessThanOrEqual(160);
      expect(category!.alwaysAvailable).toBe(false);
    }
  });
});
