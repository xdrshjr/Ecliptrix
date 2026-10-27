import * as React from 'react';
import { createPortal } from 'react-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- Vite raw source for the existing JSX-preserve test loader.
import dockSource from '../AgentChatDock.tsx?raw';
// @ts-expect-error -- Vite raw source.
import panelSource from '../AgentChatFloatingPanel.tsx?raw';
// @ts-expect-error -- Vite raw source.
import fabSource from '../AgentChatFloatingButton.tsx?raw';
// @ts-expect-error -- Vite raw source.
import chatSource from '../../VideoChatWindow/VideoChatWindow.tsx?raw';
// @ts-expect-error -- Vite raw source.
import timelineSource from '../../VideoChatWindow/timeline/TimelineChatPanel.tsx?raw';
import {
  compileComponent, compileComponentModule, localeContextModule, reactModules,
  type ModuleMap,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import * as errorRecovery from '@/lib/video-editing-agent/errorRecovery';
import * as timelineUtils from '../../VideoChatWindow/timeline/utils';
import * as planScan from '@/lib/video-editing-agent/planScan';
import * as askScan from '@/lib/video-editing-agent/askScan';
import * as agentToolkitTypes from '@/types/agentToolkit';
import * as agentToolkitApi from '@/lib/api/agentToolkit';
import * as agentToolkitStatus from '@/lib/agentToolkitStatus';
import * as askUserCard from '../../VideoChatWindow/AskUserCard';
import * as composerPicker from '../../VideoChatWindow/ComposerPicker';
import * as useComposerModule from '../../VideoChatWindow/useComposer';
import * as animations from '../../VideoChatWindow/timeline/animations';
import * as draggable from '../useDraggableFab';
import type { VideoChatWindowProps } from '../../VideoChatWindow';
import type { TimelineChatPanelProps } from '../../VideoChatWindow/timeline/types';

interface DockProps {
  isOpen: boolean;
  onOpen: () => void;
  onMinimize: () => void;
  agentIsExecuting: boolean;
  chatProps: VideoChatWindowProps;
  contextLabel: string | null;
}

let Dock: React.FC<DockProps>;
let reducedMotion = false;
let forcedAnchor: draggable.FabPosition | null = null;
let forcedDragging = false;
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
    '@/lib/video-editing-agent/planScan': planScan,
    '@/lib/video-editing-agent/askScan': askScan,
    '@/types/agentToolkit': agentToolkitTypes,
    '@/lib/api/agentToolkit': agentToolkitApi,
    '@/lib/agentToolkitStatus': agentToolkitStatus,
    './AskUserCard': askUserCard,
    './ComposerPicker': composerPicker,
    './useComposer': useComposerModule,
    './SteerQueue': { __esModule: true, default: () => null },
    './ComposerSkillPicker': { __esModule: true, default: () => null },
    './ComposerMentionPicker': { __esModule: true, default: () => null },
    '@/contexts/NotificationContext': {
      useNotification: () => ({ showConfirm: vi.fn() }),
    },
  });
  const Panel = compileComponent(panelSource, { ...shared, './useDraggableFab': draggable });
  const Fab = compileComponentModule(fabSource, shared);
  const presence = await import('../useDockPresence');
  Dock = compileComponent<DockProps>(dockSource, {
    ...shared, '../VideoChatWindow': { VideoChatWindow: Chat },
    './AgentChatFloatingPanel': { __esModule: true, default: Panel },
    './AgentChatFloatingButton': Fab,
    './useDraggableFab': { useDraggableFab: (ref?: React.RefObject<HTMLElement | null>) => {
      const actual = draggable.useDraggableFab(ref);
      return { ...actual, position: forcedAnchor ?? actual.position,
        isDragging: forcedDragging || actual.isDragging };
    } },
    './useDockPresence': presence,
  });
});

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion = false;
  forcedAnchor = null;
  forcedDragging = false;
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({
    matches: reducedMotion,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function Harness({ conversationId = 'one', hasMessages = false,
  contextLabel = null, agentIsExecuting = false }: { conversationId?: string;
  hasMessages?: boolean; contextLabel?: string | null; agentIsExecuting?: boolean }) {
  const [isOpen, setOpen] = React.useState(false);
  return React.createElement(React.Fragment, null,
    React.createElement('button', { onClick: () => setOpen(false) }, 'editor'),
    React.createElement(Dock, {
      isOpen, onOpen: () => setOpen(true),
      onMinimize: () => setOpen(false), agentIsExecuting, contextLabel,
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
  const fab = screen.getByRole('button', { name: 'AI editing assistant' });
  act(() => fab.focus());
  fireEvent.click(fab);
  act(() => vi.advanceTimersByTime(260));
  return fab;
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

  it('Escape 只处理面板内部且非 IME 的事件', () => {
    render(React.createElement(Harness));
    openDock();
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'AI editing assistant' }))
      .toHaveFocus();
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

  it('首次键盘打开聚焦输入，最小化后恢复旧输入焦点', () => {
    render(React.createElement(Harness));
    const fab = openDock();
    const input = screen.getByRole('textbox');
    expect(input).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize assistant' }));
    expect(fab).toHaveFocus();
    expect(fab).toHaveAttribute('aria-expanded', 'false');
    act(() => vi.advanceTimersByTime(260));
    openDock();
    expect(input).toHaveFocus();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'false');
    expect(fab.getAttribute('aria-controls')).toBe(screen.getByRole('dialog').id);
  });

  it('shows_context_label: segment label or whole-project fallback', () => {
    const { rerender } = render(React.createElement(Harness));
    openDock();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('AI Editing Assistant');
    expect(dialog).toHaveTextContent('Assisting: the whole project');
    rerender(React.createElement(Harness,
      { contextLabel: '正在协助：第 2 段 · 活泼天性' }));
    expect(dialog).toHaveTextContent('正在协助：第 2 段 · 活泼天性');
    expect(dialog).not.toHaveTextContent('Assisting: the whole project');
  });

  it('panel_id_is_stable_for_top_bar_aria_controls', () => {
    render(React.createElement(Harness));
    openDock();
    expect(screen.getByRole('dialog').id).toBe('ws-assistant-panel');
  });

  it('busy_fab_shows_pulse_and_busy_label', () => {
    render(React.createElement(Harness, { agentIsExecuting: true }));
    const fab = screen.getByRole('button', { name: 'Agent running…' });
    expect(fab.className).toContain('is-busy');
  });

  it('打开动画期间转移至编辑器的焦点不会被收尾抢回', () => {
    render(React.createElement(Harness));
    fireEvent.click(screen.getByRole('button', { name: 'AI editing assistant' }));
    const editor = screen.getByRole('button', { name: 'editor' });
    act(() => editor.focus());
    act(() => vi.advanceTimersByTime(260));
    expect(editor).toHaveFocus();
    fireEvent.click(editor);
    act(() => vi.advanceTimersByTime(260));
    expect(editor).toHaveFocus();
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
    const fab = openDock();
    const input = screen.getByRole('textbox');
    fireEvent.click(fab);
    act(() => vi.advanceTimersByTime(50));
    fireEvent.click(fab);
    act(() => vi.advanceTimersByTime(260));
    expect(screen.getByRole('textbox')).toBe(input);
    expect(screen.getByRole('dialog')).not.toHaveAttribute('inert');
    expect(fab).toHaveAttribute('aria-expanded', 'true');
  });

  it('减少动画路径直接隐藏但保留草稿', () => {
    reducedMotion = true;
    render(React.createElement(Harness));
    const fab = openDock();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '保留' } });
    fireEvent.click(fab);
    expect(input.closest('[role="dialog"]')).toHaveStyle({ display: 'none' });
    fireEvent.click(fab);
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
    const fab = openDock();
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
    fireEvent.click(screen.getByRole('button', { name: 'Minimize assistant' }));
    act(() => vi.advanceTimersByTime(260));
    expect(list.scrollHeight).toBe(0);
    list.scrollTop = 0;
    fireEvent.scroll(list);
    contentHeight = 1800;
    fireEvent.click(fab);
    act(() => vi.advanceTimersByTime(260));
    expect(list.scrollTop).toBe(follow ? 1400 : 120);
  });
});

