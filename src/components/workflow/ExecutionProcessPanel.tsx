'use client';

import React, { useState, useEffect } from 'react';
import { WorkflowNodeExecutionState } from '@/types';
import NodeExecutionCard from './NodeExecutionCard';

interface ExecutionProcessPanelProps {
  nodeStates: Record<string, WorkflowNodeExecutionState>;
  executionOrder: string[]; // 节点执行顺序
  nodeNames: Record<string, string>; // nodeId -> nodeName 映射
  isCompleted: boolean; // 执行是否完成
}

/**
 * Execution Process Panel Component
 * Displays all node execution cards with collapsible functionality
 * Auto-expands during execution, auto-collapses when completed
 * Apple light theme: clean, elegant panel design
 */
const ExecutionProcessPanel: React.FC<ExecutionProcessPanelProps> = ({
  nodeStates,
  executionOrder,
  nodeNames,
  isCompleted,
}) => {
  // 折叠状态：执行时展开，完成后折叠
  const [isCollapsed, setIsCollapsed] = useState(isCompleted);
  
  // 监听执行状态变化，自动展开/折叠
  useEffect(() => {
    if (!isCompleted) {
      // 执行中：自动展开
      console.log('[ExecutionProcessPanel] Workflow executing, auto-expanding panel');
      setIsCollapsed(false);
    } else {
      // 执行完成：自动折叠
      console.log('[ExecutionProcessPanel] Workflow completed, auto-collapsing panel');
      setIsCollapsed(true);
    }
  }, [isCompleted]);

  console.log('[ExecutionProcessPanel] Rendering:', {
    isCollapsed,
    isCompleted,
    nodeCount: executionOrder.length
  });

  // 计算统计信息
  const stats = React.useMemo(() => {
    const nodes = Object.values(nodeStates);
    return {
      total: nodes.length,
      pending: nodes.filter(n => n.status === 'pending').length,
      executing: nodes.filter(n => n.status === 'executing').length,
      completed: nodes.filter(n => n.status === 'completed').length,
      error: nodes.filter(n => n.status === 'error').length,
    };
  }, [nodeStates]);

  // 计算总执行时间
  const getTotalExecutionTime = () => {
    const completedNodes = Object.values(nodeStates).filter(
      n => n.status === 'completed' && n.startTime && n.endTime
    );
    
    if (completedNodes.length === 0) return null;
    
    const totalMs = completedNodes.reduce((sum, node) => {
      const duration = node.endTime!.getTime() - node.startTime!.getTime();
      return sum + duration;
    }, 0);
    
    return (totalMs / 1000).toFixed(2);
  };

  const totalTime = getTotalExecutionTime();

  return (
    <div className="rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100/50 border-2 border-gray-200 overflow-hidden transition-all duration-300">
      {/* Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full px-5 py-4 bg-white/80 backdrop-blur-sm border-b border-gray-200 hover:bg-white transition-all duration-200"
      >
        <div className="flex items-center space-x-3">
          {/* 折叠图标 */}
          <div
            className={`transform transition-transform duration-300 ${
              isCollapsed ? '-rotate-90' : 'rotate-0'
            }`}
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          
          {/* 标题 */}
          <div className="flex items-center space-x-2">
            <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span className="text-sm font-semibold text-gray-900">执行过程</span>
          </div>
        </div>
        
        {/* 进度条 */}
        {!isCollapsed && stats.total > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-600 mb-1.5">
              <span>进度</span>
              <span className="font-medium">
                {stats.completed + stats.error} / {stats.total}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-500 ease-out"
                style={{
                  width: `${((stats.completed + stats.error) / stats.total) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
      </button>

      {/* Content - Collapsible */}
      <div
        className={`
          transition-all duration-300 ease-in-out overflow-hidden
          ${isCollapsed ? 'max-h-0' : 'max-h-[600px]'}
        `}
      >
        <div className="p-5 space-y-3 overflow-y-auto" style={{ maxHeight: '550px' }}>
          {executionOrder.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm">暂无执行节点</p>
            </div>
          ) : (
            executionOrder.map((nodeId, index) => {
              const state = nodeStates[nodeId];
              const nodeName = nodeNames[nodeId] || nodeId;
              
              if (!state) return null;
              
              return (
                <NodeExecutionCard
                  key={nodeId}
                  nodeId={nodeId}
                  nodeName={nodeName}
                  state={state}
                  order={index + 1}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default ExecutionProcessPanel;

