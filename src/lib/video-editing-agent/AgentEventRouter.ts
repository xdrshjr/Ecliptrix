/**
 * AgentEventRouter — Routes parsed SSE events from SSEStreamManager to the
 * appropriate handlers: AgentStateManager for state updates and
 * OperationApplier for timeline mutations.
 *
 * This class is a pure event dispatcher with no React dependency, making it
 * easy to test in isolation.
 *
 * @module AgentEventRouter
 */

import type { AgentClientApplyError } from '@/types';
import type {
  SSEEvent,
  AgentOperation,
  AgentStreamErrorCode,
  MaterialOperation,
  ScriptOperation,
  StoryboardOperation,
  AsyncTaskOperation,
} from './types';
import type { AgentStateManager } from './AgentStateManager';
import type { ApplyOutcome, OperationApplier } from './OperationApplier';
import { useVideoEditingStore } from '@/stores';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AgentEventRouterConfig {
  stateManager: AgentStateManager;
  operationApplier: OperationApplier;
  /**
   * Optional callback fired after an operation is applied to the timeline.
   * Consumers use this to trigger external timeline update signals
   * (e.g., setExternalTimelineUpdateId).
   */
  onOperationApplied?: (operation: SSEEvent & { type: 'tool_result' }) => void;
  /**
   * Optional callback fired when the stream encounters an error event.
   * This is for SSE-level `error` events, not stream transport errors
   * (those go through SSEStreamManager's onError).
   */
  onError?: (message: string) => void;
  /**
   * Turns an SSE `error` event into the text shown to the user (and stored
   * on the message). The router has no locale, so the consumer localises by
   * `code`; without it the server's raw message is used.
   */
  describeError?: (error: { message: string; code?: AgentStreamErrorCode }) => string;
}

// ---------------------------------------------------------------------------
// AgentEventRouter
// ---------------------------------------------------------------------------

export class AgentEventRouter {
  private readonly stateManager: AgentStateManager;
  private readonly operationApplier: OperationApplier;
  private readonly onOperationApplied?: AgentEventRouterConfig['onOperationApplied'];
  private readonly onError?: AgentEventRouterConfig['onError'];
  private readonly describeError?: AgentEventRouterConfig['describeError'];

  constructor(config: AgentEventRouterConfig) {
    this.stateManager = config.stateManager;
    this.operationApplier = config.operationApplier;
    this.onOperationApplied = config.onOperationApplied;
    this.onError = config.onError;
    this.describeError = config.describeError;
  }

  /**
   * Route a single SSE event to the appropriate handler(s).
   *
   * Event routing:
   *   thinking_start -> StateManager.setThinkingPhase('thinking')
   *   thinking_delta -> StateManager.appendThinkingContent()
   *   thinking_end   -> StateManager.setThinkingPhase('executing')
   *   text_delta     -> StateManager.appendText()
   *   tool_call      -> StateManager.addToolCall()
   *   tool_result    -> StateManager.updateToolStatus() + OperationApplier.apply()
   *   error          -> StateManager.setError()
   *   agent_end      -> StateManager.finalize()
   *   others         -> no-op (lifecycle markers forwarded but no state change)
   */
  async handleEvent(event: SSEEvent): Promise<void> {
    switch (event.type) {
      case 'thinking_start':
        this.stateManager.setThinkingPhase('thinking');
        break;

      case 'thinking_delta':
        this.stateManager.appendThinkingContent(event.content);
        break;

      case 'thinking_end':
        this.stateManager.setThinkingPhase('executing');
        break;

      case 'text_delta':
        this.stateManager.appendText(event.content);
        break;

      case 'tool_call':
        this.stateManager.addToolCall({
          id: event.toolCallId,
          name: event.toolName,
          params: event.params,
          status: 'executing',
        });
        break;

      case 'tool_result':
        await this.handleToolResult(event);
        break;

      case 'error': {
        const text = this.describeError?.({ message: event.message, code: event.code }) ?? event.message;
        this.stateManager.setError(text);
        this.onError?.(text);
        break;
      }

      case 'agent_end':
        this.stateManager.finalize();
        break;

      case 'cancelled':
        // Server-side abort propagated through SSE — seal the in-flight
        // tool calls as `cancelled`. A server timeout was not the user's
        // choice: its `error` event (sent first) explains it, and the turn
        // must not tell the next one "the user stopped you".
        if (event.reason === 'server_timeout') {
          this.stateManager.markCancelled({ appendMarker: false, byUser: false });
          break;
        }
        this.stateManager.markCancelled({
          appendMarker: event.reason === 'client_aborted' || event.reason === 'thinking_aborted',
        });
        break;

      case 'script_delta':
        this.handleScriptDelta(event.content);
        break;

      // Lifecycle markers (agent_start, turn_start, turn_end, message_start,
      // message_end) — no state-manager action needed. The stream lifecycle
      // is handled by SSEStreamManager and useAgentExecutionState.
      default:
        break;
    }
  }

