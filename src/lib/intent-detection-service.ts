/**
 * Intent Detection Service
 * Shared service for detecting user intent and determining if workflow should be called
 * This service can be used directly by API routes without HTTP fetch
 */

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

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

/**
 * Detect user intent by calling the Python backend service
 * @param userMessage - The user's message
 * @param enabledWorkflows - List of enabled workflows
 * @param conversationHistory - Optional conversation history
 * @returns Intent detection result
 */
export async function detectIntent(
  userMessage: string,
  enabledWorkflows: EnabledWorkflow[],
  conversationHistory?: ConversationMessage[]
): Promise<IntentDetectionResult> {
  try {
    console.log('[Intent Detection Service] 开始Fast LLM意图检测:', {
      messagePreview: userMessage.substring(0, 100) + '...',
      messageLength: userMessage.length,
      workflowsCount: enabledWorkflows.length,
      workflows: enabledWorkflows.map(wf => wf.workflow_name).join(', '),
      hasHistory: !!conversationHistory,
      historyLength: conversationHistory?.length || 0,
      backendUrl: BACKEND_URL
    });

    // Validate input
    if (!userMessage || userMessage.trim() === '') {
      console.error('[Intent Detection Service] user_message为空');
      return {
        success: false,
        error: 'user_message is required and cannot be empty'
      };
    }

    if (!enabledWorkflows || !Array.isArray(enabledWorkflows) || enabledWorkflows.length === 0) {
      console.error('[Intent Detection Service] enabled_workflows为空或无效');
      return {
        success: false,
        error: 'enabled_workflows array is required and cannot be empty'
      };
    }

    // Call backend service
    const backendResponse = await fetch(`${BACKEND_URL}/api/intent-detection/detect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_message: userMessage,
        enabled_workflows: enabledWorkflows,
        conversation_history: conversationHistory || null
      }),
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error('[Intent Detection Service] Python后端Fast LLM调用失败:', {
        status: backendResponse.status,
        error: errorText
      });
      return {
        success: false,
        error: `Backend Fast LLM error: ${backendResponse.status}`,
        details: errorText
      };
    }

    const data = await backendResponse.json();

    console.log('[Intent Detection Service] Python后端Fast LLM响应:', {
      success: data.success,
      shouldCallWorkflow: data.data?.should_call_workflow || false,
      workflowName: data.data?.workflow_name || null,
      confidence: data.data?.confidence || 0,
      reasoning: data.data?.reasoning || '',
      error: data.error || null
    });

    return data;

  } catch (error) {
    console.error('[Intent Detection Service] 异常:', error);
    return {
      success: false,
      error: 'Internal server error in intent detection',
      details: error instanceof Error ? error.message : String(error)
    };
  }
}

