import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { MaterialItem } from '@/types';
import type { ToolContext } from '../types';
import { FALLBACK_TTS_VOICE_ID, resolveVoiceType } from '../voiceDefaults';
import { toolFetch } from './apiHelper';
import {
  assertTtsNotAborted, invalidTtsRequest, normalizeSingleTtsResponse,
  readTtsResponse, ttsRequestFailure, ttsToolResult,
} from './ttsResponse';

const MAX_TEXT_LENGTH = 5000;

const parameters = Type.Object({
  text: Type.String({ description: '需要转换成语音的文本。' }),
  voice_type: Type.Optional(Type.String({
    description: '火山语音音色 ID；省略则使用本工程「全片默认音色」，用户明确指定则以用户为准。' +
      '通过 explore_tools("tts_tools") 查看音色。',
  })),
  speed: Type.Optional(Type.Number({
    description: '语速倍数，0.5–2.0，默认为 1.0。',
  })),
});

type Params = Static<typeof parameters>;

export function createGenerateTtsTool(
  context: ToolContext,
): AgentTool<typeof parameters> {
  return {
    name: 'generate_tts',
    label: '生成配音',
    description: '将文本转换成语音并加入素材库。默认使用本工程「全片默认音色」，不要每轮追问；' +
      '仅当用户提到性别/风格/语言/年龄/情绪或抱怨音色不对时，先用 ask_user 问一次（YOLO 模式除外）。' +
      '仅音色不可用时回退一次默认音色；其他失败返回具体原因。',
    parameters,
    execute: async (toolCallId, params: Params) => {
      assertTtsNotAborted(context);
      const text = typeof params.text === 'string' ? params.text.trim() : '';
      if (!text || text.length > MAX_TEXT_LENGTH ||
          (params.speed !== undefined && !Number.isFinite(params.speed)) ||
          (params.voice_type !== undefined && !params.voice_type.trim())) {
        return ttsToolResult({ success: false, ...invalidTtsRequest() });
      }
      const voiceType = resolveVoiceType(params.voice_type, context.defaultVoiceId);
      const speed = Math.max(0.5, Math.min(2, params.speed ?? 1));
      try {
        const outcome = await generateSpeech(context, text, voiceType, speed);
        assertTtsNotAborted(context);
        if (!outcome.result.success) return ttsToolResult(outcome.result);
        const material = createSpeechMaterial(text, outcome.result);
        assertTtsNotAborted(context);
        context.materials.push(material);
        context.recordOperation(toolCallId, { type: 'add_material', material });
        return ttsToolResult({
          success: true,
          // 回显实际使用的音色：模型/用户/日志都能确认这一次到底用了哪个音色。
          voice_type: outcome.voiceType,
          material: {
            id: material.id, name: material.name, type: 'audio',
            duration: material.duration, url: material.url, format: 'mp3',
          },
          message: `配音已生成并加入素材库（音色 ${outcome.voiceType}）。`,
        });
      } catch (error) {
        return ttsToolResult({ success: false, ...ttsRequestFailure(error, context) });
      }
    },
  };
}

async function generateSpeech(
  context: ToolContext,
  text: string,
  voiceType: string,
  speed: number,
) {
  let result = await callTtsApi(context, text, voiceType, speed);
  assertTtsNotAborted(context);
  if (result.success || result.error_code !== 'TTS_VOICE_UNAVAILABLE') {
    return { result, voiceType };
  }
  // 回退目标永远是「工程默认音色」；解析值本身就是它时只退到全局兜底音色，
  // 且绝不拿同一个 id 再请求一次（docs/diagnoses/
  // agent-tts-ignores-project-default-voice/analysis.md §8.5-1）。
  const projectDefault = resolveVoiceType(undefined, context.defaultVoiceId);
  const retryVoice = voiceType === projectDefault
    ? FALLBACK_TTS_VOICE_ID : projectDefault;
  if (retryVoice === voiceType) return { result, voiceType };
  try {
    result = await callTtsApi(context, text, retryVoice, speed);
  } catch (error) {
    result = { success: false, ...ttsRequestFailure(error, context) };
  }
  assertTtsNotAborted(context);
  if (result.success) return { result, voiceType: retryVoice };
  return {
    result: {
      ...result,
      error_details: {
        ...result.error_details,
        source: result.error_details?.source ?? 'client' as const,
        retryable: result.error_details?.retryable ?? false,
        voice_fallback: true,
      },
    },
    voiceType,
  };
}

async function callTtsApi(
  context: ToolContext,
  text: string,
  voiceType: string,
  speed: number,
) {
  assertTtsNotAborted(context);
  const response = await toolFetch(context, '/api/tts/convert', {
    method: 'POST', timeout: 130_000, retry: false,
    body: JSON.stringify({ text, voice_type: voiceType, speed_ratio: speed }),
  });
  assertTtsNotAborted(context);
  const parsed = await readTtsResponse(response, [text]);
  assertTtsNotAborted(context);
  return normalizeSingleTtsResponse(parsed);
}

function createSpeechMaterial(
  text: string,
  audio: { audio_url: string; duration: number },
): MaterialItem {
  return {
    id: `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: text.length > 30 ? `TTS: ${text.slice(0, 27)}...` : `TTS: ${text}`,
    type: 'audio', format: 'mp3', size: 0, duration: audio.duration,
    url: audio.audio_url, serverUrl: audio.audio_url, createdAt: new Date(),
    tags: ['tts', 'generated'], description: '生成的配音',
  };
}
