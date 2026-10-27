import type { TimelineState, TimelineItem, Track, MaterialItem, ChatMessage, AgentMaterialData } from '@/types';
import type { StoryboardItem } from '@/stores/slices/storyboardSlice';
import type { AsyncTask } from '@/stores/slices/asyncTaskSlice';
import type { TtsFailure } from '@/lib/ttsErrors';
import type { ResearchRunClient } from '@/lib/server/researchRunClient';
import type { ToolkitTurnState } from '@/types/agentToolkit';
import type { SkillIndexEntry } from '@/types/agentSkills';

// --- Tool Context ---

export interface ToolContext {
  researchRun?: ResearchRunClient;
  timelineState: TimelineState;
  materials: MaterialItem[];
  /**
   * Base URL for internal API calls. In production this is a loopback URL
   * (e.g. "http://127.0.0.1:3088") pointing at the local Next.js process, so
   * that server-side tool fetches bypass nginx/HTTPS and do not hairpin
   * through the public domain.
   */
  apiBaseUrl: string;
  /**
   * Owning project id when the agent is invoked from a project-bound editor
   * mount (the normal case post project-isolation refactor). Tools that
   * touch project-scoped backend resources (e.g. storyboard packs) must
   * forward this field; tools without an active project should refuse with
   * a structured error rather than fall back to a global call.
   */
  projectId?: string;
  /**
   * 最近一次成功导出的 composition id（agent-visual-review spec §4.4 / P1-1）。
   *
   * Agent 没有导出工具，所以 `inspect_export` 与 `source:'export'` 的唯一 id
   * 来源就是这里：导出 hook 在 `status === 'completed'` 时记录，随请求透传到
   * chat 路由，再注入本上下文。**它只是定位线索，不是权限凭证**——后端仍要
   * 过 `get_download_info()` 的状态与存在性校验。
   */
  lastCompositionId?: string;
  /**
   * AbortSignal that fires when the route-wide abort is triggered (client
   * disconnect, server timeout, or user-clicked Stop). Tools that issue
   * `fetch()` MUST forward this signal so in-flight requests tear down
   * along with the agent loop; tools wrapping a synchronous SDK should
   * race their await against this signal so the tool function returns
   * promptly even if the SDK has no native cancel API.
   */
  abortSignal?: AbortSignal;
  /** Map of toolCallId → operation produced by that tool call */
  operations: Map<string, AgentOperation>;
  /** Called by tools to record an operation and update local state */
  updateTimeline: (toolCallId: string, operation: TimelineOperation) => void;
  /** Called by tools to record any agent operation (material, script, storyboard, async task) */
  recordOperation: (toolCallId: string, operation: AgentOperation) => void;
  /**
   * Per-request agent-toolkit state. A fresh object is created on every
   * `createVideoEditingAgent` call, so an SSE retry (a new request) naturally
   * resets the "one ask per turn" rule — nothing here is persisted.
   */
  turnState: ToolkitTurnState;
  /**
   * Narrow window onto `ToolActivationState.load` for `use_skill`: it lets a
   * skill preload the tools it names without exposing the whole activation
   * object to tools. Throws the same errors as `load`
   * (`invalid_tool_selection` / `tool_schema_budget`). Absent in contexts
   * built outside `createVideoEditingAgent` (unit tests).
   */
  loadTools?: (category: string, names: string[]) => { loaded: string[] };
  /** Capability availability for skill `requires` (false = known unavailable). */
  skillAvailability?: Partial<Record<string, boolean>>;
}

// --- Timeline Operations (produced by tools, applied by frontend) ---

export type TimelineOperation =
  | {
      type: 'add_clip';
      clip: {
        id: string;
        materialId: string;
        trackId: string;
        startTime: number;
        duration: number;
        clipStart: number;
        clipEnd: number;
        originalDuration: number;
        volume: number;
      };
      /** Playback snapshot (`toAgentClipMaterial`): the clip keeps previewing
       *  after its material leaves the library. */
      material: AgentMaterialData;
    }
  | {
      type: 'trim_clip';
      clipId: string;
      clipStart: number;
      clipEnd: number;
      duration: number;
    }
  | {
      type: 'delete_clip';
      clipId: string;
      trackId: string;
    }
  | {
      type: 'move_clip';
      clipId: string;
      fromTrackId: string;
      toTrackId: string;
      newStartTime: number;
    }
  | {
      type: 'resize_clip';
      clipId: string;
      newDuration: number;
      /** New out-point (clipStart + newDuration). Omitted for images. */
      clipEnd?: number;
    };

// --- Material Operations ---

