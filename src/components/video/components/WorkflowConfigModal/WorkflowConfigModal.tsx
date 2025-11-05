'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNotification } from '@/contexts/NotificationContext';
import { loadAgentWorkflows, WorkflowRecord } from '@/lib/api/workflow';

/**
 * Workflow configuration stored in memory
 */
export interface WorkflowConfig {
  workflowId: string;
  workflowName: string;
  enabled: boolean;
  toolDescription: string;
}

interface WorkflowConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
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
}) => {
  const { t } = useLocale();
  const { user } = useAuth();
  const { showSuccess, showError } = useNotification();

  // State management
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [workflowConfigs, setWorkflowConfigs] = useState<Map<string, WorkflowConfig>>(new Map());

  console.log('[WorkflowConfigModal] Component rendered:', {
    isOpen,
    taskId,
    workflowsCount: workflows.length,
    selectedWorkflowId,
    configsCount: workflowConfigs.size,
    zIndex: 9999,
    note: 'Modal covers entire screen including taskbar with z-index 9999',
    timestamp: new Date().toISOString()
  });

  // Load workflows when modal opens
  useEffect(() => {
    if (isOpen && user?.id) {
      loadWorkflows();
    }
  }, [isOpen, user?.id]);

  /**
   * Load workflows from backend
   */
  const loadWorkflows = useCallback(async () => {
    if (!user?.id) {
      console.warn('[WorkflowConfigModal] No user ID available, skipping workflow load');
      return;
    }

    setIsLoading(true);
    
    try {
      console.log('[WorkflowConfigModal] Loading workflows for user:', user.id);
      
      const response = await loadAgentWorkflows(user.id);
      
      if (response.success && response.data) {
        setWorkflows(response.data);
        
        console.log('[WorkflowConfigModal] Workflows loaded successfully:', {
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
      console.error('[WorkflowConfigModal] Failed to load workflows:', error);
      showError(t.workflowConfigModal.errorLoad);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, showError, t]);

  /**
   * Handle workflow selection from left panel
   */
  const handleWorkflowSelect = useCallback((workflowId: string) => {
    console.log('[WorkflowConfigModal] Workflow selected:', workflowId);
    setSelectedWorkflowId(workflowId);
  }, []);

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
      
      console.log('[WorkflowConfigModal] Workflow toggled:', {
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
        toolDescription: workflow.workflow_description || ''
      };
      
      const newConfigs = new Map(workflowConfigs);
      newConfigs.set(workflowId, newConfig);
      setWorkflowConfigs(newConfigs);
      
      console.log('[WorkflowConfigModal] New workflow config created:', {
        workflowId,
        enabled: true,
        descriptionInitialized: !!workflow.workflow_description,
        descriptionLength: (workflow.workflow_description || '').length
      });
    }
  }, [workflowConfigs]);

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
      
      console.log('[WorkflowConfigModal] Tool description updated:', {
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
        
        console.log('[WorkflowConfigModal] New workflow config created (disabled) for description edit:', {
          workflowId,
          enabled: false,
          descriptionLength: description.length
        });
      } else {
        console.warn('[WorkflowConfigModal] Cannot create config: workflow not found:', workflowId);
      }
    }
  }, [workflowConfigs, workflows]);


  /**
   * Handle save configuration
   */
  const handleSave = useCallback(() => {
    console.log('[WorkflowConfigModal] Saving workflow configurations:', {
      configsCount: workflowConfigs.size,
      enabledCount: Array.from(workflowConfigs.values()).filter(c => c.enabled).length,
      configs: Array.from(workflowConfigs.entries()).map(([id, config]) => ({
        id,
        name: config.workflowName,
        enabled: config.enabled,
        hasDescription: !!config.toolDescription
      }))
    });
    
    // Store configurations in memory (can be accessed via props or context in future)
    // For now, we'll just show success message
    showSuccess(t.workflowConfigModal.successSave);
    onClose();
  }, [workflowConfigs, showSuccess, onClose, t]);

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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-8 py-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">
                {t.workflowConfigModal.title}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {t.workflowConfigModal.subtitle}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors flex items-center justify-center"
              aria-label="Close"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content - Left-Right Layout */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Panel - Workflow List */}
          <div className="w-1/3 border-r border-gray-100 bg-gray-50/50 flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                {t.workflowConfigModal.workflowListTitle}
              </h3>
              {workflows.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  {t.workflowConfigModal.workflowCount.replace('{count}', workflows.length.toString())}
                </p>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                    <p className="text-sm text-gray-500">{t.workflowConfigModal.loadingWorkflows}</p>
                  </div>
                </div>
              ) : workflows.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center px-6">
                    <div className="w-16 h-16 bg-gray-200 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-gray-900 mb-1">
                      {t.workflowConfigModal.noWorkflowsAvailable}
                    </p>
                    <p className="text-xs text-gray-500">
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
                          px-4 py-3 rounded-xl cursor-pointer transition-all
                          ${isSelected 
                            ? 'bg-blue-50 border-2 border-blue-200 shadow-sm' 
                            : 'bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm'
                          }
                        `}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0 mr-3">
                            <h4 className={`text-sm font-medium truncate ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
                              {workflow.workflow_name}
                            </h4>
                            {workflow.workflow_description && (
                              <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                {workflow.workflow_description}
                              </p>
                            )}
                            {isEnabled && (
                              <div className="mt-2">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-green-100 text-green-800">
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
                              ${isEnabled ? 'bg-blue-500' : 'bg-gray-300'}
                            `}>
                              <div className={`
                                absolute w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ease-in-out
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
          <div className="flex-1 flex flex-col bg-white">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                {t.workflowConfigModal.workflowConfigTitle}
              </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {selectedWorkflow ? (
                <div className="space-y-6">
                  {/* Workflow Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      工作流名称
                    </label>
                    <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl">
                      <p className="text-sm text-gray-900 font-medium">
                        {selectedWorkflow.workflow_name}
                      </p>
                    </div>
                  </div>

                  {/* Tool Description */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t.workflowConfigModal.toolDescriptionLabel}
                    </label>
                    <textarea
                      value={selectedConfig?.toolDescription ?? selectedWorkflow.workflow_description ?? ''}
                      onChange={(e) => handleToolDescriptionChange(selectedWorkflowId!, e.target.value)}
                      placeholder={t.workflowConfigModal.toolDescriptionPlaceholder}
                      rows={6}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    />
                    <p className="text-xs text-gray-500 mt-2">
                      描述此工作流的功能，让 AI 助手了解何时调用它
                    </p>
                  </div>

                  {/* Workflow Info */}
                  <div className="pt-4 border-t border-gray-100">
                    <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">
                      工作流信息
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-500">节点数量:</span>
                        <span className="text-gray-900 font-medium">{selectedWorkflow.nodes.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">连接数量:</span>
                        <span className="text-gray-900 font-medium">{selectedWorkflow.connections.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">版本:</span>
                        <span className="text-gray-900 font-medium">{selectedWorkflow.version}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center px-6">
                    <div className="w-20 h-20 bg-gray-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                      <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <p className="text-base font-medium text-gray-900 mb-2">
                      {t.workflowConfigModal.noWorkflowSelected}
                    </p>
                    <p className="text-sm text-gray-500">
                      {t.workflowConfigModal.selectWorkflowPrompt}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
          >
            {t.workflowConfigModal.cancelButton}
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all shadow-md hover:shadow-lg"
          >
            {t.workflowConfigModal.saveButton}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkflowConfigModal;

