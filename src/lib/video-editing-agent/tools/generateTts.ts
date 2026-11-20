import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { MaterialItem } from '@/types';
import type { ToolContext } from '../types';
import { FALLBACK_TTS_VOICE_ID, resolveVoiceType } from '../voiceDefaults';
import { toolFetch } from './apiHelper';
import { toolResult } from './webToolAdapter';
import {
  assertTtsNotAborted, invalidTtsRequest, normalizeSingleTtsResponse,
  readTtsResponse, ttsRequestFailure, ttsToolResult,
  prepareSegmentVoice, segmentVoiceMetadata,
} from './ttsResponse';

const MAX_TEXT_LENGTH = 5000;

const parameters = Type.Object({
  segment_id: Type.Optional(Type.String({ description: '脚本配音必传稳定段 ID；普通无脚本配音省略。' })),
  text: Type.String({ description: '需要转换成语音的文本。' }),
  voice_type: Type.Optional(Type.String({
    description: '火山音色 ID；省略用段落/全片默认音色。explore_tools("tts_tools") 查看音色。',
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
    description: '生成配音入库。脚本配音传 segment_id；音色优先段落设置，否则用全片默认音色，不要每轮追问。' +
      '用户指定性别/风格/语言/年龄/情绪或抱怨音色时 ask_user 一次（YOLO 除外）。仅音色不可用时回退一次。',
    parameters,
    execute: async (toolCallId, params: Params) => {
      assertTtsNotAborted(context);
      const text = typeof params.text === 'string' ? params.text.trim() : '';
      if (!text || text.length > MAX_TEXT_LENGTH ||
          (params.speed !== undefined && !Number.isFinite(params.speed)) ||
          (params.voice_type !== undefined && !params.voice_type.trim())) {
        return ttsToolResult({ success: false, ...invalidTtsRequest() });
      }
      const prepared = prepareSegmentVoice(context, params.segment_id, text);
      if (prepared.failure) return ttsToolResult({ success: false, ...prepared.failure });
      const voiceType = resolveVoiceType(params.voice_type ?? prepared.segment?.voiceId, context.defaultVoiceId);
      const speed = Math.max(0.5, Math.min(2, params.speed ?? prepared.segment?.voiceSpeed ?? 1));
      try {
        const outcome = await generateSpeech(context, text, voiceType, speed);
        assertTtsNotAborted(context);
        if (!outcome.result.success) return ttsToolResult(outcome.result);
        if (prepared.segment && !context.scriptSegments?.some(s => s.id === prepared.segment!.id)) {
          return ttsToolResult({ success: false, ...invalidTtsRequest(), error: '脚本段落已删除，已丢弃迟到配音。' });
        }
        const material = createSpeechMaterial(text, outcome.result);
        material.metadata = segmentVoiceMetadata(prepared, outcome.voiceType, speed);
        assertTtsNotAborted(context);
        context.materials.push(material);
        context.recordOperation(toolCallId, { type: 'add_material', material });
        return ttsToolResult({
          success: true,
          // 回显实际使用的音色：模型/用户/日志都能确认这一次到底用了哪个音色。
          voice_type: outcome.voiceType,
          requested_voice_type: voiceType,
          actual_voice_type: outcome.voiceType,
          degraded: outcome.voiceType !== voiceType,
          ...(outcome.voiceType !== voiceType ? { unmet_requirement: '请求音色未实现；回退音色不证明原语言、方言或风格要求已完成。' } : {}),
          ...(prepared.segment ? { segment_id: prepared.segment.id } : {}),
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

const voiceParameters = Type.Object({
  query: Type.Optional(Type.String({ maxLength: 80, description: '按目录的名称、语言、描述或风格筛选；不要从 ID 猜语言。' })),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 40, description: '最多返回 40 项，默认 20。' })),
});

export function createListTtsVoicesTool(context: ToolContext): AgentTool<typeof voiceParameters> {
  return {
    name: 'list_tts_voices', label: '查询音色目录',
    description: '查询当前服务音色 ID、语言、性别、风格及 stale。目录包含提供方字段或静态回退值，不保证当前账号权限或方言支持；按证据选择，禁止猜 ID。',
    parameters: voiceParameters,
    execute: async (_callId, params, signal) => {
      try {
        const response = await toolFetch(context, '/api/tts/voice-types', { signal });
        const body = await response.json();
        if (!response.ok || body.success !== true || !body.data || typeof body.data !== 'object') {
          return toolResult({ success: false, error_code: 'TTS_CATALOGUE_UNAVAILABLE', next_step: '报告目录不可用，不猜测音色或把能力级故障当成单音色故障。' });
        }
        const clean = (value: unknown) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').slice(0, 180) : '';
        const query = (params.query ?? '').toLowerCase();
        const voices = Object.values(body.data).filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
          .map(v => ({ id: clean(v.id), name: clean(v.name), language: clean(v.language), gender: clean(v.gender), category: clean(v.category), description: clean(v.description) }))
          .filter(v => v.id && (!query || Object.values(v).join(' ').toLowerCase().includes(query)));
        return toolResult({ success: true, stale: body.stale === true, availability: 'catalogue_only',
          language_evidence: 'provider_or_static_fallback', total_matches: voices.length,
          voices: voices.slice(0, Math.max(1, Math.min(40, params.limit ?? 20))),
          note: '目录不证明实时授权；缺失语言可能使用默认值。方言要求须核实，降级后仍报告原要求未完成。' });
      } catch {
        return toolResult({ success: false, error_code: context.abortSignal?.aborted || signal?.aborted ? 'TTS_CANCELLED' : 'TTS_CATALOGUE_UNAVAILABLE' });
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
