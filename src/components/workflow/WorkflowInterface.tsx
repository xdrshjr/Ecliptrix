'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { WorkflowTaskContent, WorkflowNode, WorkflowConnection, WorkflowExecutionState } from '@/types';
import WorkflowSidebar from './WorkflowSidebar';
import WorkflowCanvas from './WorkflowCanvas';
import WorkflowLogPanel from './WorkflowLogPanel';
import { WorkflowExecutor } from './WorkflowExecutor';

interface WorkflowInterfaceProps {
  taskId: string;
  content: WorkflowTaskContent | null;
  onUpdateContent: (content: WorkflowTaskContent) => void;
}

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

  // Workflow execution state
  const [executionState, setExecutionState] = useState<WorkflowExecutionState>({
    isRunning: false,
    currentNodeId: null,
    nodeStates: {},
    logs: [],
  });
  const [workflowExecutor, setWorkflowExecutor] = useState<WorkflowExecutor | null>(null);

  // Initialize default content if none exists
  useEffect(() => {
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
  }, [content, onUpdateContent]);

  // Get active workflow
  const activeWorkflow = content?.workflows.find(
    w => w.id === content.activeWorkflowId
  );

  console.log('[WorkflowInterface] Active workflow:', {
    activeWorkflowId: content?.activeWorkflowId,
    activeWorkflowName: activeWorkflow?.name,
    nodesCount: activeWorkflow?.data.nodes.length || 0
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

  // Handle workflow execution
  const handleRunWorkflow = useCallback(async () => {
    if (!activeWorkflow || executionState.isRunning) {
      console.warn('[WorkflowInterface] Cannot run workflow:', {
        hasActiveWorkflow: !!activeWorkflow,
        isRunning: executionState.isRunning
      });
      return;
    }

    console.log('[WorkflowInterface] Starting workflow execution');

    // Create a new executor
    const executor = new WorkflowExecutor(
      activeWorkflow.data.nodes,
      activeWorkflow.data.connections,
      (newState) => {
        console.log('[WorkflowInterface] Execution state updated:', {
          isRunning: newState.isRunning,
          currentNodeId: newState.currentNodeId,
          logsCount: newState.logs.length
        });
        setExecutionState(newState);
      }
    );

    setWorkflowExecutor(executor);
    
    // Start execution
    try {
      await executor.execute();
    } catch (error) {
      console.error('[WorkflowInterface] Workflow execution failed:', error);
    }
  }, [activeWorkflow, executionState.isRunning]);

  // Handle workflow abort
  const handleAbortWorkflow = useCallback(() => {
    if (workflowExecutor) {
      console.log('[WorkflowInterface] Aborting workflow execution');
      workflowExecutor.abort();
    }
  }, [workflowExecutor]);

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
        />
      </div>

      {/* Right Canvas - 80% width */}
      <div className="flex-1 h-full">
        {activeWorkflow ? (
          <div className="h-full w-full flex flex-col">
            {/* Canvas Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4">
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
                    className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium flex items-center space-x-2"
                    onClick={() => {
                      console.log('[WorkflowInterface] Save workflow clicked');
                      // TODO: Implement save functionality
                    }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                    </svg>
                    <span>Save</span>
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

            {/* Canvas and Log Panel Area - Split vertically */}
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

