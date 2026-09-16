import {
  getLegacyTtsFailure, getTtsFailure, isTtsRecord, makeTtsFailure,
  sanitizeTtsText,
} from '@/lib/ttsErrors';
import type {
  TtsFailure, TtsSegmentFailure, TtsSegmentSuccess,
} from '@/lib/ttsErrors';
import type { ToolContext } from '../types';

interface ParsedTtsResponse {
  body?: Record<string, unknown>;
  failure?: TtsFailure;
}

export interface TtsRequestSegment {
  segment_id: string;
  input_index: number;
  text: string;
  voice_type: string;
}

export function assertTtsNotAborted(context: ToolContext): void {
  if (context.abortSignal?.aborted) {
    throw new DOMException('语音请求已取消。', 'AbortError');
  }
}

export function ttsRequestFailure(
  error: unknown,
  context: ToolContext,
): TtsFailure {
  assertTtsNotAborted(context);
  const name = error instanceof Error || error instanceof DOMException
    ? error.name : '';
  // 用户取消已由上方 signal 检查处理；fetch 正文超时也可能抛 AbortError。
  const code = name === 'TimeoutError' || name === 'AbortError' ? 'TTS_TIMEOUT'
    : name === 'TypeError' ? 'TTS_BACKEND_UNAVAILABLE' : 'TTS_UNKNOWN_ERROR';
  return makeTtsFailure(code, { source: 'client', retryable: false });
}

export function invalidTtsRequest(): TtsFailure {
  return makeTtsFailure('TTS_INVALID_REQUEST', {
    source: 'client', retryable: false, attempts: 0,
  });
}

function invalidResponse(): TtsFailure {
  return makeTtsFailure('TTS_INVALID_RESPONSE', {
    source: 'client', retryable: false,
  });
}

function backendFailure(response: Response, body?: Record<string, unknown>) {
  const code = body?.error_code === 'BACKEND_TIMEOUT'
    ? 'TTS_BACKEND_TIMEOUT' : 'TTS_BACKEND_UNAVAILABLE';
  return makeTtsFailure(code, {
    source: 'backend', retryable: false, http_status: response.status,
  });
}

function safeStructuredFailure(
  value: unknown,
  sensitiveValues: readonly string[],
): TtsFailure | undefined {
  const failure = getTtsFailure(value, sensitiveValues);
  if (!failure) return undefined;
  const details = failure.error_details;
  return {
    ...failure,
    error_details: {
      ...details,
      source: details?.source ??
        (details?.provider === 'volcengine' ? 'provider' : 'backend'),
      retryable: details?.retryable ?? false,
    },
  };
}

function legacyBackendFailure(value: unknown): TtsFailure {
  const failure = getLegacyTtsFailure(value);
  return {
    ...failure,
    error_details: {
      ...failure.error_details, source: 'backend', retryable: false,
    },
  };
}

/** Consume the response once, regardless of the HTTP status. */
export async function readTtsResponse(
  response: Response,
  sensitiveValues: readonly string[] = [],
): Promise<ParsedTtsResponse> {
  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    // 仅 JSON 语法错误属于无效响应，传输异常由工具保留超时/断流原因。
    if (!(error instanceof SyntaxError)) throw error;
    return { failure: response.ok ? invalidResponse() : backendFailure(response) };
  }
  if (!isTtsRecord(value)) return { failure: invalidResponse() };
  const structured = safeStructuredFailure(value, sensitiveValues);
  if (structured) return { body: value, failure: structured };
  if (['BACKEND_TIMEOUT', 'BACKEND_UNREACHABLE', 'BACKEND_ERROR']
    .includes(String(value.error_code))) {
    return { failure: backendFailure(response, value) };
  }
  if ('detail' in value) return { failure: fastApiFailure(response, value.detail) };
  if (!response.ok) return { failure: backendFailure(response) };
  if (value.success === false) {
    const failure = legacyBackendFailure(
      sanitizeTtsText(value.error ?? value.message, sensitiveValues),
    );
    return { body: value, failure };
  }
  return { body: value };
}

