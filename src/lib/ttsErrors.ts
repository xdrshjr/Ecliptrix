import type { Translations } from './i18n';

export const TTS_ERROR_CODES = [
  'TTS_INSUFFICIENT_BALANCE', 'TTS_RATE_LIMITED', 'TTS_QUOTA_EXHAUSTED',
  'TTS_AUTH_FAILED', 'TTS_VOICE_UNAVAILABLE', 'TTS_PERMISSION_DENIED',
  'TTS_INVALID_REQUEST', 'TTS_TIMEOUT', 'TTS_NETWORK_ERROR',
  'TTS_PROVIDER_ERROR', 'TTS_INVALID_RESPONSE', 'TTS_LOCAL_IO_ERROR',
  'TTS_UNKNOWN_ERROR', 'TTS_CONFIG_MISSING', 'TTS_BACKEND_TIMEOUT',
  'TTS_BACKEND_UNAVAILABLE',
] as const;

export type TtsErrorCode = typeof TTS_ERROR_CODES[number];

// 桌面运行时支持 Unicode 属性；构造器兼容仓库的 TypeScript ES5 编译目标。
const CONTROL_CHARACTERS = new RegExp('[\\p{Cc}\\p{Cf}\\p{Cs}]', 'gu');

export interface TtsErrorDetails {
  source?: 'provider' | 'backend' | 'client' | 'local';
  provider?: 'volcengine';
  provider_code?: string;
  provider_message?: string;
  http_status?: number;
  request_id?: string;
  attempts?: number;
  retryable: boolean;
  voice_fallback?: boolean;
}

export interface TtsFailure {
  error_code: TtsErrorCode;
  error: string;
  error_details?: TtsErrorDetails;
}

export interface TtsSegmentFailure extends TtsFailure {
  segment_id: string;
  input_index: number;
}

export interface TtsSegmentSuccess {
  input_index: number;
  segment_id: string;
  material_id: string;
  audio_url: string;
  duration: number;
}

export interface TtsBatchToolResult {
  success: boolean;
  partial: boolean;
  taskId: string;
  total_segments: number;
  successful_segments: number;
  failed_segments: number;
  results: TtsSegmentSuccess[];
  failures: TtsSegmentFailure[];
  message: string;
  error_code?: TtsErrorCode;
  error?: string;
  error_details?: TtsErrorDetails;
}

// These safe summaries also travel to the model without a UI locale.
const SUMMARIES: Record<TtsErrorCode, string> = {
  TTS_INSUFFICIENT_BALANCE: '语音服务余额不足或已欠费。',
  TTS_RATE_LIMITED: '语音请求过于频繁或并发超限。',
  TTS_QUOTA_EXHAUSTED: '语音服务额度已用完。',
  TTS_AUTH_FAILED: '语音服务凭据无效。',
  TTS_VOICE_UNAVAILABLE: '当前音色不可用。',
  TTS_PERMISSION_DENIED: '语音服务或音色未获授权。',
  TTS_INVALID_REQUEST: '语音请求参数无效。',
  TTS_TIMEOUT: '语音请求等待超时，生成结果尚未确认。',
  TTS_NETWORK_ERROR: '无法连接语音服务。',
  TTS_PROVIDER_ERROR: '语音服务返回错误。',
  TTS_INVALID_RESPONSE: '语音服务返回了无效数据。',
  TTS_LOCAL_IO_ERROR: '无法保存语音文件。',
  TTS_UNKNOWN_ERROR: '语音生成失败，服务未返回可识别的原因。',
  TTS_CONFIG_MISSING: '尚未配置语音服务凭据。',
  TTS_BACKEND_TIMEOUT: '本地语音处理等待超时，生成结果尚未确认。',
  TTS_BACKEND_UNAVAILABLE: '本地语音服务不可用。',
};

export function isTtsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function removeKnownValues(text: string, sensitiveValues: readonly string[]) {
  return sensitiveValues.filter(Boolean)
    .sort((first, second) => second.length - first.length)
    .reduce((clean, value) => clean.split(value).join('[已隐藏]'), text);
}

