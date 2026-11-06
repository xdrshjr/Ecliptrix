import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { MaterialItem } from '@/types';
import type { TtsBatchToolResult, TtsSegmentSuccess } from '@/lib/ttsErrors';
import type { ToolContext } from '../types';
import { resolveVoiceType } from '../voiceDefaults';
import { toolFetch } from './apiHelper';
import {
  assertTtsNotAborted, invalidTtsRequest, normalizeBatchTtsResponse,
  readTtsResponse, ttsRequestFailure, ttsToolResult,
  prepareSegmentVoice, segmentVoiceMetadata,
} from './ttsResponse';
import type { TtsRequestSegment } from './ttsResponse';

const MAX_SEGMENTS = 50;
const MAX_TEXT_LENGTH = 5000;

const parameters = Type.Object({
  segments: Type.Array(Type.Object({
    segment_id: Type.Optional(Type.String({ description: '该项对应的稳定脚本段 ID；不替代批次请求 ID。' })),
    text: Type.String({ description: '本段需要转换的文本。' }),
    voice_type: Type.Optional(Type.String({
      description: '本段的火山语音音色 ID；省略则使用本工程「全片默认音色」。',
    })),
  }), { description: '待生成配音的段落；可以逐段指定音色。' }),
  speed: Type.Optional(Type.Number({ description: '统一语速倍数，0.5–2.0，默认 1.0。' })),
});

type Params = Static<typeof parameters>;

