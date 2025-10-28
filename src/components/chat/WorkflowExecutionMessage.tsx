'use client';

import React, { useMemo } from 'react';
import { WorkflowExecutionState } from '@/types';
import ExecutionProcessPanel from '@/components/workflow/ExecutionProcessPanel';

interface WorkflowExecutionMessageProps {
  workflowName: string;
  executionState?: WorkflowExecutionState;
  finalResult?: string;
  isComplete: boolean;
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

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] w-full space-y-3">
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
              <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                {finalResult}
              </div>
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


