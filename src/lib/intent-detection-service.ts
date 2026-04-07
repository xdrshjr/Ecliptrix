/**
 * Intent Detection Service (browser-only)
 *
 * Thin wrapper around `http.post('/api/intent-detection/detect', ...)`. After
 * the unified-api-auth-refactor (S06), this file no longer talks to the
 * backend directly — it goes through the Next.js proxy route, which forwards
 * the user's session token via the new HTTP wrapper.
 *
 * IMPORTANT: This module is BROWSER-ONLY. `http-client.ts` throws when
 * imported on the server (`window` is undefined). The two former server-side
 * consumers (`src/app/api/intent-detection/route.ts` and
 * `src/app/api/video-editing-chat/route.ts`) have been migrated per S06 §4.1
 * to call the backend server-to-server via `backendConfig.baseUrl`. Do NOT
 * re-introduce a server-side import of `detectIntent`.
 *
 * Spec: docs/plans/unified-api-auth-refactor/specs/06-direct-browser-call-migration.md §4.1
 */

import { http } from '@/lib/api/http-client';

interface EnabledWorkflow {
  workflow_id: string;
  workflow_name: string;
  tool_description: string;
  enabled: boolean;
}

interface ConversationMessage {
  role: string;
  content: string;
}

interface IntentDetectionResult {
  success: boolean;
  data?: {
    should_call_workflow: boolean;
    workflow_name: string | null;
    workflow_id: string | null;
    confidence: number;
    reasoning: string;
    parameters?: Record<string, any>;
  };
  error?: string;
  details?: string;
}

/**
 * Detect user intent by calling the backend Fast LLM via the Next.js proxy.
 *
 * @param userMessage - The user's message
 * @param enabledWorkflows - List of enabled workflows
 * @param conversationHistory - Optional conversation history
 * @returns Intent detection result
 *
 * Errors from the HTTP wrapper (`MissingAuthError`, `SessionExpiredError`,
 * `ApiError`, `TimeoutError`) propagate to the caller — there is no
 * `{success: false}` envelope wrapping. The pre-flight validation of empty
 * `userMessage` / empty `enabledWorkflows` remains because it is a pure
 * client-side guard, not a network/auth concern.
 */
export async function detectIntent(
  userMessage: string,
  enabledWorkflows: EnabledWorkflow[],
  conversationHistory?: ConversationMessage[]
): Promise<IntentDetectionResult> {
  // Pre-flight validation (pure client-side guard, no network involved).
  if (!userMessage || userMessage.trim() === '') {
    return {
      success: false,
      error: 'user_message is required and cannot be empty',
    };
  }

  if (!enabledWorkflows || !Array.isArray(enabledWorkflows) || enabledWorkflows.length === 0) {
    return {
      success: false,
      error: 'enabled_workflows array is required and cannot be empty',
    };
  }

  return http.post<IntentDetectionResult>('/api/intent-detection/detect', {
    user_message: userMessage,
    enabled_workflows: enabledWorkflows,
    conversation_history: conversationHistory || null,
  });
}
