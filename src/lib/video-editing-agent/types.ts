import type { TimelineState, TimelineItem, Track, MaterialItem, ChatMessage } from '@/types';

// --- Tool Context ---

export interface ToolContext {
  timelineState: TimelineState;
  materials: MaterialItem[];
  /** Map of toolCallId → operation produced by that tool call */
  operations: Map<string, TimelineOperation>;
  /** Called by tools to record an operation and update local state */
  updateTimeline: (toolCallId: string, operation: TimelineOperation) => void;
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
      operation: TimelineOperation | null;
    }
  | { type: 'error'; message: string };

// --- API Route Request ---

export interface AgentChatRequest {
  messages: ChatMessage[];
  timelineState: TimelineState;
  materials: MaterialItem[];
}

// --- Agent Factory Config ---

export interface VideoEditingAgentConfig {
  llmApiUrl: string;
  llmApiKey: string;
  llmModel: string;
  timelineState: TimelineState;
  materials: MaterialItem[];
  conversationHistory: ChatMessage[];
}

// Re-export from central types for convenience
export type { AgentToolCallRecord } from '@/types';
