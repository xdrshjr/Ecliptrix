/**
 * Workflow service for managing creative workflow operations
 */

import { VideoEditingLogger } from '../utils';

export interface WorkflowNodeInfo {
  nodeId: string;
  fieldName: string;
  fieldValue: any;
  description: string;
}

export interface WorkflowInfo {
  workflowName: string;
  workflowType: string;
  showNameCh: string;
  showNameEn: string;
  workflowId: string;
  description: string;
  icon: string;
  nodeInfoList: WorkflowNodeInfo[];
}

export interface WorkflowParameter {
  nodeId: string;
  fieldName: string;
  fieldValue: any;
}

export interface WorkflowExecutionRequest {
  workflowId: string;
  parameters: WorkflowParameter[];
  taskId?: string;
}

export interface WorkflowExecutionResult {
  workflowId: string;
  workflowName: string;
  status: string;
  message: string;
  taskId?: string;
  parameters: Record<string, any>;
  timestamp: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

class WorkflowService {
  private baseUrl: string;
  private logger: VideoEditingLogger;

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
    this.logger = new VideoEditingLogger({ component: 'WorkflowService' });
  }

  /**
   * Get all available creative workflows
   */
  async getAvailableWorkflows(): Promise<WorkflowInfo[]> {
    try {
      this.logger.info('Fetching available workflows');

      const response = await fetch(`${this.baseUrl}/api/workflow/list`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error('Failed to fetch workflows', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`Failed to fetch workflows: ${response.status} ${response.statusText}`);
      }

      const result: ApiResponse<WorkflowInfo[]> = await response.json();

      if (!result.success) {
        this.logger.error('API returned error', { message: result.message });
        throw new Error(result.message || 'Failed to fetch workflows');
      }

      this.logger.info('Successfully fetched workflows', { count: result.data.length });
      return result.data;

    } catch (error) {
      this.logger.error('Error fetching workflows', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Get a specific workflow by ID
   */
  async getWorkflowById(workflowId: string): Promise<WorkflowInfo> {
    try {
      this.logger.info('Fetching workflow by ID', { workflowId });

      const response = await fetch(`${this.baseUrl}/api/workflow/${workflowId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error('Failed to fetch workflow', {
          workflowId,
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`Failed to fetch workflow: ${response.status} ${response.statusText}`);
      }

      const result: ApiResponse<WorkflowInfo> = await response.json();

      if (!result.success) {
        this.logger.error('API returned error', { workflowId, message: result.message });
        throw new Error(result.message || 'Failed to fetch workflow');
      }

      this.logger.info('Successfully fetched workflow', { workflowId, workflowName: result.data.workflowName });
      return result.data;

    } catch (error) {
      this.logger.error('Error fetching workflow', { 
        workflowId, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Execute a workflow with provided parameters
   */
  async executeWorkflow(request: WorkflowExecutionRequest): Promise<WorkflowExecutionResult> {
    try {
      this.logger.info('Executing workflow', { 
        workflowId: request.workflowId, 
        parameterCount: request.parameters.length,
        taskId: request.taskId
      });

      const response = await fetch(`${this.baseUrl}/api/workflow/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflow_id: request.workflowId,
          parameters: request.parameters.map(param => ({
            node_id: param.nodeId,
            field_name: param.fieldName,
            field_value: param.fieldValue
          })),
          task_id: request.taskId
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error('Failed to execute workflow', {
          workflowId: request.workflowId,
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`Failed to execute workflow: ${response.status} ${response.statusText}`);
      }

      const result: ApiResponse<WorkflowExecutionResult> = await response.json();

      if (!result.success) {
        this.logger.error('Workflow execution failed', { 
          workflowId: request.workflowId, 
          message: result.message 
        });
        throw new Error(result.message || 'Failed to execute workflow');
      }

      this.logger.info('Workflow execution started successfully', { 
        workflowId: request.workflowId,
        status: result.data.status,
        taskId: result.data.taskId
      });
      
      return result.data;

    } catch (error) {
      this.logger.error('Error executing workflow', { 
        workflowId: request.workflowId,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Check workflow service health
   */
  async checkHealth(): Promise<boolean> {
    try {
      this.logger.info('Checking workflow service health');

      const response = await fetch(`${this.baseUrl}/api/workflow/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const isHealthy = response.ok;
      
      if (isHealthy) {
        const result: ApiResponse<any> = await response.json();
        this.logger.info('Workflow service is healthy', { data: result.data });
      } else {
        this.logger.warning('Workflow service health check failed', {
          status: response.status,
          statusText: response.statusText
        });
      }

      return isHealthy;

    } catch (error) {
      this.logger.error('Error checking workflow service health', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return false;
    }
  }

  /**
   * Convert workflow node info to parameter input format
   */
  convertNodeInfoToParameters(nodeInfoList: WorkflowNodeInfo[], userValues: Record<string, any>): WorkflowParameter[] {
    return nodeInfoList.map(nodeInfo => ({
      nodeId: nodeInfo.nodeId,
      fieldName: nodeInfo.fieldName,
      fieldValue: userValues[nodeInfo.nodeId] !== undefined ? userValues[nodeInfo.nodeId] : nodeInfo.fieldValue
    }));
  }

  /**
   * Validate user parameters against workflow requirements
   */
  validateParameters(nodeInfoList: WorkflowNodeInfo[], userValues: Record<string, any>): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const nodeInfo of nodeInfoList) {
      const userValue = userValues[nodeInfo.nodeId];
      
      // Check if required fields are provided (basic validation)
      if (nodeInfo.fieldName === 'text' || nodeInfo.fieldName === 'prompt') {
        if (!userValue || (typeof userValue === 'string' && userValue.trim() === '')) {
          errors.push(`${nodeInfo.description} 不能为空`);
        }
      }

      // Add more validation rules as needed
      if (nodeInfo.fieldName === 'value' && userValue !== undefined) {
        const numValue = Number(userValue);
        if (isNaN(numValue) || numValue <= 0) {
          errors.push(`${nodeInfo.description} 必须是正数`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

// Export singleton instance
export const workflowService = new WorkflowService();