'use client';

/**
 * How audio clips render on the timeline (editor-shell-ui-consolidation W6).
 *
 * 'waveform' (default): a clean waveform, no text drawn over it.
 * 'sentences': the TTS sentence colour blocks.
 *
 * A per-viewer UI preference kept in localStorage — never written into the
 * project data. A module-level listener set lets the toolbar toggle re-render
 * every TimelineItem at once; the `storage` event keeps other windows in sync.
 */

import { useCallback, useSyncExternalStore } from 'react';

export type AudioClipDisplay = 'waveform' | 'sentences';
export const AUDIO_CLIP_DISPLAY_KEY = 'ecliptrix.timeline.audioClipDisplay.v1';
export const DEFAULT_AUDIO_CLIP_DISPLAY: AudioClipDisplay = 'waveform';

const listeners = new Set<() => void>();
// readAudioClipDisplay is the useSyncExternalStore snapshot, called on every
// render of every audio clip; warn about blocked storage once, not per call.
let hasWarnedReadFailure = false;

const isAudioClipDisplay = (value: unknown): value is AudioClipDisplay =>
  value === 'waveform' || value === 'sentences';

export function readAudioClipDisplay(): AudioClipDisplay {
  try {
    const stored = window.localStorage.getItem(AUDIO_CLIP_DISPLAY_KEY);
    return isAudioClipDisplay(stored) ? stored : DEFAULT_AUDIO_CLIP_DISPLAY;
  } catch (error) {
    if (!hasWarnedReadFailure) {
      hasWarnedReadFailure = true;
      console.warn('[audioClipDisplay] preference storage unavailable', error);
    }
    return DEFAULT_AUDIO_CLIP_DISPLAY;
  }
}

export function writeAudioClipDisplay(value: AudioClipDisplay): void {
  try {
    window.localStorage.setItem(AUDIO_CLIP_DISPLAY_KEY, value);
  } catch (error) {
    console.warn('[audioClipDisplay] preference storage unavailable', error);
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === AUDIO_CLIP_DISPLAY_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const getServerSnapshot = (): AudioClipDisplay => DEFAULT_AUDIO_CLIP_DISPLAY;

export function useAudioClipDisplay(): [AudioClipDisplay, (value: AudioClipDisplay) => void] {
  const display = useSyncExternalStore(subscribe, readAudioClipDisplay, getServerSnapshot);
  const setDisplay = useCallback((value: AudioClipDisplay) => writeAudioClipDisplay(value), []);
  return [display, setDisplay];
}
