import type { TimelineState, TimelineItem, Track, MaterialItem, ChatMessage } from '@/types';
import type { StoryboardItem } from '@/stores/slices/storyboardSlice';
import type { AsyncTask } from '@/stores/slices/asyncTaskSlice';

// --- Tool Context ---

export interface ToolContext {
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
   * Session token from the incoming user request, forwarded as an
   * `Authorization: Bearer <token>` header on every internal tool fetch so
   * the downstream Next.js BFF routes (and the backend SessionAuthMiddleware)
   * can identify the caller. Undefined when the incoming request carried no
   * credentials — tools should still run but will likely see 401 from
   * auth-protected routes.
   */
  authToken?: string;
  /** Map of toolCallId → operation produced by that tool call */
  operations: Map<string, AgentOperation>;
  /** Called by tools to record an operation and update local state */
  updateTimeline: (toolCallId: string, operation: TimelineOperation) => void;
  /** Called by tools to record any agent operation (material, script, storyboard, async task) */
  recordOperation: (toolCallId: string, operation: AgentOperation) => void;
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
      material: {
        id: string;
        name: string;
        type: string;
        url: string;
        thumbnailUrl?: string;
      };
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

// --- Unified Agent Operation ---

export type AgentOperation =
  | TimelineOperation
  | MaterialOperation
  | ScriptOperation
  | StoryboardOperation
  | AsyncTaskOperation;

// --- SSE Events (sent from API route to frontend) ---

export type SSEEvent =
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
  | { type: 'error'; message: string };

// --- API Route Request ---

export interface AgentChatRequest {
  messages: ChatMessage[];
  timelineState: TimelineState;
  materials: MaterialItem[];
  /**
   * Session token passed in the request body as a fallback for cases where
   * the Authorization header is lost (observed in some dev/deploy environments).
   * The chat route reads from header first, then falls back to this field.
   */
  sessionToken?: string;
}

// --- Agent Factory Config ---

export interface VideoEditingAgentConfig {
  llmApiUrl: string;
  llmApiKey: string;
  llmModel: string;
  /** Provider type from model settings, used to select API format (e.g. 'kimi_coding', 'anthropic') */
  providerType?: string;
  timelineState: TimelineState;
  materials: MaterialItem[];
  conversationHistory: ChatMessage[];
  /**
   * Base URL for internal API calls. Should point at the local Next.js
   * process via loopback (e.g. "http://127.0.0.1:3088") so tool fetches do
   * not depend on public DNS / nginx / HTTPS being reachable from inside
   * the server container.
   */
  apiBaseUrl: string;
  /**
   * Session token from the incoming request, forwarded to every internal
   * tool fetch so auth-protected BFF routes and the backend
   * SessionAuthMiddleware see the user identity.
   */
  authToken?: string;
}

// Re-export from central types for convenience
export type { AgentToolCallRecord } from '@/types';
