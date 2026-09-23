import * as React from 'react';
import { createPortal } from 'react-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- Vite raw source for the existing JSX-preserve test loader.
import dockSource from '../AgentChatDock.tsx?raw';
// @ts-expect-error -- Vite raw source.
import drawerSource from '../AgentChatDrawer.tsx?raw';
// @ts-expect-error -- Vite raw source.
import chatSource from '../../VideoChatWindow/VideoChatWindow.tsx?raw';
// @ts-expect-error -- Vite raw source.
import timelineSource from '../../VideoChatWindow/timeline/TimelineChatPanel.tsx?raw';
import {
  compileComponent, localeContextModule, reactModules,
  type ModuleMap,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import * as errorRecovery from '@/lib/video-editing-agent/errorRecovery';
import * as timelineUtils from '../../VideoChatWindow/timeline/utils';
import * as animations from '../../VideoChatWindow/timeline/animations';
import type { VideoChatWindowProps } from '../../VideoChatWindow';
import type { TimelineChatPanelProps } from '../../VideoChatWindow/timeline/types';

interface DockProps {
  isOpen: boolean;
  onMinimize: () => void;
  chatProps: VideoChatWindowProps;
  contextLabel: string | null;
}

let Dock: React.FC<DockProps>;
let reducedMotion = false;
const onSendMessage = vi.fn().mockResolvedValue(undefined);
const onCancel = vi.fn();
const chatProps: VideoChatWindowProps = {
  conversation: { id: 'one', messages: [] } as never,
  onSendMessage, onClearMessages: vi.fn(), isLoading: false,
  agentMode: true, onAgentModeChange: vi.fn(), agentIsExecuting: false,
  onCancel,
};

function compileTimelinePanel(shared: ModuleMap) {
  const stub = { __esModule: true, default: () => null };
  return compileComponent<TimelineChatPanelProps>(timelineSource, {
    ...shared,
    '@/lib/video-editing-agent/errorRecovery': errorRecovery,
    './utils': timelineUtils, './animations': animations,
    './TimelineAnimationStyles': stub, './TimelineConnector': stub,
    './UserMessageNode': stub, './AgentThinkingNode': stub,
    './AgentExecutionNode': stub, './AgentResponseNode': stub,
    './ErrorStateCard': stub,
  });
}

beforeAll(async () => {
  const shared = { ...reactModules(), ...localeContextModule(),
    'framer-motion': {
      MotionConfig: ({ children }: { children: React.ReactNode }) => children,
      AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    },
  };
  const Timeline = compileTimelinePanel(shared);
  const Chat = compileComponent<VideoChatWindowProps>(chatSource, {
    ...shared,
    './timeline': { TimelineChatPanel: (props: TimelineChatPanelProps) =>
      React.createElement(
      React.Fragment, null,
      React.createElement(Timeline, props),
      React.createElement('button', {
        onKeyDown: (event: React.KeyboardEvent) => event.preventDefault(),
      }, 'child-menu'),
      createPortal(React.createElement('button', null, 'portal'), document.body),
    ) },
    './AgentBusyBar': { __esModule: true, default: () => null },
    '@/contexts/NotificationContext': {
      useNotification: () => ({ showConfirm: vi.fn() }),
    },
  });
  const Drawer = compileComponent(drawerSource,
    { ...shared, '../../workbench/icons': { Sparkles: () => null } });
  const presence = await import('../useDockPresence');
  Dock = compileComponent<DockProps>(dockSource, {
    ...shared, '../VideoChatWindow': { VideoChatWindow: Chat },
    './AgentChatDrawer': { __esModule: true, default: Drawer },
    './useDockPresence': presence,
  });
});

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion = false;
  vi.stubGlobal('matchMedia', () => ({
    matches: reducedMotion,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

// The toggle stands in for the top-bar「AI 助手」button (owned by the lead).
function Harness({ conversationId = 'one', hasMessages = false,
  contextLabel = null }: { conversationId?: string; hasMessages?: boolean;
  contextLabel?: string | null }) {
  const [isOpen, setOpen] = React.useState(false);
  return React.createElement(React.Fragment, null,
    React.createElement('button', {
      onClick: () => setOpen((open) => !open), 'aria-pressed': isOpen,
    }, 'toggle-assistant'),
    React.createElement('button', { onClick: () => setOpen(false) }, 'editor'),
    React.createElement(Dock, {
      isOpen, contextLabel,
      onMinimize: () => setOpen(false),
      chatProps: {
        ...chatProps,
        conversation: { ...chatProps.conversation, id: conversationId,
          messages: hasMessages ? [{ id: 'one', role: 'user',
            content: '历史消息', timestamp: new Date(0) }] : [] } as never,
      },
    }),
  );
}

function openDock() {
  const toggle = screen.getByRole('button', { name: 'toggle-assistant' });
  act(() => toggle.focus());
  fireEvent.click(toggle);
  act(() => vi.advanceTimersByTime(260));
  return toggle;
}

describe('助手最小化生命周期', () => {
  it('收起保留聊天 DOM 和未发送草稿，隐藏内容 inert', () => {
    render(React.createElement(Harness));
    openDock();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '未发送草稿' } });
    fireEvent.click(screen.getByRole('button', { name: 'editor' }));
    act(() => vi.advanceTimersByTime(260));
    expect(input.isConnected).toBe(true);
    const panel = input.closest('[role="dialog"]');
    expect(panel).toHaveAttribute('inert');
    expect(panel).toHaveAttribute('aria-hidden', 'true');
    openDock();
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input).toHaveValue('未发送草稿');
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('escape_closes_and_restores_focus: only inside, non-IME Escape closes', () => {
    render(React.createElement(Harness));
    const toggle = openDock();
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(toggle).toHaveFocus();
  });

  it('输入法 Enter 不发送，普通 Enter 沿用发送行为', () => {
    render(React.createElement(Harness));
    openDock();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '拼音输入' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(input).toHaveValue('拼音输入');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSendMessage).toHaveBeenCalledWith('拼音输入');
  });

  it('打开时聚焦输入框，关闭按钮把焦点还给打开前的元素', () => {
    render(React.createElement(Harness));
    const toggle = openDock();
    const input = screen.getByRole('textbox');
    expect(input).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    act(() => vi.advanceTimersByTime(260));
    openDock();
    expect(input).toHaveFocus();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'false');
  });

  it('打开时焦点在编辑器也会被记住，关闭后还给编辑器', () => {
    render(React.createElement(Harness));
    const editor = screen.getByRole('button', { name: 'editor' });
    act(() => editor.focus());
    fireEvent.click(screen.getByRole('button', { name: 'toggle-assistant' }));
    act(() => vi.advanceTimersByTime(260));
    expect(screen.getByRole('textbox')).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(editor).toHaveFocus();
  });

  it('打开动画期间转移至编辑器的焦点不会被收尾抢回', () => {
    render(React.createElement(Harness));
    fireEvent.click(screen.getByRole('button', { name: 'toggle-assistant' }));
    const editor = screen.getByRole('button', { name: 'editor' });
    act(() => editor.focus());
    act(() => vi.advanceTimersByTime(260));
    expect(editor).toHaveFocus();
    fireEvent.click(editor);
    act(() => vi.advanceTimersByTime(260));
    expect(editor).toHaveFocus();
  });

  it('shows_context_label: segment label or whole-project fallback', () => {
    const { rerender } = render(React.createElement(Harness));
    openDock();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('AI assistant');
    expect(dialog).toHaveTextContent('Assisting: the whole project');
    rerender(React.createElement(Harness,
      { contextLabel: '正在协助：第 2 段 · 活泼天性' }));
    expect(dialog).toHaveTextContent('正在协助：第 2 段 · 活泼天性');
    expect(dialog).not.toHaveTextContent('Assisting: the whole project');
  });

  it('子菜单已处理的 Escape 与 React portal 事件不会最小化', () => {
    render(React.createElement(Harness, { hasMessages: true }));
    openDock();
    fireEvent.keyDown(screen.getByText('child-menu'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByText('portal'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('只有实际切换会话才重新挂载草稿', () => {
    const { rerender } = render(React.createElement(Harness));
    openDock();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '旧会话草稿' } });
    rerender(React.createElement(Harness, { conversationId: 'two' }));
    expect(screen.getByRole('textbox')).not.toBe(input);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('连续快速开合保持同一个聊天实例并最终可交互', () => {
    render(React.createElement(Harness));
    const toggle = openDock();
    const input = screen.getByRole('textbox');
    fireEvent.click(toggle);
    act(() => vi.advanceTimersByTime(50));
    fireEvent.click(toggle);
    act(() => vi.advanceTimersByTime(260));
    expect(screen.getByRole('textbox')).toBe(input);
    expect(screen.getByRole('dialog')).not.toHaveAttribute('inert');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('减少动画路径直接隐藏但保留草稿', () => {
    reducedMotion = true;
    render(React.createElement(Harness));
    const toggle = openDock();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '保留' } });
    fireEvent.click(toggle);
    expect(input.closest('[role="dialog"]')).toHaveStyle({ display: 'none' });
    fireEvent.click(toggle);
    expect(input).toHaveValue('保留');
    expect(input).toHaveFocus();
  });

  it.each([
    [false, false], [false, true], [true, false], [true, true],
  ])('隐藏 DOM 重开后保留滚动意图（减少动画=%s，跟随底部=%s）',
  (reduce, follow) => {
    reducedMotion = reduce;
    const { container } = render(
      React.createElement(Harness, { hasMessages: true }),
    );
    const toggle = openDock();
    const panel = screen.getByRole('dialog');
    const list = container.querySelector<HTMLElement>('.agent-chat-messages')!;
    let contentHeight = 1000;
    // jsdom 不计算布局，尺寸必须与真实祖先 display:none 同步，
    // 避免在 isOpen 更新前人为恢复尺寸而漏掉父子 layout effect 时序。
    Object.defineProperties(list, {
      scrollHeight: { get: () =>
        panel.style.display === 'none' ? 0 : contentHeight },
      clientHeight: { get: () => panel.style.display === 'none' ? 0 : 400 },
    });
    list.scrollTop = follow ? 600 : 120;
    fireEvent.scroll(list);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    act(() => vi.advanceTimersByTime(260));
    expect(list.scrollHeight).toBe(0);
    list.scrollTop = 0;
    fireEvent.scroll(list);
    contentHeight = 1800;
    fireEvent.click(toggle);
    act(() => vi.advanceTimersByTime(260));
    expect(list.scrollTop).toBe(follow ? 1400 : 120);
  });
});
