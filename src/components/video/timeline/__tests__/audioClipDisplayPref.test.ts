import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIO_CLIP_DISPLAY_KEY,
  readAudioClipDisplay,
  useAudioClipDisplay,
  writeAudioClipDisplay,
} from '../audioClipDisplayPref';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('audioClipDisplayPref', () => {
  it('defaults_to_waveform', () => {
    expect(readAudioClipDisplay()).toBe('waveform');
  });

  it('invalid_value_falls_back', () => {
    localStorage.setItem(AUDIO_CLIP_DISPLAY_KEY, 'bogus');
    expect(readAudioClipDisplay()).toBe('waveform');
  });

  it('write_notifies_subscribers', () => {
    const first = renderHook(() => useAudioClipDisplay());
    const second = renderHook(() => useAudioClipDisplay());
    expect(first.result.current[0]).toBe('waveform');
    act(() => first.result.current[1]('sentences'));
    expect(first.result.current[0]).toBe('sentences');
    expect(second.result.current[0]).toBe('sentences');
    expect(localStorage.getItem(AUDIO_CLIP_DISPLAY_KEY)).toBe('sentences');
  });

  it('storage_failure_falls_back_to_waveform', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('denied');
    });
    expect(readAudioClipDisplay()).toBe('waveform');
    expect(warn).toHaveBeenCalled();
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('denied');
    });
    expect(() => writeAudioClipDisplay('sentences')).not.toThrow();
  });
});