  /**
   * Handle tool_result events: update tool status in state manager,
   * apply any timeline operation, and route non-timeline operations
   * to the appropriate store.
   */
  private async handleToolResult(
    event: SSEEvent & { type: 'tool_result' },
  ): Promise<void> {
    const isError =
      event.result != null &&
      typeof event.result === 'object' &&
      (event.result as Record<string, unknown>).success === false;

    this.stateManager.updateToolStatus(
      event.toolCallId,
      isError ? 'error' : 'completed',
      event.result,
    );

    // Check if the result contains a batch of timeline operations (e.g. from
    // compose_storyboard which adds multiple clips in one tool call). The SSE
    // protocol only carries one operation per tool_result event, but the tool
    // embeds the full array in result.operations for batch application.
    const resultObj = event.result as Record<string, unknown> | null;
    const batchOps = resultObj?.operations;
    if (Array.isArray(batchOps) && batchOps.length > 0 && this.isTimelineOperation(batchOps[0] as AgentOperation)) {
      const operations = batchOps as import('./types').TimelineOperation[];
      // auto_fix_overlaps reports a finished re-pack, not steps to replay.
      const outcome = event.toolName === 'auto_fix_overlaps'
        ? this.operationApplier.applyRepack(operations, event.toolCallId)
        : await this.operationApplier.applyBatch(operations, event.toolCallId);
      if (this.reportRejectedApply(event, outcome)) return;
      this.markIfApplied(event.toolCallId, outcome);
      this.onOperationApplied?.(event);
      return;
    }

    // Route operation to the appropriate handler
    if (event.operation) {
      const op = event.operation;

      if (this.isTimelineOperation(op)) {
        // Timeline operations go through OperationApplier (existing path)
        const outcome = await this.operationApplier.apply(op, event.toolCallId);
        if (this.reportRejectedApply(event, outcome)) return;
        this.markIfApplied(event.toolCallId, outcome);
      } else if (this.isMaterialOperation(op)) {
        // Record pre-state for undo BEFORE applying
        this.operationApplier.recordNonTimelineOperation(op, event.toolCallId);
        this.handleMaterialOperation(op);
      } else if (this.isScriptOperation(op)) {
        this.operationApplier.recordNonTimelineOperation(op, event.toolCallId);
        this.handleScriptOperation(op);
      } else if (this.isStoryboardOperation(op)) {
        this.operationApplier.recordNonTimelineOperation(op, event.toolCallId);
        this.handleStoryboardOperation(op);
      } else if (this.isAsyncTaskOperation(op)) {
        // Async tasks are not undoable but still recorded
        this.operationApplier.recordNonTimelineOperation(op, event.toolCallId);
        this.handleAsyncTaskOperation(op);
      } else {
        console.warn(
          `[AgentEventRouter] Unknown operation type: ${(op as { type: string }).type}`,
        );
      }

      this.onOperationApplied?.(event);
    }
  }