export type MaterialOperation =
  | { type: 'add_material'; material: MaterialItem }
  | { type: 'add_materials'; materials: MaterialItem[] }
  | { type: 'remove_material'; materialId: string };

// --- Script Operations ---

export type ScriptOperation =
  | { type: 'set_script'; content: string; scriptType: string }
  | { type: 'append_script'; content: string }
  | { type: 'set_script_with_narration'; segments: Array<{ title: string; scriptText: string; narrationText: string }>; scriptType: string };

// --- Storyboard Operations ---

export type StoryboardOperation =
  | { type: 'set_storyboards'; storyboards: StoryboardItem[] }
  | { type: 'update_storyboard'; storyboardId: string; patch: Record<string, unknown> };

// --- Async Task Operations ---

export type AsyncTaskOperation =
  | { type: 'start_async_task'; task: AsyncTask };

type CoverOperationBase = {
  type: 'cover_action';
  projectId: string;
  operationId: string;
  durationFrames: number;
  applyWhenReady: boolean;
}

export type CoverOperation = CoverOperationBase & (
  | { action: 'watch_job'; jobId: string; draftVersion: number }
  | { action: 'prepare_draft'; draftVersion: number }
  | { action: 'apply_revision'; revisionId: string }
);

export interface CoverOperationStatus {
  state: 'submitted' | 'image_ready' | 'applying' | 'applied'
    | 'not_applied' | 'error' | 'cancel_unconfirmed';
  jobId?: string;
  projectId?: string;
  revisionId?: string;
  thumbnailUrl?: string;
  error?: string;
}

export const COVER_CARD_ACTION_EVENT = 'ecliptrix:cover-action';
export interface CoverCardActionDetail {
  projectId: string;
  operationId: string;
  action: 'edit' | 'apply' | 'locate';
  revisionId?: string;
}

/** Project-mounted controller owns baselines, cancellation and rendering. */
export interface CoverAgentBridge {
  beginOperation: (toolCallId: string, toolName: string,
    onStatus?: (status: CoverOperationStatus) => void) => void;
  handleCoverOperation: (
    operation: CoverOperation,
    onStatus: (status: CoverOperationStatus) => void,
  ) => void | Promise<void>;
  cancelOperations: (options: {
    cancelJobs: boolean; operationIds?: string[];
  }) => void;
}

// --- Unified Agent Operation ---

export type AgentOperation =
  | TimelineOperation
  | MaterialOperation
  | ScriptOperation
  | StoryboardOperation
  | AsyncTaskOperation
  | CoverOperation;

// --- SSE Events (sent from API route to frontend) ---

/**
 * Why an agent run failed, carried on SSE `error` events so the client can
 * show a localised, actionable message. Older clients ignore it and show
 * `message`.
 */
export type AgentStreamErrorCode =
  | 'provider_auth'
  | 'provider_rate_limit'
  | 'context_overflow'
  /** The local byte/token budget refused before any provider request. */
  | 'context_budget_exceeded'
  /** On-demand tool schemas exceeded the 48 KiB disclosure cap. */
  | 'tool_schema_budget'
  /** The turn hit its model-call ceiling (runaway loop guard). */
  | 'model_call_limit'
  /** The turn hit its tool-call ceiling (runaway loop guard). */
  | 'tool_call_limit'
  | 'provider_error'
  | 'empty_response'
  | 'server_timeout'
  /** The circuit breaker stopped the run after consecutive tool failures. */
  | 'tool_failures'
  /** The route failed outside the model request; `message` is the detail. */
  | 'agent_error';

export type SSEEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; content: string }
  | { type: 'thinking_end' }
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'turn_start' }
  | { type: 'turn_end' }
  | { type: 'message_start' }
  | { type: 'message_end' }
  | { type: 'text_delta'; content: string }
  | {
      type: 'tool_call';
      toolCallId: string;
      toolName: string;
      params: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      toolCallId: string;
      toolName: string;
      result: unknown;
      operation: AgentOperation | null;
    }
  | { type: 'script_delta'; content: string }
  | {
      type: 'error'; message: string; code?: AgentStreamErrorCode;
      cause?: TtsFailure;
    }
  | {
      type: 'cancelled';
      reason: 'client_aborted' | 'server_timeout' | 'thinking_aborted';
      timestamp?: number;
    }
  /** The run is registered and can receive steers (precedes `agent_start`). */
  | { type: 'run_started'; runId: string }
  /** A mid-run steer reached the model; `afterToolCallId` null = turn start. */
  | { type: 'steer_applied'; steerId: string; afterToolCallId: string | null }
  /** Steers still undelivered when the turn completed (completed path only). */
  | { type: 'steer_dropped'; steerIds: string[] }
  /** The requested skill could not be loaded; the turn ran without it. */
  | { type: 'skill_skipped'; skillId: string; reason: SkillSkipReason };

