import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- Vite raw source for the existing JSX-preserve test loader.
import source from '../TimelineChatPanel.tsx?raw';
import {
  compileComponent, localeContextModule, reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import * as errorRecovery from '@/lib/video-editing-agent/errorRecovery';
import * as utils from '../utils';
import * as animations from '../animations';
import { framerMotionModule } from './test-utils/motionStub';
import type { TimelineChatPanelProps } from '../types';
import type { ChatMessage } from '@/types';

let Panel: React.FC<TimelineChatPanelProps>;
const stub = { __esModule: true, default: () => null };
const firstMessage: ChatMessage = {
  id: 'one', role: 'user', content: 'hello', timestamp: new Date(0),
  isStreaming: true,
};
const props: TimelineChatPanelProps = {
  messages: [firstMessage], executionState: null,
  onUndoAll: vi.fn(), onUndoSingle: vi.fn(), onCancel: vi.fn(),
};

beforeAll(() => {
  Panel = compileComponent<TimelineChatPanelProps>(source, {
    ...reactModules(), ...localeContextModule(), ...framerMotionModule(),
    '@/lib/video-editing-agent/errorRecovery': errorRecovery,
    './utils': utils, './animations': animations,
    './TimelineAnimationStyles': stub,
    './TimelineConnector': { __esModule: true,
      default: ({ state }: { state: string }) =>
        React.createElement('div', { 'data-testid': 'connector',
          'data-state': state }),
    },
    './UserMessageNode': stub,
    './AgentThinkingNode': { __esModule: true,
      default: ({ node }: { node: { content: string } }) =>
        React.createElement('div', null, node.content),
    },
    './AgentExecutionNode': stub,
    './AgentResponseNode': { __esModule: true,
      default: () => React.createElement('div', { 'data-testid': 'response' }),
    },
    './ErrorStateCard': stub,
  });
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

function setupScroll() {
  const view = render(React.createElement(Panel, props));
  const container = view.container.querySelector('.agent-chat-messages')!;
  let scrollHeight = 1000;
  let clientHeight = 400;
  Object.defineProperties(container, {
    scrollHeight: { configurable: true, get: () => scrollHeight },
    clientHeight: { configurable: true, get: () => clientHeight },
  });
  return {
    ...view, container,
    resize: (scroll: number, client: number) => {
      scrollHeight = scroll;
      clientHeight = client;
    },
  };
}

describe('最小化期间的阅读位置', () => {
  it('阅读历史后隐藏不执行定时滚动，零尺寸 scroll 不覆盖快照', () => {
    const { container, rerender, resize } = setupScroll();
    container.scrollTop = 120;
    fireEvent.scroll(container);
    rerender(React.createElement(Panel, { ...props, isVisible: false }));
    expect(vi.getTimerCount()).toBe(0);
    resize(0, 0);
    container.scrollTop = 0;
    fireEvent.scroll(container);
    const messages = [...props.messages, { ...firstMessage, id: 'two' }];
    rerender(React.createElement(Panel,
      { ...props, messages, isVisible: false }));
    act(() => vi.advanceTimersByTime(1000));
    expect(container.scrollTop).toBe(0);
    resize(1800, 400);
    rerender(React.createElement(Panel,
      { ...props, messages, isVisible: true }));
    expect(container.scrollTop).toBe(120);
    fireEvent.scroll(container);
    act(() => vi.advanceTimersByTime(300));
    expect(container.scrollTop).toBe(120);
  });

  it('最小化前位于底部，隐藏期间收到新消息后重开跟随底部', () => {
    const { container, rerender, resize } = setupScroll();
    act(() => vi.advanceTimersByTime(100));
    expect(container.scrollTop).toBe(600);
    rerender(React.createElement(Panel, { ...props, isVisible: false }));
    container.scrollTop = 0;
    fireEvent.scroll(container);
    resize(1800, 400);
    rerender(React.createElement(Panel, { ...props, isVisible: true }));
    expect(container.scrollTop).toBe(1400);
  });

  it('恢复时夹到可滚范围内但不改变历史阅读意图', () => {
    const { container, rerender, resize } = setupScroll();
    container.scrollTop = 300;
    fireEvent.scroll(container);
    rerender(React.createElement(Panel, { ...props, isVisible: false }));
    resize(500, 400);
    rerender(React.createElement(Panel, { ...props, isVisible: true }));
    expect(container.scrollTop).toBe(100);
    fireEvent.scroll(container);
    resize(1800, 400);
    act(() => vi.advanceTimersByTime(300));
    expect(container.scrollTop).toBe(100);
  });

  it('可见列表正常跟随流式消息增长，卸载清理延迟与 interval', () => {
    const { container, resize, unmount } = setupScroll();
    act(() => vi.advanceTimersByTime(150));
    expect(container.scrollTop).toBe(600);
    resize(1300, 400);
    act(() => vi.advanceTimersByTime(150));
    expect(container.scrollTop).toBe(900);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('仅历史思考内容保留且连接线静止，没有空响应卡片', () => {
    render(React.createElement(Panel, { ...props, messages: [
      { ...firstMessage, isStreaming: false },
      { id: 'thinking', role: 'assistant', content: '',
        timestamp: new Date(1), isAgentMessage: true,
        thinkingContent: '保留思考内容', isThinking: false, isStreaming: false },
    ] }));
    expect(screen.getByText('保留思考内容')).toBeInTheDocument();
    expect(screen.getByTestId('connector')).toHaveAttribute('data-state', 'default');
    expect(screen.queryByTestId('response')).toBeNull();
  });
});