export function createBatchGenerateTtsTool(
  context: ToolContext,
): AgentTool<typeof parameters> {
  return {
    name: 'batch_generate_tts', label: '批量生成配音',
    description: '同步生成各段配音并返回素材 ID、原始索引及失败段落。默认使用本工程「全片默认音色」，' +
      '不要每轮追问；仅当用户提到性别/风格/语言/年龄/情绪或抱怨音色不对时，先用 ask_user 问一次' +
      '（YOLO 模式除外）。taskId 仅用于关联；部分失败后只按用户意图重试指定失败段落。',
    parameters,
    execute: async (toolCallId, params: Params) => {
      assertTtsNotAborted(context);
      if (!validParams(params)) {
        return ttsToolResult({ success: false, ...invalidTtsRequest() });
      }
      const prepared = params.segments.map(s => prepareSegmentVoice(context, s.segment_id, s.text.trim()));
      const invalid = prepared.find(p => p.failure)?.failure;
      if (invalid) return ttsToolResult({ success: false, ...invalid });
      const taskId = `batch-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const requests = params.segments.map((segment, input_index) => ({
        segment_id: `${taskId}-seg-${input_index}`, input_index,
        text: segment.text.trim(),
        voice_type: resolveVoiceType(segment.voice_type ?? prepared[input_index].segment?.voiceId, context.defaultVoiceId),
      }));
      let normalized: ReturnType<typeof normalizeBatchTtsResponse>;
      try {
        const parsed = await callBatchTtsApi(context, requests, params.speed, taskId);
        assertTtsNotAborted(context);
        normalized = normalizeBatchTtsResponse(parsed, requests);
      } catch (error) {
        normalized = normalizeBatchTtsResponse({
          failure: ttsRequestFailure(error, context),
        }, requests);
      }
      assertTtsNotAborted(context);
      normalized.results = normalized.results.filter(result => {
        const segment = prepared[result.input_index].segment;
        if (!segment || context.scriptSegments?.some(s => s.id === segment.id)) return true;
        normalized.failures.push({ input_index: result.input_index, segment_id: result.segment_id,
          ...invalidTtsRequest(), error: '脚本段落已删除，已丢弃迟到配音。' });
        return false;
      });
      const materials = normalized.results.map(result => {
        const request = requests[result.input_index];
        const material = createBatchMaterial(result, request.text);
        material.metadata = segmentVoiceMetadata(prepared[result.input_index], request.voice_type,
          Math.max(0.5, Math.min(2, params.speed ?? 1)));
        return material;
      });
      if (materials.length > 0) {
        assertTtsNotAborted(context);
        context.materials.push(...materials);
        context.recordOperation(toolCallId, { type: 'add_materials', materials });
      }
      if (normalized.ignoredResults) {
        console.warn('[batch_generate_tts] 忽略无关或无效结果条数：', normalized.ignoredResults);
      }
      const defaultVoiceType = resolveVoiceType(undefined, context.defaultVoiceId);
      const payload = batchPayload(taskId, normalized, defaultVoiceType);
      const identify = <T extends { input_index: number }>(row: T) => {
        const id = prepared[row.input_index].segment?.id;
        return { ...row, ...(id ? { script_segment_id: id } : {}) };
      };
      return ttsToolResult({ ...payload,
        results: payload.results.map(identify), failures: payload.failures.map(identify),
        message: payload.message + (prepared.some(p => p.segment)
          ? ' 上轨时使用 script_segment_id 作为 segment_id；结果中的 segment_id 是批次请求 ID。' : ''),
      });
    },
  };
}

function validParams(params: Params): boolean {
  if (!Array.isArray(params.segments) || !params.segments.length ||
      params.segments.length > MAX_SEGMENTS ||
      (params.speed !== undefined && !Number.isFinite(params.speed))) return false;
  return params.segments.every(segment =>
    segment && typeof segment.text === 'string' && segment.text.trim() &&
    segment.text.trim().length <= MAX_TEXT_LENGTH &&
    (segment.voice_type === undefined ||
      (typeof segment.voice_type === 'string' && segment.voice_type.trim())));
}

async function callBatchTtsApi(
  context: ToolContext,
  requests: TtsRequestSegment[],
  speed: number | undefined,
  taskId: string,
) {
  assertTtsNotAborted(context);
  const response = await toolFetch(context, '/api/tts/batch-convert', {
    method: 'POST', timeout: 610_000, retry: false,
    body: JSON.stringify({
      segments: requests.map(({ segment_id, text, voice_type }) => ({
        segment_id, text, voice_type,
      })),
      // 段级已逐段解析；顶层只是兜底，后端语义仍是「段级优先」
      // （batch_tts_service.py:157 `segment.voice_type or request.voice_type`）。
      voice_type: resolveVoiceType(undefined, context.defaultVoiceId),
      speed_ratio: Math.max(0.5, Math.min(2, speed ?? 1)), task_id: taskId,
    }),
  });
  assertTtsNotAborted(context);
  const parsed = await readTtsResponse(response, requests.map(segment => segment.text));
  assertTtsNotAborted(context);
  return parsed;
}

function batchPayload(
  taskId: string,
  normalized: ReturnType<typeof normalizeBatchTtsResponse>,
  defaultVoiceType: string,
): TtsBatchToolResult {
  const { results, failures } = normalized;
  const total = results.length + failures.length;
  const success = results.length > 0;
  const first = failures[0];
  return {
    success, partial: success && failures.length > 0, taskId,
    // 回显「全片默认音色」：未逐段指定音色的段落实际用的就是它。
    voice_type: defaultVoiceType,
    total_segments: total, successful_segments: results.length,
    failed_segments: failures.length, results, failures,
    message: `成功 ${results.length}/${total} 段，${failures.length} 段失败。`,
    ...(!success && first ? {
      error: first.error, error_code: first.error_code,
      error_details: first.error_details,
    } : {}),
  };
}

function createBatchMaterial(result: TtsSegmentSuccess, text: string): MaterialItem {
  return {
    id: result.material_id,
    name: text.length > 25 ? `TTS: ${text.slice(0, 22)}...` : `TTS: ${text}`,
    type: 'audio', format: 'mp3', size: 0, duration: result.duration,
    url: result.audio_url, serverUrl: result.audio_url, createdAt: new Date(),
    tags: ['tts', 'generated', 'batch'], description: '批量生成的配音',
  };
}
