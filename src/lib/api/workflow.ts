/**
 * Workflow API service
 * Handles agent workflow persistence operations
 */

import { WorkflowNode, WorkflowConnection } from '@/types';

// API Types
export interface SaveWorkflowRequest {
  user_id: string;
  workflow_id: string;
  workflow_name: string;
  workflow_description?: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
}

export interface WorkflowRecord {
  id: string;
  user_id: string;
  workflow_id: string;
  workflow_name: string;
  workflow_description?: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  is_active: boolean;
  is_template: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  last_executed_at?: string;
}

export interface SaveWorkflowResponse {
  success: boolean;
  message: string;
  data: WorkflowRecord;
}

export interface LoadWorkflowsResponse {
  success: boolean;
  message: string;
  data: WorkflowRecord[];
}

export interface DeleteWorkflowResponse {
  success: boolean;
  message: string;
  data: {
    workflow_id: string;
  };
}

/**
 * Save an agent workflow to the backend
 * @param request SaveWorkflowRequest containing workflow data
 * @returns Promise<SaveWorkflowResponse> Saved workflow data
 */
export async function saveAgentWorkflow(
  request: SaveWorkflowRequest
): Promise<SaveWorkflowResponse> {
  try {
    console.log('[Workflow API] Saving agent workflow:', {
      workflow_id: request.workflow_id,
      workflow_name: request.workflow_name,
      nodes_count: request.nodes.length,
      connections_count: request.connections.length,
    });

    const response = await fetch('/api/workflow/agent/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail || errorData.message || `HTTP error! status: ${response.status}`
      );
    }

    const data: SaveWorkflowResponse = await response.json();

    if (!data.success) {
      throw new Error(data.message || 'Failed to save workflow');
    }

    console.log('[Workflow API] Workflow saved successfully:', {
      workflow_id: data.data.workflow_id,
      version: data.data.version,
    });

    return data;
  } catch (error) {
    console.error('[Workflow API] Failed to save workflow:', error);
    throw error;
  }
}

/**
 * Load all agent workflows for a user
 * @param userId User ID to load workflows for
 * @returns Promise<LoadWorkflowsResponse> List of workflows
 */
export async function loadAgentWorkflows(
  userId: string
): Promise<LoadWorkflowsResponse> {
  try {
    console.log('[Workflow API] Loading agent workflows for user:', userId);

    const response = await fetch(`/api/workflow/agent/load/${userId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail || errorData.message || `HTTP error! status: ${response.status}`
      );
    }

    const data: LoadWorkflowsResponse = await response.json();

    if (!data.success) {
      throw new Error(data.message || 'Failed to load workflows');
    }

    console.log('[Workflow API] Workflows loaded successfully:', {
      count: data.data.length,
    });

    return data;
  } catch (error) {
    console.error('[Workflow API] Failed to load workflows:', error);
    throw error;
  }
}

/**
 * Delete an agent workflow
 * @param userId User ID who owns the workflow
 * @param workflowId Workflow ID to delete
 * @returns Promise<DeleteWorkflowResponse> Deletion result
 */
export async function deleteAgentWorkflow(
  userId: string,
  workflowId: string
): Promise<DeleteWorkflowResponse> {
  try {
    console.log('[Workflow API] Deleting agent workflow:', {
      user_id: userId,
      workflow_id: workflowId,
    });

    const response = await fetch(`/api/workflow/agent/delete/${userId}/${workflowId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail || errorData.message || `HTTP error! status: ${response.status}`
      );
    }

    const data: DeleteWorkflowResponse = await response.json();

    if (!data.success) {
      throw new Error(data.message || 'Failed to delete workflow');
    }

    console.log('[Workflow API] Workflow deleted successfully:', {
      workflow_id: workflowId,
    });

    return data;
  } catch (error) {
    console.error('[Workflow API] Failed to delete workflow:', error);
    throw error;
  }
}

