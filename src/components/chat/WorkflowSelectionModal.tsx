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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm transition-all"
      onClick={handleBackdropClick}
    >
      {/* Modal Container */}
      <div className="relative w-full max-w-4xl mx-4 bg-white rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="px-8 py-6 bg-gradient-to-br from-gray-50 to-white border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-md">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">选择工作流</h2>
                <p className="text-sm text-gray-500 mt-0.5">选择一个工作流来开始新的对话</p>
              </div>
            </div>
            
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-all"
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
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mb-4 animate-pulse">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
                </svg>
              </div>
              <p className="text-sm text-gray-600">加载工作流中...</p>
            </div>
          ) : error ? (
            // Error State
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-900 mb-2">加载失败</p>
              <p className="text-sm text-gray-600 text-center max-w-md">{error}</p>
              <button
                onClick={() => {
                  setError(null);
                  // Trigger reload by toggling state
                  setIsLoading(true);
                  setTimeout(() => setIsLoading(false), 100);
                }}
                className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors text-sm font-medium"
              >
                重试
              </button>
            </div>
          ) : workflows.length === 0 ? (
            // Empty State
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-900 mb-2">暂无工作流</p>
              <p className="text-sm text-gray-600 text-center max-w-md">
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
                  className="group relative p-5 bg-gradient-to-br from-white to-gray-50 border border-gray-200 rounded-2xl hover:border-blue-300 hover:shadow-lg transition-all duration-200 text-left"
                >
                  {/* Workflow Icon */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-100 to-purple-100 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                      <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    
                    {/* Active Badge */}
                    {workflow.is_active && (
                      <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-lg">
                        活跃
                      </span>
                    )}
                  </div>
                  
                  {/* Workflow Info */}
                  <div className="space-y-2">
                    <h3 className="text-base font-semibold text-gray-900 line-clamp-1 group-hover:text-blue-600 transition-colors">
                      {workflow.workflow_name}
                    </h3>
                    
                    {workflow.workflow_description && (
                      <p className="text-sm text-gray-600 line-clamp-2">
                        {workflow.workflow_description}
                      </p>
                    )}
                    
                    {/* Workflow Stats */}
                    <div className="flex items-center space-x-3 text-xs text-gray-500 pt-2">
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
                  <div className="absolute inset-0 rounded-2xl ring-2 ring-blue-500 ring-opacity-0 group-hover:ring-opacity-100 transition-all pointer-events-none" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 py-4 bg-gray-50 border-t border-gray-200">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {!isLoading && !error && workflows.length > 0 && (
                `共 ${workflows.length} 个工作流可用`
              )}
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 hover:border-gray-400 transition-all text-sm font-medium"
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


