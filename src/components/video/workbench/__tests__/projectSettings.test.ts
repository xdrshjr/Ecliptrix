/**
 * T-PERSIST-1 (spec R2 §6.1): the project voice and canvas settings live at
 * the top level of the content, survive the save normalisation, and two
 * settings written in one tick are both kept (RV2-18).
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { VideoEditingTaskContent } from '@/types';
import { normaliseProjectDataForSave } from '@/lib/api/videoProjects';

vi.mock('@/contexts/LocaleContext', async () => {
  const { getTranslations } = await import('@/lib/i18n');
  return { useLocale: () => ({ locale: 'zh-CN', t: getTranslations('zh-CN') }) };
});

import { useProjectSettings } from '../useWorkbenchWiring';

const base = (): VideoEditingTaskContent => ({ markdownContent: '', lastModified: new Date(0) });

describe('project settings persistence (T-PERSIST-1)', () => {
  it('defaultVoiceId and canvasSettings are saved as top-level keys', () => {
    const saved = normaliseProjectDataForSave({
      ...base(),
      defaultVoiceId: 'voice-b',
      canvasSettings: { aspectRatioId: '9:16', fit: 'blur', dismissedAdvisories: ['letterbox'] },
    });
    expect({ voice: saved.defaultVoiceId, canvas: saved.canvasSettings }).toEqual({
      voice: 'voice-b',
      canvas: { aspectRatioId: '9:16', fit: 'blur', dismissedAdvisories: ['letterbox'] },
    });
  });

  it('an old project reads the defaults of today (I-1)', () => {
    const { result } = renderHook(() => useProjectSettings(base(), vi.fn()));
    expect({
      ratio: result.current.aspectRatioId, fit: result.current.canvasFit, voice: result.current.defaultVoiceId,
    }).toEqual({ ratio: '16:9', fit: 'contain', voice: undefined });
  });

  it('two settings changed in the same tick are both kept', () => {
    const writes: VideoEditingTaskContent[] = [];
    const { result } = renderHook(() => useProjectSettings(base(), (next) => writes.push(next)));
    act(() => {
      result.current.setCanvasFit('cover');
      result.current.setDefaultVoiceId('voice-b');
    });
    const last = writes[writes.length - 1];
    expect({ fit: last.canvasSettings?.fit, voice: last.defaultVoiceId }).toEqual({ fit: 'cover', voice: 'voice-b' });
  });

  it('before the project is loaded the ratio stays a local choice', () => {
    const write = vi.fn();
    const { result } = renderHook(() => useProjectSettings(null, write));
    act(() => result.current.setAspectRatioId('9:16'));
    expect({ ratio: result.current.aspectRatioId, writes: write.mock.calls.length }).toEqual({ ratio: '9:16', writes: 0 });
  });
});
