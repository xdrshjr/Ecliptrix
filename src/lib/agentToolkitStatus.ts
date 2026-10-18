import type { Translations } from '@/lib/i18n';

/**
 * 错误码 → 本地文案 / 设置路径的**唯一**映射。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §6.1 第 6 段。
 * 与 `webResearchStatus.ts` 同一纪律：只返回本地白名单键，后端/供应商的
 * 原始文本永远不直接展示。
 */

type CopyKey = Exclude<keyof Translations['agentToolkit'], 'tools'>;

export type AgentToolkitFailureClass =
  'user_input' | 'policy' | 'configuration' | 'transient' | 'internal'
  | 'cancelled';

export interface AgentToolkitStatusInput {
  error_code?: string;
  failure_class?: AgentToolkitFailureClass | string;
  status?: string;
  success?: boolean;
}

/** 逐码登记：`agent_toolkit_models.STATUS` 的每个码都必须在这里出现。 */
const CODES: Record<string, CopyKey> = {
  // 参数
  invalid_argument: 'invalidArgument',
  invalid_workspace_name: 'invalidName',
  invalid_offset: 'invalidOffset',
  invalid_page_size: 'invalidOffset',
  page_out_of_range: 'pageOutOfRange',
  analysis_rejected: 'codeRejected',
  invalid_call_id: 'internalError',
  unknown_toolkit_setting: 'invalidSetting',
  setting_out_of_range: 'invalidSetting',
  origin_forbidden: 'originBlocked',
  json_required: 'internalError',
  request_too_large: 'fileTooLarge',
  // 能力闸门
  toolkit_disabled: 'capabilityDisabled',
  workspace_disabled: 'capabilityDisabled',
  documents_disabled: 'capabilityDisabled',
  analysis_disabled: 'analysisDisabled',
  memory_disabled: 'capabilityDisabled',
  // 策略
  policy_blocked: 'policyBlocked',
  memory_limit_reached: 'memoryFull',
  workspace_quota_exceeded: 'quotaExceeded',
  // 未命中
  workspace_not_found: 'fileNotFound',
  memory_not_found: 'fileNotFound',
  document_not_found: 'fileNotFound',
  not_found: 'fileNotFound',
  // 体积/格式
  workspace_file_too_large: 'fileTooLarge',
  document_too_large: 'documentTooLarge',
  binary_file: 'binaryFile',
  document_unsupported_format: 'unsupportedFormat',
  document_parse_failed: 'parseFailed',
  // 可用性
  storage_unavailable: 'storageUnavailable',
  documents_unavailable: 'documentsUnavailable',
  upstream_timeout: 'timeout',
  analysis_timeout: 'timeout',
  // 复用既有码
  cache_commit_failed: 'storageUnavailable',
  cache_integrity_error: 'storageUnavailable',
  unsupported_media_type: 'unsupportedFormat',
  // 客户端合成码
  network_error: 'storageUnavailable',
  timeout: 'timeout',
};

/**
 * 该码是否已登记本地文案。
 *
 * `agentToolkitCopyKey` 对未知码返回 `internalError`（安全兜底），所以
 * 「已登记」必须单独判定：跨语言契约测试用它把后端 `STATUS` 的每一码都钉住
 * （spec §3.8 闭集 / AC-35）。
 */
export function isKnownToolkitCode(errorCode: string): boolean {
  return Object.prototype.hasOwnProperty.call(CODES, errorCode);
}

export function agentToolkitCopyKey(errorCode: string): CopyKey {
  return Object.prototype.hasOwnProperty.call(CODES, errorCode)
    ? CODES[errorCode] : 'internalError';
}

/** 配置类错误必须能把用户送到能改的那一屏。 */
export function agentToolkitSettingsHint(
  errorCode: string,
): 'settings' | 'models' | null {
  switch (errorCode) {
    case 'analysis_disabled':
    case 'toolkit_disabled':
    case 'workspace_disabled':
    case 'documents_disabled':
    case 'memory_disabled':
    case 'workspace_quota_exceeded':
      return 'settings';
    case 'documents_unavailable':
      return 'models';
    default:
      return null;
  }
}

export function resolveAgentToolkitStatus(input: AgentToolkitStatusInput): {
  key: CopyKey; role: 'status' | 'alert';
  hint: 'settings' | 'models' | null;
} | null {
  const code = input.error_code ?? '';
  if (input.status === 'cancelled' || code === 'cancelled') {
    return { key: 'stopped', role: 'status', hint: null };
  }
  if (!code && input.status !== 'error' && input.success !== false) return null;
  const key = agentToolkitCopyKey(code);
  return {
    key,
    role: input.failure_class === 'user_input' ? 'status' : 'alert',
    hint: agentToolkitSettingsHint(code),
  };
}

/** 工作区条目大小的人读格式（设置面板/卡片共用，避免两份实现）。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