function installGeometry() {
  const size = { width: 800, height: 600, panelWidth: 360, panelHeight: 480 };
  const resizeCallbacks: Array<() => void> = [];
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get')
    .mockImplementation(function (this: HTMLElement) { return this.parentElement; });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
    .mockImplementation(() => size.width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    .mockImplementation(() => size.height);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
    .mockImplementation(() => size.panelWidth);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    .mockImplementation(() => size.panelHeight);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resizeCallbacks.push(callback); }
    observe() {}
    disconnect() {}
  });
  return { size, resize: () => resizeCallbacks.forEach((callback) => callback()) };
}

describe('浮窗布局与 FAB 可达性', () => {
  it.each([
    ['左上', 736, 536, true], ['右上', 8, 536, true],
    ['左下', 736, 8, false], ['右下', 8, 8, false],
    ['上边', 372, 536, true], ['左边', 736, 272, true],
    ['右边', 8, 272, true], ['下边', 372, 8, false],
  ])('%s 位置按工作区夹定，抓取区遮挡时提升 FAB',
  (_label, right, bottom, occluded) => {
    installGeometry();
    forcedAnchor = { right: Number(right), bottom: Number(bottom) };
    render(React.createElement(Harness));
    const fab = openDock();
    const panel = screen.getByRole('dialog');
    expect(Number.parseFloat(panel.style.right)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(panel.style.right)).toBeLessThanOrEqual(432);
    expect(Number.parseFloat(panel.style.bottom)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(panel.style.bottom)).toBeLessThanOrEqual(112);
    expect(fab.style.zIndex).toBe(occluded ? '861' : '');
  });

  it('展开动画期间工作区 resize 立即归位并采用低高度布局', () => {
    const geometry = installGeometry();
    render(React.createElement(Harness));
    fireEvent.click(screen.getByRole('button', { name: 'AI editing assistant' }));
    act(() => vi.advanceTimersByTime(40));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-phase', 'opening');
    geometry.size.width = 720;
    geometry.size.height = 400;
    geometry.size.panelHeight = 320;
    act(() => geometry.resize());
    expect(screen.getByRole('dialog')).toHaveAttribute('data-phase', 'open');
    expect(screen.getByRole('dialog')).toHaveAttribute('data-compact', 'true');
    expect(screen.getByRole('dialog')).toHaveStyle({ transition: 'none' });
  });

  it('收起中 FAB 拖动结束当前动画，隐藏状态清除遮挡提升', () => {
    installGeometry();
    forcedAnchor = { right: 736, bottom: 536 };
    const { rerender, container } = render(React.createElement(Harness));
    const fab = openDock();
    expect(fab.style.zIndex).toBe('861');
    fireEvent.click(fab);
    forcedAnchor = { right: 8, bottom: 8 };
    rerender(React.createElement(Harness));
    const panel = container.querySelector('[role="dialog"]');
    expect(panel).toHaveAttribute('data-phase', 'hidden');
    const editor = screen.getByRole('button', { name: 'editor' });
    act(() => editor.focus());
    expect(fab.style.zIndex).toBe('');
  });

  it('FAB 键盘聚焦与拖拽独立提升层级，结束后恢复', () => {
    const { rerender } = render(React.createElement(Harness));
    const fab = screen.getByRole('button', { name: 'AI editing assistant' });
    act(() => fab.focus());
    expect(fab.style.zIndex).toBe('861');
    act(() => screen.getByRole('button', { name: 'editor' }).focus());
    expect(fab.style.zIndex).toBe('');
    forcedDragging = true;
    rerender(React.createElement(Harness));
    expect(fab.style.zIndex).toBe('861');
    forcedDragging = false;
    rerender(React.createElement(Harness));
    expect(fab.style.zIndex).toBe('');
  });

  it('真实拖拽阈值吞掉鼠标合成 click，随后键盘激活仍有效', () => {
    render(React.createElement(Harness));
    const fab = screen.getByRole('button', { name: 'AI editing assistant' });
    const pointer = (type: string, x: number) => {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { pointerId: 1, clientX: x, clientY: 100 });
      fireEvent(fab, event);
    };
    pointer('pointerdown', 100);
    pointer('pointermove', 120);
    pointer('pointerup', 120);
    fireEvent.click(fab, { detail: 1 });
    expect(fab).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(fab, { detail: 0 });
    act(() => vi.advanceTimersByTime(260));
    expect(fab).toHaveAttribute('aria-expanded', 'true');
  });
});
