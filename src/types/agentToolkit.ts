/**
 * Agent Toolkit 前端形状（plan / ask / workspace / documents / analysis / memory）。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §5.3。
 *
 * 刻意**不**改 `ChatMessage` / `AgentToolCallRecord`：计划与提问都从既有的
 * `agentToolCalls` 记录派生，不新增持久化字段（否则会出现第二份真相）。
 */

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface PlanStep {
  index: number;
  title: string;
  status: PlanStepStatus;
}

export interface AgentPlan {
  planId: string;
  steps: PlanStep[];
  activeStep: number | null;
  doneCount: number;
  total: number;
  note?: string;
}

export interface AskUserOption {
  label: string;
  description?: string;
}

export interface AskUserQuestion {
  questionId: string;
  question: string;
  options: AskUserOption[];
  allowFreeText: boolean;
  status: 'awaiting' | 'answered' | 'unanswered';
}

export type WorkspaceEntryKind = 'text' | 'csv' | 'image' | 'media' | 'other';

export interface WorkspaceEntry {
  name: string;
  bytes: number;
  mtime: string;
  kind: WorkspaceEntryKind;
}

/** 文档走独立数组，`kind` 里**没有** `'document'`（§3.3.1 R-08）。 */
export interface DocumentEntry {
  documentId: string;
  name: string;
  pages: number;
  chars: number;
  createdAt: string;
}

export interface WorkspaceListing {
  files: WorkspaceEntry[];
  documents: DocumentEntry[];
  totalFiles: number;
  totalBytes: number;
  quotaBytes: number;
  truncated: boolean;
}

export interface AnalysisResult {
  status: 'ok' | 'error' | 'timeout';
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  files: Array<{ name: string; bytes: number; kind: string }>;
  truncated: boolean;
}

export interface MemoryEntry {
  id: string;
  kind: 'fact' | 'preference' | 'decision';
  text: string;
  tags: string[];
  scope: 'project' | 'global';
  hitCount: number;
  updatedAt: string;
  expiresAt: string | null;
}

export interface AgentToolkitLimits {
  maxFileMb: number;
  documentMaxPages: number;
  documentMaxChars: number;
  analysisTimeoutSeconds: number;
}

export interface AgentToolkitCapabilitySegment {
  available: boolean;
  enabled: boolean;
  error_code?: string;
}

export interface AgentToolkitCapabilities {
  workspace: AgentToolkitCapabilitySegment & {
    root_label: string;
    used_bytes: number;
    quota_bytes: number;
    used_by_kind: Record<string, number>;
  };
  documents: AgentToolkitCapabilitySegment & { formats: string[] };
  analysis: AgentToolkitCapabilitySegment;
  memory: AgentToolkitCapabilitySegment & { entries: Record<string, number> };
  limits: {
    max_file_mb: number;
    document_max_pages: number;
    document_max_chars: number;
    analysis_timeout_seconds: number;
  };
}

export interface AgentToolkitUsage {
  workspace_bytes: number;
  workspace_quota_bytes: number;
  used_by_kind: Record<string, number>;
  documents: number;
  memories: Record<string, number>;
}

/** `ToolContext.turnState` —— 本轮状态，每个请求新建，绝不跨轮复用。 */
export interface ToolkitTurnState {
  plan?: AgentPlan;
  askedQuestionId?: string;
}

/** 计划/提问卡片与工具结果共用的工具名谓词集合。 */
export const TOOLKIT_WORKSPACE_TOOLS = [
  'workspace_list', 'workspace_read', 'workspace_write', 'workspace_delete',
  'workspace_import_material',
] as const;

export const TOOLKIT_DOCUMENT_TOOLS = ['read_document'] as const;
export const TOOLKIT_ANALYSIS_TOOLS = ['run_analysis'] as const;
export const TOOLKIT_MEMORY_TOOLS = [
  'memory_write', 'memory_search', 'memory_forget',
] as const;
export const TOOLKIT_PLAN_TOOLS = ['update_plan'] as const;
export const TOOLKIT_ASK_TOOLS = ['ask_user'] as const;

export function isPlanTool(name: string): boolean {
  return (TOOLKIT_PLAN_TOOLS as readonly string[]).includes(name);
}

export function isAskUserTool(name: string): boolean {
  return (TOOLKIT_ASK_TOOLS as readonly string[]).includes(name);
}

/** 三张卡片共用的分发谓词（与 web 研究卡的 `isWebResearchTool` 同形）。 */
export function isToolkitTool(name: string): boolean {
  return isPlanTool(name) || isAskUserTool(name)
    || (TOOLKIT_WORKSPACE_TOOLS as readonly string[]).includes(name)
    || (TOOLKIT_DOCUMENT_TOOLS as readonly string[]).includes(name)
    || (TOOLKIT_ANALYSIS_TOOLS as readonly string[]).includes(name)
    || (TOOLKIT_MEMORY_TOOLS as readonly string[]).includes(name);
}

/** 回答一条 `ask_user` 时使用的消息前缀（服务端不解析，只用于识别）。 */
export const ASK_ANSWER_PREFIX = '[[ask:';
export const DOC_REF_PREFIX = '[[doc:';

export function askAnswerMessage(questionId: string, answer: string): string {
  return `${ASK_ANSWER_PREFIX}${questionId}]] ${answer}`;
}

export function documentRefMessage(documentId: string, name: string): string {
  return `${DOC_REF_PREFIX}${documentId}]] ${name}`;
}

export function parseAskAnswer(content: string): string | null {
  if (!content.startsWith(ASK_ANSWER_PREFIX)) return null;
  const end = content.indexOf(']]');
  if (end < 0) return null;
  return content.slice(ASK_ANSWER_PREFIX.length, end) || null;
}
