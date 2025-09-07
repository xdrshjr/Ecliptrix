/**
 * Workflow service for managing creative workflow operations
 */

import { VideoEditingLogger } from '../utils';

export interface UIConfigOption {
  label: string;
  value: any;
  description?: string;
  default?: boolean;
}

export interface UIConfigValidation {
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

export interface UIConfig {
  inputType?: 'text' | 'textarea' | 'number' | 'select' | 'multiselect' | 'slider' | 'toggle';
  options?: UIConfigOption[];
  validation?: UIConfigValidation;
  placeholder?: string;
  helpText?: string;
  defaultValue?: any;
}

export interface WorkflowNodeInfo {
  nodeId: string;
  fieldName: string;
  fieldValue: any;
  description: string;
  uiConfig?: UIConfig;
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
  instanceType?: string;
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
  runninghubTaskId?: string;
  parameters: Record<string, any>;
  timestamp: string;
  netWssUrl?: string;
  clientId?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  timestamp?: string;
  error_code?: string;
  error_details?: any;
}

export interface WorkflowError extends Error {
  errorCode?: string;
  errorDetails?: any;
  timestamp?: string;
  isTaskQueueMaxed?: boolean;
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
        let errorData: any;
        try {
          // Try to parse error response as JSON to get detailed error information
          errorData = await response.json();
        } catch (parseError) {
          // Fallback to text if JSON parsing fails
          const errorText = await response.text();
          errorData = { message: errorText };
        }

        this.logger.error('Failed to execute workflow', {
          workflowId: request.workflowId,
          status: response.status,
          statusText: response.statusText,
          errorData: errorData
        });

        // Create enhanced error with detailed information
        const workflowError: WorkflowError = new Error(
          errorData.message || `Failed to execute workflow: ${response.status} ${response.statusText}`
        ) as WorkflowError;
        
        workflowError.errorCode = errorData.error_code;
        workflowError.errorDetails = errorData.error_details;
        workflowError.timestamp = errorData.timestamp;
        workflowError.isTaskQueueMaxed = errorData.message?.includes('TASK_QUEUE_MAXED') || false;

        // Log specific handling for TASK_QUEUE_MAXED error
        if (workflowError.isTaskQueueMaxed) {
          this.logger.warn('TASK_QUEUE_MAXED error detected in workflow execution', {
            workflowId: request.workflowId,
            errorCode: workflowError.errorCode,
            timestamp: workflowError.timestamp
          });
        }

        throw workflowError;
      }

      const result: ApiResponse<WorkflowExecutionResult> = await response.json();

      if (!result.success) {
        this.logger.error('Workflow execution failed', { 
          workflowId: request.workflowId, 
          message: result.message,
          errorCode: result.error_code,
          timestamp: result.timestamp
        });

        // Create enhanced error for failed workflow execution
        const workflowError: WorkflowError = new Error(result.message || 'Failed to execute workflow') as WorkflowError;
        workflowError.errorCode = result.error_code;
        workflowError.errorDetails = result.error_details;
        workflowError.timestamp = result.timestamp;
        workflowError.isTaskQueueMaxed = result.message?.includes('TASK_QUEUE_MAXED') || false;

        if (workflowError.isTaskQueueMaxed) {
          this.logger.warn('TASK_QUEUE_MAXED error in workflow response', {
            workflowId: request.workflowId,
            errorCode: workflowError.errorCode,
            timestamp: workflowError.timestamp
          });
        }

        throw workflowError;
      }

      this.logger.info('Workflow execution started successfully', { 
        workflowId: request.workflowId,
        status: result.data.status,
        taskId: result.data.taskId,
        runninghubTaskId: result.data.runninghub_task_id
      });
      
      // Convert snake_case to camelCase for frontend consistency
      const executionResult: WorkflowExecutionResult = {
        workflowId: result.data.workflow_id,
        workflowName: result.data.workflow_name,
        status: result.data.status,
        message: result.data.message,
        taskId: result.data.task_id,
        runninghubTaskId: result.data.runninghub_task_id,
        parameters: result.data.parameters,
        timestamp: result.data.timestamp,
        netWssUrl: result.data.net_wss_url,
        clientId: result.data.client_id
      };
      
      return executionResult;

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
   * Check workflow task status
   */
  async checkTaskStatus(runninghubTaskId: string): Promise<{ success: boolean; status: string; message: string }> {
    try {
      this.logger.info('Checking workflow task status', { runninghubTaskId });

      const response = await fetch(`${this.baseUrl}/api/workflow/status/${runninghubTaskId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error('Failed to check task status', {
          runninghubTaskId,
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`Failed to check task status: ${response.status} ${response.statusText}`);
      }

      const result: ApiResponse<any> = await response.json();

      if (!result.success) {
        this.logger.error('Task status check returned error', { runninghubTaskId, message: result.message });
        throw new Error(result.message || 'Failed to check task status');
      }

      this.logger.debug('Task status retrieved successfully', { 
        runninghubTaskId, 
        status: result.data.status 
      });
      
      return {
        success: true,
        status: result.data.status,
        message: result.message
      };

    } catch (error) {
      this.logger.error('Error checking task status', { 
        runninghubTaskId,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Get workflow task results
   */
  async getTaskResults(runninghubTaskId: string): Promise<{ success: boolean; results: any[]; message: string }> {
    try {
      this.logger.info('Getting workflow task results', { runninghubTaskId });

      const response = await fetch(`${this.baseUrl}/api/workflow/results/${runninghubTaskId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error('Failed to get task results', {
          runninghubTaskId,
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`Failed to get task results: ${response.status} ${response.statusText}`);
      }

      const result: ApiResponse<any> = await response.json();

      if (!result.success) {
        this.logger.error('Task results retrieval returned error', { runninghubTaskId, message: result.message });
        throw new Error(result.message || 'Failed to get task results');
      }

      this.logger.info('Task results retrieved successfully', { 
        runninghubTaskId, 
        resultCount: result.data.results?.length || 0
      });
      
      return {
        success: true,
        results: result.data.results || [],
        message: result.message
      };

    } catch (error) {
      this.logger.error('Error getting task results', { 
        runninghubTaskId,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
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