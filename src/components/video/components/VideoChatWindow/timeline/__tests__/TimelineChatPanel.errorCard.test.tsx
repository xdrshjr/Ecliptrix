/**
 * AG3-04: the error card belongs to a run that already ended. Its action
 * clears the error; "Cancel" there used to re-seal the finished turn as
 * stopped by the user.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import chatPanelSource from '../TimelineChatPanel.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import errorCardSource from '../ErrorStateCard.tsx?raw';
import {
  compileComponent,
  localeContextModule,
  reactModules,
  type ModuleMap,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import { getTranslations } from '@/lib/i18n';
import * as errorRecovery from '@/lib/video-editing-agent/errorRecovery';
import { StreamErrorType, classifyError, type StreamError } from '@/lib/video-editing-agent/errorRecovery';
import {
  IDLE_TIMEOUT_ERROR_MESSAGE,
  MAX_DURATION_ERROR_MESSAGE,
} from '@/lib/video-editing-agent/SSEStreamManager';
import type { AgentExecutionState } from '@/components/video/hooks/useAgentExecutionState';
import type { ChatMessage } from '@/types';
import * as animations from '../animations';
import * as utils from '../utils';
import { framerMotionModule } from './test-utils/motionStub';

interface ChatPanelProps {
  messages: ChatMessage[];
  executionState: AgentExecutionState | null;
  onUndoAll: (messageId: string) => void;
  onUndoSingle: (messageId: string, toolCallId: string) => void;
  onCancel: () => void;
  onDismiss?: () => void;
}

const en = getTranslations('en');
const stub = { __esModule: true, default: () => null };
let TimelineChatPanel: React.FC<ChatPanelProps>;

beforeAll(() => {
  const shared: ModuleMap = { ...reactModules(), ...framerMotionModule(), ...localeContextModule() };
  const ErrorStateCard = compileComponent(String(errorCardSource), {
    ...shared,
    './animations': animations,
  });
  TimelineChatPanel = compileComponent<ChatPanelProps>(String(chatPanelSource), {
    ...shared,
    '@/lib/video-editing-agent/errorRecovery': errorRecovery,
    './utils': utils,
    './animations': animations,
    './TimelineAnimationStyles': stub,
    './TimelineConnector': stub,
    './UserMessageNode': stub,
    './AgentThinkingNode': stub,
    './AgentExecutionNode': stub,
    './AgentResponseNode': stub,
    '../CompactionDivider': stub,
    './ErrorStateCard': { __esModule: true, default: ErrorStateCard },
  });
});

afterEach(() => {
  cleanup();
});

const CONNECTION_LOST: StreamError = {
  type: StreamErrorType.NETWORK_DROP,
  message: 'socket closed',
  userMessage: 'Connection lost.',
  recoverable: false,
};

function endedWithError(error: StreamError = CONNECTION_LOST): AgentExecutionState {
  return {
    status: 'error',
    startTime: 0,
    elapsedTime: 10,
    retryCount: 2,
    completedTools: [],
    currentTool: null,
    pendingMessage: '',
    error,
    isThinking: false,
  };
}

function renderPanel(executionState: AgentExecutionState, handlers: Partial<ChatPanelProps> = {}) {
  return render(React.createElement(TimelineChatPanel, {
    messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: new Date(0) }],
    executionState,
    onUndoAll: vi.fn(),
    onUndoSingle: vi.fn(),
    onCancel: vi.fn(),
    ...handlers,
  }));
}

describe('TimelineChatPanel — terminal error card', () => {
  it('a terminal error card offers dismiss, not cancel', () => {
    const onCancel = vi.fn();
    const onDismiss = vi.fn();
    renderPanel(endedWithError(), { onCancel, onDismiss });

    fireEvent.click(screen.getByRole('button', { name: en.agentTimeline.dismiss }));

    expect({
      cancelButton: screen.queryByRole('button', { name: en.agentTimeline.stop }),
      dismissed: onDismiss.mock.calls.length,
      cancelled: onCancel.mock.calls.length,
      message: screen.getByRole('alert').textContent,
    }).toEqual({
      cancelButton: null,
      dismissed: 1,
      cancelled: 0,
      message: en.agentTimeline.errorPrefix.replace('{message}', en.agentStream.errors.connectionLost),
    });
  });

  it.each([
    [IDLE_TIMEOUT_ERROR_MESSAGE, 'idleTimeout'],
    [MAX_DURATION_ERROR_MESSAGE, 'totalTimeout'],
  ] as const)('a stream timeout "%s" reads as %s', (message, key) => {
    const error = classifyError({ error: new Error(message), disconnectReason: 'total_timeout' });

    renderPanel(endedWithError(error));

    expect(screen.getByRole('alert').textContent)
      .toBe(en.agentTimeline.errorPrefix.replace('{message}', en.agentStream.errors[key]));
  });

  it('a connection error card states the retries it used as text', () => {
    renderPanel(endedWithError());

    const retries = en.agentTimeline.retriesUsed.replace('{n}', '2').replace('{max}', '2');
    expect(screen.getByText(retries).textContent).toBe(retries);
  });
});

describe('TimelineChatPanel — live indicator', () => {
  it('the live indicator names its stop button like the execution card', () => {
    renderPanel({ ...endedWithError(), status: 'executing', error: null, retryCount: 0 });

    expect(screen.getByRole('button', { name: en.agentTimeline.stop }).tagName).toBe('BUTTON');
  });
});
