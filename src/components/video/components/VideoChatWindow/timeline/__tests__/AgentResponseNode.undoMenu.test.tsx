/**
 * AG3-06 / AG2-20 / AG2-05: the single-step undo menu lists only steps that
 * changed the timeline, numbers same-name steps, follows the ARIA menu
 * keyboard pattern, and is hidden for turns without live undo records.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import responseNodeSource from '../AgentResponseNode.tsx?raw';
import {
  compileComponent,
  localeContextModule,
  reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import { getTranslations } from '@/lib/i18n';
import type { AgentToolCallRecord } from '@/types';
import * as animations from '../animations';
import * as utils from '../utils';
import type { AgentResponseNodeData } from '../types';
import { framerMotionModule } from './test-utils/motionStub';

interface ResponseNodeProps {
  node: AgentResponseNodeData;
  onUndoAll?: (messageId: string) => void;
  onUndoSingle?: (messageId: string, toolCallId: string) => void;
  canUndoSteps?: boolean;
}

const en = getTranslations('en');
let AgentResponseNode: React.FC<ResponseNodeProps>;

beforeAll(() => {
  AgentResponseNode = compileComponent<ResponseNodeProps>(String(responseNodeSource), {
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
});

afterEach(() => {
  cleanup();
});

function nodeWith(toolCalls: AgentToolCallRecord[]): AgentResponseNodeData {
  return {
    kind: 'response',
    id: 'msg-1-response',
    timestamp: new Date(0),
    content: 'Done.',
    toolCalls,
    isUndone: false,
    messageId: 'msg-1',
    canUndo: true,
  };
}

function step(id: string, name: string, changedTimeline?: boolean): AgentToolCallRecord {
  return { id, name, params: { clipId: `clip-${id}` }, status: 'completed', changedTimeline };
}

function stepLabel(index: number, tool: keyof typeof en.agentTimeline.toolNames): string {
  return en.agentTimeline.undoStepItem
    .replace('{index}', String(index))
    .replace('{tool}', en.agentTimeline.toolNames[tool]);
}

function openMenu(): HTMLElement {
  const trigger = screen.getByRole('button', { name: en.agentTimeline.undoStep });
  fireEvent.click(trigger);
  return trigger;
}

describe('AgentResponseNode — undo step menu', () => {
  it('the undo menu lists only steps that changed the timeline', () => {
    render(React.createElement(AgentResponseNode, {
      node: nodeWith([
        step('tc-1', 'delete_clip', true),
        step('tc-2', 'auto_fix_overlaps'),
        step('tc-3', 'move_clip', true),
      ]),
    }));

    openMenu();

    expect(screen.getAllByRole('menuitem').map(item => item.textContent))
      .toEqual([stepLabel(1, 'delete_clip'), stepLabel(3, 'move_clip')]);
  });

  it('same-name steps are numbered', () => {
    render(React.createElement(AgentResponseNode, {
      node: nodeWith([
        step('tc-1', 'add_to_track', true),
        step('tc-2', 'add_to_track', true),
        step('tc-3', 'add_to_track', true),
      ]),
    }));

    openMenu();

    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      stepLabel(1, 'add_to_track'),
      stepLabel(2, 'add_to_track'),
      stepLabel(3, 'add_to_track'),
    ]);
  });

  it('the undo step menu is a keyboard-operable ARIA menu', () => {
    const onUndoSingle = vi.fn();
    render(React.createElement(AgentResponseNode, {
      onUndoSingle,
      node: nodeWith([
        step('tc-1', 'add_to_track', true),
        step('tc-2', 'move_clip', true),
        step('tc-3', 'delete_clip', true),
      ]),
    }));

    const trigger = openMenu();
    const menu = screen.getByRole('menu');
    const items = screen.getAllByRole('menuitem');
    const focusedIndex = () => items.indexOf(document.activeElement as HTMLElement);
    const opened = {
      haspopup: trigger.getAttribute('aria-haspopup'),
      expanded: trigger.getAttribute('aria-expanded'),
      controls: trigger.getAttribute('aria-controls') === menu.id,
      focus: focusedIndex(),
      tabIndexes: items.map(item => item.getAttribute('tabindex')),
    };
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    const afterDown = focusedIndex();
    fireEvent.keyDown(menu, { key: 'End' });
    const afterEnd = focusedIndex();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    const afterWrap = focusedIndex();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    const afterUpWrap = focusedIndex();
    fireEvent.keyDown(menu, { key: 'Home' });
    const afterHome = focusedIndex();
    fireEvent.keyDown(menu, { key: 'Escape' });

    expect({
      opened,
      afterDown,
      afterEnd,
      afterWrap,
      afterUpWrap,
      afterHome,
      closed: screen.queryByRole('menu'),
      focusReturned: document.activeElement === trigger,
      undoCalls: onUndoSingle.mock.calls.length,
    }).toEqual({
      opened: { haspopup: 'menu', expanded: 'true', controls: true, focus: 0, tabIndexes: ['-1', '-1', '-1'] },
      afterDown: 1,
      afterEnd: 2,
      afterWrap: 0,
      afterUpWrap: 2,
      afterHome: 0,
      closed: null,
      focusReturned: true,
      undoCalls: 0,
    });
  });

  it('choosing a step undoes it and returns focus to the menu button', () => {
    const onUndoSingle = vi.fn();
    render(React.createElement(AgentResponseNode, {
      onUndoSingle,
      node: nodeWith([step('tc-1', 'add_to_track', true), step('tc-2', 'move_clip', true)]),
    }));

    const trigger = openMenu();
    fireEvent.click(screen.getAllByRole('menuitem')[1]);

    expect({ calls: onUndoSingle.mock.calls, focus: document.activeElement === trigger })
      .toEqual({ calls: [['msg-1', 'tc-2']], focus: true });
  });

  it('undoing a step that leaves one moves focus to undo all', () => {
    function Harness(): React.ReactElement {
      const [toolCalls, setToolCalls] = React.useState(() => [
        step('tc-1', 'add_to_track', true),
        step('tc-2', 'move_clip', true),
      ]);
      const onUndoSingle = (_messageId: string, toolCallId: string): void => {
        setToolCalls(calls =>
          calls.map(tc => (tc.id === toolCallId ? { ...tc, status: 'undone' as const } : tc)),
        );
      };
      return React.createElement(AgentResponseNode, { node: nodeWith(toolCalls), onUndoSingle });
    }
    render(React.createElement(Harness));

    openMenu();
    fireEvent.click(screen.getAllByRole('menuitem')[0]);

    expect({
      menuButton: screen.queryByRole('button', { name: en.agentTimeline.undoStep }),
      focused: document.activeElement?.textContent,
    }).toEqual({ menuButton: null, focused: en.agentTimeline.undoAll });
  });

  it('turns without live undo records hide undo single', () => {
    render(React.createElement(AgentResponseNode, {
      canUndoSteps: false,
      node: nodeWith([step('tc-1', 'add_to_track', true), step('tc-2', 'move_clip', true)]),
    }));

    expect({
      undoAll: screen.queryByRole('button', { name: en.agentTimeline.undoAll }) !== null,
      undoStep: screen.queryByRole('button', { name: en.agentTimeline.undoStep }),
    }).toEqual({ undoAll: true, undoStep: null });
  });
});
