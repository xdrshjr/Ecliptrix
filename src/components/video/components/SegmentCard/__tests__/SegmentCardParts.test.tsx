import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTranslations } from '@/lib/i18n';
import type { MaterialItem, ScriptSegment } from '@/types';
import {
  compileComponent, compileComponentModule, localeContextModule, reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import iconsSource from '../icons.tsx?raw';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import carouselSource from '../SegmentVideoCarousel.tsx?raw';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import voiceBarSource from '../DefaultVoiceBar.tsx?raw';
import type { VideoCarouselHandlers } from '../SegmentVideoCarousel';

const zh = getTranslations('zh-CN');
const base = { ...reactModules(), ...localeContextModule(() => 'zh-CN') };

afterEach(() => cleanup());

interface CarouselProps {
  segment: ScriptSegment;
  currentIndex: number;
  loadStates: Record<string, 'loading' | 'loaded' | 'error'>;
  handlers: VideoCarouselHandlers;
  logger: { info(): void; error(): void; userAction(): void };
}

const SegmentVideoCarousel = compileComponent<CarouselProps>(carouselSource, {
  ...base,
  '../../utils/logger': {},
});

function carouselHandlers(): VideoCarouselHandlers {
  return {
    onPlayPause: vi.fn(),
    onLoadStart: vi.fn(),
    onCanPlay: vi.fn(),
    onError: vi.fn(),
    onPlayingChange: vi.fn(),
    onRetry: vi.fn(),
    onNavigate: vi.fn(),
    getMediaErrorType: () => 'unknown',
  };
}

describe('SegmentVideoCarousel', () => {
  it('unmount_clears_playing_flag_of_bound_video', () => {
    const handlers = carouselHandlers();
    const segment = {
      id: 'seg-1',
      title: 't',
      sentences: [],
      videos: [{ id: 'v1', name: 'v1.mp4', type: 'video', url: '/v1.mp4' } as MaterialItem],
    } as unknown as ScriptSegment;
    const logger = { info: vi.fn(), error: vi.fn(), userAction: vi.fn() };
    const { unmount } = render(React.createElement(SegmentVideoCarousel, {
      segment, currentIndex: 0, loadStates: {}, handlers, logger,
    }));
    expect(handlers.onPlayingChange).not.toHaveBeenCalled();
    unmount();
    expect(handlers.onPlayingChange).toHaveBeenCalledWith('seg-1_v1', false);
  });
});

interface VoiceBarProps {
  selectedVoiceId: string;
  onVoiceChange(voiceId: string): void;
  disabled: boolean;
}

/** VoiceSelector stand-in: resolves names only for voices it "knows". */
const KNOWN_VOICES: Record<string, string> = { 'voice-a': '少年梓辛' };
const FakeVoiceSelector: React.FC<{
  selectedVoiceId: string;
  onVoiceMetaChange?: (meta: { id: string; name: string }) => void;
}> = ({ selectedVoiceId, onVoiceMetaChange }) => {
  React.useEffect(() => {
    const name = KNOWN_VOICES[selectedVoiceId];
    if (name) onVoiceMetaChange?.({ id: selectedVoiceId, name });
  }, [selectedVoiceId, onVoiceMetaChange]);
  return null;
};

const DefaultVoiceBar = compileComponent<VoiceBarProps>(voiceBarSource, {
  ...base,
  './icons': compileComponentModule(iconsSource, base),
  '../VoiceSelector': { __esModule: true, default: FakeVoiceSelector },
});

describe('DefaultVoiceBar', () => {
  it('does_not_keep_previous_voice_name_for_unresolved_voice', () => {
    const props = { onVoiceChange: vi.fn(), disabled: false };
    const { rerender } = render(React.createElement(DefaultVoiceBar, {
      ...props, selectedVoiceId: 'voice-a',
    }));
    expect(screen.getByText('少年梓辛')).toBeTruthy();
    rerender(React.createElement(DefaultVoiceBar, { ...props, selectedVoiceId: 'voice-unknown' }));
    expect(screen.queryByText('少年梓辛')).toBeNull();
    expect(screen.getByText(zh.workbench.script.defaultVoiceUnset)).toBeTruthy();
  });
});