export type SkillSkipReason = 'not_found' | 'disabled' | 'invalid' | 'unavailable';

// --- API Route Request ---

export interface AgentChatRequest {
  messages: ChatMessage[];
  timelineState: TimelineState;
  materials: MaterialItem[];
  /** Owning project id of the editor session that fired this request.
   *  Forwarded into the agent's ToolContext so project-scoped tools (e.g.
   *  storyboard pack creation) include it on backend calls. */
  projectId?: string;
  /** Exported composition the next inspect_export call should probe. */
  lastCompositionId?: string;
  /** Skill the user picked with `/`; its body rides along with this turn only. */
  skillId?: string;
  /** Materials the user referenced with `@`; validated server-side. */
  mentions?: Array<{ materialId: string; label: string }>;
}

/**
 * The four capability segments `/capabilities` answers. Kept structural so the
 * agent never depends on the transport module (server-only).
 */
export interface WebCapabilitySegment {
  available: boolean;
  enabled?: boolean;
  configured?: boolean;
  error_code?: string;
}

export interface WebCapabilitySnapshot {
  search: WebCapabilitySegment;
  browser: WebCapabilitySegment;
  downloads: WebCapabilitySegment;
}

// --- Agent Factory Config ---

export interface VideoEditingAgentConfig {
  researchRun?: ResearchRunClient;
  contextWindowTokens?: number;
  /** Network capability snapshot, rendered into the on-demand catalog (§13). */
  webCapabilities?: WebCapabilitySnapshot | null;
  llmApiUrl: string;
  llmApiKey: string;
  llmModel: string;
  /** Provider type from model settings, used to select API format (e.g. 'kimi_coding', 'anthropic') */
  providerType?: string;
  /**
   * Explicit API protocol from `model_providers.api_format` ('openai' | 'anthropic').
   * Takes precedence over providerType — needed for custom providers (e.g. a
   * GLM provider pointed at an Anthropic-compatible endpoint) where
   * providerType='custom' carries no protocol hint.
   */
  apiType?: 'openai' | 'anthropic';
  timelineState: TimelineState;
  materials: MaterialItem[];
  /**
   * Full conversation history for this turn, including the latest user
   * message at the tail. The history drives two surfaces inside
   * `createVideoEditingAgent`:
   *
   *   1. **Message replay** — every entry except the trailing user message
   *      is converted via `convertToAgentMessages` and seeded into the
   *      pi-agent-core `Agent` so the LLM sees the same `assistant` /
   *      `toolResult` pairs the user already saw.
   *   2. **Explored-categories appendix** — `scanExploredCategories`
   *      walks the same array to find any advanced tool categories the
   *      user previously loaded via `explore_tools`. Those categories'
   *      expanded blocks are then re-injected into the L0 system prompt
   *      so the agent does not "forget how the tools work" on later turns
   *      (spec: docs/plans/video-agent-prompt-persistence/spec.md §2.3).
   */
  conversationHistory: ChatMessage[];
  /**
   * Base URL for internal API calls. Should point at the local Next.js
   * process via loopback (e.g. "http://127.0.0.1:3088") so tool fetches do
   * not depend on public DNS / nginx / HTTPS being reachable from inside
   * the server container.
   */
  apiBaseUrl: string;
  /**
   * Owning project id forwarded from the user's editor session. Tools that
   * call project-scoped backend resources rely on this to pass project_id
   * along; absence means the user is not inside a project and such tools
   * should refuse with an actionable error.
   */
  projectId?: string;
  /**
   * Id of the most recent successful export, forwarded from the editor so
   * `inspect_export` does not need the user to copy an id by hand
   * (agent-visual-review spec §4.4 / P1-1). Purely a locator — the backend
   * still validates it against the settled-composition window.
   */
  lastCompositionId?: string;
  /**
   * Auto-injected long-term memory digest (<=800 chars, <=5 entries). Pulled by
   * `route.ts` with a 1.5s timeout before the agent is created; a failure just
   * means an empty digest, never a blocked turn.
   */
  memoryDigest?: { text: string; count: number } | null;
  /** Enabled skills for the L0 "可用技能" section; empty/absent renders nothing. */
  skillIndex?: SkillIndexEntry[];
}

// Re-export from central types for convenience
export type { AgentToolCallRecord } from '@/types';
