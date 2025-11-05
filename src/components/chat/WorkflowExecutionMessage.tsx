'use client';

import React, { useMemo } from 'react';
import { WorkflowExecutionState } from '@/types';
import ExecutionProcessPanel from '@/components/workflow/ExecutionProcessPanel';
import MarkdownRenderer from './MarkdownRenderer';

interface WorkflowExecutionMessageProps {
  workflowName: string;
  executionState?: WorkflowExecutionState;
  finalResult?: string;
  isComplete: boolean;
  onNavigateToVideoEditing?: (materials: any[]) => void;
}

/**
 * Workflow Execution Message Component
 * 
 * Displays workflow execution progress in chat interface
 * Uses the same ExecutionProcessPanel as Workflows task for consistency
 * Apple light design style matching WorkflowChatInterface
 */
const WorkflowExecutionMessage: React.FC<WorkflowExecutionMessageProps> = ({
  workflowName,
  executionState,
  finalResult,
  isComplete,
  onNavigateToVideoEditing,
}) => {
  console.log('[WorkflowExecutionMessage] Rendering:', {
    workflowName,
    hasExecutionState: !!executionState,
    finalResult: finalResult?.substring(0, 100),
    isComplete,
    timestamp: new Date().toISOString()
  });

  // Build node names mapping from logs
  const nodeNames = useMemo(() => {
    if (!executionState) return {};
    
    const names: Record<string, string> = {};
    Object.entries(executionState.nodeStates).forEach(([nodeId, state]) => {
      const log = executionState.logs.find(l => l.nodeId === nodeId);
      names[nodeId] = log?.nodeName || nodeId;
    });
    return names;
  }, [executionState]);

  // Build execution order from logs
  const executionOrder = useMemo(() => {
    if (!executionState) return [];
    
    const order: string[] = [];
    const visited = new Set<string>();

    executionState.logs.forEach(log => {
      if (log.nodeId && !visited.has(log.nodeId) && log.message.includes('Executing node')) {
        order.push(log.nodeId);
        visited.add(log.nodeId);
      }
    });

    return order;
  }, [executionState]);

  // Check if Video Export node was executed and extract materials
  const videoExportMaterials = useMemo(() => {
    if (!executionState || !isComplete) return null;

    // Find Video Export node execution
    const videoExportLog = executionState.logs.find(
      log => log.level === 'success' && 
             log.message.includes('Successfully exported') && 
             log.message.includes('video(s) to materials')
    );

    if (!videoExportLog || !videoExportLog.nodeId) return null;

    // Get the node state which contains the materials data
    const nodeState = executionState.nodeStates[videoExportLog.nodeId];
    if (!nodeState?.output?.materials || !Array.isArray(nodeState.output.materials)) {
      return null;
    }

    console.log('[WorkflowExecutionMessage] Video Export detected:', {
      nodeId: videoExportLog.nodeId,
      materialsCount: nodeState.output.materials.length,
      materials: nodeState.output.materials
    });

    return nodeState.output.materials;
  }, [executionState, isComplete]);

  // Handle navigation to Video Editing
  const handleNavigateToVideoEditing = () => {
    if (videoExportMaterials && onNavigateToVideoEditing) {
      console.log('[WorkflowExecutionMessage] Navigating to Video Editing with materials:', {
        materialsCount: videoExportMaterials.length
      });
      onNavigateToVideoEditing(videoExportMaterials);
    }
  };

  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] w-full space-y-3">
        {/* Execution Process Panel - Shows node execution details */}
        {executionState && executionOrder.length > 0 && (
          <ExecutionProcessPanel
            nodeStates={executionState.nodeStates}
            executionOrder={executionOrder}
            nodeNames={nodeNames}
            isCompleted={isComplete}
          />
        )}

        {/* Final Result Section - Displayed when workflow completes */}
        {finalResult && isComplete && (
          <div className="rounded-2xl overflow-hidden bg-white border-2 border-green-200 shadow-lg">
            {/* Final Result Header */}
            <div className="px-5 py-3 bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-200">
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 bg-green-500 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-sm font-semibold text-green-900">最终结果</span>
                <span className="text-xs text-green-600">· {workflowName}</span>
              </div>
            </div>
            
            {/* Final Result Content */}
            <div className="px-5 py-4 bg-white">
              <div className="text-sm text-gray-800 leading-relaxed">
                <MarkdownRenderer content={finalResult} isUser={false} />
              </div>
              
              {/* Export Clip Button - Show when Video Export node was executed */}
              {videoExportMaterials && videoExportMaterials.length > 0 && onNavigateToVideoEditing && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <button
                    onClick={handleNavigateToVideoEditing}
                    className="w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg hover:from-blue-600 hover:to-blue-700 transition-all duration-200 transform hover:scale-[1.02] flex items-center justify-center space-x-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>导出剪辑 ({videoExportMaterials.length} 个视频素材)</span>
                  </button>
                  <p className="text-xs text-gray-500 text-center mt-2">
                    点击将视频素材导入到 Video Editing 任务的素材管理面板
                  </p>
                </div>
              )}
            </div>
            
            {/* Timestamp */}
            {executionState?.endTime && (
              <div className="px-5 py-2 bg-gray-50 border-t border-gray-100">
                <div className="text-xs text-gray-500">
                  {executionState.endTime.toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Execution Progress Indicator - Shows during execution */}
        {!isComplete && executionState?.isRunning && (
          <div className="px-5 py-3 bg-blue-50 border border-blue-200 rounded-2xl shadow-sm">
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-blue-700 font-medium">工作流执行中...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkflowExecutionMessage;


