'use client';

import React from 'react';

interface WorkflowItem {
  id: string;
  name: string;
  description?: string;
}

interface WorkflowSidebarProps {
  workflows: WorkflowItem[];
  activeWorkflowId: string | null;
  onSelectWorkflow: (workflowId: string) => void;
}

/**
 * Workflow Sidebar Component
 * Displays a list of available workflows (20% width)
 */
const WorkflowSidebar: React.FC<WorkflowSidebarProps> = ({
  workflows,
  activeWorkflowId,
  onSelectWorkflow,
}) => {
  console.log('[WorkflowSidebar] Rendering sidebar:', {
    workflowsCount: workflows.length,
    activeWorkflowId,
    timestamp: new Date().toISOString()
  });

  return (
    <div className="w-full h-full bg-gray-50 border-r border-gray-200 flex flex-col">
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-gray-900">Workflows</h2>
          <button
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
            title="Add New Workflow"
            onClick={() => {
              console.log('[WorkflowSidebar] Add new workflow clicked');
              // TODO: Implement add workflow functionality
            }}
          >
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Select or create a workflow
        </p>
      </div>

      {/* Workflow List */}
      <div className="flex-1 overflow-y-auto p-2">
        {workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <div className="w-12 h-12 bg-gray-200 rounded-xl flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-sm text-gray-500">
              No workflows yet
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {workflows.map((workflow) => (
              <button
                key={workflow.id}
                onClick={() => {
                  console.log('[WorkflowSidebar] Workflow selected:', { workflowId: workflow.id });
                  onSelectWorkflow(workflow.id);
                }}
                className={`
                  w-full text-left p-3 rounded-lg transition-all duration-200
                  ${activeWorkflowId === workflow.id
                    ? 'bg-blue-50 border-2 border-blue-500 shadow-sm'
                    : 'bg-white border-2 border-gray-200 hover:border-gray-300 hover:shadow-sm'
                  }
                `}
              >
                <div className="flex items-start space-x-3">
                  {/* Workflow Icon */}
                  <div className={`
                    w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5
                    ${activeWorkflowId === workflow.id
                      ? 'bg-blue-500'
                      : 'bg-gradient-to-br from-purple-500 to-indigo-600'
                    }
                  `}>
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
                    </svg>
                  </div>

                  {/* Workflow Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className={`
                      text-sm font-semibold truncate
                      ${activeWorkflowId === workflow.id
                        ? 'text-blue-900'
                        : 'text-gray-900'
                      }
                    `}>
                      {workflow.name}
                    </h3>
                    {workflow.description && (
                      <p className={`
                        text-xs truncate mt-0.5
                        ${activeWorkflowId === workflow.id
                          ? 'text-blue-700'
                          : 'text-gray-500'
                        }
                      `}>
                        {workflow.description}
                      </p>
                    )}
                  </div>

                  {/* Active Indicator */}
                  {activeWorkflowId === workflow.id && (
                    <div className="flex-shrink-0 mt-1">
                      <div className="w-2 h-2 bg-blue-500 rounded-full" />
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="px-4 py-3 border-t border-gray-200 bg-white">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{workflows.length} workflow{workflows.length !== 1 ? 's' : ''}</span>
          {activeWorkflowId && (
            <span className="text-blue-600 font-medium">Active</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkflowSidebar;

