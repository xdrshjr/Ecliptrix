import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationViewCache } from '../conversationViewCache';

describe('会话视图缓存', () => {
  beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });
  it('迁移旧文本，立即保存完整草稿并隔离会话', () => {
    localStorage.setItem('ecliptrix.agentDraft.v1.p.a', '旧草稿');
    const cache = createConversationViewCache('p');
    expect(cache.getDraft('a').text).toBe('旧草稿');
    const draft = { version: 2 as const, text: '@素材',
      skill: { id: 'edit', name: '编辑' },
      mentions: [{ materialId: 'm', label: '素材' }] };
    cache.setDraft('a', draft);
    cache.flushDraft('a');
    expect(createConversationViewCache('p').getDraft('a')).toEqual(draft);
    expect(cache.getDraft('b').text).toBe('');
  });
  it('发送清除写空标记，删除后的旧 cleanup 不复活草稿', () => {
    vi.useFakeTimers();
    const cache = createConversationViewCache('p');
    cache.setDraft('a', { version: 2, text: '待发', skill: null,
      mentions: [] });
    cache.clearDraft('a');
    localStorage.setItem('ecliptrix.agentDraft.v1.p.a', '旧文本');
    expect(createConversationViewCache('p').getDraft('a').text).toBe('');
    cache.remove('a');
    cache.flushDraft('a');
    vi.runAllTimers();
    expect(localStorage.getItem('ecliptrix.agentDraft.v2.p.a')).toBeNull();
  });
  it('存储不可用时保留内存，回填 nonce 只消费一次', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const cache = createConversationViewCache('p');
    cache.applyRestore('a', { nonce: 1, text: '排队内容' });
    cache.applyRestore('a', { nonce: 1, text: '排队内容' });
    cache.flushDraft('a');
    expect(cache.getDraft('a').text).toBe('排队内容');
    cache.setScroll('a', { top: 42, follow: false });
    expect(cache.getScroll('a')).toEqual({ top: 42, follow: false });
    vi.restoreAllMocks();
  });
});
