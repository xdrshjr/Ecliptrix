import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- Vite raw source for the JSX-preserve test loader.
import buttonSource from '../TaskCenterButton.tsx?raw';
import {
  compileComponent, localeContextModule, reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import { useVideoEditingStore } from '@/stores/videoEditingStore';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import type { AsyncTask } from '@/stores/slices/asyncTaskSlice';
import * as collect from '../collectActiveTasks';
import * as segmentContext from '../../lib/segments/SegmentLinksContext';
import type { SegmentLinksValue } from '../../lib/segments/SegmentLinksContext';
import type { TaskCenterButtonProps } from '../TaskCenterButton';

let TaskCenterButton: React.FC<TaskCenterButtonProps>;

beforeAll(() => {
  const icon = (name: string) => {
    const Icon = () => React.createElement('svg', { 'data-icon': name });
    Icon.displayName = `Icon(${name})`;
    return Icon;
  };
  TaskCenterButton = compileComponent<TaskCenterButtonProps>(buttonSource, {
    ...reactModules(),
    ...localeContextModule(() => 'zh-CN'),
    './icons': { Loader2: icon('spinner') },
    '@/stores/videoEditingStore': { useVideoEditingStore },
    '@/stores/editorFocusStore': { useEditorFocusStore },
    '../lib/segments/SegmentLinksContext': segmentContext,
    './collectActiveTasks': collect,
  });
});

function agentTask(taskId: string, patch: Partial<AsyncTask>): AsyncTask {
  return {
    taskId, type: 'ai_video', status: 'pending', progress: 0,
    result: null, error: null, createdAt: 1, metadata: {}, ...patch,
  };
}

const IDLE_EXPORT = { isExporting: false, progress: 0 };

function renderButton(exportTask = IDLE_EXPORT, links?: Partial<SegmentLinksValue>) {
  const base = React.createElement(TaskCenterButton, { exportTask });
  if (!links) return render(base);
  const value: SegmentLinksValue = {
    segmentIndex: new Map(), itemSegmentMap: new Map(),
    materialSegmentMap: new Map(), segmentRanges: new Map(),
    statusById: new Map(), latestVoiceById: new Map(),
    highlightedItemIds: new Set(), isPlaceholderScript: false, ...links,
  };
  return render(React.createElement(
    segmentContext.SegmentLinksContext.Provider, { value }, base));
}

beforeEach(() => {
  useVideoEditingStore.setState({ tasks: {} });
  useEditorFocusStore.getState().reset();
});

afterEach(() => { cleanup(); });

describe('TaskCenterButton', () => {
  it('counts_only_pending_and_processing_tasks', () => {
    useVideoEditingStore.setState({ tasks: {
      a: agentTask('a', { status: 'processing', progress: 30 }),
      b: agentTask('b', { status: 'pending' }),
      c: agentTask('c', { status: 'completed', progress: 100 }),
    } });
    renderButton();
    expect(screen.getByRole('button', { expanded: false }))
      .toHaveTextContent('任务 2');
  });

  it('counts_converting_segments_from_script_panel', () => {
    act(() => {
      useEditorFocusStore.getState().setConvertingSegmentIds(new Set(['seg-2']));
    });
    renderButton(IDLE_EXPORT, { segmentIndex: new Map([['seg-2', {
      segmentId: 'seg-2', ordinal: 2, title: '活泼天性',
      badge: '02', label: '02 活泼天性',
    }]]) });
    const button = screen.getByRole('button', { expanded: false });
    expect(button).toHaveTextContent('任务 1');
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toHaveTextContent('第 2 段配音');
    expect(screen.getByRole('dialog')).toHaveTextContent('生成中');
  });

  it('counts_export_in_progress', () => {
    renderButton({ isExporting: true, progress: 42 });
    const button = screen.getByRole('button', { expanded: false });
    expect(button).toHaveTextContent('任务 1');
    expect(button.querySelector('[data-icon="spinner"]')).not.toBeNull();
  });

  it('shows_plain_label_without_number_when_idle', () => {
    renderButton();
    const button = screen.getByRole('button', { expanded: false });
    expect(button).toHaveTextContent(/^任务$/);
    expect(button.querySelector('[data-icon="list"]')).not.toBeNull();
  });

  it('popover_lists_failure_reason_and_display_only_note', () => {
    useVideoEditingStore.setState({ tasks: {
      f: agentTask('f', { status: 'failed', error: '额度不足\nstack…' }),
    } });
    renderButton();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('额度不足');
    expect(dialog).not.toHaveTextContent('stack');
    expect(dialog).toHaveTextContent('如需取消，请在任务发起处操作。');
    expect(dialog.querySelector('button')).toBeNull();
  });

  it('escape_and_outside_pointer_close_the_popover', () => {
    renderButton();
    const button = screen.getByRole('button', { expanded: false });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-controls', screen.getByRole('dialog').id);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
