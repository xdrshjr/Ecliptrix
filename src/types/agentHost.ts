/**
 * Agent host（本机 shell / 文件 / 通用联网）的前端类型视图。
 *
 * 设计基线：docs/plans/agent-general-assistant/spec.md §6（REST 契约）与
 * §7.2（内存形状）。
 *
 * **后端一律说 snake_case**（`timeout_s`、`max_output_kb`、`read_roots`…），
 * 这个文件描述的是**前端阅读视角的 camelCase**。归一化只发生在
 * `@/lib/server/agentHostSnapshot`（能力快照），它是本文件唯一被真实数据填充的
 * 类型来源：`HostCapabilitySnapshot` 及其子类型由该助手逐字段转换后注入
 * `ToolContext.hostCapabilities`。
 *
 * 其余 `*Request` / `*Result` 接口是 §6 REST 契约的**阅读视图**，不是线上
 * 形状：工具适配器把模型参数按后端的 snake_case 原样下发，并把后端 `data`
 * 原样回传（`hostToolAdapter` 只裁长度、不改键名）。要发真实请求请看 §6 的
 * snake_case 表，不要照这里的 camelCase 拼请求体。
 *
 * 本文件刻意**零依赖**（不 import 任何模块），因为它会被客户端组件引用。
 */

/** shell 作用域：`workspace` 只决定默认 cwd，不是沙箱。 */
export type AgentHostScope = 'workspace' | 'host';

/** 出口策略档位（spec §4.1）。 */
export type AgentHostEgressMode = 'strict' | 'balanced' | 'open';

/** `diagnose_url` 的判定层，按判定顺序排列。 */
export type AgentHostEgressLayer =
  | 'url' | 'policy' | 'proxy' | 'dns' | 'robots';

/** `download_url` 的入库品类；没有 `file`（spec §4.3.1）。 */
export type AgentHostDownloadKind = 'image' | 'media';

/** 目录/匹配项类型。 */
export type AgentHostEntryType = 'file' | 'dir' | 'symlink' | 'other';

/** 解析后的出口摘要；`target` 已剥掉 userinfo，只有 `scheme://host:port`。 */
export interface AgentHostProxySummary {
  mode: 'auto' | 'direct' | 'custom' | (string & {});
  resolvedFrom: 'settings' | 'env' | 'system' | 'direct' | 'invalid' |
    (string & {});
  target: string;
}

export interface AgentHostShellCapability {
  enabled: boolean;
  scope: AgentHostScope;
  /** 后端 `shell_timeout_s`；1–600。 */
  timeoutSeconds: number;
  /** 后端 `shell_max_output_kb`；每路（stdout/stderr 各一份）。 */
  maxOutputKb: number;
}

export interface AgentHostFsCapability {
  enabled: boolean;
  /** 单次读取页上限（`fs_max_bytes`）。 */
  maxBytes: number;
  readRoots: string[];
  writeRoots: string[];
}

export interface AgentHostEgressCapability {
  enabled: boolean;
  mode: AgentHostEgressMode;
  proxy: AgentHostProxySummary;
  /** 单次响应体上限（`egress_max_bytes`）。 */
  maxBytes: number;
  /** 每回合调用上限（`egress_max_per_turn`，前端记账）。 */
  maxPerTurn: number;
  /** 每分钟调用上限（`egress_max_per_minute`，后端限流）。 */
  maxPerMinute: number;
}

export interface AgentHostLimits {
  maxConcurrency: number;
}

/**
 * `GET /capabilities` 的归一化结果（spec §7.2）。
 *
 * `enabled=false` 是**正常快照**（总开关关闭），不是失败；只有探测本身
 * 失败或形状坏掉时 `agentHostSnapshot()` 才返回 `null`。
 */
export interface HostCapabilitySnapshot {
  enabled: boolean;
  shell: AgentHostShellCapability;
  fs: AgentHostFsCapability;
  egress: AgentHostEgressCapability;
  limits?: AgentHostLimits;
}