function fastApiFailure(response: Response, detail: unknown): TtsFailure {
  // Older releases used HTTP 500 for this exact configuration error.
  const legacyConfig = 'TTS配置不完整：请检查 VOLCANO_TTS_API_KEY 环境变量' +
    '（V3 API Key，从新版火山控制台获取）';
  const missing = typeof detail === 'string' &&
    (detail.trim() === legacyConfig ||
      /^(?:TTS服务未配置|TTS 服务未配置|TTS配置缺失|TTS API Key未配置|TTS API key is not configured)[。.!]?$/i.test(detail.trim()));
  if (missing) return makeTtsFailure('TTS_CONFIG_MISSING', {
    source: 'local', retryable: false, attempts: 0,
  });
  if (response.status === 400 || response.status === 422) {
    return makeTtsFailure('TTS_INVALID_REQUEST', {
      source: 'backend', retryable: false, http_status: response.status,
    });
  }
  return backendFailure(response);
}

export function getTtsAudio(value: unknown): {
  audio_url: string; duration: number;
} | undefined {
  if (!isTtsRecord(value) || typeof value.audio_url !== 'string' ||
      !value.audio_url.trim()) return undefined;
  if (value.duration !== undefined && (typeof value.duration !== 'number' ||
      !Number.isFinite(value.duration) || value.duration < 0)) return undefined;
  return { audio_url: value.audio_url, duration: value.duration as number ?? 0 };
}

export function normalizeSingleTtsResponse(parsed: ParsedTtsResponse) {
  if (parsed.failure) return { success: false as const, ...parsed.failure };
  const audio = parsed.body?.success === true
    ? getTtsAudio(parsed.body.data) : undefined;
  if (!audio) return { success: false as const, ...invalidResponse() };
  return { success: true as const, ...audio };
}

function getBatchRows(body?: Record<string, unknown>): unknown[] | undefined {
  if (!body) return undefined;
  if ('results' in body) return Array.isArray(body.results) ? body.results : undefined;
  return isTtsRecord(body.data) && Array.isArray(body.data.results)
    ? body.data.results : undefined;
}

interface NormalizedBatch {
  results: TtsSegmentSuccess[];
  failures: TtsSegmentFailure[];
  ignoredResults: number;
}

function indexBatchRows(rows: unknown[], requests: TtsRequestSegment[]) {
  const expected = new Set(requests.map(segment => segment.segment_id));
  const indexed = new Map<string, Record<string, unknown>[]>();
  let ignoredResults = 0;
  for (const row of rows) {
    if (!isTtsRecord(row) || typeof row.segment_id !== 'string' ||
        !expected.has(row.segment_id)) {
      ignoredResults++;
      continue;
    }
    indexed.set(row.segment_id, [...indexed.get(row.segment_id) ?? [], row]);
  }
  return { indexed, ignoredResults };
}

export function normalizeBatchTtsResponse(
  parsed: ParsedTtsResponse,
  requests: TtsRequestSegment[],
): NormalizedBatch {
  const rows = getBatchRows(parsed.body);
  const { indexed, ignoredResults } = indexBatchRows(rows ?? [], requests);
  const results: TtsSegmentSuccess[] = [];
  const failures: TtsSegmentFailure[] = [];
  const sensitiveValues = requests.map(segment => segment.text);
  const badTopLevel = parsed.body && 'results' in parsed.body && !rows;
  for (const request of requests) {
    const entries = indexed.get(request.segment_id) ?? [];
    const row = entries.length === 1 ? entries[0] : undefined;
    const audio = row?.success === true ? getTtsAudio(row) : undefined;
    const identity = {
      input_index: request.input_index, segment_id: request.segment_id,
    };
    if (audio) {
      results.push({ ...identity, ...audio, material_id: `tts-${request.segment_id}` });
      continue;
    }
    const failure = row?.success === false
      ? safeStructuredFailure(row, sensitiveValues) ??
        legacyBackendFailure(sanitizeTtsText(row.error, sensitiveValues))
      : entries.length === 0 && !badTopLevel
        ? parsed.failure ?? invalidResponse() : invalidResponse();
    failures.push({ ...identity, ...failure });
  }
  return { results, failures, ignoredResults };
}

export function ttsToolResult<T extends object>(payload: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    details: payload,
  };
}
