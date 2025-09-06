/**
 * Hook for managing AI creation workflow operations
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { workflowService, WorkflowInfo, WorkflowParameter, WorkflowExecutionResult } from '../services/workflowService';
import { VideoEditingLogger } from '../utils';
import { MaterialItem } from '@/types';

export interface UseAICreationReturn {
  // Modal state
  isModalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;

  // Workflow data
  workflows: WorkflowInfo[];
  selectedWorkflow: WorkflowInfo | null;
  isLoadingWorkflows: boolean;
  workflowsError: string | null;

  // UI state
  isParameterMode: boolean;
  parameters: Record<string, any>;
  validationErrors: string[];

  // Actions
  handleWorkflowSelect: (workflow: WorkflowInfo) => void;
  handleBackToWorkflows: () => void;
  setParameter: (nodeId: string, value: any) => void;
  handleStartCreation: (addMaterial: (material: MaterialItem) => boolean) => Promise<void>;

  // Execution state
  isExecuting: boolean;
  executionResult: WorkflowExecutionResult | null;
  executionError: string | null;

  // Utility
  taskId: string;
}

export const useAICreation = (taskId: string): UseAICreationReturn => {
  const logger = new VideoEditingLogger({ taskId, component: 'useAICreation' });

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  // Workflow data
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowInfo | null>(null);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState<boolean>(false);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);

  // UI state
  const [isParameterMode, setIsParameterMode] = useState<boolean>(false);
  const [parameters, setParameters] = useState<Record<string, any>>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Execution state
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionResult, setExecutionResult] = useState<WorkflowExecutionResult | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);

  // Task polling state
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentTaskRef = useRef<{ runninghubTaskId: string; addMaterial: (material: MaterialItem) => boolean } | null>(null);

  /**
   * Load available workflows
   */
  const loadWorkflows = useCallback(async () => {
    try {
      logger.info('Loading available workflows');
      setIsLoadingWorkflows(true);
      setWorkflowsError(null);

      const workflowList = await workflowService.getAvailableWorkflows();
      setWorkflows(workflowList);

      logger.info('Successfully loaded workflows', { count: workflowList.length });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load workflows';
      logger.error('Failed to load workflows', new Error(errorMessage));
      setWorkflowsError(errorMessage);
    } finally {
      setIsLoadingWorkflows(false);
    }
  }, [logger]);

  /**
   * Open modal and load workflows
   */
  const openModal = useCallback(() => {
    logger.info('Opening AI creation modal');
    setIsModalOpen(true);
    
    // Reset state
    setSelectedWorkflow(null);
    setIsParameterMode(false);
    setParameters({});
    setValidationErrors([]);
    setExecutionResult(null);
    setExecutionError(null);

    // Load workflows if not already loaded
    if (workflows.length === 0) {
      loadWorkflows();
    }
  }, [logger, workflows.length, loadWorkflows]);

  /**
   * Close modal
   */
  const closeModal = useCallback(() => {
    logger.info('Closing AI creation modal');
    setIsModalOpen(false);
    
    // Reset state
    setSelectedWorkflow(null);
    setIsParameterMode(false);
    setParameters({});
    setValidationErrors([]);
    setExecutionResult(null);
    setExecutionError(null);
  }, [logger]);

  /**
   * Handle workflow selection
   */
  const handleWorkflowSelect = useCallback((workflow: WorkflowInfo) => {
    logger.info('Workflow selected', { 
      workflowId: workflow.workflowId, 
      workflowName: workflow.workflowName 
    });

    setSelectedWorkflow(workflow);
    setIsParameterMode(true);

    // Initialize parameters with default values
    const defaultParams: Record<string, any> = {};
    workflow.nodeInfoList.forEach(nodeInfo => {
      defaultParams[nodeInfo.nodeId] = nodeInfo.fieldValue;
    });
    setParameters(defaultParams);

    // Clear validation errors
    setValidationErrors([]);
  }, [logger]);

  /**
   * Handle back to workflows list
   */
  const handleBackToWorkflows = useCallback(() => {
    logger.info('Returning to workflows list');
    setSelectedWorkflow(null);
    setIsParameterMode(false);
    setParameters({});
    setValidationErrors([]);
    setExecutionResult(null);
    setExecutionError(null);
  }, [logger]);

  /**
   * Set parameter value
   */
  const setParameter = useCallback((nodeId: string, value: any) => {
    logger.debug('Setting parameter', { nodeId, value });
    setParameters(prev => ({
      ...prev,
      [nodeId]: value
    }));

    // Clear validation errors when user changes parameters
    setValidationErrors([]);
  }, [logger]);

  /**
   * Stop task polling
   */
  const stopPolling = useCallback(() => {
    const currentTask = currentTaskRef.current;
    
    if (pollingIntervalRef.current) {
      logger.info('Stopping task status polling', { 
        runninghubTaskId: currentTask?.runninghubTaskId,
        intervalId: pollingIntervalRef.current,
        stopTime: new Date().toISOString()
      });
      
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    
    if (currentTask) {
      logger.info('Clearing current task reference', { 
        runninghubTaskId: currentTask.runninghubTaskId 
      });
    }
    
    currentTaskRef.current = null;
  }, [logger]);

  /**
   * Poll task status until completion
   */
  const pollTaskStatus = useCallback(async (runninghubTaskId: string, addMaterial: (material: MaterialItem) => boolean) => {
    try {
      console.log('🔍 AI Creation - Polling task status', { 
        runninghubTaskId, 
        timestamp: new Date().toISOString() 
      });
      
      logger.info('Polling task status', { runninghubTaskId, timestamp: new Date().toISOString() });

      const statusResult = await workflowService.checkTaskStatus(runninghubTaskId);
      
      console.log('🔍 AI Creation - Raw status result', {
        runninghubTaskId,
        statusResult,
        success: statusResult.success,
        status: statusResult.status,
        timestamp: new Date().toISOString()
      });
      
      if (!statusResult.success) {
        console.error('❌ AI Creation - Status check failed', {
          runninghubTaskId,
          message: statusResult.message,
          statusResult
        });
        logger.error('Failed to check task status during polling', new Error(statusResult.message));
        stopPolling();
        return;
      }

      const status = statusResult.status;
      
      console.log('📊 AI Creation - Task status received', { 
        runninghubTaskId, 
        status, 
        timestamp: new Date().toISOString() 
      });
      
      logger.info('Task status polled', { runninghubTaskId, status, timestamp: new Date().toISOString() });

      // Check if task is completed
      // According to RunningHub API documentation, successful completion status could be various values
      if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'FINISHED' || status === 'DONE') {
        logger.info('Task completed successfully, fetching results', { runninghubTaskId });
        
        try {
          const resultsResponse = await workflowService.getTaskResults(runninghubTaskId);
          
          if (resultsResponse.success && resultsResponse.results.length > 0) {
            logger.info('Task results retrieved successfully', { 
              runninghubTaskId, 
              resultCount: resultsResponse.results.length 
            });

            console.log('🎯 AI Creation - Processing task results', {
              runninghubTaskId,
              resultCount: resultsResponse.results.length,
              results: resultsResponse.results,
              timestamp: new Date().toISOString()
            });

            // Process results and replace the generating material
            for (let i = 0; i < resultsResponse.results.length; i++) {
              const result = resultsResponse.results[i];
              
              // For the first result, replace the generating material (same ID)
              // For additional results, create new materials
              const materialId = i === 0 
                ? `generating_${runninghubTaskId}` // Use same ID as generating material to replace it
                : `ai_creation_${runninghubTaskId}_${result.nodeId || Date.now()}_${i}`;
              
              const material: MaterialItem = {
                id: materialId,
                name: `AI创作结果_${selectedWorkflow?.showNameCh || '未知'}_${new Date().toLocaleString()}${i > 0 ? `_${i + 1}` : ''}`,
                type: selectedWorkflow?.workflowType === 'TEXT-2-VIDEO' ? 'video' : 'image',
                format: result.fileType || (selectedWorkflow?.workflowType === 'TEXT-2-VIDEO' ? 'mp4' : 'png'),
                size: 0, // Size will be determined when downloaded
                url: result.fileUrl,
                serverUrl: result.fileUrl,
                thumbnailUrl: selectedWorkflow?.workflowType === 'TEXT-2-VIDEO' ? undefined : result.fileUrl,
                downloadStatus: 'completed',
                createdAt: new Date(),
                metadata: {
                  workflowId: selectedWorkflow?.workflowId,
                  workflowName: selectedWorkflow?.workflowName,
                  runninghubTaskId: runninghubTaskId,
                  nodeId: result.nodeId,
                  taskCostTime: result.taskCostTime,
                  isAIGenerated: true,
                  isGenerating: false, // Mark as no longer generating
                  generatingStatus: 'completed',
                  originalGeneratingId: `generating_${runninghubTaskId}`,
                  resultIndex: i
                }
              };

              // Add/replace material in the materials panel
              const added = addMaterial(material);
              
              console.log(`🎯 AI Creation - ${i === 0 ? 'Replaced generating' : 'Added additional'} material`, {
                materialId: material.id,
                materialName: material.name,
                materialType: material.type,
                fileUrl: result.fileUrl,
                taskCostTime: result.taskCostTime,
                added,
                isReplacement: i === 0,
                resultIndex: i
              });
              
              logger.info(`AI creation result ${i === 0 ? 'replaced generating' : 'added as additional'} material`, {
                materialId: material.id,
                materialName: material.name,
                materialType: material.type,
                fileUrl: result.fileUrl,
                taskCostTime: result.taskCostTime,
                added,
                isReplacement: i === 0,
                resultIndex: i
              });
            }
          } else {
            logger.warn('Task completed but no results found');
          }
        } catch (error) {
          logger.error('Failed to fetch task results', error instanceof Error ? error : new Error(String(error)));
        }
        
        stopPolling();
      } else if (status === 'FAILED' || status === 'ERROR') {
        logger.error('Task failed', new Error(`Task failed with status: ${status}`), { runninghubTaskId, status });
        
        console.log('❌ AI Creation - Task failed, updating generating material', {
          runninghubTaskId,
          status,
          timestamp: new Date().toISOString()
        });
        
        // Update the generating material to show failed status
        const failedMaterial: MaterialItem = {
          id: `generating_${runninghubTaskId}`, // Use same ID to replace generating material
          name: `AI创作失败 - ${selectedWorkflow?.showNameCh || '未知'}`,
          type: selectedWorkflow?.workflowType === 'TEXT-2-VIDEO' ? 'video' : 'image',
          format: selectedWorkflow?.workflowType === 'TEXT-2-VIDEO' ? 'mp4' : 'png',
          size: 0,
          url: '', // Empty URL for failed state
          downloadStatus: 'error',
          createdAt: new Date(),
          metadata: {
            workflowId: selectedWorkflow?.workflowId,
            workflowName: selectedWorkflow?.workflowName,
            runninghubTaskId: runninghubTaskId,
            isAIGenerated: true,
            isGenerating: false,
            generatingStatus: 'failed',
            errorStatus: status,
            originalGeneratingId: `generating_${runninghubTaskId}`
          }
        };

        // Replace the generating material with failed status
        const updated = addMaterial(failedMaterial);
        
        console.log('❌ AI Creation - Updated generating material to failed status', {
          materialId: failedMaterial.id,
          materialName: failedMaterial.name,
          status,
          updated
        });
        
        logger.info('Updated generating material to failed status', {
          materialId: failedMaterial.id,
          materialName: failedMaterial.name,
          status,
          updated
        });
        
        stopPolling();
      } else {
        // Task is still running (RUNNING, PENDING, etc.)
        console.log('⏳ AI Creation - Task still in progress', {
          runninghubTaskId,
          status,
          timestamp: new Date().toISOString(),
          nextPollIn: '5 seconds'
        });
        
        logger.info('Task still in progress, continuing polling', { 
          runninghubTaskId, 
          status,
          timestamp: new Date().toISOString(),
          nextPollIn: '5 seconds'
        });
        // Continue polling - the interval will call this function again
      }
      
    } catch (error) {
      console.error('❌ AI Creation - Error during polling', {
        runninghubTaskId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      
      logger.error('Error during task status polling', error instanceof Error ? error : new Error(String(error)));
      // Don't stop polling on network errors, just log and continue
      logger.info('Continuing polling despite error - network issues may be temporary');
      
      console.log('⏳ AI Creation - Continuing polling despite error', {
        runninghubTaskId,
        nextPollIn: '5 seconds',
        timestamp: new Date().toISOString()
      });
    }
  }, [logger, selectedWorkflow, stopPolling]);

  /**
   * Start task polling
   */
  const startPolling = useCallback((runninghubTaskId: string, addMaterial: (material: MaterialItem) => boolean) => {
    console.log('🔄 AI Creation - Starting task status polling', { 
      runninghubTaskId, 
      pollingInterval: '5 seconds',
      startTime: new Date().toISOString()
    });
    
    logger.info('Starting task status polling', { 
      runninghubTaskId, 
      pollingInterval: '5 seconds',
      startTime: new Date().toISOString()
    });
    
    currentTaskRef.current = { runninghubTaskId, addMaterial };
    
    // Poll immediately for the first time
    console.log('🔄 AI Creation - Polling immediately (first time)');
    pollTaskStatus(runninghubTaskId, addMaterial);
    
    // Then set up interval to poll every 5 seconds
    console.log('🔄 AI Creation - Setting up polling interval');
    pollingIntervalRef.current = setInterval(() => {
      console.log('🔄 AI Creation - Interval polling triggered', { 
        hasCurrentTask: !!currentTaskRef.current,
        currentTaskId: currentTaskRef.current?.runninghubTaskId,
        timestamp: new Date().toISOString()
      });
      
      if (currentTaskRef.current) {
        logger.debug('Interval polling triggered', { 
          runninghubTaskId: currentTaskRef.current.runninghubTaskId,
          timestamp: new Date().toISOString()
        });
        pollTaskStatus(currentTaskRef.current.runninghubTaskId, currentTaskRef.current.addMaterial);
      } else {
        console.warn('⚠️ AI Creation - Polling interval triggered but no current task found');
        logger.warn('Polling interval triggered but no current task found');
      }
    }, 5000); // Poll every 5 seconds
    
    console.log('✅ AI Creation - Task polling interval established', { 
      runninghubTaskId, 
      intervalId: pollingIntervalRef.current 
    });
    
    logger.info('Task polling interval established', { 
      runninghubTaskId, 
      intervalId: pollingIntervalRef.current 
    });
  }, [logger, pollTaskStatus]);

  /**
   * Handle start creation
   */
  const handleStartCreation = useCallback(async (addMaterial: (material: MaterialItem) => boolean) => {
    if (!selectedWorkflow) {
      logger.error('No workflow selected for execution', new Error('No workflow selected'));
      return;
    }

    try {
      logger.info('Starting workflow creation', { 
        workflowId: selectedWorkflow.workflowId,
        workflowName: selectedWorkflow.workflowName
      });

      // Validate parameters
      const validation = workflowService.validateParameters(selectedWorkflow.nodeInfoList, parameters);
      if (!validation.isValid) {
        logger.warn('Parameter validation failed');
        setValidationErrors(validation.errors);
        return;
      }

      setIsExecuting(true);
      setExecutionError(null);
      setValidationErrors([]);

      // Convert parameters to API format
      const workflowParameters = workflowService.convertNodeInfoToParameters(
        selectedWorkflow.nodeInfoList,
        parameters
      );

      // Execute workflow
      const result = await workflowService.executeWorkflow({
        workflowId: selectedWorkflow.workflowId,
        parameters: workflowParameters,
        taskId: taskId
      });

      setExecutionResult(result);
      logger.info('Workflow execution started successfully', { 
        workflowId: selectedWorkflow.workflowId,
        status: result.status,
        resultTaskId: result.taskId,
        runninghubTaskId: result.runninghubTaskId
      });

      // Add detailed logging for debugging
      console.log('🚀 AI Creation - Workflow execution result:', {
        workflowId: selectedWorkflow.workflowId,
        workflowName: selectedWorkflow.workflowName,
        status: result.status,
        taskId: result.taskId,
        runninghubTaskId: result.runninghubTaskId,
        hasRunninghubTaskId: !!result.runninghubTaskId,
        timestamp: new Date().toISOString()
      });

      // Close modal immediately after starting the task
      setIsModalOpen(false);

      // Add a generating material to the materials panel
      const generatingMaterial: MaterialItem = {
        id: `generating_${result.runninghubTaskId || Date.now()}`,
        name: `正在生成 - ${selectedWorkflow.showNameCh}`,
        type: selectedWorkflow.workflowType === 'TEXT-2-VIDEO' ? 'video' : 'image',
        format: selectedWorkflow.workflowType === 'TEXT-2-VIDEO' ? 'mp4' : 'png',
        size: 0,
        url: '', // Empty URL for generating state
        downloadStatus: 'generating',
        createdAt: new Date(),
        metadata: {
          workflowId: selectedWorkflow.workflowId,
          workflowName: selectedWorkflow.workflowName,
          runninghubTaskId: result.runninghubTaskId,
          isGenerating: true,
          parameters: parameters
        }
      };

      // Add generating material
      addMaterial(generatingMaterial);

      // Start polling for task completion if we have a RunningHub task ID
      if (result.runninghubTaskId) {
        console.log('✅ AI Creation - Starting task polling', {
          runninghubTaskId: result.runninghubTaskId,
          workflowId: selectedWorkflow.workflowId,
          workflowName: selectedWorkflow.workflowName,
          taskId: result.taskId,
          timestamp: new Date().toISOString()
        });
        
        logger.info('Starting task polling after successful workflow execution', {
          workflowId: selectedWorkflow.workflowId,
          workflowName: selectedWorkflow.workflowName,
          runninghubTaskId: result.runninghubTaskId,
          taskId: result.taskId
        });
        startPolling(result.runninghubTaskId, addMaterial);
      } else {
        console.error('❌ AI Creation - No RunningHub task ID received!', {
          workflowId: selectedWorkflow.workflowId,
          executionResult: result,
          resultKeys: Object.keys(result),
          timestamp: new Date().toISOString()
        });
        
        logger.error('No RunningHub task ID received, cannot start polling', new Error('Missing RunningHub task ID'), {
          workflowId: selectedWorkflow.workflowId,
          executionResult: result
        });
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start creation';
      logger.error('Failed to start workflow creation', error instanceof Error ? error : new Error(errorMessage));
      setExecutionError(errorMessage);
    } finally {
      setIsExecuting(false);
    }
  }, [selectedWorkflow, parameters, taskId, logger, startPolling]);

  // Load workflows when hook is first used
  useEffect(() => {
    if (isModalOpen && workflows.length === 0 && !isLoadingWorkflows) {
      loadWorkflows();
    }
  }, [isModalOpen, workflows.length, isLoadingWorkflows, loadWorkflows]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      // Clean up polling when component unmounts
      if (pollingIntervalRef.current) {
        console.log('🧹 AI Creation - Cleaning up polling on unmount', {
          intervalId: pollingIntervalRef.current,
          timestamp: new Date().toISOString()
        });
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      currentTaskRef.current = null;
    };
  }, []); // Empty dependency array - only run on mount/unmount

  return {
    // Modal state
    isModalOpen,
    openModal,
    closeModal,

    // Workflow data
    workflows,
    selectedWorkflow,
    isLoadingWorkflows,
    workflowsError,

    // UI state
    isParameterMode,
    parameters,
    validationErrors,

    // Actions
    handleWorkflowSelect,
    handleBackToWorkflows,
    setParameter,
    handleStartCreation,

    // Execution state
    isExecuting,
    executionResult,
    executionError,

    // Utility
    taskId
  };
};