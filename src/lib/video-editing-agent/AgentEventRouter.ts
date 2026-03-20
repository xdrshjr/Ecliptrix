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

import type { SSEEvent } from './types';
import type { AgentStateManager } from './AgentStateManager';
import type { OperationApplier } from './OperationApplier';

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
}

// ---------------------------------------------------------------------------
// AgentEventRouter
// ---------------------------------------------------------------------------

export class AgentEventRouter {
  private readonly stateManager: AgentStateManager;
  private readonly operationApplier: OperationApplier;
  private readonly onOperationApplied?: AgentEventRouterConfig['onOperationApplied'];
  private readonly onError?: AgentEventRouterConfig['onError'];

  constructor(config: AgentEventRouterConfig) {
    this.stateManager = config.stateManager;
    this.operationApplier = config.operationApplier;
    this.onOperationApplied = config.onOperationApplied;
    this.onError = config.onError;
  }

  /**
   * Route a single SSE event to the appropriate handler(s).
   *
   * Event routing:
   *   text_delta   -> StateManager.appendText()
   *   tool_call    -> StateManager.addToolCall()
   *   tool_result  -> StateManager.updateToolStatus() + OperationApplier.apply()
   *   error        -> StateManager.setError()
   *   agent_end    -> StateManager.finalize()
   *   others       -> no-op (lifecycle markers forwarded but no state change)
   */
  async handleEvent(event: SSEEvent): Promise<void> {
    switch (event.type) {
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

      case 'error':
        this.stateManager.setError(event.message);
        this.onError?.(event.message);
        break;

      case 'agent_end':
        this.stateManager.finalize();
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
   * apply any timeline operation, and trigger animation callback.
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

    // Apply timeline operation if the tool produced one
    if (event.operation) {
      await this.operationApplier.apply(event.operation, event.toolCallId);
      this.onOperationApplied?.(event);
    }
  }
}
