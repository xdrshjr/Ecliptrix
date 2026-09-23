/**
 * Regression tests of the R1 leftovers closed in R2 (spec R2 §3.13, T-L1..L5).
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTranslations } from '@/lib/i18n';
import type { MaterialItem, VideoEditingTaskContent } from '@/types';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import { useTimelineStore } from '../../timeline/store';
import { normaliseProjectDataForSave } from '@/lib/api/videoProjects';
import { isContentAlreadySaved } from '../../projects/hooks/useProjectAutosave';
import { useInspectorSelection } from '../inspector/inspectorSelection';

vi.mock('@/contexts/NotificationContext', () => ({
  useNotification: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ locale: 'zh-CN', t: getTranslations('zh-CN') }),
}));

import { resetSegmentAuditionForTests, useSegmentAudition } from '../../hooks/useSegmentAudition';

afterEach(() => {
  resetSegmentAuditionForTests();
  vi.unstubAllGlobals();
  useEditorFocusStore.getState().reset();
});

describe('R1 leftovers', () => {
  it('T-L1: stopping an audition releases the audio source', () => {
    const audio = {
      src: '', onended: null, onerror: null,
      play: vi.fn(() => Promise.resolve()), pause: vi.fn(),
      getAttribute: vi.fn(() => '/voice.mp3'), removeAttribute: vi.fn(), load: vi.fn(),
    };
    vi.stubGlobal('Audio', vi.fn(function FakeAudio() { return audio; }));
    const { result } = renderHook(() => useSegmentAudition());
    act(() => result.current.play('s1', { id: 'v', url: '/voice.mp3', type: 'audio' } as MaterialItem));
    act(() => result.current.stop());
    expect({ removed: audio.removeAttribute.mock.calls, loaded: audio.load.mock.calls.length })
      .toEqual({ removed: [['src']], loaded: 1 });
  });

  it('T-L3: content back at the saved version counts as saved', () => {
    const content: VideoEditingTaskContent = { markdownContent: 'a', lastModified: new Date(0) };
    const saved = JSON.stringify(normaliseProjectDataForSave(content));
    expect([
      isContentAlreadySaved(content, saved),
      isContentAlreadySaved({ ...content, markdownContent: 'b' }, saved),
      isContentAlreadySaved(content, ''),
    ]).toEqual([true, false, false]);
  });

  it('T-L4: clicking the same material again brings it back after a clip click', () => {
    const materials = [{ id: 'm1' } as MaterialItem];
    const { result } = renderHook(() => useInspectorSelection(materials));
    act(() => useEditorFocusStore.getState().selectMaterial('m1'));
    act(() => useTimelineStore.setState({ selectedItems: ['clip-1'] }));
    const afterClip = result.current.kind;
    act(() => useEditorFocusStore.getState().selectMaterial('m1'));
    expect({ afterClip, afterReclick: result.current.kind }).toEqual({ afterClip: 'items', afterReclick: 'material' });
    act(() => useTimelineStore.setState({ selectedItems: [] }));
  });
});
