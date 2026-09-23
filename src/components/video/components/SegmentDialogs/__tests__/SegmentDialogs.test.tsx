import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compileComponent, compileComponentModule, localeContextModule, reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import { getTranslations } from '@/lib/i18n';
import * as focusTrap from '@/components/ui/focusTrap';
import * as formatImpact from '../../../lib/segments/formatSegmentImpact';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import shellSource from '../SegmentDialogShell.tsx?raw';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import durationSource from '../VoiceDurationDialog.tsx?raw';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import deleteSource from '../SegmentDeleteDialog.tsx?raw';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import batchSource from '../BatchFillScopeDialog.tsx?raw';
import type { VoiceDurationDialogProps } from '../VoiceDurationDialog';
import type { SegmentDeleteDialogProps } from '../SegmentDeleteDialog';
import type { BatchFillScopeDialogProps } from '../BatchFillScopeDialog';

const copy = getTranslations('zh-CN').workbench.segmentCommands;
const base = { ...reactModules(), ...localeContextModule(() => 'zh-CN'), '@/components/ui/focusTrap': focusTrap };
const withShell = { ...base, './SegmentDialogShell': compileComponentModule(shellSource, base) };
const DurationDialog = compileComponent<VoiceDurationDialogProps>(durationSource, {
  ...withShell, '../../lib/segments/formatSegmentImpact': formatImpact,
});
const DeleteDialog = compileComponent<SegmentDeleteDialogProps>(deleteSource, withShell);
const BatchDialog = compileComponent<BatchFillScopeDialogProps>(batchSource, withShell);

afterEach(cleanup);

describe('VoiceDurationDialog (T-UI-DURATION)', () => {
  function open(patch: Partial<VoiceDurationDialogProps> = {}) {
    const props: VoiceDurationDialogProps = {
      delta: 2, lines: ['第 3 段「亲密陪伴」及之后内容将后移 2.0 秒', '工程总时长 25.6s → 27.6s'],
      canKeep: false, isStaleVersion: false, onChoose: vi.fn(), onClose: vi.fn(), ...patch,
    };
    render(React.createElement(DurationDialog, props));
    return props;
  }

  it('shows the title, the impact lines and three options, "adjust" preselected', () => {
    open();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect({
      title: screen.getByRole('heading').textContent,
      lines: screen.getAllByRole('listitem').map((li) => li.textContent),
      checked: radios.map((radio) => radio.checked),
    }).toEqual({
      title: '新配音比原来长 2.0 秒',
      lines: ['第 3 段「亲密陪伴」及之后内容将后移 2.0 秒', '工程总时长 25.6s → 27.6s'],
      checked: [true, false, false],
    });
  });

  it('Esc closes without applying anything', () => {
    const props = open();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect({ closed: (props.onClose as ReturnType<typeof vi.fn>).mock.calls.length, chosen: (props.onChoose as ReturnType<typeof vi.fn>).mock.calls })
      .toEqual({ closed: 1, chosen: [] });
  });

  it('a shorter voice can keep the original length', () => {
    const props = open({ delta: -1.2, canKeep: true });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: copy.confirm }));
    expect((props.onChoose as ReturnType<typeof vi.fn>).mock.calls).toEqual([['keep']]);
  });

  it('restoring an older version says it is based on older text', () => {
    open({ isStaleVersion: true });
    expect(screen.getByText(copy.staleVersionNote)).toBeTruthy();
  });
});

describe('SegmentDeleteDialog (T-UI-DELETE)', () => {
  function open(patch: Partial<SegmentDeleteDialogProps> = {}) {
    const props: SegmentDeleteDialogProps = {
      ordinal: 2, title: '活泼天性',
      removedItems: [{ trackName: '主画面', count: 2 }, { trackName: '旁白', count: 1 }],
      removalLines: ['时间轴上会留下 8.0 秒空隙，可用「整理素材」收紧'],
      isEditLocked: false, onConfirm: vi.fn(), onClose: vi.fn(), ...patch,
    };
    render(React.createElement(DeleteDialog, props));
    return props;
  }

  it('lists the clips per lane, ticked by default', () => {
    const props = open();
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: copy.deleteConfirm }));
    expect({
      label: box.parentElement?.textContent,
      checked: box.checked,
      confirmed: (props.onConfirm as ReturnType<typeof vi.fn>).mock.calls,
    }).toEqual({
      label: '同时移除时间轴上的关联片段：主画面 2 个、旁白 1 个',
      checked: true,
      confirmed: [[true]],
    });
  });

  it('a segment without clips shows no checkbox', () => {
    open({ removedItems: [], removalLines: [] });
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('under the agent lock only the narration can be deleted', () => {
    const props = open({ isEditLocked: true });
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: copy.deleteConfirm }));
    expect({ disabled: box.disabled, checked: box.checked, confirmed: (props.onConfirm as ReturnType<typeof vi.fn>).mock.calls })
      .toEqual({ disabled: true, checked: false, confirmed: [[false]] });
  });
});

describe('BatchFillScopeDialog', () => {
  it('lists what will be generated, skipped and left to the user', () => {
    render(React.createElement(BatchDialog, {
      scope: { voiceTargetIds: ['a', 'b'], upToDateIds: ['c'], missingVisualIds: ['b'] },
      ordinalOf: (id: string) => ({ a: 1, b: 2, c: 3 } as Record<string, number>)[id],
      onStart: vi.fn(), onClose: vi.fn(),
    }));
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '将生成 2 段配音（第 1、2 段：没有配音或文案已修改）。',
      '第 3 段已有最新配音，跳过。',
      copy.batchFillNote,
      '第 2 段还没有画面，可用「为本段找画面」。',
    ]);
  });
});
