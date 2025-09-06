/**
 * Hook for managing AI creation workflow operations
 */

import { useState, useCallback, useEffect } from 'react';
import { workflowService, WorkflowInfo, WorkflowParameter, WorkflowExecutionResult } from '../services/workflowService';
import { VideoEditingLogger } from '../utils';

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
  handleStartCreation: () => Promise<void>;

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
      logger.error('Failed to load workflows', { error: errorMessage });
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
   * Handle start creation
   */
  const handleStartCreation = useCallback(async () => {
    if (!selectedWorkflow) {
      logger.error('No workflow selected for execution');
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
        logger.warning('Parameter validation failed', { errors: validation.errors });
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
        resultTaskId: result.taskId
      });

      // TODO: Handle execution result (e.g., show success message, redirect, etc.)
      // For now, we'll just log the result

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start creation';
      logger.error('Failed to start workflow creation', { 
        workflowId: selectedWorkflow.workflowId,
        error: errorMessage 
      });
      setExecutionError(errorMessage);
    } finally {
      setIsExecuting(false);
    }
  }, [selectedWorkflow, parameters, taskId, logger]);

  // Load workflows when hook is first used
  useEffect(() => {
    if (isModalOpen && workflows.length === 0 && !isLoadingWorkflows) {
      loadWorkflows();
    }
  }, [isModalOpen, workflows.length, isLoadingWorkflows, loadWorkflows]);

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