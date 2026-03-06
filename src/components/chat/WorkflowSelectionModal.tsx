'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { loadAgentWorkflows, WorkflowRecord } from '@/lib/api/workflow';

interface WorkflowSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectWorkflow: (workflowId: string, workflowName: string) => void;
}

/**
 * Workflow Selection Modal Component
 * 
 * Apple light design style: clean, elegant, minimalist
 * Features:
 * - Displays all available workflows in a card grid
 * - Allows user to select a workflow for the new chat conversation
 * - Beautiful animations and hover effects
 * - Responsive layout
 */
const WorkflowSelectionModal: React.FC<WorkflowSelectionModalProps> = ({
  isOpen,
  onClose,
  onSelectWorkflow,
}) => {
  const { user, isAuthenticated } = useAuth();
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load workflows when modal opens
  useEffect(() => {
    const fetchWorkflows = async () => {
      if (!isOpen || !isAuthenticated || !user) {
        console.log('[WorkflowSelectionModal] Skipping workflow load:', {
          isOpen,
          isAuthenticated,
          hasUser: !!user
        });
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        console.log('[WorkflowSelectionModal] Loading workflows for user:', user.id);
        
        const response = await loadAgentWorkflows(user.id);
        
        if (response.success && response.data) {
          console.log('[WorkflowSelectionModal] Workflows loaded successfully:', {
            count: response.data.length
          });
          setWorkflows(response.data);
        } else {
          throw new Error(response.message || 'Failed to load workflows');
        }
      } catch (err) {
        console.error('[WorkflowSelectionModal] Error loading workflows:', err);
        setError(err instanceof Error ? err.message : 'Failed to load workflows');
      } finally {
        setIsLoading(false);
      }
    };

    fetchWorkflows();
  }, [isOpen, isAuthenticated, user]);

  // Handle workflow selection
  const handleSelectWorkflow = (workflow: WorkflowRecord) => {
    console.log('[WorkflowSelectionModal] Workflow selected:', {
      workflow_id: workflow.workflow_id,
      workflow_name: workflow.workflow_name
    });
    onSelectWorkflow(workflow.workflow_id, workflow.workflow_name);
    onClose();
  };

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      console.log('[WorkflowSelectionModal] Backdrop clicked, closing modal');
      onClose();
    }
  };

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 transition-colors"
      onClick={handleBackdropClick}
    >
      {/* Modal Container */}
      <div className="relative w-full max-w-4xl mx-4 bg-card rounded-md shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="px-8 py-6 bg-card border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-primary rounded-md flex items-center justify-center">
                <svg className="w-6 h-6 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-foreground">选择工作流</h2>
                <p className="text-sm text-muted-foreground mt-0.5">选择一个工作流来开始新的对话</p>
              </div>
            </div>
            
            <button
              onClick={onClose}
              className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-8 py-6 max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            // Loading State
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 bg-primary rounded-md flex items-center justify-center mb-4 animate-pulse">
                <svg className="w-8 h-8 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
                </svg>
              </div>
              <p className="text-sm text-muted-foreground">加载工作流中...</p>
            </div>
          ) : error ? (
            // Error State
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 bg-destructive/15 rounded-md flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-foreground mb-2">加载失败</p>
              <p className="text-sm text-muted-foreground text-center max-w-md">{error}</p>
              <button
                onClick={() => {
                  setError(null);
                  // Trigger reload by toggling state
                  setIsLoading(true);
                  setTimeout(() => setIsLoading(false), 100);
                }}
                className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-[var(--primary-hover)] transition-colors text-sm font-medium"
              >
                重试
              </button>
            </div>
          ) : workflows.length === 0 ? (
            // Empty State
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 bg-accent rounded-md flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
              </div>
              <p className="text-sm font-medium text-foreground mb-2">暂无工作流</p>
              <p className="text-sm text-muted-foreground text-center max-w-md">
                请先在"工作流"任务中创建工作流，然后再开始新的对话
              </p>
            </div>
          ) : (
            // Workflows Grid
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {workflows.map((workflow) => (
                <button
                  key={workflow.workflow_id}
                  onClick={() => handleSelectWorkflow(workflow)}
                  className="group relative p-5 bg-card border border-border rounded-md hover:border-primary/40 transition-colors duration-200 text-left"
                >
                  {/* Workflow Icon */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-12 h-12 bg-primary/15 rounded-md flex items-center justify-center transition-transform">
                      <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    
                    {/* Active Badge */}
                    {workflow.is_active && (
                      <span className="px-2 py-1 bg-green-500/15 text-green-500 text-xs font-medium rounded-lg">
                        活跃
                      </span>
                    )}
                  </div>
                  
                  {/* Workflow Info */}
                  <div className="space-y-2">
                    <h3 className="text-base font-semibold text-foreground line-clamp-1 group-hover:text-primary transition-colors">
                      {workflow.workflow_name}
                    </h3>
                    
                    {workflow.workflow_description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {workflow.workflow_description}
                      </p>
                    )}
                    
                    {/* Workflow Stats */}
                    <div className="flex items-center space-x-3 text-xs text-muted-foreground pt-2">
                      <div className="flex items-center space-x-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                        </svg>
                        <span>{workflow.nodes?.length || 0} 节点</span>
                      </div>
                      
                      <div className="flex items-center space-x-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                        </svg>
                        <span>v{workflow.version}</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Hover Indicator */}
                  <div className="absolute inset-0 rounded-md ring-2 ring-ring ring-opacity-0 group-hover:ring-opacity-100 transition-colors pointer-events-none" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 py-4 bg-muted border-t border-border">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {!isLoading && !error && workflows.length > 0 && (
                `共 ${workflows.length} 个工作流可用`
              )}
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-card border border-border text-foreground rounded-md hover:bg-accent transition-colors text-sm font-medium"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkflowSelectionModal;


