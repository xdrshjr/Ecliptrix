'use client';

import React, { useState } from 'react';

interface WorkflowItem {
  id: string;
  name: string;
  description?: string;
}

interface WorkflowSidebarProps {
  workflows: WorkflowItem[];
  activeWorkflowId: string | null;
  onSelectWorkflow: (workflowId: string) => void;
  onAddWorkflow: () => void;
  onRenameWorkflow: (workflowId: string, newName: string) => void;
  onDeleteWorkflow?: (workflowId: string) => void;
  onEditWorkflow?: (workflowId: string) => void;
}

/**
 * Workflow Sidebar Component
 * Displays a list of available workflows (20% width)
 */
const WorkflowSidebar: React.FC<WorkflowSidebarProps> = ({
  workflows,
  activeWorkflowId,
  onSelectWorkflow,
  onAddWorkflow,
  onRenameWorkflow,
  onDeleteWorkflow,
  onEditWorkflow,
}) => {
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  console.log('[WorkflowSidebar] Rendering sidebar:', {
    workflowsCount: workflows.length,
    activeWorkflowId,
    timestamp: new Date().toISOString()
  });

  return (
    <div className="w-full h-full bg-muted border-r border-border flex flex-col">
      {/* Header */}
      <div className="px-4 py-4 border-b border-border bg-card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-foreground">Workflows</h2>
          <button
            className="p-1.5 hover:bg-accent rounded-lg transition-colors"
            title="Add New Workflow"
            onClick={() => {
              console.log('[WorkflowSidebar] Add new workflow clicked');
              onAddWorkflow();
            }}
          >
            <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Select or create a workflow
        </p>
      </div>

      {/* Workflow List */}
      <div className="flex-1 overflow-y-auto p-2">
        {workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <div className="w-12 h-12 bg-secondary rounded-md flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-sm text-muted-foreground">
              No workflows yet
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {workflows.map((workflow) => (
              <div
                key={workflow.id}
                className={`
                  w-full text-left p-3 rounded-lg transition-colors duration-200
                  ${activeWorkflowId === workflow.id
                    ? 'bg-primary/10 border-2 border-primary'
                    : 'bg-card border-2 border-border hover:border-border'
                  }
                `}
              >
                <div className="flex items-start space-x-3">
                  {/* Workflow Icon */}
                  <button
                    onClick={() => {
                      console.log('[WorkflowSidebar] Workflow selected:', { workflowId: workflow.id });
                      onSelectWorkflow(workflow.id);
                    }}
                    className={`
                      w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5
                      ${activeWorkflowId === workflow.id
                        ? 'bg-primary'
                        : 'bg-secondary'
                      }
                    `}
                  >
                    <svg className="w-4 h-4 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
                    </svg>
                  </button>

                  {/* Workflow Info */}
                  <div className="flex-1 min-w-0">
                    {editingWorkflowId === workflow.id ? (
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => {
                          console.log('[WorkflowSidebar] Renaming workflow:', { 
                            workflowId: workflow.id, 
                            oldName: workflow.name, 
                            newName: editingName 
                          });
                          if (editingName.trim() && editingName !== workflow.name) {
                            onRenameWorkflow(workflow.id, editingName.trim());
                          }
                          setEditingWorkflowId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          } else if (e.key === 'Escape') {
                            setEditingWorkflowId(null);
                          }
                        }}
                        className="w-full px-2 py-1 text-sm font-semibold border border-primary rounded focus:outline-none focus:ring-2 focus:ring-ring"
                        autoFocus
                      />
                    ) : (
                      <div 
                        onClick={() => {
                          console.log('[WorkflowSidebar] Workflow selected:', { workflowId: workflow.id });
                          onSelectWorkflow(workflow.id);
                        }}
                        onDoubleClick={() => {
                          console.log('[WorkflowSidebar] Edit mode activated for workflow:', { workflowId: workflow.id });
                          setEditingWorkflowId(workflow.id);
                          setEditingName(workflow.name);
                        }}
                        className="cursor-pointer"
                      >
                        <h3 className={`
                          text-sm font-semibold truncate
                          ${activeWorkflowId === workflow.id
                            ? 'text-foreground'
                            : 'text-foreground'
                          }
                        `}>
                          {workflow.name}
                        </h3>
                        {workflow.description && (
                          <p className={`
                            text-xs truncate mt-0.5
                            ${activeWorkflowId === workflow.id
                              ? 'text-primary'
                              : 'text-muted-foreground'
                            }
                          `}>
                            {workflow.description}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  {!editingWorkflowId && (
                    <div className="flex-shrink-0 mt-1 flex items-center space-x-1">
                      {/* Edit Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log('[WorkflowSidebar] Edit button clicked for workflow:', { workflowId: workflow.id });
                          if (onEditWorkflow) {
                            onEditWorkflow(workflow.id);
                          }
                        }}
                        className="p-1 hover:bg-primary/10 rounded transition-colors"
                        title="Edit Workflow Details"
                      >
                        <svg className="w-3.5 h-3.5 text-muted-foreground hover:text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>

                      {/* Delete Button */}
                      {onDeleteWorkflow && workflows.length > 1 && (
                        <>
                          {showDeleteConfirm === workflow.id ? (
                            <div className="flex items-center space-x-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  console.log('[WorkflowSidebar] Delete confirmed for workflow:', { workflowId: workflow.id });
                                  onDeleteWorkflow(workflow.id);
                                  setShowDeleteConfirm(null);
                                }}
                                className="p-1 hover:bg-red-100 rounded transition-colors"
                                title="Confirm Delete"
                              >
                                <svg className="w-3.5 h-3.5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  console.log('[WorkflowSidebar] Delete cancelled for workflow:', { workflowId: workflow.id });
                                  setShowDeleteConfirm(null);
                                }}
                                className="p-1 hover:bg-accent rounded transition-colors"
                                title="Cancel"
                              >
                                <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                console.log('[WorkflowSidebar] Delete button clicked for workflow:', { workflowId: workflow.id });
                                setShowDeleteConfirm(workflow.id);
                              }}
                              className="p-1 hover:bg-red-50 rounded transition-colors"
                              title="Delete Workflow"
                            >
                              <svg className="w-3.5 h-3.5 text-muted-foreground hover:text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}

                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="px-4 py-3 border-t border-border bg-card">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{workflows.length} workflow{workflows.length !== 1 ? 's' : ''}</span>
          {activeWorkflowId && (
            <span className="text-primary font-medium">Active</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkflowSidebar;