/** Reject raw bodies, headers, paths and request echoes before truncating. */
export function sanitizeTtsText(
  value: unknown,
  sensitiveValues: readonly string[] = [],
): string {
  if (typeof value !== 'string') return '';
  const knownClean = removeKnownValues(value, sensitiveValues);
  const credentialProbe = knownClean.replace(CONTROL_CHARACTERS, '');
  // 控制字符变体不能恢复为可读的正文片段；这类回显整体丢弃。
  const hasPrivateEcho = sensitiveValues.some(sensitive => {
    const normalized = sensitive.replace(CONTROL_CHARACTERS, '');
    return !!normalized && credentialProbe.includes(normalized);
  });
  if (hasPrivateEcho) return '';
  // 安全规则保留完整单行以便审计（表达式超过 80 列）。
  const credential = /\b(?:api[_-]?key|access[_-]?token|token|secret)["']?\s*[=:]/i;
  if (credential.test(credentialProbe)) return '';
  let clean = knownClean.replace(CONTROL_CHARACTERS, ' ');
  // 安全规则保留完整单行以便审计（表达式超过 80 列）。
  const unsafe = /<[^>]*>|traceback|\bstack\b|\bat\s+\S+\s*\(|[A-Z]:[\\/]|(?:^|\s)\/(?:[^\s/]+\/)+|\b(?:authorization|x-api-key|headers?|text|input|prompt)["']?\s*[:=]|(?:请求文本|配音正文)\s*[:：]|[a-z0-9+/=_-]{72,}/i;
  const path = /(?:^|[\s"'])\/\S|\\[^\s]/;
  if (unsafe.test(credentialProbe) || path.test(clean)) return '';
  clean = clean
    .replace(/\bBearer\s+\S+/gi, '[已隐藏]')
    .replace(/\b(?:api[_-]?key|access[_-]?token|token|secret)\s*[=:]\s*["']?[^\s,;"'}]+/gi, '[已隐藏]')
    .replace(/\b(?:sk|rk|pk)-[a-z0-9_-]+/gi, '[已隐藏]')
    .replace(/https?:\/\/[^\s<>'"]+/gi, '[链接已隐藏]')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(clean).slice(0, 240).join('');
}

function safeIdentifier(
  value: unknown,
  isRequestId: boolean,
  sensitiveValues: readonly string[],
): string | undefined {
  const text = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value) : value;
  if (typeof text !== 'string') return undefined;
  const clean = removeKnownValues(text, sensitiveValues);
  if (clean !== text || /^(?:sk|rk|pk)-/i.test(clean)) return undefined;
  const pattern = isRequestId ? /^[\w-]{1,128}$/ : /^[\w.-]{1,64}$/;
  return pattern.test(clean) ? clean : undefined;
}

function isIntegerInRange(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= min && value <= max;
}

function getDetails(
  value: unknown,
  sensitiveValues: readonly string[],
): TtsErrorDetails | undefined {
  if (!isTtsRecord(value) || typeof value.retryable !== 'boolean') {
    return undefined;
  }
  const result: TtsErrorDetails = { retryable: value.retryable };
  if (typeof value.source === 'string' &&
      ['provider', 'backend', 'client', 'local'].includes(value.source)) {
    result.source = value.source as TtsErrorDetails['source'];
  }
  if (value.provider === 'volcengine' &&
      (!result.source || result.source === 'provider')) {
    result.provider = 'volcengine';
  }
  const code = safeIdentifier(value.provider_code, false, sensitiveValues);
  const requestId = safeIdentifier(value.request_id, true, sensitiveValues);
  const message = sanitizeTtsText(value.provider_message, sensitiveValues);
  if (code) result.provider_code = code;
  if (requestId) result.request_id = requestId;
  if (message) result.provider_message = message;
  if (isIntegerInRange(value.http_status, 100, 599)) {
    result.http_status = value.http_status as number;
  }
  if (isIntegerInRange(value.attempts, 0, Number.MAX_SAFE_INTEGER)) {
    result.attempts = value.attempts as number;
  }
  if (typeof value.voice_fallback === 'boolean') {
    result.voice_fallback = value.voice_fallback;
  }
  return result;
}

/** Returns a new allowlisted object; never pass the untrusted input onward. */
export function getTtsFailure(
  value: unknown,
  sensitiveValues: readonly string[] = [],
): TtsFailure | undefined {
  if (!isTtsRecord(value) || value.success === true ||
      typeof value.error_code !== 'string' ||
      !value.error_code.startsWith('TTS_')) return undefined;
  const code = TTS_ERROR_CODES.includes(value.error_code as TtsErrorCode)
    ? value.error_code as TtsErrorCode : 'TTS_UNKNOWN_ERROR';
  const details = getDetails(value.error_details, sensitiveValues);
  return {
    error_code: code,
    error: SUMMARIES[code],
    ...(details ? { error_details: details } : {}),
  };
}

/** Legacy strings have no reliable source and never authorize a retry. */
export function getLegacyTtsFailure(value: unknown): TtsFailure {
  const message = sanitizeTtsText(value);
  const recognizable = /余额不足|欠费|insufficient balance|authentication failed|鉴权失败|音色.{0,10}(不存在|不支持)|voice.{0,20}(not found|unsupported)|并发超限|rate limit/i;
  const reason = message && recognizable.test(message) ? message : '';
  return {
    error_code: 'TTS_UNKNOWN_ERROR',
    error: SUMMARIES.TTS_UNKNOWN_ERROR,
    ...(reason ? { error_details: {
      retryable: false, provider_message: reason,
    } } : {}),
  };
}

export function makeTtsFailure(
  code: TtsErrorCode,
  details: TtsErrorDetails,
): TtsFailure {
  return { error_code: code, error: SUMMARIES[code], error_details: details };
}

export interface TtsFailureDescription {
  summary: string;
  action: string;
  details?: TtsErrorDetails;
}

export function describeTtsFailure(
  failure: TtsFailure,
  translations: Translations,
): TtsFailureDescription {
  const safe = getTtsFailure(failure) ?? getLegacyTtsFailure(undefined);
  const copy = translations.ttsErrors;
  const isClientTimeout = safe.error_code === 'TTS_TIMEOUT' &&
    safe.error_details?.source === 'client';
  return {
    summary: isClientTimeout
      ? copy.clientTimeout : copy.summary[safe.error_code],
    action: isClientTimeout
      ? copy.action.TTS_BACKEND_TIMEOUT : copy.action[safe.error_code],
    details: safe.error_details,
  };
}