/** `POST /shell/run`（超时 1000–600000，越界由 BFF 判 400）。 */
export interface ShellRunRequest {
  projectId?: string;
  /** ≤8000 字符。 */
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

/**
 * `ShellResult`（spec §4.4）。
 *
 * 非 0 `exitCode` 是**正常结果**，不是错误；只有 `spawnFailed` 与
 * `killed`（超时被杀）需要单独措辞。
 */
export interface ShellResultData {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
  cwd: string;
  killed: boolean;
  /** 实际解释器回显（Windows 是 `cmd.exe`，POSIX 是 `/bin/sh`）。 */
  shell: string;
  spawnFailed?: string;
}

export interface FsReadRequest {
  projectId?: string;
  path: string;
  /** 字节偏移，与 `workspace_store.byte_page()` 同义。 */
  offset?: number;
  maxBytes?: number;
  scope?: AgentHostScope;
}

export interface FsReadResult {
  path: string;
  content: string;
  offset: number;
  nextOffset: number | null;
  truncated: boolean;
  binary: boolean;
  /** 本次实际覆盖的行数。 */
  lines: number;
}

export interface FsWriteRequest {
  projectId?: string;
  path: string;
  content: string;
  scope?: AgentHostScope;
  createParents?: boolean;
}

export interface FsWriteResult {
  path: string;
  bytes: number;
  created: boolean;
}

export interface FsEditRequest {
  projectId?: string;
  path: string;
  /** 必须恰好出现一次，否则 409 `edit_not_unique` 且不落盘。 */
  oldString: string;
  newString: string;
  replaceAll?: boolean;
  scope?: AgentHostScope;
}

export interface FsEditResult {
  path: string;
  replacements: number;
  /** 统一 diff 预览，≤4 KiB。 */
  diff: string;
  bytes: number;
}

export interface FsListRequest {
  projectId?: string;
  path: string;
  scope?: AgentHostScope;
}

export interface AgentHostDirEntry {
  name: string;
  type: AgentHostEntryType;
  size: number;
}

export interface FsListResult {
  path: string;
  entries: AgentHostDirEntry[];
  truncated: boolean;
}

export interface FsGlobRequest {
  projectId?: string;
  pattern: string;
  cwd?: string;
  scope?: AgentHostScope;
}

export interface AgentHostGlobMatch {
  path: string;
  type: AgentHostEntryType;
  size: number;
  /** 后端可能给 epoch 毫秒或 ISO 文本；前端只用来排序展示。 */
  mtime: number | string;
}

export interface FsGlobResult {
  matches: AgentHostGlobMatch[];
  truncated: boolean;
}

export interface FsGrepRequest {
  projectId?: string;
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  scope?: AgentHostScope;
}

export interface AgentHostGrepHit {
  path: string;
  line: number;
  text: string;
}

export interface FsGrepResult {
  hits: AgentHostGrepHit[];
  filesScanned: number;
  truncated: boolean;
}

/** `POST /egress/request`：只有 GET/HEAD，没有请求体（spec §4.3.1）。 */
export interface EgressRequestPayload {
  method: 'GET' | 'HEAD';
  url: string;
  /** 只有 `accept` / `accept-language` 会被后端采纳。 */
  headers?: Record<string, string>;
  maxBytes?: number;
  timeoutMs?: number;
  allowRobots?: boolean;
}

export interface EgressResponseData {
  status: number;
  headers: Record<string, string>;
  bodyBase64?: string;
  bodyText?: string;
  truncated: boolean;
  finalUrl: string;
  /** 被拒/降级时的码，与 §7.3 同一套取值。 */
  reason?: string;
}

export interface EgressDownloadRequest {
  url: string;
  name?: string;
  kind: AgentHostDownloadKind;
  sourcePageUrl?: string;
  importToLibrary?: boolean;
}

/** 素材来源（复用既有 provenance 语义，字段可为空）。 */
export interface AgentHostMaterialProvenance {
  sourcePageUrl?: string;
  finalUrl?: string;
  title?: string;
  author?: string | null;
  licenseStatus?: 'unknown' | 'declared';
  licenseUrl?: string | null;
  retrievedAt?: string;
  /** 落盘文件的摘要；与 `size=0` 同级的"真的拿到了字节"证据。 */
  sha256?: string;
  artifactId?: string | null;
}

export interface AgentHostMaterial {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio';
  format: string;
  /** 必须 > 0；`size=0` 一律判失败（spec §4.6）。 */
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  localUrl: string;
  provenance: AgentHostMaterialProvenance;
}

export interface EgressDownloadResult {
  status: 'ready';
  reused: boolean;
  material: AgentHostMaterial;
}

export interface EgressDiagnoseRequest {
  url: string;
  /** 是否真的做一次 `getaddrinfo`（5 s 上限）。 */
  resolve?: boolean;
  checkRobots?: boolean;
}

export interface EgressDiagnosisCheck {
  name: string;
  ok: boolean;
  /** 允许 `skipped (proxy)` / `skipped (check_robots:false)`。 */
  detail: string;
}

/** `POST /egress/diagnose`（spec §7.2）。 */
export interface EgressDiagnosis {
  allowed: boolean;
  url: string;
  host: string;
  mode: AgentHostEgressMode;
  layer: AgentHostEgressLayer;
  reason?: string;
  remediation?: string;
  checks: EgressDiagnosisCheck[];
}

/** `GET /audit?limit=N` 的一条事件；命令原文只有 sha256。 */
export interface AgentHostAuditEntry {
  at: string;
  event: string;
  projectId: string | null;
  commandSha256?: string;
  exitCode?: number | null;
  durationMs?: number;
}

export interface AgentHostAuditResult {
  entries: AgentHostAuditEntry[];
  truncated: boolean;
}
