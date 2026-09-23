import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialItem, ScriptSegment } from '@/types';
import { getTranslations } from '@/lib/i18n';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import { segmentTextHash } from '../../lib/aiMix/segmentTextHash';

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
const tts = vi.hoisted(() => ({ convert: vi.fn() }));

vi.mock('@/contexts/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: notify.success, showError: notify.error, showWarning: notify.warning }),
}));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ locale: 'zh-CN', t: getTranslations('zh-CN') }),
}));
vi.mock('@/lib/utils/localAudioManager', () => ({
  default: { storeAudioFile: vi.fn(async () => 'blob:local') },
}));
vi.mock('@/lib/api/tts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/tts')>();
  return { ...actual, convertSentencesToSpeech: tts.convert };
});

import { useSegmentVoiceGeneration } from '../useSegmentVoiceGeneration';

const segment = (id: string, text: string, extra: Partial<ScriptSegment> = {}): ScriptSegment =>
  ({ id, title: id, narrationText: text, sentences: [{ id: `${id}-1`, text }], ...extra }) as ScriptSegment;

function reply(duration = 6) {
  return {
    success: true, concatenated_audio_url: '/api/audio/generated/a.mp3', total_duration: duration,
    sentence_results: [], successful_sentences: 1, total_sentences: 1, failed_sentences: 0,
  };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

function setup(segments: ScriptSegment[], defaultVoiceId = 'voice-default') {
  const segmentsRef = { current: segments };
  const added: MaterialItem[] = [];
  const updates: ScriptSegment[][] = [];
  const hook = renderHook(() => useSegmentVoiceGeneration({
    taskId: 't', segmentsRef, defaultVoiceId, logger,
    onAddMaterial: (material) => added.push(material),
    onUpdateSegments: (next) => updates.push(next),
    getSegmentNumber: (id) => segments.findIndex((s) => s.id === id) + 1,
  }));
  return { hook, segmentsRef, added, updates };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) })));
  tts.convert.mockReset();
  notify.success.mockReset(); notify.error.mockReset(); notify.warning.mockReset();
  useEditorFocusStore.getState().reset();
});

afterEach(() => vi.unstubAllGlobals());

describe('useSegmentVoiceGeneration', () => {
  it('T-VOICE-HASH: the hash is the text at request time; an edit during the request makes the result stale', async () => {
    const original = segment('s1', 'old text');
    const { hook, segmentsRef, added } = setup([original]);
    tts.convert.mockImplementation(async () => {
      segmentsRef.current = [segment('s1', 'edited text')];
      return reply();
    });
    await act(async () => { await hook.result.current.convert(original); });
    expect({
      hash: added[0]?.metadata?.segment_text_hash,
      warned: notify.warning.mock.calls.map((call) => call[0]),
    }).toEqual({
      hash: segmentTextHash(original),
      warned: [getTranslations('zh-CN').workbench.segmentCommands.voiceResultStale],
    });
  });

  it('T-VOICE-DELETED: a reply for a deleted segment is discarded', async () => {
    const original = segment('s1', 'text');
    const { hook, segmentsRef, added } = setup([original]);
    tts.convert.mockImplementation(async () => { segmentsRef.current = []; return reply(); });
    let outcome = '';
    await act(async () => { outcome = await hook.result.current.convert(original); });
    expect({ outcome, added: added.length }).toEqual({ outcome: 'discarded', added: 0 });
  });

  it('T-VOICE-OVERRIDE: the request uses the segment voice / speed, else the project default', async () => {
    const own = segment('s1', 'a', { voiceId: 'voice-own', voiceSpeed: 1.2 });
    const plain = segment('s2', 'b');
    const { hook, added } = setup([own, plain]);
    tts.convert.mockResolvedValue(reply());
    await act(async () => { await hook.result.current.convert(own); });
    await act(async () => { await hook.result.current.convert(plain); });
    expect(tts.convert.mock.calls.map(([request]) => [request.voice_type, request.speed_ratio]))
      .toEqual([['voice-own', 1.2], ['voice-default', 1]]);
    expect(added.map((m) => [m.metadata?.voice_type, m.metadata?.voice_speed]))
      .toEqual([['voice-own', 1.2], ['voice-default', 1]]);
  });

  it('T-VOICE-DURATION-WRITE-KEPT: segment.duration is still written with the new length (I-11)', async () => {
    const original = segment('s1', 'text');
    const { hook, updates } = setup([original]);
    tts.convert.mockResolvedValue(reply(9.5));
    await act(async () => { await hook.result.current.convert(original); });
    expect(updates[updates.length - 1]?.[0].duration).toBe(9.5);
  });

  it('a failure is kept on the segment with its reason and cleared on the next try', async () => {
    const original = segment('s1', 'text');
    const { hook } = setup([original]);
    tts.convert.mockRejectedValueOnce(new Error('network down'));
    await act(async () => { await hook.result.current.convert(original); });
    const kept = useEditorFocusStore.getState().segmentVoiceErrors.get('s1');
    tts.convert.mockResolvedValue(reply());
    await act(async () => { await hook.result.current.convert(original); });
    expect({ kept, after: useEditorFocusStore.getState().segmentVoiceErrors.get('s1') })
      .toEqual({ kept: 'network down', after: undefined });
  });

  it('T-VOICE-BATCH-FAILCOUNT: one failure in three is counted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const segments = [segment('a', '1'), segment('b', '2'), segment('c', '3')];
    const { hook } = setup(segments);
    tts.convert
      .mockResolvedValueOnce(reply())
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(reply());
    let counts = { ok: 0, failed: 0 };
    await act(async () => {
      const running = hook.result.current.convertMany(['a', 'b', 'c']);
      await vi.runAllTimersAsync();
      counts = await running;
    });
    vi.useRealTimers();
    expect(counts).toEqual({ ok: 2, failed: 1 });
  });
});
