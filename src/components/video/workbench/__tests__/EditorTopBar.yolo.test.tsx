import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
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

/**
 * 顶栏 YOLO 徽标（docs/plans/agent-yolo-autonomous-mode spec.md §4.9.1 /
 * AC-C3）：只在 `isYoloArmed` 时出现，复用 `.ws-chip--warn`，且不改变左侧内容。
 */

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
    '../components/AgentChatDock/AgentChatDock': { AGENT_PANEL_ID: 'ws-assistant-panel' },
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

function renderBar(patch: Partial<EditorTopBarProps> = {}) {
  render(React.createElement(EditorTopBar, {
    project: chrome(), isAssistantOpen: false, isAgentBusy: false,
    onToggleAssistant: vi.fn(),
    exportState: { canExport: true, isExporting: false, progress: 0 },
    onExport: vi.fn(), ...patch,
  }));
}

beforeEach(() => {
  useTimelineStore.setState({
    canUndo: true, canRedo: false, externalEditLock: null, isInteracting: false,
  });
});

afterEach(() => cleanup());

describe('EditorTopBar YOLO 徽标', () => {
  it('renders no badge by default', () => {
    renderBar();
    expect(screen.queryByTestId('topbar-yolo-chip')).toBeNull();
  });

  it('renders the read-only badge with the existing warn chip classes', () => {
    renderBar({ isYoloArmed: true });
    const badge = screen.getByTestId('topbar-yolo-chip');
    expect(badge.textContent).toBe('YOLO');
    expect(badge.className).toContain('ws-chip');
    expect(badge.className).toContain('ws-chip--warn');
    // 只读徽标没有可见文字解释，读屏只能靠 aria-label（AC-C3）。
    expect(badge.getAttribute('role')).toBe('status');
    expect(badge.getAttribute('aria-label')).toBeTruthy();
    expect(badge.getAttribute('title')).toBeTruthy();
    expect(badge.tagName).toBe('SPAN');
  });

  it('keeps the left-hand project chrome unchanged', () => {
    renderBar();
    const before = screen.getByText('约克夏').textContent;
    cleanup();
    renderBar({ isYoloArmed: true });
    expect(screen.getByText('约克夏').textContent).toBe(before);
  });
});
