import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import responseNodeSource from '../AgentResponseNode.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import chatPanelSource from '../TimelineChatPanel.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import chatWindowSource from '../../VideoChatWindow.tsx?raw';
import * as trackPatch from '@/lib/video-editing-agent/trackPatch';
import * as animations from '../animations';
import * as utils from '../utils';
import type { AgentResponseNodeData } from '../types';

/**
 * AG2-10 / RV-05. tsconfig keeps JSX as `preserve`, so the component is
 * compiled from its raw source with the TypeScript API and rendered with
 * framer-motion, markdown and the locale context stubbed out.
 */

interface ResponseNodeProps {
  node: AgentResponseNodeData;
  onUndoAll?: (messageId: string) => void;
  onUndoSingle?: (messageId: string, toolCallId: string) => void;
  undoDisabled?: boolean;
}

const MOTION_ONLY_PROPS = ['variants', 'initial', 'animate', 'exit', 'layout', 'transition'];
const motionComponents = new Map<string, React.ElementType>();

function motionComponent(tag: string): React.ElementType {
  const cached = motionComponents.get(tag);
  if (cached) return cached;
  const component = React.forwardRef<Element, Record<string, unknown>>(function MotionStub(props, ref) {
    const domProps: Record<string, unknown> = { ...props, ref };
    for (const key of MOTION_ONLY_PROPS) delete domProps[key];
    return React.createElement(tag, domProps);
  });
  component.displayName = `motion.${tag}`;
  motionComponents.set(tag, component);
  return component;
}

function loadResponseNode(): React.FC<ResponseNodeProps> {
  const { outputText } = ts.transpileModule(String(responseNodeSource), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const modules: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'framer-motion': {
      motion: new Proxy({}, { get: (_target, tag: string) => motionComponent(tag) }),
      AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
        React.createElement(React.Fragment, null, children),
    },
    '@/components/chat/MarkdownRenderer': {
      __esModule: true,
      default: ({ content }: { content: string }) => React.createElement('div', null, content),
    },
    '@/contexts/LocaleContext': {
      useLocale: () => ({ t: { agentUndo: { blockedWhileRunning: 'The agent is still working' } } }),
    },
    '@/lib/video-editing-agent/trackPatch': trackPatch,
    './utils': utils,
    './animations': animations,
    './TimelineNodeIcon': { __esModule: true, default: () => null },
  };
  const compiled = { exports: {} as { default?: React.FC<ResponseNodeProps> } };
  const requireModule = (id: string) => {
    if (id in modules) return modules[id];
    throw new Error(`unmapped import ${id}`);
  };
  new Function('require', 'module', 'exports', outputText)(requireModule, compiled, compiled.exports);
  return compiled.exports.default!;
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
      { id: 'tc-1', name: 'move_clip', params: {}, status: 'completed' },
      { id: 'tc-2', name: 'add_to_track', params: {}, status: 'completed' },
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

    const undoAll = screen.getByRole('button', { name: 'Undo All' });
    fireEvent.click(undoAll);

    expect({
      undoAllDisabled: (undoAll as HTMLButtonElement).disabled,
      undoSingleDisabled: (screen.getByRole('button', { name: 'Undo Single' }) as HTMLButtonElement).disabled,
      title: undoAll.getAttribute('title'),
      undoCalls: onUndoAll.mock.calls.length,
    }).toEqual({
      undoAllDisabled: true,
      undoSingleDisabled: true,
      title: 'The agent is still working',
      undoCalls: 0,
    });
  });

  it('undo buttons work once the agent has finished', () => {
    const onUndoAll = vi.fn();
    render(React.createElement(AgentResponseNode, { node: responseNode(), onUndoAll }));

    fireEvent.click(screen.getByRole('button', { name: 'Undo All' }));

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
