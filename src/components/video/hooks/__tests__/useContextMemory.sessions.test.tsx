import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import { useContextMemory } from '../useContextMemory';
import type { ChatMessage } from '@/types';
const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }));
vi.mock('@/contexts/LocaleContext', () => ({ useLocale: () => ({
  t: translations.en, locale: 'en',
}) }));
vi.mock('@/lib/api/agentCompact', () => ({
  requestConversationCompaction: mocks.request,
}));
vi.mock('../useCompactionSettings', () => ({ useCompactionSettings: () => ({
  settings: { autoCompact: true, autoCompactRatio: 0.1 },
  refresh: mocks.refresh, setAutoCompact: vi.fn(),
}) }));
const messages: ChatMessage[] = Array.from({ length: 8 }, (_, index) => ({
  id: String(index), role: index % 2 ? 'assistant' : 'user',
  content: '正文'.repeat(30000), timestamp: new Date(),
}));
const success = { success: true, text: '摘要', tokensBefore: 1000,
  tokensAfter: 100 };
function options() {
  return { conversationId: 'a', messages, writeMessages: vi.fn(),
    liveUsage: null, agentIsExecuting: false,
    executionStatus: 'idle' as const, hasPendingSteers: false };
}
beforeEach(() => { mocks.request.mockReset(); mocks.refresh.mockReset(); });
describe('上下文压缩的会话归属', () => {
  it('同步外部锁拒绝压缩', async () => {
    const { result } = renderHook(() => useContextMemory({ ...options(),
      canStartCompaction: () => false }));
    await expect(result.current.compactNow()).resolves.toBe('busy');
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('卸载取消后即使服务返回成功也不写入', async () => {
    let resolve!: (value: unknown) => void;
    mocks.request.mockReturnValue(new Promise(done => { resolve = done; }));
    const params = options();
    const { result, unmount } = renderHook(() => useContextMemory(params));
    let pending!: ReturnType<typeof result.current.compactNow>;
    act(() => { pending = result.current.compactNow(); });
    expect(result.current.isCompactingNow?.()).toBe(true);
    unmount();
    await act(async () => { resolve(success); await pending; });
    expect(params.writeMessages).not.toHaveBeenCalled();
  });
  it('设置刷新期间 A→B→A 不再启动自动压缩', async () => {
    let resolve!: (value: unknown) => void;
    mocks.refresh.mockReturnValue(new Promise(done => { resolve = done; }));
    let epoch = 0;
    const params = { ...options(), getSelectionEpoch: () => epoch };
    const { rerender } = renderHook(props => useContextMemory(props), {
      initialProps: { ...params, agentIsExecuting: true,
        executionStatus: 'executing' as 'executing' | 'completed' },
    });
    rerender({ ...params, agentIsExecuting: false, executionStatus: 'completed' });
    epoch = 2;
    await act(async () => { resolve({ autoCompact: true, autoCompactRatio: 0.1 }); });
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
