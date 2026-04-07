/**
 * Workflow API service
 * Handles agent workflow persistence operations
 */

import { http } from '@/lib/api/http-client';
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
 * Save an agent workflow to the backend.
 */
export async function saveAgentWorkflow(
  request: SaveWorkflowRequest,
): Promise<SaveWorkflowResponse> {
  const data = await http.post<SaveWorkflowResponse>(
    '/api/workflow/agent/save',
    request,
  );

  if (!data.success) {
    throw new Error(data.message || 'Failed to save workflow');
  }

  return data;
}

/**
 * Load all agent workflows for a user.
 */
export async function loadAgentWorkflows(
  userId: string,
): Promise<LoadWorkflowsResponse> {
  const data = await http.get<LoadWorkflowsResponse>(
    `/api/workflow/agent/load/${userId}`,
  );

  if (!data.success) {
    throw new Error(data.message || 'Failed to load workflows');
  }

  return data;
}

/**
 * Delete an agent workflow.
 */
export async function deleteAgentWorkflow(
  userId: string,
  workflowId: string,
): Promise<DeleteWorkflowResponse> {
  const data = await http.del<DeleteWorkflowResponse>(
    `/api/workflow/agent/delete/${userId}/${workflowId}`,
  );

  if (!data.success) {
    throw new Error(data.message || 'Failed to delete workflow');
  }

  return data;
}
