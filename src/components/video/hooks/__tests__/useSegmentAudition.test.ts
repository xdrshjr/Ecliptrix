import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialItem } from '@/types';
import { getTranslations } from '@/lib/i18n';
import { useTimelineStore } from '../../timeline/store/useTimelineStore';

const showError = vi.fn();
vi.mock('@/contexts/NotificationContext', () => ({
  useNotification: () => ({ showError, showSuccess: vi.fn() }),
}));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ locale: 'zh-CN', setLocale: () => {}, t: getTranslations('zh-CN') }),
}));

import { resetSegmentAuditionForTests, useSegmentAudition } from '../useSegmentAudition';

interface FakeAudio {
  src: string;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}

const created: FakeAudio[] = [];

function voice(id: string): MaterialItem {
  return {
    id,
    name: `${id}.mp3`,
    type: 'audio',
    url: `/api/audio/generated/${id}.mp3`,
    serverUrl: `/api/audio/generated/${id}.mp3`,
    createdAt: new Date(0),
  } as unknown as MaterialItem;
}

beforeEach(() => {
  created.length = 0;
  showError.mockReset();
  vi.stubGlobal('Audio', vi.fn(function FakeAudioCtor(this: FakeAudio) {
    this.src = '';
    this.play = vi.fn(() => Promise.resolve());
    this.pause = vi.fn();
    this.onended = null;
    this.onerror = null;
    created.push(this);
  }));
  useTimelineStore.setState({ isPlaying: false });
});

afterEach(() => {
  resetSegmentAuditionForTests();
  vi.unstubAllGlobals();
});

describe('useSegmentAudition', () => {
  it('pauses_composition_before_audition', () => {
    const order: string[] = [];
    const onPauseComposition = vi.fn(() => {
      const alreadyPlaying = created.some((audio) => audio.play.mock.calls.length > 0);
      order.push(alreadyPlaying ? 'pause-after-play' : 'pause');
    });
    const { result } = renderHook(() => useSegmentAudition({ onPauseComposition }));
    act(() => result.current.play('seg-1', voice('v1')));
    order.push(created[0].play.mock.calls.length > 0 ? 'played' : 'not-played');
    expect(order).toEqual(['pause', 'played']);
    expect(result.current.auditioningSegmentId).toBe('seg-1');
  });

  it('stops_when_composition_starts_playing', () => {
    const { result } = renderHook(() => useSegmentAudition());
    act(() => result.current.play('seg-1', voice('v1')));
    act(() => {
      useTimelineStore.setState({ isPlaying: true });
    });
    expect(result.current.auditioningSegmentId).toBeNull();
    expect(created[0].pause).toHaveBeenCalled();
  });

  it('only_one_segment_auditions_at_a_time', () => {
    const { result } = renderHook(() => useSegmentAudition());
    act(() => result.current.play('seg-1', voice('v1')));
    act(() => result.current.play('seg-2', voice('v2')));
    expect(created).toHaveLength(1);
    expect(result.current.auditioningSegmentId).toBe('seg-2');
    expect(created[0].src).toContain('v2.mp3');
  });

  it('play_failure_reports_error_and_clears_state', async () => {
    const { result } = renderHook(() => useSegmentAudition());
    act(() => result.current.play('seg-1', voice('v1')));
    await act(async () => {
      created[0].onerror?.();
    });
    expect(showError).toHaveBeenCalledWith(getTranslations('zh-CN').workbench.segmentCard.auditionFailed);
    expect(result.current.auditioningSegmentId).toBeNull();
  });

  it('unmount_stops_audition', () => {
    const { result, unmount } = renderHook(() => useSegmentAudition());
    act(() => result.current.play('seg-1', voice('v1')));
    unmount();
    expect(created[0].pause).toHaveBeenCalled();
  });
});
