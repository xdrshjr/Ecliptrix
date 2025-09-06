/**
 * FLUX text-to-image generation service
 * Handles API calls to the backend FLUX generation endpoints
 */

import { VideoEditingLogger } from '../utils';

export interface FluxGenerationRequest {
  positive_prompt: string;
  aspect_ratio?: string;
  task_id?: string;
}

export interface FluxGenerationResponse {
  success: boolean;
  task_id: string;
  runninghub_task_id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  message: string;
}

export interface FluxGenerationStatusResponse {
  success: boolean;
  task_id: string;
  runninghub_task_id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  message: string;
}

export interface FluxGenerationResultFile {
  fileUrl: string;
  fileType: string;
  taskCostTime: string;
  nodeId: string;
}

export interface FluxGenerationResultResponse {
  success: boolean;
  task_id: string;
  runninghub_task_id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  results: FluxGenerationResultFile[];
  message: string;
}

export interface FluxGenerationErrorResponse {
  success: false;
  error: string;
  error_code?: string;
  task_id?: string;
}

export type FluxApiResponse<T> = T | FluxGenerationErrorResponse;

export class FluxGenerationService {
  private logger: VideoEditingLogger;
  private baseUrl: string;

  constructor(taskId: string) {
    this.logger = new VideoEditingLogger({
      taskId,
      component: 'FluxGenerationService'
    });
    this.baseUrl = '/api/flux';
  }

  /**
   * Create a new FLUX generation task
   */
  async createGenerationTask(request: FluxGenerationRequest): Promise<FluxApiResponse<FluxGenerationResponse>> {
    try {
      this.logger.info('Creating FLUX generation task', {
        prompt_length: request.positive_prompt.length,
        aspect_ratio: request.aspect_ratio,
        task_id: request.task_id
      });

      const response = await fetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error('FLUX generation API error', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        
        return {
          success: false,
          error: `API request failed: ${response.status} ${response.statusText}`,
          error_code: 'API_ERROR'
        };
      }

      const data = await response.json();
      
      if (!data.success) {
        this.logger.error('FLUX generation failed', {
          error: data.error,
          error_code: data.error_code
        });
        return data as FluxGenerationErrorResponse;
      }

      this.logger.info('FLUX generation task created successfully', {
        task_id: data.task_id,
        runninghub_task_id: data.runninghub_task_id,
        status: data.status
      });

      return data as FluxGenerationResponse;

    } catch (error) {
      this.logger.error('Error creating FLUX generation task', { error: String(error) });
      return {
        success: false,
        error: `Network error: ${String(error)}`,
        error_code: 'NETWORK_ERROR'
      };
    }
  }

  /**
   * Check the status of a FLUX generation task
   */
  async checkTaskStatus(taskId: string, runninghubTaskId: string): Promise<FluxApiResponse<FluxGenerationStatusResponse>> {
    try {
      this.logger.debug('Checking FLUX task status', {
        task_id: taskId,
        runninghub_task_id: runninghubTaskId
      });

      const response = await fetch(
        `${this.baseUrl}/status/${taskId}?runninghub_task_id=${runninghubTaskId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error('FLUX status check API error', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        
        return {
          success: false,
          error: `Status check failed: ${response.status} ${response.statusText}`,
          error_code: 'API_ERROR'
        };
      }

      const data = await response.json();
      
      this.logger.debug('FLUX task status retrieved', {
        task_id: taskId,
        status: data.status,
        success: data.success
      });

      return data as FluxGenerationStatusResponse;

    } catch (error) {
      this.logger.error('Error checking FLUX task status', { 
        task_id: taskId,
        error: String(error) 
      });
      return {
        success: false,
        error: `Network error: ${String(error)}`,
        error_code: 'NETWORK_ERROR'
      };
    }
  }

  /**
   * Get the results of a completed FLUX generation task
   */
  async getTaskResults(taskId: string, runninghubTaskId: string): Promise<FluxApiResponse<FluxGenerationResultResponse>> {
    try {
      this.logger.info('Getting FLUX task results', {
        task_id: taskId,
        runninghub_task_id: runninghubTaskId
      });

      const response = await fetch(
        `${this.baseUrl}/results/${taskId}?runninghub_task_id=${runninghubTaskId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error('FLUX results API error', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        
        return {
          success: false,
          error: `Results retrieval failed: ${response.status} ${response.statusText}`,
          error_code: 'API_ERROR'
        };
      }

      const data = await response.json();
      
      if (!data.success) {
        this.logger.error('FLUX results retrieval failed', {
          error: data.error,
          error_code: data.error_code
        });
        return data as FluxGenerationErrorResponse;
      }

      this.logger.info('FLUX task results retrieved successfully', {
        task_id: taskId,
        results_count: data.results.length
      });

      return data as FluxGenerationResultResponse;

    } catch (error) {
      this.logger.error('Error getting FLUX task results', { 
        task_id: taskId,
        error: String(error) 
      });
      return {
        success: false,
        error: `Network error: ${String(error)}`,
        error_code: 'NETWORK_ERROR'
      };
    }
  }

  /**
   * Poll for task completion with automatic retries
   */
  async pollForCompletion(
    taskId: string, 
    runninghubTaskId: string, 
    options: {
      intervalMs?: number;
      maxAttempts?: number;
      onStatusUpdate?: (status: string) => void;
    } = {}
  ): Promise<FluxApiResponse<FluxGenerationResultResponse>> {
    const { 
      intervalMs = 5000, 
      maxAttempts = 120, // 10 minutes max
      onStatusUpdate 
    } = options;

    this.logger.info('Starting FLUX task polling', {
      task_id: taskId,
      interval_ms: intervalMs,
      max_attempts: maxAttempts
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const statusResponse = await this.checkTaskStatus(taskId, runninghubTaskId);
        
        if (!statusResponse.success) {
          this.logger.error('Status check failed during polling', {
            attempt,
            error: statusResponse.error
          });
          return statusResponse;
        }

        const status = statusResponse.status;
        onStatusUpdate?.(status);

        this.logger.debug('Polling attempt', {
          attempt,
          max_attempts: maxAttempts,
          status
        });

        if (status === 'COMPLETED') {
          this.logger.info('FLUX task completed, getting results', {
            task_id: taskId,
            attempts: attempt
          });
          return await this.getTaskResults(taskId, runninghubTaskId);
        }

        if (status === 'FAILED') {
          this.logger.error('FLUX task failed', {
            task_id: taskId,
            attempts: attempt
          });
          return {
            success: false,
            error: 'Task failed during generation',
            error_code: 'TASK_FAILED'
          };
        }

        // Wait before next poll
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, intervalMs));
        }

      } catch (error) {
        this.logger.error('Error during polling attempt', {
          attempt,
          error: String(error)
        });
        
        if (attempt === maxAttempts) {
          return {
            success: false,
            error: `Polling failed after ${maxAttempts} attempts: ${String(error)}`,
            error_code: 'POLLING_ERROR'
          };
        }
      }
    }

    this.logger.error('FLUX task polling timeout', {
      task_id: taskId,
      max_attempts: maxAttempts
    });

    return {
      success: false,
      error: `Task did not complete within ${maxAttempts} polling attempts`,
      error_code: 'TIMEOUT'
    };
  }
}