  /**
   * The tool succeeded on the server but its operation could not be applied
   * locally (clip or track gone, invalid time): turn the tool card into an
   * error so the user never sees a success that changed nothing. The reason
   * travels as data; the UI localises it. Returns whether it was rejected.
   */
  private reportRejectedApply(
    event: SSEEvent & { type: 'tool_result' },
    outcome: ApplyOutcome | undefined,
  ): boolean {
    if (outcome?.status !== 'rejected') return false;
    const clientApplyError: AgentClientApplyError = {
      reason: outcome.reason,
      ...(outcome.trackId !== undefined ? { trackId: outcome.trackId } : {}),
      ...(outcome.clipId !== undefined ? { clipId: outcome.clipId } : {}),
    };
    const serverResult =
      event.result !== null && typeof event.result === 'object'
        ? (event.result as Record<string, unknown>)
        : {};
    this.stateManager.updateToolStatus(event.toolCallId, 'error', {
      ...serverResult,
      success: false,
      clientApplyError,
    });
    return true;
  }

  /** Only a step that really changed the timeline can be undone on its own. */
  private markIfApplied(toolCallId: string, outcome: ApplyOutcome | undefined): void {
    if (outcome?.status === 'applied') this.stateManager.markTimelineChanged(toolCallId);
  }

  // -------------------------------------------------------------------------
  // Script delta handler
  // -------------------------------------------------------------------------

  /**
   * Handle streaming script_delta events by appending content to the
   * script store.
   */
  private handleScriptDelta(content: string): void {
    const store = useVideoEditingStore.getState();
    store.appendScriptContent(content);
  }

  // -------------------------------------------------------------------------
  // Operation handlers for non-timeline operations
  // -------------------------------------------------------------------------

  private handleMaterialOperation(op: MaterialOperation): void {
    const store = useVideoEditingStore.getState();
    switch (op.type) {
      case 'add_material':
        store.addMaterial(op.material);
        break;
      case 'add_materials':
        store.addMaterials(op.materials);
        break;
      case 'remove_material':
        store.removeMaterial(op.materialId);
        break;
    }
  }

  private handleScriptOperation(op: ScriptOperation): void {
    const store = useVideoEditingStore.getState();
    switch (op.type) {
      case 'set_script':
        store.setScriptContent(op.content);
        store.setScriptType(op.scriptType as 'video' | 'understanding' | 'ai_generated');
        break;
      case 'append_script':
        store.appendScriptContent(op.content);
        break;
      case 'set_script_with_narration':
        store.setScriptSegmentsData(op.segments);
        store.setScriptType(op.scriptType as 'video' | 'understanding' | 'ai_generated');
        // NOTE: Do NOT set scriptContent here — it would trigger the legacy text-based
        // sync effect in VideoEditingInterface, which would overwrite the structured
        // segments (with narrationText) with plain parsed markdown (without narrationText).
        break;
    }
  }

  private handleStoryboardOperation(op: StoryboardOperation): void {
    const store = useVideoEditingStore.getState();
    switch (op.type) {
      case 'set_storyboards':
        store.setStoryboards(op.storyboards);
        break;
      case 'update_storyboard':
        store.updateStoryboard(op.storyboardId, op.patch);
        break;
    }
  }

  private handleAsyncTaskOperation(op: AsyncTaskOperation): void {
    const store = useVideoEditingStore.getState();
    switch (op.type) {
      case 'start_async_task':
        store.addTask(op.task);
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Type guards
  // -------------------------------------------------------------------------

  private isTimelineOperation(op: AgentOperation): op is import('./types').TimelineOperation {
    return ['add_clip', 'trim_clip', 'delete_clip', 'move_clip', 'resize_clip'].includes(op.type);
  }

  private isMaterialOperation(op: AgentOperation): op is MaterialOperation {
    return ['add_material', 'add_materials', 'remove_material'].includes(op.type);
  }

  private isScriptOperation(op: AgentOperation): op is ScriptOperation {
    return ['set_script', 'append_script', 'set_script_with_narration'].includes(op.type);
  }

  private isStoryboardOperation(op: AgentOperation): op is StoryboardOperation {
    return ['set_storyboards', 'update_storyboard'].includes(op.type);
  }

  private isAsyncTaskOperation(op: AgentOperation): op is AsyncTaskOperation {
    return op.type === 'start_async_task';
  }
}
