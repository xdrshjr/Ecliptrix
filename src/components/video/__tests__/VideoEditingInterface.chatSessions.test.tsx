import React, { useRef, useState } from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { VideoEditingTaskContent } from '@/types';
import { useVideoChatContentBridge } from '../hooks/useVideoChatContentBridge';
import { useVideoChatSessions } from '../hooks/useVideoChatSessions';
import { createConversation } from '../hooks/videoChatSessionModel';
import VideoChatWindow from '../components/VideoChatWindow/VideoChatWindow';
import { ASK_ANSWER_EVENT } from '../components/VideoChatWindow/AskUserCard';

vi.mock('@/contexts/LocaleContext', () => ({ useLocale: () => ({
  t: translations.en, locale: 'en',
}) }));
vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => ({
  showConfirm: vi.fn(), showError: vi.fn(),
}) }));
vi.mock('@/lib/api/agentToolkit', () => ({
  fetchAgentToolkitCapabilities: vi.fn(async () => ({ documents: {
    enabled: false, available: false, formats: [],
  }, limits: {} })), uploadDocument: vi.fn(), AgentToolkitApiError: Error,
}));

/** 与编辑器相同的桥、事务和同步守卫组合；没有真实 LLM 请求。 */
function useEditorConversations() {
  const [content, update] = useState<VideoEditingTaskContent>({
    markdownContent: '项目正文', lastModified: new Date(),
    conversations: [createConversation('a', 'A'), createConversation('b', 'B')],
    activeConversationId: 'a',
  });
  const busy = useRef<string | null>(null);
  const bridge = useVideoChatContentBridge({ projectKey: 'project', content,
    onUpdateContent: update });
  const sessions = useVideoChatSessions({ projectKey: 'project',
    contentBridge: bridge, isConversationReady: true,
    getBusyReason: () => busy.current, labels: { defaultTitle: '新会话 {n}' } });
  return { content, busy, bridge, sessions };
}
describe('编辑器会话接线', () => {
  it.each(['Agent 发送', '普通聊天', '上传', '压缩', 'finishing'])(
    '%s 在同帧同步锁定结构事务，释放后可切换', reason => {
      const { result } = renderHook(useEditorConversations);
      act(() => {
        result.current.busy.current = reason;
        expect(result.current.sessions.selectConversation('b').ok).toBe(false);
        expect(result.current.sessions.createConversation().ok).toBe(false);
        expect(result.current.sessions.deleteConversation('a').ok).toBe(false);
      });
      act(() => {
        result.current.busy.current = null;
        expect(result.current.sessions.selectConversation('b').ok).toBe(true);
      });
      expect(result.current.content.activeConversationId).toBe('b');
    });
  it('A 的迟到终态只写 A，清空后旧 writer 失效', () => {
    const { result } = renderHook(useEditorConversations);
    const scope = result.current.sessions.captureWriteScope('a')!;
    act(() => { result.current.sessions.selectConversation('b'); });
    const message = { id: 'late', role: 'assistant' as const,
      content: 'A 结果', timestamp: new Date() };
    act(() => { result.current.sessions.writeMessages(scope, [message]); });
    expect(result.current.bridge.getConversation('a')?.messages).toEqual([message]);
    expect(result.current.bridge.getConversation('b')?.messages).toEqual([]);
    act(() => { result.current.sessions.clearMessages('a'); });
    expect(result.current.sessions.writeMessages(scope, [message])).toBe(false);
    expect(result.current.content.markdownContent).toBe('项目正文');
  });
  it('另一个页签的 AskUser 事件不进入当前请求', async () => {
    const send = vi.fn(async () => ({ accepted: true }));
    await act(async () => {
      render(<VideoChatWindow conversation={createConversation('b', 'B')}
        onSendMessage={send} onClearMessages={() => {}}
        isLoading={false} agentMode agentIsExecuting={false}
        onAgentModeChange={() => {}} />);
    });
    act(() => window.dispatchEvent(new CustomEvent(ASK_ANSWER_EVENT, {
      detail: { questionId: 'question-from-a', answer: 'yes' },
    })));
    expect(send).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '正常输入' } });
    await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
    expect(send).toHaveBeenCalledWith('正常输入');
  });
});
