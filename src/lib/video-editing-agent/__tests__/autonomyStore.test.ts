import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `autonomyStore` 是 YOLO 开关的唯一真相
 * （docs/plans/agent-yolo-autonomous-mode spec.md §4.2 / §7.2 / AC-C9）。
 *
 * 两个入口（剪辑台工具栏、设置中心小节）读同一个快照：这里断言 store
 * 本身的语义——单次 GET、乐观写入、失败回滚、广播。
 */

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));

vi.mock('@/lib/api/systemSettings', () => ({
  getCategorySettings: mocks.get,
  updateCategorySettings: mocks.update,
}));

import {
  YOLO_MODE_UPDATED_EVENT,
  getYoloModeSnapshot,
  loadYoloModeOnce,
  resetYoloModeForTest,
  setYoloMode,
  subscribeYoloMode,
} from '../autonomyStore';

const settingsResponse = (value: unknown) => ({
  success: true,
  category: 'agent_toolkit',
  settings: [
    { key: 'crew_enabled', value: true },
    { key: 'yolo_mode', value },
  ],
});

beforeEach(() => {
  mocks.get.mockReset();
  mocks.update.mockReset();
  resetYoloModeForTest();
});

describe('autonomyStore', () => {
  it('starts unloaded and turns ready after the first read', async () => {
    mocks.get.mockResolvedValue(settingsResponse(true));
    expect(getYoloModeSnapshot()).toEqual({ enabled: false, ready: false, saving: false });
    await loadYoloModeOnce();
    expect(getYoloModeSnapshot()).toEqual({ enabled: true, ready: true, saving: false });
    expect(mocks.get).toHaveBeenCalledWith('agent_toolkit');
  });

  it('reads once for concurrent subscribers (AC-C9)', async () => {
    mocks.get.mockResolvedValue(settingsResponse(false));
    await Promise.all([loadYoloModeOnce(), loadYoloModeOnce(), loadYoloModeOnce()]);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('falls back to off when the read fails (失败即旧行为)', async () => {
    mocks.get.mockRejectedValue(new Error('backend down'));
    await loadYoloModeOnce();
    expect(getYoloModeSnapshot()).toEqual({ enabled: false, ready: true, saving: false });
  });

  it('treats a non-boolean stored value as off', async () => {
    mocks.get.mockResolvedValue(settingsResponse('yes'));
    await loadYoloModeOnce();
    expect(getYoloModeSnapshot().enabled).toBe(false);
  });

  it('notifies every subscriber when a write succeeds and broadcasts', async () => {
    mocks.update.mockResolvedValue({ success: true, settings: [] });
    const first = vi.fn();
    const second = vi.fn();
    const events: string[] = [];
    const listener = (event: Event) => events.push(event.type);
    subscribeYoloMode(first);
    subscribeYoloMode(second);
    window.addEventListener(YOLO_MODE_UPDATED_EVENT, listener);
    await setYoloMode(true);
    window.removeEventListener(YOLO_MODE_UPDATED_EVENT, listener);
    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
    expect(events).toContain(YOLO_MODE_UPDATED_EVENT);
    expect(getYoloModeSnapshot().enabled).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith('agent_toolkit', { yolo_mode: true });
  });

  it('rolls back and rethrows when the write fails (AC-C2)', async () => {
    mocks.get.mockResolvedValue(settingsResponse(false));
    await loadYoloModeOnce();
    mocks.update.mockRejectedValue(new Error('422'));
    await expect(setYoloMode(true)).rejects.toThrow();
    expect(getYoloModeSnapshot()).toEqual({ enabled: false, ready: true, saving: false });
  });

  it('sends a JSON boolean, never 1/0 (StrictBool)', async () => {
    mocks.update.mockResolvedValue({ success: true, settings: [] });
    await setYoloMode(true);
    const [, payload] = mocks.update.mock.calls[0];
    expect(payload).toEqual({ yolo_mode: true });
    expect(typeof payload.yolo_mode).toBe('boolean');
  });
});
