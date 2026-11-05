/**
 * Agent host 错误码 → 本地文案键的**唯一**映射。
 *
 * 设计基线：docs/plans/agent-general-assistant/spec.md §7.3。
 * 与 `agentToolkitStatus.ts` 同一纪律：只返回本地白名单键，后端/供应商的
 * 原始文本永远不直接展示；未登记码一律回退到通用兜底码的文案。
 *
 * 文案本体由 i18n 侧提供在顶层 `agentHost.errors.*`（spec §4.9），键名就是
 * 错误码本身（snake_case，见 `src/lib/i18n.ts` 的 `BEGIN/END agentHost`）。
 * 本文件只**引用**键，不复制任何一句用户可见文本，也不修改 `i18n.ts`。
 */

/**
 * `agentHost.errors.*` 下的键名：**本域真实会抛、且值得给用户一句人话**的码。
 *
 * 不是 `agent_toolkit_models.STATUS` 的全集——那份表被跨域合并进来后有上百个
 * 码（含 toolkit / research / 供应商域），把它们全部搬进文案表既维护不动，
 * 也会把"模板文案"和"这些码真的会到这里"混为一谈。清单的守门测试是
 * `__tests__/agentHostStatus.test.ts`：它照 Python 侧的 `LOCAL_STATUS` 抄，
 * 少一个就红。
 */
export type AgentHostErrorKey =
  | 'shell_disabled'
  | 'shell_busy'
  | 'shell_spawn_failed'
  | 'path_forbidden'
  | 'edit_not_unique'
  | 'host_file_too_large'
  | 'fs_disabled'
  | 'not_found'
  | 'invalid_argument'
  | 'egress_disabled'
  | 'egress_budget_exceeded'
  | 'egress_rate_limited'
  | 'http_write_unsupported'
  | 'proxy_config_invalid'
  | 'dns_answer_non_global'
  | 'dns_no_answer'
  | 'port_not_allowed'
  | 'invalid_url'
  | 'binary_file'
  | 'workspace_file_too_large'
  | 'workspace_quota_exceeded'
  | 'material_not_materialized'
  | 'material_not_ready'
  | 'download_failed'
  | 'unsupported_media_type'
  | 'url_forbidden';

/** `messageKey()` 的返回值前缀，与 i18n 顶层命名空间一致。 */
const MESSAGE_PREFIX = 'agentHost.errors.';

/**
 * 未登记码的兜底键。
 *
 * `url_forbidden` 是本域既有的**通用兜底码**（spec §7.3 末尾），文案也确实是
 * 「策略阻止了那个 URL」这一层含义，比新造一个 `internalError` 更诚实。
 */
const FALLBACK_KEY: AgentHostErrorKey = 'url_forbidden';

/**
 * 逐码登记：§7.3 的每个新码都必须在这里出现。
 *
 * 键与码同名不是"没做映射"，而是契约本身：i18n 侧按码建键，跨语言契约测试
 * 用 `isKnownAgentHostCode()` 把后端 `STATUS` 的每一码都钉住。
 */
const CODES: Record<string, AgentHostErrorKey> = {
  // 本机命令（§4.4）
  shell_disabled: 'shell_disabled',
  shell_busy: 'shell_busy',
  shell_spawn_failed: 'shell_spawn_failed',
  // 文件（§4.5）
  path_forbidden: 'path_forbidden',
  edit_not_unique: 'edit_not_unique',
  host_file_too_large: 'host_file_too_large',
  fs_disabled: 'fs_disabled',
  not_found: 'not_found',
  invalid_argument: 'invalid_argument',
  binary_file: 'binary_file',
  workspace_file_too_large: 'workspace_file_too_large',
  workspace_quota_exceeded: 'workspace_quota_exceeded',
  // 出口（§4.1 / §4.3）
  egress_disabled: 'egress_disabled',
  egress_budget_exceeded: 'egress_budget_exceeded',
  egress_rate_limited: 'egress_rate_limited',
  http_write_unsupported: 'http_write_unsupported',
  proxy_config_invalid: 'proxy_config_invalid',
  dns_answer_non_global: 'dns_answer_non_global',
  dns_no_answer: 'dns_no_answer',
  port_not_allowed: 'port_not_allowed',
  invalid_url: 'invalid_url',
  download_failed: 'download_failed',
  unsupported_media_type: 'unsupported_media_type',
  url_forbidden: 'url_forbidden',
  // 素材
  material_not_materialized: 'material_not_materialized',
  material_not_ready: 'material_not_ready',
};

/**
 * 该码是否已登记本地文案。
 *
 * `messageKey()` 对未知码返回兜底键，所以「已登记」必须单独判定：跨语言
 * 契约测试用它把后端 `STATUS` 的每一码都钉住（同 `isKnownToolkitCode`）。
 */
export function isKnownAgentHostCode(errorCode: string): boolean {
  return Object.prototype.hasOwnProperty.call(CODES, errorCode);
}

/**
 * 错误码 → `agentHost.errors.*` 的完整键路径。
 *
 * @param errorCode 后端 `error_code`（snake_case）
 * @returns 形如 `agentHost.errors.shell_disabled`；未知码为
 *   `agentHost.errors.url_forbidden`
 */
export function messageKey(errorCode: string): string {
  const key = Object.prototype.hasOwnProperty.call(CODES, errorCode)
    ? CODES[errorCode] : FALLBACK_KEY;
  return `${MESSAGE_PREFIX}${key}`;
}
