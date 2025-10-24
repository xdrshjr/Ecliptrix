'use client';

import React, { useState } from 'react';
import { WorkflowExecutionState, WorkflowNodeExecutionState } from '@/types';

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
 * Features:
 * - Collapsible node execution details
 * - Status indicators for each node
 * - Execution timeline
 * - Final result display
 * Apple light design style
 */
const WorkflowExecutionMessage: React.FC<WorkflowExecutionMessageProps> = ({
  workflowName,
  executionState,
  finalResult,
  isComplete,
}) => {
  const [isExpanded, setIsExpanded] = useState(!isComplete);

  // Get nodes in execution order
  const getExecutionOrder = (): string[] => {
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
  };

  const executionOrder = getExecutionOrder();
  const nodeStates = executionState?.nodeStates || {};

  // Get status icon and color
  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'executing':
        return {
          icon: (
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          ),
          color: 'text-blue-600',
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-200'
        };
      case 'completed':
        return {
          icon: (
            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ),
          color: 'text-green-600',
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200'
        };
      case 'error':
        return {
          icon: (
            <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ),
          color: 'text-red-600',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200'
        };
      default:
        return {
          icon: (
            <div className="w-4 h-4 border-2 border-gray-300 rounded-full" />
          ),
          color: 'text-gray-400',
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-200'
        };
    }
  };

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] w-full">
        <div className="rounded-2xl overflow-hidden bg-white border border-gray-200 shadow-md">
          {/* Header */}
          <div className="px-5 py-3 bg-gradient-to-r from-purple-50 to-blue-50 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-600 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">{workflowName}</h4>
                  <p className="text-xs text-gray-600">
                    {isComplete ? '执行完成' : '执行中...'}
                  </p>
                </div>
              </div>
              
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1.5 rounded-lg hover:bg-white/50 transition-colors"
              >
                <svg
                  className={`w-5 h-5 text-gray-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Execution Details - Collapsible */}
          {isExpanded && executionOrder.length > 0 && (
            <div className="px-5 py-4 bg-gray-50 border-b border-gray-200">
              <div className="space-y-3">
                {executionOrder.map((nodeId, index) => {
                  const nodeState: WorkflowNodeExecutionState = nodeStates[nodeId];
                  if (!nodeState) return null;

                  const nodeName = executionState?.logs.find(l => l.nodeId === nodeId)?.nodeName || nodeId;
                  const statusDisplay = getStatusDisplay(nodeState.status);

                  return (
                    <div key={nodeId} className="flex items-start space-x-3">
                      {/* Timeline connector */}
                      <div className="flex flex-col items-center">
                        <div className={`w-6 h-6 rounded-full ${statusDisplay.bgColor} border-2 ${statusDisplay.borderColor} flex items-center justify-center`}>
                          {statusDisplay.icon}
                        </div>
                        {index < executionOrder.length - 1 && (
                          <div className="w-0.5 h-8 bg-gray-200 my-1" />
                        )}
                      </div>

                      {/* Node info */}
                      <div className="flex-1 pb-2">
                        <div className="flex items-center justify-between">
                          <h5 className={`text-sm font-medium ${statusDisplay.color}`}>
                            {nodeName}
                          </h5>
                          {nodeState.startTime && nodeState.endTime && (
                            <span className="text-xs text-gray-500">
                              {Math.round((nodeState.endTime.getTime() - nodeState.startTime.getTime()) / 1000)}s
                            </span>
                          )}
                        </div>
                        
                        {nodeState.error && (
                          <p className="text-xs text-red-600 mt-1">{nodeState.error}</p>
                        )}
                        
                        {nodeState.output && nodeState.status === 'completed' && (
                          <div className="mt-2 p-2 bg-white border border-gray-200 rounded-lg">
                            <p className="text-xs text-gray-700 line-clamp-2">
                              {typeof nodeState.output === 'string' 
                                ? nodeState.output 
                                : JSON.stringify(nodeState.output).substring(0, 100)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Final Result */}
          {finalResult && (
            <div className="px-5 py-4 bg-white">
              <div className="flex items-start space-x-2 mb-2">
                <div className="w-5 h-5 bg-green-500 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h5 className="text-sm font-semibold text-gray-900">最终结果</h5>
              </div>
              <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap pl-7">
                {finalResult}
              </div>
            </div>
          )}

          {/* Execution Progress (when not complete) */}
          {!isComplete && executionState?.isRunning && (
            <div className="px-5 py-3 bg-blue-50 border-t border-blue-100">
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-blue-700 font-medium">工作流执行中...</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkflowExecutionMessage;

