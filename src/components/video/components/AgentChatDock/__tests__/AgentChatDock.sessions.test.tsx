import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import { NotificationProvider } from '@/contexts/NotificationContext';
import type { Conversation } from '@/types';
import AgentChatDock, { type AgentChatSessions } from '../AgentChatDock';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'] }),
}));
vi.mock('../../VideoChatWindow', () => ({
  VideoChatWindow: () => <textarea data-agent-input="" aria-label="消息" />,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const conversations: Conversation[] = ['A', 'B'].map(id => ({
  id, title: id, createdAt: new Date(0), updatedAt: new Date(0),
  messages: [{ id: `message-${id}`, role: 'user', content: '保留的内容',
    timestamp: new Date(0) }],
}));

function setup() {
  const remove = vi.fn(() => ({ ok: true }));
  const minimize = vi.fn();
  const sessions: AgentChatSessions = {
    conversations, activeConversationId: 'A',
    createConversation: vi.fn(() => ({ ok: true })),
    selectConversation: vi.fn(() => ({ ok: true })),
    renameConversation: vi.fn(() => ({ ok: true })),
    deleteConversation: remove,
  };
  const view = render(<NotificationProvider>
    <AgentChatDock isOpen onOpen={vi.fn()} onMinimize={minimize}
      agentIsExecuting={false} contextLabel={null} sessions={sessions}
      chatProps={{ conversation: conversations[0], onSendMessage: vi.fn(),
        onClearMessages: vi.fn(), isLoading: false, agentMode: true,
        onAgentModeChange: vi.fn(), agentIsExecuting: false }} />
  </NotificationProvider>);
  fireEvent.click(screen.getByRole('button', { name: '当前会话操作' }));
  const deletion = screen.getByRole('menuitem', { name: '删除会话' });
  act(() => deletion.focus());
  fireEvent.click(deletion);
  return { ...view, remove, minimize };
}

describe('会话删除确认', () => {
  it('有内容的会话用模态确认，初始焦点在取消，Escape 只取消确认', () => {
    const { remove, minimize } = setup();
    const dialog = screen.getByRole('dialog', { name: '删除会话' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const cancel = within(dialog).getByRole('button', { name: '取消' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Escape' });
    expect(remove).not.toHaveBeenCalled();
    expect(minimize).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(250));
    expect(screen.queryByRole('dialog', { name: '删除会话' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'A' })).toHaveFocus();
  });

  it('明确确认后只删除捕获的会话 ID', () => {
    const { remove } = setup();
    const dialog = screen.getByRole('dialog', { name: '删除会话' });
    fireEvent.click(within(dialog).getByRole('button', { name: '删除会话' }));
    expect(remove).toHaveBeenCalledExactlyOnceWith('A');
  });
});
