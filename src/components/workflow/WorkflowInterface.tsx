'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { WorkflowTaskContent, WorkflowNode, WorkflowConnection, WorkflowExecutionState } from '@/types';
import WorkflowSidebar from './WorkflowSidebar';
import WorkflowCanvas from './WorkflowCanvas';
import WorkflowLogPanel from './WorkflowLogPanel';
import WorkflowChatInterface from './WorkflowChatInterface';
import { WorkflowExecutor } from './WorkflowExecutor';
import { useAuth } from '@/contexts/AuthContext';
import { useNotification } from '@/contexts/NotificationContext';
import { saveAgentWorkflow, loadAgentWorkflows, deleteAgentWorkflow } from '@/lib/api/workflow';

interface WorkflowInterfaceProps {
  taskId: string;
  content: WorkflowTaskContent | null;
  onUpdateContent: (content: WorkflowTaskContent) => void;
}

type RightPanelTab = 'chat' | 'workflow';

/**
 * Workflow Interface Component
 * Main container with 20/80 layout (sidebar/canvas)
 * Manages workflow state and provides drag-and-drop workflow editor
 */
const WorkflowInterface: React.FC<WorkflowInterfaceProps> = ({
  taskId,
  content,
  onUpdateContent,
}) => {
  console.log('[WorkflowInterface] Rendering interface:', {
    taskId,
    hasContent: !!content,
    workflowsCount: content?.workflows?.length || 0,
    activeWorkflowId: content?.activeWorkflowId,
    timestamp: new Date().toISOString()
  });

  // Get auth and notification contexts
  const { user, isAuthenticated } = useAuth();
  const notification = useNotification();

  // Right panel tab state
  const [activeRightTab, setActiveRightTab] = useState<RightPanelTab>('chat');

  // Workflow execution state
  const [executionState, setExecutionState] = useState<WorkflowExecutionState>({
    isRunning: false,
    currentNodeId: null,
    nodeStates: {},
    logs: [],
  });
  const [workflowExecutor, setWorkflowExecutor] = useState<WorkflowExecutor | null>(null);
  
  // Chat messages state - 在父组件中管理，避免切换标签页时丢失
  // 为每个工作流维护独立的聊天记录和上下文
  const [workflowChatStates, setWorkflowChatStates] = useState<Record<string, {
    messages: any[];
    contextCleared: boolean; // 标记上下文是否已清空
  }>>({});
  
  // User input state for workflow execution
  const [currentUserInput, setCurrentUserInput] = useState<string | null>(null);
  
  // Save state
  const [isSaving, setIsSaving] = useState(false);

  // Auto-load workflows from database on mount
  useEffect(() => {
    const loadWorkflows = async () => {
      if (!isAuthenticated || !user) {
        console.log('[WorkflowInterface] User not authenticated, skipping workflow load');
        return;
      }

      try {
        console.log('[WorkflowInterface] Loading workflows for user:', user.id);
        
        const response = await loadAgentWorkflows(user.id);
        
        if (response.success && response.data.length > 0) {
          console.log('[WorkflowInterface] Loaded workflows:', response.data.length);
          
          // Convert loaded workflows to WorkflowTaskContent format
          const workflows = response.data.map(record => ({
            id: record.workflow_id,
            name: record.workflow_name,
            data: {
              name: record.workflow_name,
              description: record.workflow_description || '',
              nodes: record.nodes,
              connections: record.connections,
            },
          }));
          
          const loadedContent: WorkflowTaskContent = {
            activeWorkflowId: workflows[0].id,
            workflows,
          };
          
          console.log('[WorkflowInterface] Setting loaded workflows as content');
          onUpdateContent(loadedContent);
          
          notification.showSuccess(`Loaded ${workflows.length} workflow(s)`, 2000);
        } else {
          console.log('[WorkflowInterface] No workflows found, initializing default');
          initializeDefaultContent();
        }
      } catch (error) {
        console.error('[WorkflowInterface] Error loading workflows:', error);
        notification.showError('Failed to load workflows', 3000);
        initializeDefaultContent();
      }
    };

    const initializeDefaultContent = () => {
      if (!content) {
        console.log('[WorkflowInterface] Initializing default workflow content');
        
        const defaultContent: WorkflowTaskContent = {
          activeWorkflowId: 'search-chat-agent',
          workflows: [
            {
              id: 'search-chat-agent',
              name: 'Search Chat Agent',
              data: {
                name: 'Search Chat Agent',
                description: 'AI agent for searching and chatting',
                nodes: [],
                connections: [],
              },
            },
          ],
        };
        
        onUpdateContent(defaultContent);
      }
    };

    // Load workflows only on initial mount
    if (!content) {
      loadWorkflows();
    }
  }, [isAuthenticated, user]); // Only run when auth state changes

  // Get active workflow
  const activeWorkflow = content?.workflows.find(
    w => w.id === content.activeWorkflowId
  );

  console.log('[WorkflowInterface] Active workflow:', {
    activeWorkflowId: content?.activeWorkflowId,
    activeWorkflowName: activeWorkflow?.name,
    nodesCount: activeWorkflow?.data.nodes.length || 0
  });

  // Get or initialize chat state for active workflow
  const activeWorkflowId = content?.activeWorkflowId || '';
  const activeChatState = workflowChatStates[activeWorkflowId] || { messages: [], contextCleared: false };
  
  console.log('[WorkflowInterface] Active chat state:', {
    workflowId: activeWorkflowId,
    messagesCount: activeChatState.messages.length,
    contextCleared: activeChatState.contextCleared
  });

  // Handle workflow selection
  const handleSelectWorkflow = useCallback((workflowId: string) => {
    if (!content) return;
    
    console.log('[WorkflowInterface] Selecting workflow:', { workflowId });
    
    onUpdateContent({
      ...content,
      activeWorkflowId: workflowId,
    });
  }, [content, onUpdateContent]);

  // Handle add new workflow
  const handleAddWorkflow = useCallback(async () => {
    if (!content) return;
    
    // Check authentication
    if (!isAuthenticated || !user) {
      notification.showWarning('Please login to create workflows', 3000);
      return;
    }
    
    const newWorkflowId = `workflow-${Date.now()}`;
    const defaultName = 'New Workflow';
    
    console.log('[WorkflowInterface] Adding new workflow:', {
      workflowId: newWorkflowId,
      workflowName: defaultName,
      timestamp: new Date().toISOString()
    });
    
    const newWorkflow = {
      id: newWorkflowId,
      name: defaultName,
      data: {
        name: defaultName,
        description: '',
        nodes: [],
        connections: [],
      },
    };
    
    const updatedContent = {
      ...content,
      workflows: [...content.workflows, newWorkflow],
      activeWorkflowId: newWorkflowId, // Set the new workflow as active
    };
    
    onUpdateContent(updatedContent);
    
    console.log('[WorkflowInterface] New workflow added and selected:', {
      workflowId: newWorkflowId,
      totalWorkflows: updatedContent.workflows.length,
      activeWorkflowId: updatedContent.activeWorkflowId
    });

    // Auto-save the new workflow to database
    try {
      console.log('[WorkflowInterface] Auto-saving new workflow to database:', {
        workflow_id: newWorkflowId,
        workflow_name: defaultName
      });

      const response = await saveAgentWorkflow({
        user_id: user.id,
        workflow_id: newWorkflowId,
        workflow_name: defaultName,
        workflow_description: '',
        nodes: [],
        connections: [],
      });

      if (response.success) {
        console.log('[WorkflowInterface] New workflow auto-saved successfully:', {
          workflow_id: response.data.workflow_id,
          version: response.data.version,
        });
        
        notification.showSuccess(`Workflow "${defaultName}" created successfully`, 2000);
      }
    } catch (error) {
      console.error('[WorkflowInterface] Error auto-saving new workflow:', error);
      notification.showError(
        'Workflow created but failed to save. Please save it manually.',
        4000
      );
    }
  }, [content, onUpdateContent, isAuthenticated, user, notification]);

  // Handle rename workflow
  const handleRenameWorkflow = useCallback(async (workflowId: string, newName: string) => {
    if (!content) return;
    
    // Check authentication
    if (!isAuthenticated || !user) {
      notification.showWarning('Please login to rename workflows', 3000);
      return;
    }
    
    console.log('[WorkflowInterface] Renaming workflow:', {
      workflowId,
      newName,
      timestamp: new Date().toISOString()
    });
    
    const workflowToRename = content.workflows.find(w => w.id === workflowId);
    if (!workflowToRename) {
      console.error('[WorkflowInterface] Workflow not found for renaming:', workflowId);
      return;
    }
    
    const updatedWorkflows = content.workflows.map(workflow =>
      workflow.id === workflowId
        ? {
            ...workflow,
            name: newName,
            data: {
              ...workflow.data,
              name: newName,
            },
          }
        : workflow
    );
    
    onUpdateContent({
      ...content,
      workflows: updatedWorkflows,
    });
    
    console.log('[WorkflowInterface] Workflow renamed successfully in local state:', {
      workflowId,
      newName
    });

    // Auto-save the renamed workflow to database
    try {
      console.log('[WorkflowInterface] Auto-saving renamed workflow to database:', {
        workflow_id: workflowId,
        old_name: workflowToRename.name,
        new_name: newName
      });

      const response = await saveAgentWorkflow({
        user_id: user.id,
        workflow_id: workflowId,
        workflow_name: newName,
        workflow_description: workflowToRename.data.description,
        nodes: workflowToRename.data.nodes,
        connections: workflowToRename.data.connections,
      });

      if (response.success) {
        console.log('[WorkflowInterface] Renamed workflow auto-saved successfully:', {
          workflow_id: response.data.workflow_id,
          version: response.data.version,
        });
        
        notification.showSuccess(`Workflow renamed to "${newName}"`, 2000);
      }
    } catch (error) {
      console.error('[WorkflowInterface] Error auto-saving renamed workflow:', error);
      notification.showError(
        'Workflow renamed but failed to save. Please save it manually.',
        4000
      );
    }
  }, [content, onUpdateContent, isAuthenticated, user, notification]);

  // Handle delete workflow
  const handleDeleteWorkflow = useCallback(async (workflowId: string) => {
    if (!content) return;
    
    // Check authentication
    if (!isAuthenticated || !user) {
      notification.showWarning('Please login to delete workflows', 3000);
      return;
    }

    // Prevent deleting the last workflow
    if (content.workflows.length <= 1) {
      notification.showWarning('Cannot delete the last workflow', 3000);
      return;
    }

    const workflowToDelete = content.workflows.find(w => w.id === workflowId);
    if (!workflowToDelete) {
      console.error('[WorkflowInterface] Workflow not found for deletion:', workflowId);
      return;
    }

    console.log('[WorkflowInterface] Deleting workflow:', {
      workflowId,
      workflowName: workflowToDelete.name,
      timestamp: new Date().toISOString()
    });

    try {
      // Delete workflow from backend
      const response = await deleteAgentWorkflow(user.id, workflowId);

      if (response.success) {
        console.log('[WorkflowInterface] Workflow deleted from backend successfully:', {
          workflow_id: workflowId
        });

        // Remove workflow from local state
        const updatedWorkflows = content.workflows.filter(w => w.id !== workflowId);
        
        // Update active workflow if the deleted one was active
        let newActiveWorkflowId = content.activeWorkflowId;
        if (content.activeWorkflowId === workflowId) {
          // Select the first remaining workflow
          newActiveWorkflowId = updatedWorkflows.length > 0 ? updatedWorkflows[0].id : null;
          console.log('[WorkflowInterface] Active workflow was deleted, switching to:', {
            newActiveWorkflowId,
            newActiveWorkflowName: updatedWorkflows.find(w => w.id === newActiveWorkflowId)?.name
          });
        }

        onUpdateContent({
          ...content,
          workflows: updatedWorkflows,
          activeWorkflowId: newActiveWorkflowId,
        });

        console.log('[WorkflowInterface] Workflow deleted successfully:', {
          workflowId,
          workflowName: workflowToDelete.name,
          remainingWorkflows: updatedWorkflows.length,
          newActiveWorkflowId
        });

        notification.showSuccess(
          `Workflow "${workflowToDelete.name}" deleted successfully`,
          3000
        );
      }
    } catch (error) {
      console.error('[WorkflowInterface] Error deleting workflow:', error);
      notification.showError(
        error instanceof Error ? error.message : 'Failed to delete workflow',
        4000
      );
    }
  }, [content, onUpdateContent, isAuthenticated, user, notification]);

  // Handle nodes change
  const handleNodesChange = useCallback((nodes: WorkflowNode[]) => {
    if (!content || !content.activeWorkflowId) return;
    
    console.log('[WorkflowInterface] Updating nodes:', { 
      workflowId: content.activeWorkflowId,
      nodesCount: nodes.length 
    });
    
    const updatedWorkflows = content.workflows.map(workflow =>
      workflow.id === content.activeWorkflowId
        ? {
            ...workflow,
            data: {
              ...workflow.data,
              nodes,
            },
          }
        : workflow
    );
    
    onUpdateContent({
      ...content,
      workflows: updatedWorkflows,
    });
  }, [content, onUpdateContent]);

  // Handle connections change
  const handleConnectionsChange = useCallback((connections: WorkflowConnection[]) => {
    if (!content || !content.activeWorkflowId) return;
    
    console.log('[WorkflowInterface] Updating connections:', { 
      workflowId: content.activeWorkflowId,
      connectionsCount: connections.length 
    });
    
    const updatedWorkflows = content.workflows.map(workflow =>
      workflow.id === content.activeWorkflowId
        ? {
            ...workflow,
            data: {
              ...workflow.data,
              connections,
            },
          }
        : workflow
    );
    
    onUpdateContent({
      ...content,
      workflows: updatedWorkflows,
    });
  }, [content, onUpdateContent]);

  // Handle clear chat history for current workflow
  const handleClearChatHistory = useCallback(() => {
    if (!activeWorkflowId) return;
    
    console.log('[WorkflowInterface] Clearing chat history for workflow:', {
      workflowId: activeWorkflowId,
      previousMessagesCount: activeChatState.messages.length,
      timestamp: new Date().toISOString()
    });
    
    setWorkflowChatStates(prev => ({
      ...prev,
      [activeWorkflowId]: {
        messages: [],
        contextCleared: prev[activeWorkflowId]?.contextCleared || false
      }
    }));
    
    console.log('[WorkflowInterface] Chat history cleared successfully');
  }, [activeWorkflowId, activeChatState.messages.length]);

  // Handle clear context for current workflow
  const handleClearContext = useCallback(() => {
    if (!activeWorkflowId) return;
    
    console.log('[WorkflowInterface] Clearing context for workflow:', {
      workflowId: activeWorkflowId,
      timestamp: new Date().toISOString()
    });
    
    // Mark context as cleared for this workflow
    setWorkflowChatStates(prev => ({
      ...prev,
      [activeWorkflowId]: {
        messages: prev[activeWorkflowId]?.messages || [],
        contextCleared: true
      }
    }));
    
    // Reset execution state to clear runtime context
    setExecutionState({
      isRunning: false,
      currentNodeId: null,
      nodeStates: {},
      logs: [],
    });
    
    // Clear the executor instance
    setWorkflowExecutor(null);
    
    console.log('[WorkflowInterface] Context cleared successfully:', {
      workflowId: activeWorkflowId,
      messagesPreserved: activeChatState.messages.length
    });
  }, [activeWorkflowId, activeChatState.messages.length]);

  // Handle workflow execution
  const handleRunWorkflow = useCallback(async (userInput?: string | null) => {
    if (!activeWorkflow || executionState.isRunning) {
      console.warn('[WorkflowInterface] Cannot run workflow:', {
        hasActiveWorkflow: !!activeWorkflow,
        isRunning: executionState.isRunning
      });
      return;
    }

    console.log('[WorkflowInterface] Starting workflow execution', {
      hasUserInput: !!userInput,
      userInputLength: userInput?.length || 0,
      contextCleared: activeChatState.contextCleared
    });

    // Reset contextCleared flag when starting new execution
    if (activeChatState.contextCleared && activeWorkflowId) {
      setWorkflowChatStates(prev => ({
        ...prev,
        [activeWorkflowId]: {
          ...prev[activeWorkflowId],
          contextCleared: false
        }
      }));
    }

    // Create a new executor with user input
    const executor = new WorkflowExecutor(
      activeWorkflow.data.nodes,
      activeWorkflow.data.connections,
      (newState) => {
        console.log('[WorkflowInterface] Execution state updated:', {
          isRunning: newState.isRunning,
          currentNodeId: newState.currentNodeId,
          logsCount: newState.logs.length,
          lastLog: newState.logs.length > 0 ? newState.logs[newState.logs.length - 1] : null,
          timestamp: new Date().toISOString()
        });
        
        // Force state update by creating a new object reference
        setExecutionState({
          ...newState,
          logs: [...newState.logs]
        });
      },
      userInput // Pass user input to executor
    );

    setWorkflowExecutor(executor);
    
    // Start execution
    try {
      console.log('[WorkflowInterface] Calling executor.execute()');
      await executor.execute();
      console.log('[WorkflowInterface] Executor.execute() completed successfully');
    } catch (error) {
      console.error('[WorkflowInterface] Workflow execution failed:', error);
    } finally {
      console.log('[WorkflowInterface] Workflow execution finished (finally block)');
      // Clear user input after execution
      setCurrentUserInput(null);
    }
  }, [activeWorkflow, executionState.isRunning, activeChatState.contextCleared, activeWorkflowId]);

  // Handle workflow abort
  const handleAbortWorkflow = useCallback(() => {
    if (workflowExecutor) {
      console.log('[WorkflowInterface] Aborting workflow execution');
      workflowExecutor.abort();
    }
  }, [workflowExecutor]);

  // Handle workflow save
  const handleSaveWorkflow = useCallback(async () => {
    if (!isAuthenticated || !user) {
      notification.showWarning('Please login to save workflows', 3000);
      return;
    }

    if (!activeWorkflow) {
      notification.showError('No active workflow to save', 3000);
      return;
    }

    try {
      setIsSaving(true);
      
      console.log('[WorkflowInterface] Saving workflow:', {
        workflow_id: activeWorkflow.id,
        workflow_name: activeWorkflow.name,
        nodes_count: activeWorkflow.data.nodes.length,
        connections_count: activeWorkflow.data.connections.length,
      });

      const response = await saveAgentWorkflow({
        user_id: user.id,
        workflow_id: activeWorkflow.id,
        workflow_name: activeWorkflow.name,
        workflow_description: activeWorkflow.data.description,
        nodes: activeWorkflow.data.nodes,
        connections: activeWorkflow.data.connections,
      });

      if (response.success) {
        console.log('[WorkflowInterface] Workflow saved successfully:', {
          workflow_id: response.data.workflow_id,
          version: response.data.version,
        });
        
        notification.showSuccess(
          `Workflow "${activeWorkflow.name}" saved successfully (v${response.data.version})`,
          3000
        );
      } else {
        throw new Error(response.message || 'Failed to save workflow');
      }
    } catch (error) {
      console.error('[WorkflowInterface] Error saving workflow:', error);
      notification.showError(
        error instanceof Error ? error.message : 'Failed to save workflow',
        5000
      );
    } finally {
      setIsSaving(false);
    }
  }, [isAuthenticated, user, activeWorkflow, notification]);

  // Show loading state while initializing
  if (!content) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl mx-auto mb-4 flex items-center justify-center animate-pulse">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
            </svg>
          </div>
          <p className="text-sm text-gray-600">Loading workflow...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex overflow-hidden">
      {/* Left Sidebar - 20% width */}
      <div className="w-1/5 min-w-[250px] h-full">
        <WorkflowSidebar
          workflows={content.workflows.map(w => ({
            id: w.id,
            name: w.name,
            description: w.data.description,
          }))}
          activeWorkflowId={content.activeWorkflowId}
          onSelectWorkflow={handleSelectWorkflow}
          onAddWorkflow={handleAddWorkflow}
          onRenameWorkflow={handleRenameWorkflow}
          onDeleteWorkflow={handleDeleteWorkflow}
        />
      </div>

      {/* Right Panel - 80% width with Tabs */}
      <div className="flex-1 h-full">
        {activeWorkflow ? (
          <div className="h-full w-full flex flex-col">
            {/* Tab Header */}
            <div className="bg-white border-b border-gray-200">
              {/* Tabs Navigation */}
              <div className="flex items-center px-6 pt-4 space-x-1">
                <button
                  onClick={() => {
                    console.log('[WorkflowInterface] Switching to Chat tab');
                    setActiveRightTab('chat');
                  }}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-all ${
                    activeRightTab === 'chat'
                      ? 'bg-white text-blue-600 border-t border-x border-gray-200'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <span>聊天界面</span>
                  </div>
                </button>
                
                <button
                  onClick={() => {
                    console.log('[WorkflowInterface] Switching to Workflow tab');
                    setActiveRightTab('workflow');
                  }}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-all ${
                    activeRightTab === 'workflow'
                      ? 'bg-white text-blue-600 border-t border-x border-gray-200'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
                    </svg>
                    <span>工作流界面</span>
                  </div>
                </button>
              </div>

              {/* Workflow Info and Actions (only shown in workflow tab) */}
              {activeRightTab === 'workflow' && (
                <div className="px-6 py-4 border-t border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">
                        {activeWorkflow.name}
                      </h2>
                      {activeWorkflow.data.description && (
                        <p className="text-sm text-gray-500 mt-1">
                          {activeWorkflow.data.description}
                        </p>
                      )}
                    </div>
                
                <div className="flex items-center space-x-2">
                  <button
                    className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleSaveWorkflow}
                    disabled={isSaving || !isAuthenticated}
                  >
                    {isSaving ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                        </svg>
                        <span>Save</span>
                      </>
                    )}
                  </button>
                  
                  {!executionState.isRunning ? (
                    <button
                      className="px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-lg hover:from-purple-600 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg text-sm font-medium flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={handleRunWorkflow}
                      disabled={!activeWorkflow}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Run</span>
                    </button>
                  ) : (
                    <button
                      className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all shadow-md hover:shadow-lg text-sm font-medium flex items-center space-x-2"
                      onClick={handleAbortWorkflow}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                      </svg>
                      <span>Stop</span>
                    </button>
                  )}
                </div>
                  </div>
                </div>
              )}
            </div>

            {/* Tab Content Area */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Chat Interface Tab */}
              {activeRightTab === 'chat' && (
                <WorkflowChatInterface
                  executionState={executionState}
                  onRunWorkflow={handleRunWorkflow}
                  onAbortWorkflow={handleAbortWorkflow}
                  messages={activeChatState.messages}
                  onMessagesChange={(messages) => {
                    console.log('[WorkflowInterface] Updating chat messages for workflow:', {
                      workflowId: activeWorkflowId,
                      newMessagesCount: messages.length,
                      timestamp: new Date().toISOString()
                    });
                    setWorkflowChatStates(prev => ({
                      ...prev,
                      [activeWorkflowId]: {
                        ...prev[activeWorkflowId],
                        messages
                      }
                    }));
                  }}
                  onClearChatHistory={handleClearChatHistory}
                  onClearContext={handleClearContext}
                />
              )}

              {/* Workflow Canvas Tab */}
              {activeRightTab === 'workflow' && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Canvas Area */}
                  <div className="flex-1 overflow-hidden">
                    <WorkflowCanvas
                      nodes={activeWorkflow.data.nodes}
                      connections={activeWorkflow.data.connections}
                      onNodesChange={handleNodesChange}
                      onConnectionsChange={handleConnectionsChange}
                      nodeExecutionStates={executionState.nodeStates}
                    />
                  </div>
                  
                  {/* Log Panel Area - Flexible height */}
                  <div className="border-t border-gray-200 flex-shrink-0">
                    <WorkflowLogPanel
                      logs={executionState.logs}
                      nodeStates={executionState.nodeStates}
                      isRunning={executionState.isRunning}
                      currentNodeId={executionState.currentNodeId}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full w-full flex items-center justify-center bg-gray-50">
            <div className="text-center max-w-md px-6">
              <div className="w-20 h-20 bg-gray-200 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                No Workflow Selected
              </h3>
              <p className="text-sm text-gray-600">
                Select a workflow from the sidebar to start editing
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkflowInterface;

