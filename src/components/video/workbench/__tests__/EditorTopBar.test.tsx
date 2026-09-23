import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- Vite raw source for the JSX-preserve test loader.
import topBarSource from '../EditorTopBar.tsx?raw';
// @ts-expect-error -- Vite raw source for the JSX-preserve test loader.
import nameSource from '../ProjectNameEditor.tsx?raw';
// @ts-expect-error -- Vite raw source for the JSX-preserve test loader.
import saveSource from '../SaveStatusIndicator.tsx?raw';
import {
  compileComponent, compileComponentModule, localeContextModule, reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import { useTimelineStore } from '@/components/video/timeline/store';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import type { EditorProjectChrome, EditorTopBarProps } from '../EditorTopBar';

let EditorTopBar: React.FC<EditorTopBarProps>;

beforeAll(() => {
  const icon = (name: string) => {
    const Icon = () => React.createElement('svg', { 'data-icon': name });
    Icon.displayName = name;
    return Icon;
  };
  const icons = Object.fromEntries([
    'AlertTriangle', 'CheckCircle2', 'Circle', 'Loader2', 'ChevronLeft', 'Download',
    'Redo2', 'RotateCcw', 'Sparkles', 'Undo2',
  ].map((name) => [name, icon(name)]));
  const base = { ...reactModules(), ...localeContextModule(() => 'zh-CN'), './icons': icons };
  EditorTopBar = compileComponent<EditorTopBarProps>(topBarSource, {
    ...base,
    '../timeline/store': { useTimelineStore },
    '@/stores/editorFocusStore': { useEditorFocusStore },
    './ProjectNameEditor': compileComponentModule(nameSource, base),
    './SaveStatusIndicator': compileComponentModule(saveSource, base),
    './TaskCenterButton': { __esModule: true, default: () => React.createElement('span', null, 'tasks') },
  });
});

function chrome(patch: Partial<EditorProjectChrome> = {}): EditorProjectChrome {
  return {
    projectName: '约克夏', updatedAt: null, saveStatus: 'saved', lastSavedAt: null,
    hasRecoveryBackup: false, onBack: vi.fn(), onRenameProject: vi.fn(async () => {}),
    onRenameFailed: vi.fn(), onRetrySave: vi.fn(), onRequestRestoreBackup: vi.fn(),
    onRequestDiscardBackup: vi.fn(), ...patch,
  };
}

function renderBar(project = chrome(), patch: Partial<EditorTopBarProps> = {}) {
  render(React.createElement(EditorTopBar, {
    project, isAssistantOpen: false, isAgentBusy: false, onToggleAssistant: vi.fn(),
    exportState: { canExport: true, isExporting: false, progress: 0 }, onExport: vi.fn(), ...patch,
  }));
  return project;
}

beforeEach(() => {
  useTimelineStore.setState({ canUndo: true, canRedo: false, externalEditLock: null, isInteracting: false });
});

afterEach(() => cleanup());

describe('EditorTopBar', () => {
  it('shows_saving_saved_error_states_with_text', () => {
    renderBar(chrome({ saveStatus: 'saving' }));
    expect(screen.getByText('保存中…')).toBeTruthy();
    cleanup();
    renderBar(chrome({ saveStatus: 'saved' }));
    expect(screen.getByText('已保存')).toBeTruthy();
    cleanup();
    renderBar(chrome({ saveStatus: 'error' }));
    expect(screen.getByText('保存失败')).toBeTruthy();
  });

  it('error_state_click_retries_save', () => {
    const project = renderBar(chrome({ saveStatus: 'error' }));
    fireEvent.click(screen.getByText('保存失败'));
    expect(project.onRetrySave).toHaveBeenCalledTimes(1);
  });

  it('export_disabled_with_reason_when_timeline_empty', () => {
    renderBar(chrome(), {
      exportState: { canExport: false, isExporting: false, progress: 0, disabledReason: '时间轴为空，先添加素材' },
    });
    const button = screen.getByText('导出视频').closest('button')!;
    expect([button.disabled, button.getAttribute('title')]).toEqual([true, '时间轴为空，先添加素材']);
  });

  it('undo_disabled_while_agent_lock', () => {
    useTimelineStore.setState({ externalEditLock: 'agent' });
    renderBar();
    const undo = screen.getByText('撤销').closest('button')!;
    expect([undo.disabled, undo.getAttribute('title')]).toEqual([true, 'AI 助手执行中，暂不能撤销']);
  });

  it('rename_empty_name_reverts_without_request', () => {
    const project = renderBar();
    fireEvent.click(screen.getByText('约克夏'));
    const input = screen.getByLabelText('项目名称') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(project.onRenameProject).not.toHaveBeenCalled();
    expect(screen.getByText('约克夏')).toBeTruthy();
  });

  it('rename_failure_reverts_and_reports', async () => {
    const failure = new Error('500');
    const project = renderBar(chrome({ onRenameProject: vi.fn(async () => { throw failure; }) }));
    fireEvent.click(screen.getByText('约克夏'));
    const input = screen.getByLabelText('项目名称') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '新名字' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(project.onRenameFailed).toHaveBeenCalledWith(failure);
    expect(screen.getByText('约克夏')).toBeTruthy();
  });
});
