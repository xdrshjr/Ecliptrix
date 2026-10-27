import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import responseNodeSource from '../AgentResponseNode.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import chatPanelSource from '../TimelineChatPanel.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import chatWindowSource from '../../VideoChatWindow.tsx?raw';
import {
  compileComponent,
  localeContextModule,
  reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import { getTranslations } from '@/lib/i18n';
import * as animations from '../animations';
import * as utils from '../utils';
import type { AgentResponseNodeData } from '../types';
import { framerMotionModule } from './test-utils/motionStub';

/**
 * AG2-10 / RV-05. tsconfig keeps JSX as `preserve`, so the component is
 * compiled from its raw source with the TypeScript API and rendered with
 * framer-motion and markdown stubbed out and the real English translations.
 */

interface ResponseNodeProps {
  node: AgentResponseNodeData;
  onUndoAll?: (messageId: string) => void;
  onUndoSingle?: (messageId: string, toolCallId: string) => void;
  undoDisabled?: boolean;
}

const en = getTranslations('en');

function loadResponseNode(): React.FC<ResponseNodeProps> {
  return compileComponent<ResponseNodeProps>(String(responseNodeSource), {
    ...reactModules(),
    ...framerMotionModule(),
    ...localeContextModule(),
    '@/components/chat/MarkdownRenderer': {
      __esModule: true,
      default: ({ content }: { content: string }) => React.createElement('div', null, content),
    },
    './utils': utils,
    './animations': animations,
    './TimelineNodeIcon': { __esModule: true, default: () => null },
    '../TurnSummaryCard': { __esModule: true, default: () => null },
  });
}

let AgentResponseNode: React.FC<ResponseNodeProps>;

beforeAll(() => {
  AgentResponseNode = loadResponseNode();
});

afterEach(() => {
  cleanup();
});

function responseNode(): AgentResponseNodeData {
  return {
    kind: 'response',
    id: 'msg-1-response',
    timestamp: new Date(0),
    content: 'Moved two clips.',
    toolCalls: [
      { id: 'tc-1', name: 'move_clip', params: {}, status: 'completed', changedTimeline: true },
      { id: 'tc-2', name: 'add_to_track', params: {}, status: 'completed', changedTimeline: true },
    ],
    isUndone: false,
    messageId: 'msg-1',
    canUndo: true,
  };
}

describe('AgentResponseNode undo while the agent runs', () => {
  it('undo buttons are disabled while the agent executes', () => {
    const onUndoAll = vi.fn();
    render(React.createElement(AgentResponseNode, { node: responseNode(), onUndoAll, undoDisabled: true }));

    const undoAll = screen.getByRole('button', { name: en.agentTimeline.undoAll });
    fireEvent.click(undoAll);

    expect({
      undoAllDisabled: (undoAll as HTMLButtonElement).disabled,
      undoSingleDisabled: (screen.getByRole('button', { name: en.agentTimeline.undoStep }) as HTMLButtonElement).disabled,
      title: undoAll.getAttribute('title'),
      undoCalls: onUndoAll.mock.calls.length,
    }).toEqual({
      undoAllDisabled: true,
      undoSingleDisabled: true,
      title: en.agentUndo.blockedWhileRunning,
      undoCalls: 0,
    });
  });

  it('undo buttons work once the agent has finished', () => {
    const onUndoAll = vi.fn();
    render(React.createElement(AgentResponseNode, { node: responseNode(), onUndoAll }));

    fireEvent.click(screen.getByRole('button', { name: en.agentTimeline.undoAll }));

    expect(onUndoAll).toHaveBeenCalledWith('msg-1');
  });

  it('the stop button is disabled while finishing', () => {
    const panel = String(chatPanelSource);
    const chatWindow = String(chatWindowSource);
    expect({
      liveIndicatorStop: panel.includes('disabled={isFinishing}'),
      executionNodeStopHidden: panel.includes('onCancel={isFinishing ? undefined : onCancel}'),
      responseUndo: panel.includes('undoDisabled={undoDisabled}'),
      windowStop: chatWindow.includes('disabled={isFinishing}'),
    }).toEqual({
      liveIndicatorStop: true,
      executionNodeStopHidden: true,
      responseUndo: true,
      windowStop: true,
    });
  });
});
