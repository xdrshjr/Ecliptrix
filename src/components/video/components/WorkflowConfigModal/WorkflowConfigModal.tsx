'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNotification } from '@/contexts/NotificationContext';
import { loadAgentWorkflows, WorkflowRecord } from '@/lib/api/workflow';
import {
  load as loadWorkflowPrefs,
  save as saveWorkflowPrefs,
} from '@/lib/api/workflowPreferences';
import { VideoEditingLogger } from '../../utils/logger';

/**
 * Workflow configuration stored in memory
 */
export interface WorkflowConfig {
  workflowId: string;
  workflowName: string;
  enabled: boolean;
  toolDescription: string;
  nodes?: any[];
  connections?: any[];
}

interface WorkflowConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
  onSave?: (configs: Map<string, WorkflowConfig>) => void;
}

/**
 * WorkflowConfigModal Component
 * 
 * A modal for configuring workflows to be used in Video Editing tasks.
 * Features:
 * - Left panel: List of all available workflows with multi-select checkboxes
 * - Right panel: Configuration details for selected workflow (tool description, model selection)
 * - Clean, elegant Apple-style UI design
 * - Workflows are loaded from the Workflows task
 * - Configuration is stored in memory
 */
const WorkflowConfigModal: React.FC<WorkflowConfigModalProps> = ({
  isOpen,
  onClose,
  taskId,
  onSave: onSaveCallback,
}) => {
  const { t } = useLocale();
  const { user } = useAuth();
  const { showSuccess, showError } = useNotification();

  // State management
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [workflowConfigs, setWorkflowConfigs] = useState<Map<string, WorkflowConfig>>(new Map());
  const [isLoadingPreferences, setIsLoadingPreferences] = useState<boolean>(false);
  const [isSavingPreferences, setIsSavingPreferences] = useState<boolean>(false);

  const logger = useMemo(
    () => new VideoEditingLogger({ taskId, component: 'WorkflowConfigModal' }),
    [taskId],
  );

  // Load workflows and preferences when modal opens
  useEffect(() => {
    if (isOpen && user?.id) {
      loadWorkflows();
      loadWorkflowPreferences();
    }
  }, [isOpen, user?.id]);

  /**
   * Load workflows from backend
   */
  const loadWorkflows = useCallback(async () => {
    if (!user?.id) {
      logger.warn('No user ID available, skipping workflow load');
      return;
    }

    setIsLoading(true);

    try {
      logger.debug('Loading workflows for user', { userId: user.id });

      const response = await loadAgentWorkflows(user.id);

      if (response.success && response.data) {
        setWorkflows(response.data);

        logger.debug('Workflows loaded successfully', {
          count: response.data.length,
          workflows: response.data.map(w => ({
            id: w.workflow_id,
            name: w.workflow_name
          }))
        });
      } else {
        throw new Error(response.message || 'Failed to load workflows');
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to load workflows', err);
      showError(t.workflowConfigModal.errorLoad);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, showError, t, logger]);

  /**
   * Load workflow preferences from backend
   */
  const loadWorkflowPreferences = useCallback(async () => {
    if (!user?.id) {
      logger.warn('No user ID available, skipping preferences load');
      return;
    }

    setIsLoadingPreferences(true);

    try {
      logger.debug('Loading workflow preferences for user', { userId: user.id });

      const result = await loadWorkflowPrefs(user.id);

      if (result.success && result.preferences) {
        // Convert preferences object to Map
        const preferencesMap = new Map<string, WorkflowConfig>();
        Object.entries(result.preferences).forEach(([key, value]: [string, any]) => {
          // Find the corresponding workflow to get nodes and connections
          const workflow = workflows.find(w => w.workflow_id === value.workflow_id);
          preferencesMap.set(key, {
            workflowId: value.workflow_id,
            workflowName: value.workflow_name,
            enabled: value.is_expanded, // Map is_expanded to enabled
            toolDescription: value.tool_description || '',
            nodes: workflow?.nodes,
            connections: workflow?.connections
          });
        });

        setWorkflowConfigs(preferencesMap);

        logger.debug('Workflow preferences loaded successfully', {
          count: preferencesMap.size,
          expandedCount: Array.from(preferencesMap.values()).filter(c => c.enabled).length,
          configsWithNodes: Array.from(preferencesMap.values()).filter(c => c.nodes && c.nodes.length > 0).length,
        });
      }
    } catch (error) {
      // Don't show error to user for preferences loading - it's not critical.
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to load workflow preferences', err);
    } finally {
      setIsLoadingPreferences(false);
    }
  }, [user?.id, workflows, logger]);

  /**
   * Save workflow preferences to backend
   */
  const saveWorkflowPreferences = useCallback(async (configs: Map<string, WorkflowConfig>) => {
    if (!user?.id) {
      logger.warn('No user ID available, skipping preferences save');
      return;
    }

    setIsSavingPreferences(true);

    try {
      logger.debug('Saving workflow preferences for user', { userId: user.id });

      // Convert Map to object for API
      const preferencesObject: Record<string, any> = {};
      configs.forEach((config, workflowId) => {
        preferencesObject[workflowId] = {
          workflow_id: config.workflowId,
          workflow_name: config.workflowName,
          is_expanded: config.enabled, // Map enabled to is_expanded
          tool_description: config.toolDescription || null
        };
      });

      const result = await saveWorkflowPrefs(user.id, preferencesObject);

      if (result.success) {
        logger.debug('Workflow preferences saved successfully', {
          savedCount: result.saved_count,
        });
      }
    } catch (error) {
      // Don't throw error - preferences save is non-critical.
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to save workflow preferences', err);
    } finally {
      setIsSavingPreferences(false);
    }
  }, [user?.id, logger]);

  /**
   * Handle workflow selection from left panel
   */
  const handleWorkflowSelect = useCallback((workflowId: string) => {
    logger.debug('Workflow selected', { workflowId });
    setSelectedWorkflowId(workflowId);
  }, [logger]);

  /**
   * Handle workflow enable/disable toggle
   */
  const handleWorkflowToggle = useCallback((workflow: WorkflowRecord) => {
    const workflowId = workflow.workflow_id;
    const currentConfig = workflowConfigs.get(workflowId);
    
    if (currentConfig) {
      // Toggle existing config
      const updatedConfig: WorkflowConfig = {
        ...currentConfig,
        enabled: !currentConfig.enabled
      };
      
      const newConfigs = new Map(workflowConfigs);
      newConfigs.set(workflowId, updatedConfig);
      setWorkflowConfigs(newConfigs);

      logger.debug('Workflow toggled', {
        workflowId,
        enabled: updatedConfig.enabled
      });
    } else {
      // Create new config with enabled=true
      // Initialize toolDescription with workflow_description if available
      const newConfig: WorkflowConfig = {
        workflowId,
        workflowName: workflow.workflow_name,
        enabled: true,
        toolDescription: workflow.workflow_description || '',
        nodes: workflow.nodes,
        connections: workflow.connections
      };
      
      const newConfigs = new Map(workflowConfigs);
      newConfigs.set(workflowId, newConfig);
      setWorkflowConfigs(newConfigs);

      logger.debug('New workflow config created', {
        workflowId,
        enabled: true,
        descriptionInitialized: !!workflow.workflow_description,
        descriptionLength: (workflow.workflow_description || '').length,
        nodesCount: workflow.nodes?.length || 0,
        connectionsCount: workflow.connections?.length || 0
      });
    }
  }, [workflowConfigs, logger]);

  /**
   * Handle tool description change
   */
  const handleToolDescriptionChange = useCallback((workflowId: string, description: string) => {
    const currentConfig = workflowConfigs.get(workflowId);
    
    if (currentConfig) {
      // Update existing config
      const updatedConfig: WorkflowConfig = {
        ...currentConfig,
        toolDescription: description
      };
      
      const newConfigs = new Map(workflowConfigs);
      newConfigs.set(workflowId, updatedConfig);
      setWorkflowConfigs(newConfigs);

      logger.debug('Tool description updated', {
        workflowId,
        descriptionLength: description.length,
        configEnabled: currentConfig.enabled
      });
    } else {
      // Create new config with enabled=false if it doesn't exist
      // This allows users to edit description before enabling the workflow
      const workflow = workflows.find(w => w.workflow_id === workflowId);
      
      if (workflow) {
        const newConfig: WorkflowConfig = {
          workflowId,
          workflowName: workflow.workflow_name,
          enabled: false,
          toolDescription: description
        };
        
        const newConfigs = new Map(workflowConfigs);
        newConfigs.set(workflowId, newConfig);
        setWorkflowConfigs(newConfigs);

        logger.debug('New workflow config created (disabled) for description edit', {
          workflowId,
          enabled: false,
          descriptionLength: description.length
        });
      } else {
        logger.warn('Cannot create config: workflow not found', { workflowId });
      }
    }
  }, [workflowConfigs, workflows, logger]);


  /**
   * Handle save configuration
   */
  const handleSave = useCallback(async () => {
    logger.debug('Saving workflow configurations', {
      configsCount: workflowConfigs.size,
      enabledCount: Array.from(workflowConfigs.values()).filter(c => c.enabled).length,
      configs: Array.from(workflowConfigs.entries()).map(([id, config]) => ({
        id,
        name: config.workflowName,
        enabled: config.enabled,
        hasDescription: !!config.toolDescription
      }))
    });

    // Save preferences to backend
    await saveWorkflowPreferences(workflowConfigs);

    // Call the save callback to update parent component
    if (onSaveCallback) {
      onSaveCallback(workflowConfigs);
    }

    // Show success message
    showSuccess(t.workflowConfigModal.successSave);
    onClose();
  }, [workflowConfigs, showSuccess, onClose, t, onSaveCallback, saveWorkflowPreferences, logger]);

  /**
   * Get current config for a workflow
   */
  const getWorkflowConfig = useCallback((workflowId: string): WorkflowConfig | undefined => {
    return workflowConfigs.get(workflowId);
  }, [workflowConfigs]);

  /**
   * Get selected workflow record
   */
  const selectedWorkflow = selectedWorkflowId 
    ? workflows.find(w => w.workflow_id === selectedWorkflowId)
    : null;

  const selectedConfig = selectedWorkflowId 
    ? getWorkflowConfig(selectedWorkflowId)
    : null;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30">
      <div className="bg-card rounded-md w-full max-w-6xl h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-8 py-6 border-b border-border bg-gradient-to-r from-muted to-card">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-foreground">
                {t.workflowConfigModal.title}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {t.workflowConfigModal.subtitle}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors"
              aria-label={t.common.close}
            >
              <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content - Left-Right Layout */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Panel - Workflow List */}
          <div className="w-1/3 border-r border-border bg-muted flex flex-col">
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                {t.workflowConfigModal.workflowListTitle}
              </h3>
              {workflows.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t.workflowConfigModal.workflowCount.replace('{count}', workflows.length.toString())}
                </p>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                    <p className="text-sm text-muted-foreground">{t.workflowConfigModal.loadingWorkflows}</p>
                  </div>
                </div>
              ) : workflows.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center px-6">
                    <div className="w-16 h-16 bg-accent rounded-md mx-auto mb-4 flex items-center justify-center">
                      <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">
                      {t.workflowConfigModal.noWorkflowsAvailable}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.workflowConfigModal.createWorkflowPrompt}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {workflows.map((workflow) => {
                    const config = getWorkflowConfig(workflow.workflow_id);
                    const isEnabled = config?.enabled ?? false;
                    const isSelected = selectedWorkflowId === workflow.workflow_id;
                    
                    return (
                      <div
                        key={workflow.workflow_id}
                        onClick={() => handleWorkflowSelect(workflow.workflow_id)}
                        className={`
                          px-4 py-3 rounded-md cursor-pointer transition-all
                          ${isSelected 
                            ? 'bg-primary/10 border-2 border-primary/20' 
                            : 'bg-card border border-border hover:border-border '
                          }
                        `}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0 mr-3">
                            <h4 className={`text-sm font-medium truncate ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                              {workflow.workflow_name}
                            </h4>
                            {workflow.workflow_description && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {workflow.workflow_description}
                              </p>
                            )}
                            {isEnabled && (
                              <div className="mt-2">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary">
                                  {t.workflowConfigModal.enabledLabel}
                                </span>
                              </div>
                            )}
                          </div>
                          <div 
                            className="flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleWorkflowToggle(workflow);
                            }}
                          >
                            <div className={`
                              relative w-11 h-6 rounded-full transition-colors cursor-pointer flex items-center
                              ${isEnabled ? 'bg-primary/100' : 'bg-accent'}
                            `}>
                              <div className={`
                                absolute w-4 h-4 bg-card rounded-full transition-transform duration-200 ease-in-out
                                ${isEnabled ? 'translate-x-6' : 'translate-x-1'}
                              `} />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Workflow Configuration */}
          <div className="flex-1 flex flex-col bg-card">
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                {t.workflowConfigModal.workflowConfigTitle}
              </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {selectedWorkflow ? (
                <div className="space-y-6">
                  {/* Workflow Name */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      工作流名称
                    </label>
                    <div className="px-4 py-3 bg-muted border border-border rounded-md">
                      <p className="text-sm text-foreground font-medium">
                        {selectedWorkflow.workflow_name}
                      </p>
                    </div>
                  </div>

                  {/* Tool Description */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      {t.workflowConfigModal.toolDescriptionLabel}
                    </label>
                    <textarea
                      value={selectedConfig?.toolDescription ?? selectedWorkflow.workflow_description ?? ''}
                      onChange={(e) => handleToolDescriptionChange(selectedWorkflowId!, e.target.value)}
                      placeholder={t.workflowConfigModal.toolDescriptionPlaceholder}
                      rows={6}
                      className="w-full px-4 py-3 border border-border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary text-sm"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      描述此工作流的功能，让 AI 助手了解何时调用它
                    </p>
                  </div>

                  {/* Workflow Info */}
                  <div className="pt-4 border-t border-border">
                    <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide mb-3">
                      工作流信息
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">节点数量:</span>
                        <span className="text-foreground font-medium">{selectedWorkflow.nodes.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">连接数量:</span>
                        <span className="text-foreground font-medium">{selectedWorkflow.connections.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">版本:</span>
                        <span className="text-foreground font-medium">{selectedWorkflow.version}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center px-6">
                    <div className="w-20 h-20 bg-muted rounded-md mx-auto mb-4 flex items-center justify-center">
                      <svg className="w-10 h-10 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <p className="text-base font-medium text-foreground mb-2">
                      {t.workflowConfigModal.noWorkflowSelected}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t.workflowConfigModal.selectWorkflowPrompt}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-4 border-t border-border bg-muted flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2.5 text-sm font-medium text-foreground bg-card border border-border rounded-md hover:bg-muted transition-colors"
          >
            {t.workflowConfigModal.cancelButton}
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2.5 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 transition-colors"
          >
            {t.workflowConfigModal.saveButton}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkflowConfigModal;

