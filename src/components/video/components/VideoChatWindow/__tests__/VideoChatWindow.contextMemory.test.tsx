import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { Conversation } from '@/types';
import type { UseContextMemoryReturn } from '@/components/video/hooks/useContextMemory';
import VideoChatWindow, { type VideoChatWindowProps } from '../VideoChatWindow';

const notify = vi.hoisted(() => ({
  showSuccess: vi.fn(), showWarning: vi.fn(), showError: vi.fn(), showConfirm: vi.fn(),
}));
const api = vi.hoisted(() => ({ capabilities: vi.fn(), listSkills: vi.fn() }));

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));
vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => notify }));
vi.mock('@/lib/api/agentToolkit', () => ({
  AgentToolkitApiError: class extends Error {},
  fetchAgentToolkitCapabilities: api.capabilities,
  uploadDocument: vi.fn(),
}));
vi.mock('@/lib/api/agentSkills', () => ({ listSkills: api.listSkills }));
vi.mock('@/components/chat/MarkdownRenderer', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

const copy = translations.en.agentContext;
const at = new Date(0);
const conversation: Conversation = {
  id: 'c', title: 't', createdAt: at, updatedAt: at,
  messages: [
    { id: 'u1', role: 'user', content: 'make a city video', timestamp: at },
    { id: 'a1', role: 'assistant', content: 'on it', timestamp: at },
  ],
};

function memory(patch: Partial<UseContextMemoryReturn> = {}): UseContextMemoryReturn {
  return {
    reading: { usedTokens: 90_000, windowTokens: 128_000, maxOutputTokens: 4096, dropped: false },
    ratio: 0.74, percent: 74, level: 'notice', isCompacting: false, canCompact: true,
    compactingAfterMessageId: null,
    settings: { autoCompact: true, autoCompactRatio: 0.75 },
    setAutoCompact: vi.fn().mockResolvedValue(true),
    compactNow: vi.fn().mockResolvedValue('compacted'),
    undoCompaction: vi.fn().mockReturnValue(true),
    ...patch,
  };
}

function renderWindow(patch: Partial<VideoChatWindowProps> = {}) {
  const props: VideoChatWindowProps = {
    conversation, onSendMessage: vi.fn().mockResolvedValue(undefined), onClearMessages: vi.fn(),
    isLoading: false, agentMode: true, onAgentModeChange: vi.fn(), agentIsExecuting: false, ...patch,
  };
  return { props, ...render(<VideoChatWindow {...props} />) };
}
const ringButton = (percent: number) =>
  screen.queryByRole('button', { name: copy.ring.label.replace('{pct}', String(percent)) });

beforeEach(() => {
  Object.values(notify).forEach(fn => fn.mockReset());
  api.capabilities.mockReset().mockResolvedValue(null);
  api.listSkills.mockReset().mockResolvedValue([]);
  window.localStorage.clear();
});
afterEach(cleanup);

describe('VideoChatWindow — context ring and /compact', () => {
  it('shows the ring in agent mode when the memory hook is wired', () => {
    renderWindow({ contextMemory: memory() });

    expect(ringButton(74)).toBeTruthy();
  });

  it('shows no ring without the memory hook, or outside agent mode', () => {
    renderWindow();
    expect(ringButton(74)).toBeNull();
    cleanup();

    renderWindow({ contextMemory: memory(), agentMode: false });
    expect(ringButton(74)).toBeNull();
  });

  it('"/compact" + Enter runs the compaction once, clears the input and confirms', async () => {
    const contextMemory = memory();
    const { props } = renderWindow({ contextMemory });
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: '/compact', selectionStart: 8 } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(notify.showSuccess).toHaveBeenCalledWith(copy.done));
    expect(contextMemory.compactNow).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('');
    expect(props.onSendMessage).not.toHaveBeenCalled();
  });

  it('the command appears in the "/" menu under its own heading', async () => {
    renderWindow({ contextMemory: memory() });
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: '/', selectionStart: 1 } });

    expect(await screen.findByRole('option', { name: /Compact conversation/ })).toBeTruthy();
    expect(screen.getByText(copy.commandGroup)).toBeTruthy();
  });

  it('tells the user when there is nothing to compact, and when it failed', async () => {
    const tooShort = memory({ compactNow: vi.fn().mockResolvedValue('too_short') });
    renderWindow({ contextMemory: tooShort });
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '/compact', selectionStart: 8 } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(notify.showWarning).toHaveBeenCalledWith(copy.tooShort));
    cleanup();

    const failing = memory({ compactNow: vi.fn().mockResolvedValue('failed') });
    renderWindow({ contextMemory: failing });
    const second = screen.getByRole('textbox');
    fireEvent.change(second, { target: { value: '/compact', selectionStart: 8 } });
    fireEvent.keyDown(second, { key: 'Enter' });
    await waitFor(() => expect(notify.showError).toHaveBeenCalledWith(copy.failed));
  });

  it('the ring button runs the same compaction', async () => {
    const contextMemory = memory({ level: 'warn', percent: 85 });
    renderWindow({ contextMemory });

    fireEvent.click(ringButton(85)!);
    fireEvent.click(screen.getByRole('button', { name: copy.compactNow }));

    await waitFor(() => expect(contextMemory.compactNow).toHaveBeenCalledTimes(1));
  });

  it('shows the folded-conversation divider, with Undo wired to the memory hook', () => {
    const contextMemory = memory();
    renderWindow({
      contextMemory,
      conversation: {
        ...conversation,
        messages: [...conversation.messages, {
          id: 'c1', role: 'system', content: 'folded 2', timestamp: at,
          metadata: { type: 'compaction', compaction: {
            summaryText: 's', coveredThroughMessageId: 'a1', coveredCount: 2, tokensBefore: 100,
            tokensAfter: 40, auto: true, createdAt: at.toISOString() } },
        }],
      },
    });

    expect(screen.getByText('Folded 2 earlier messages, saving about 60% of context')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: copy.undo }));

    expect(contextMemory.undoCompaction).toHaveBeenCalledWith('c1');
  });
});
