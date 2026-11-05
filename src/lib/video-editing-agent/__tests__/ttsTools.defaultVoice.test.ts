import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../types';
import { createGenerateTtsTool } from '../tools/generateTts';
import { createBatchGenerateTtsTool } from '../tools/batchGenerateTts';
import { FALLBACK_TTS_VOICE_ID } from '../voiceDefaults';

// 回归测试：docs/diagnoses/agent-tts-ignores-project-default-voice/analysis.md
// §2.A 复现用例转正 + §8.6 追加断言。修 bug 从「先能复现」的测试开始。

/** 用户在「全片默认音色」里实际选中的音色（此处取一个与兜底值不同的男声）。 */
const PROJECT_DEFAULT = 'zh_male_yangguangqingnian_uranus_bigtts';
/** 界面缺省显示的「全片默认音色」（ScriptPanel.DEFAULT_VOICE_ID）。 */
const UI_DEFAULT_VOICE = 'zh_male_shaonianzixin_uranus_bigtts';

function context(defaultVoiceId?: string): ToolContext {
  return {
    materials: [], operations: new Map(),
    apiBaseUrl: 'http://127.0.0.1:3000',
    recordOperation: vi.fn(), updateTimeline: vi.fn(),
    defaultVoiceId,
  } as unknown as ToolContext;
}

function speakOk(audioUrl = '/a.mp3') {
  return new Response(JSON.stringify({
    success: true, data: { audio_url: audioUrl, duration: 1 },
  }), { status: 200 });
}

function voiceUnavailable() {
  return new Response(JSON.stringify({
    success: false, error_code: 'TTS_VOICE_UNAVAILABLE', message: '音色不可用',
    error_details: {
      source: 'provider', provider: 'volcengine', retryable: false,
      attempts: 1, provider_code: '45000001',
    },
  }), { status: 200 });
}

function batchOk() {
  return vi.fn().mockImplementation(async (_url, init) => {
    const { segments } = JSON.parse(init.body as string);
    return new Response(JSON.stringify({
      success: true,
      results: segments.map((segment: { segment_id: string }, index: number) => ({
        segment_id: segment.segment_id, success: true, audio_url: `/audio-${index}.mp3`,
      })),
    }), { status: 200 });
  });
}

const requestBody = (fetchMock: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse(fetchMock.mock.calls[call][1].body as string);

function voiceSchema(tool: { parameters: unknown }) {
  return (tool.parameters as { properties: Record<string, { description?: string }> })
    .properties.voice_type;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Agent TTS 使用工程「全片默认音色」', () => {
  it('generate_tts 未显式指定 voice_type 时使用工程默认音色', async () => {
    const fetchMock = vi.fn().mockResolvedValue(speakOk());
    vi.stubGlobal('fetch', fetchMock);
    const result = await createGenerateTtsTool(context(PROJECT_DEFAULT))
      .execute('one', { text: '一句话' });
    expect(requestBody(fetchMock).voice_type).toBe(PROJECT_DEFAULT);
    // 可观测性：回显实际使用的音色，模型/用户/日志都能核对。
    expect(result.details).toMatchObject({ success: true, voice_type: PROJECT_DEFAULT });
  });

  it('没有工程默认时落到与界面缺省同值的兜底音色', async () => {
    const fetchMock = vi.fn().mockResolvedValue(speakOk());
    vi.stubGlobal('fetch', fetchMock);
    await createGenerateTtsTool(context()).execute('one', { text: '一句话' });
    expect(FALLBACK_TTS_VOICE_ID).toBe(UI_DEFAULT_VOICE);
    expect(requestBody(fetchMock).voice_type).toBe(UI_DEFAULT_VOICE);
  });

  it('用户明确指定 voice_type 时优先于工程默认', async () => {
    const fetchMock = vi.fn().mockResolvedValue(speakOk());
    vi.stubGlobal('fetch', fetchMock);
    const result = await createGenerateTtsTool(context(PROJECT_DEFAULT))
      .execute('one', { text: '一句话', voice_type: 'custom-voice' });
    expect(requestBody(fetchMock).voice_type).toBe('custom-voice');
    expect(result.details).toMatchObject({ voice_type: 'custom-voice' });
  });

  it('batch_generate_tts 逐段使用工程默认音色，顶层兜底同值', async () => {
    const fetchMock = batchOk();
    vi.stubGlobal('fetch', fetchMock);
    const result = await createBatchGenerateTtsTool(context(PROJECT_DEFAULT))
      .execute('batch', {
        segments: [{ text: '第一句' }, { text: '第二句', voice_type: 'voice-a' }],
      });
    const body = requestBody(fetchMock);
    expect(body.segments.map((segment: { voice_type: string }) => segment.voice_type))
      .toEqual([PROJECT_DEFAULT, 'voice-a']);
    // 后端语义仍是「段级优先」（batch_tts_service.py:157），顶层只是兜底。
    expect(body.voice_type).toBe(PROJECT_DEFAULT);
    expect(result.details).toMatchObject({ voice_type: PROJECT_DEFAULT });
  });
});

describe('音色不可用时的回退目标', () => {
  it('回退到工程默认音色，而不是硬编码的女声', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(voiceUnavailable())
      .mockResolvedValueOnce(speakOk());
    vi.stubGlobal('fetch', fetchMock);
    await createGenerateTtsTool(context(PROJECT_DEFAULT))
      .execute('one', { text: '一句话', voice_type: 'custom-voice' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 1).voice_type).toBe(PROJECT_DEFAULT);
  });

  it('解析值本身就是工程默认音色时只退到兜底音色一次', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(voiceUnavailable())
      .mockResolvedValueOnce(speakOk());
    vi.stubGlobal('fetch', fetchMock);
    await createGenerateTtsTool(context(PROJECT_DEFAULT)).execute('one', { text: '一句话' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock).voice_type).toBe(PROJECT_DEFAULT);
    expect(requestBody(fetchMock, 1).voice_type).toBe(FALLBACK_TTS_VOICE_ID);
  });

  it('解析值已是兜底音色时不再发起第二次请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(voiceUnavailable());
    vi.stubGlobal('fetch', fetchMock);
    const result = await createGenerateTtsTool(context()).execute('one', { text: '一句话' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({ success: false, error_code: 'TTS_VOICE_UNAVAILABLE' });
  });
});

describe('工具描述（真正进入模型上下文的载体）', () => {
  it('generate_tts 的参数描述不再写死具体音色', () => {
    const tool = createGenerateTtsTool(context(PROJECT_DEFAULT));
    const voiceType = voiceSchema(tool);
    expect(voiceType.description).toContain('全片默认音色');
    expect(`${tool.description} ${voiceType.description}`).not.toMatch(/_bigtts/);
  });

  it('两个 TTS 工具都写明「默认不问、必要时 ask_user 问一次」', () => {
    for (const tool of [
      createGenerateTtsTool(context(PROJECT_DEFAULT)),
      createBatchGenerateTtsTool(context(PROJECT_DEFAULT)),
    ]) {
      expect(tool.description).toContain('全片默认音色');
      expect(tool.description).toContain('ask_user');
    }
  });
});
