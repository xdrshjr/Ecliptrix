import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * YOLO 开关 hook 的外壳语义
 * （docs/plans/agent-yolo-autonomous-mode spec.md §7.2 / AC-C1 / AC-C2）。
 *
 * 状态在 `autonomyStore`，本 hook 只做「首次订阅读一次」与「失败提示」。
 */

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));

vi.mock('@/lib/api/systemSettings', () => ({
  getCategorySettings: mocks.get,
  updateCategorySettings: mocks.update,
}));

import { resetYoloModeForTest } from '@/lib/video-editing-agent/autonomyStore';
import { useAgentYoloMode } from '../useAgentYoloMode';

const stored = (value: unknown) => ({
  success: true, category: 'agent_toolkit',
  settings: [{ key: 'yolo_mode', value }],
});

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(stored(false));
  mocks.update.mockReset().mockResolvedValue({ success: true, settings: [] });
  resetYoloModeForTest();
});

describe('useAgentYoloMode', () => {
  it('is disabled (ready=false) until the first read lands', async () => {
    const view = renderHook(() => useAgentYoloMode());
    expect(view.result.current.yoloReady).toBe(false);
    await waitFor(() => expect(view.result.current.yoloReady).toBe(true));
    expect(view.result.current.yolo).toBe(false);
  });

  it('toggles through the store and reports saving', async () => {
    const view = renderHook(() => useAgentYoloMode());
    await waitFor(() => expect(view.result.current.yoloReady).toBe(true));
    await act(async () => { await view.result.current.toggleYolo(true); });
    expect(view.result.current.yolo).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith('agent_toolkit', { yolo_mode: true });
  });

  it('reports a failed write and keeps the previous value', async () => {
    const onSaveFailed = vi.fn();
    const view = renderHook(() => useAgentYoloMode({ onSaveFailed }));
    await waitFor(() => expect(view.result.current.yoloReady).toBe(true));
    mocks.update.mockRejectedValue(new Error('boom'));
    await act(async () => { await view.result.current.toggleYolo(true); });
    expect(onSaveFailed).toHaveBeenCalledTimes(1);
    expect(view.result.current.yolo).toBe(false);
  });

  it('shares one snapshot between two instances (AC-C9)', async () => {
    const a = renderHook(() => useAgentYoloMode());
    const b = renderHook(() => useAgentYoloMode());
    await waitFor(() => expect(a.result.current.yoloReady).toBe(true));
    await act(async () => { await a.result.current.toggleYolo(true); });
    expect(b.result.current.yolo).toBe(true);
    // 两个入口共用一次 GET。
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});
