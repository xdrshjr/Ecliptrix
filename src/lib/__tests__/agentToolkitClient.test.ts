import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * `/api/agent-toolkit/*` 客户端与后端闸门的对齐（spec §4.1.1）。
 *
 * 这两条是**真实故障**的回归钉：面板的读取端点在后端属「必须带
 * `x-tool-call-id`」那一格，删除端点在 BFF 侧不要求 content-type。任何一侧
 * 漏掉，面板就会整块显示「无法加载」，而单元测试之外很难发现。
 */

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('agentToolkit client', () => {
  it('mints an x-tool-call-id for panel reads', async () => {
    const { fetchWorkspaceListing } = await import('../api/agentToolkit');
    fetchMock.mockResolvedValue(jsonResponse({
      success: true, data: { files: [], documents: [] },
    }));
    await fetchWorkspaceListing('p1');
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    // 后端 `read_guard` 缺这个头就是 400 invalid_call_id。
    expect(headers['x-tool-call-id']).toMatch(/^panel-/);
    // 读请求没有请求体，不应该顺手声明 JSON。
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('sends no content-type on DELETE but keeps the call id', async () => {
    const { deleteMemory } = await import('../api/agentToolkit');
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
    await deleteMemory('memory-1', 'p1');
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('DELETE');
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers['x-tool-call-id']).toMatch(/^panel-/);
  });

  it('surfaces the backend error code instead of a generic failure', async () => {
    const { fetchMemories, AgentToolkitApiError } =
      await import('../api/agentToolkit');
    fetchMock.mockResolvedValue(jsonResponse({
      success: false, error_code: 'memory_disabled', message: 'off',
    }, 403));
    await expect(fetchMemories('p1')).rejects.toMatchObject({
      errorCode: 'memory_disabled',
      status: 403,
    });
    await expect(fetchMemories('p1')).rejects
      .toBeInstanceOf(AgentToolkitApiError);
  });
});
