import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import type { TimelineState } from '@/types';
import type { ToolContext, TimelineOperation, SSEEvent, VideoEditingAgentConfig } from './types';
import { buildSystemPrompt } from './systemPrompt';
import { convertToAgentMessages } from './messageConverter';
import { buildVideoEditingTools } from './tools';

/**
 * Create a video editing agent instance with all tools and configuration.
 * Returns the agent and the shared tool context (for reading operations after tool execution).
 */
export function createVideoEditingAgent(config: VideoEditingAgentConfig): {
  agent: Agent;
  toolContext: ToolContext;
} {
  // 1. Construct Model for custom OpenAI-compatible endpoint
  const model: Model<'openai-completions'> = {
    id: config.llmModel,
    name: config.llmModel,
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: config.llmApiUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };

  // 2. Deep-clone timelineState so tool mutations don't affect caller
  const localTimelineState: TimelineState = JSON.parse(JSON.stringify(config.timelineState));

  // 3. Create shared tool context
  const toolContext: ToolContext = {
    timelineState: localTimelineState,
    materials: config.materials,
    operations: new Map(),
    updateTimeline: (toolCallId: string, operation: TimelineOperation) => {
      toolContext.operations.set(toolCallId, operation);
      applyOperationLocally(toolContext.timelineState, operation);
    },
  };

  // 4. Build tools
  const tools = buildVideoEditingTools(toolContext);

  // 5. Convert conversation history (exclude last user message — it goes to agent.prompt())
  const history = config.conversationHistory.slice(0, -1);
  const initialMessages = convertToAgentMessages(history);

  // 6. Create Agent
  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(config.timelineState),
      model,
      thinkingLevel: 'off',
      tools,
      messages: initialMessages,
    },
    getApiKey: () => config.llmApiKey,
  });

  return { agent, toolContext };
}

/**
 * Subscribe to agent events and forward them as SSE events.
 */
export function subscribeAgentEvents(
  agent: Agent,
  toolContext: ToolContext,
  send: (data: SSEEvent) => void
): () => void {
  return agent.subscribe((event: AgentEvent) => {
    switch (event.type) {
      case 'agent_start':
        send({ type: 'agent_start' });
        break;

      case 'agent_end':
        send({ type: 'agent_end' });
        break;

      case 'turn_start':
        send({ type: 'turn_start' });
        break;

      case 'turn_end':
        send({ type: 'turn_end' });
        break;

      case 'message_start':
        send({ type: 'message_start' });
        break;

      case 'message_end':
        send({ type: 'message_end' });
        break;

      case 'message_update': {
        const evt = event.assistantMessageEvent;
        if (evt.type === 'text_delta') {
          send({ type: 'text_delta', content: evt.delta });
        }
        break;
      }

      case 'tool_execution_start':
        send({
          type: 'tool_call',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          params: event.args ?? {},
        });
        break;

      case 'tool_execution_end': {
        // Don't send operation if the tool errored
        const operation = event.isError
          ? null
          : (toolContext.operations.get(event.toolCallId) ?? null);
        // event.result is AgentToolResult = { content, details }
        const details = event.result?.details ?? event.result;

        send({
          type: 'tool_result',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: details,
          operation,
        });
        break;
      }
    }
  });
}

/**
 * Apply an operation to the local timeline state copy so subsequent tools see consistent state.
 */
function applyOperationLocally(state: TimelineState, operation: TimelineOperation): void {
  switch (operation.type) {
    case 'add_clip': {
      const track = state.tracks.find(t => t.id === operation.clip.trackId);
      if (track) {
        track.items.push({
          id: operation.clip.id,
          name: operation.material.name,
          type: track.type,
          startTime: operation.clip.startTime,
          duration: operation.clip.duration,
          trackId: operation.clip.trackId,
          color: '',
          materialId: operation.clip.materialId,
          clipStart: operation.clip.clipStart,
          clipEnd: operation.clip.clipEnd,
          originalDuration: operation.clip.originalDuration,
          volume: operation.clip.volume,
        });
      }
      break;
    }

    case 'trim_clip': {
      for (const track of state.tracks) {
        const clip = track.items.find(i => i.id === operation.clipId);
        if (clip) {
          clip.clipStart = operation.clipStart;
          clip.clipEnd = operation.clipEnd;
          clip.duration = operation.duration;
          break;
        }
      }
      break;
    }

    case 'delete_clip': {
      const track = state.tracks.find(t => t.id === operation.trackId);
      if (track) {
        track.items = track.items.filter(i => i.id !== operation.clipId);
      }
      break;
    }

    case 'move_clip': {
      const fromTrack = state.tracks.find(t => t.id === operation.fromTrackId);
      const toTrack = state.tracks.find(t => t.id === operation.toTrackId);
      if (fromTrack && toTrack) {
        const idx = fromTrack.items.findIndex(i => i.id === operation.clipId);
        if (idx !== -1) {
          const [clip] = fromTrack.items.splice(idx, 1);
          clip.startTime = operation.newStartTime;
          clip.trackId = operation.toTrackId;
          toTrack.items.push(clip);
        }
      } else if (fromTrack) {
        // toTrack not found — update position in place without moving
        const clip = fromTrack.items.find(i => i.id === operation.clipId);
        if (clip) {
          clip.startTime = operation.newStartTime;
        }
      }
      break;
    }

    case 'resize_clip': {
      for (const track of state.tracks) {
        const clip = track.items.find(i => i.id === operation.clipId);
        if (clip) {
          clip.duration = operation.newDuration;
          break;
        }
      }
      break;
    }
  }
}
