'use client';

import React from 'react';
import { WorkflowNodeExecutionState } from '@/types';

interface NodeExecutionCardProps {
  nodeName: string;
  nodeId: string;
  state: WorkflowNodeExecutionState;
  order: number; // 执行顺序
}

/**
 * Node Execution Card Component
 * Displays individual node execution status, timing, input/output
 * Apple light theme: clean, elegant card design
 */
const NodeExecutionCard: React.FC<NodeExecutionCardProps> = ({
  nodeName,
  nodeId,
  state,
  order,
}) => {
  // 获取状态图标和颜色
  const getStatusConfig = () => {
    switch (state.status) {
      case 'pending':
        return {
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          color: 'text-gray-400',
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-200',
          label: '等待中',
          labelColor: 'text-gray-600 bg-gray-100',
        };
      case 'executing':
        return {
          icon: (
            <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          ),
          color: 'text-blue-500',
          bgColor: 'bg-blue-50/50',
          borderColor: 'border-blue-300',
          label: '执行中',
          labelColor: 'text-blue-700 bg-blue-100',
        };
      case 'completed':
        return {
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          color: 'text-green-500',
          bgColor: 'bg-green-50/50',
          borderColor: 'border-green-300',
          label: '已完成',
          labelColor: 'text-green-700 bg-green-100',
        };
      case 'error':
        return {
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          color: 'text-red-500',
          bgColor: 'bg-red-50/50',
          borderColor: 'border-red-300',
          label: '失败',
          labelColor: 'text-red-700 bg-red-100',
        };
    }
  };

  const config = getStatusConfig();

  // 计算执行时间
  const getExecutionTime = () => {
    if (!state.startTime) return null;
    
    const endTime = state.endTime || new Date();
    const duration = endTime.getTime() - state.startTime.getTime();
    
    if (duration < 1000) {
      return `${duration}ms`;
    }
    return `${(duration / 1000).toFixed(2)}s`;
  };

  // 格式化输出数据
  const formatData = (data: any): string => {
    if (!data) return '';
    
    if (typeof data === 'string') {
      return data;
    }
    
    if (data.text) {
      return data.text;
    }
    
    if (data.llmResponse) {
      return data.llmResponse;
    }
    
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  const executionTime = getExecutionTime();

  return (
    <div
      className={`
        rounded-xl border-2 ${config.borderColor} ${config.bgColor}
        p-4 transition-all duration-300 hover:shadow-md
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          {/* 执行顺序 */}
          <div className="w-8 h-8 rounded-full bg-white border-2 border-gray-300 flex items-center justify-center">
            <span className="text-sm font-bold text-gray-700">{order}</span>
          </div>
          
          {/* 节点名称 */}
          <div>
            <h4 className="text-sm font-semibold text-gray-900">{nodeName}</h4>
            <p className="text-xs text-gray-500 font-mono">{nodeId}</p>
          </div>
        </div>
        
        {/* 状态指示器 */}
        <div className="flex items-center space-x-2">
          {state.status !== 'completed' && (
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${config.labelColor}`}>
              {config.label}
            </span>
          )}
          <div className={config.color}>
            {config.icon}
          </div>
        </div>
      </div>

      {/* 执行时间 */}
      {executionTime && (
        <div className="mb-3 flex items-center space-x-2">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs text-gray-600">
            执行时间: <span className="font-medium text-gray-800">{executionTime}</span>
          </span>
        </div>
      )}

      {/* LLM 系统提示词 - 仅对LLM节点显示 */}
      {state.llmSystemPrompt && (
        <div className="mb-3">
          <div className="flex items-center space-x-2 mb-1.5">
            <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-xs font-semibold text-purple-700">系统提示词</span>
            {state.llmModel && (
              <span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded">
                {state.llmModel}
              </span>
            )}
          </div>
          <div className="bg-purple-50/50 rounded-lg p-3 border border-purple-200">
            <pre className="text-xs text-purple-900 whitespace-pre-wrap font-mono overflow-x-auto max-h-32 overflow-y-auto">
              {state.llmSystemPrompt}
            </pre>
          </div>
        </div>
      )}

      {/* LLM 用户提示词（输入） */}
      {state.llmUserPrompt && (
        <div className="mb-3">
          <div className="flex items-center space-x-2 mb-1.5">
            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-xs font-semibold text-gray-700">Prompt（用户输入）</span>
          </div>
          <div className="bg-white/80 rounded-lg p-3 border border-blue-200">
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono overflow-x-auto max-h-32 overflow-y-auto">
              {state.llmUserPrompt}
            </pre>
          </div>
        </div>
      )}

      {/* LLM 模型回复 */}
      {state.llmResponse && state.status === 'completed' && (
        <div className="mb-3">
          <div className="flex items-center space-x-2 mb-1.5">
            <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-semibold text-gray-700">模型回复</span>
          </div>
          <div className="bg-green-50/50 rounded-lg p-3 border border-green-200">
            <pre className="text-xs text-green-900 whitespace-pre-wrap font-mono overflow-x-auto max-h-32 overflow-y-auto">
              {state.llmResponse}
            </pre>
          </div>
        </div>
      )}

      {/* 传统输入 - 对非LLM节点或无LLM信息时显示 */}
      {state.input && !state.llmUserPrompt && (
        <div className="mb-3">
          <div className="flex items-center space-x-2 mb-1.5">
            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            <span className="text-xs font-semibold text-gray-700">输入</span>
          </div>
          <div className="bg-white/80 rounded-lg p-3 border border-gray-200">
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono overflow-x-auto max-h-32 overflow-y-auto">
              {formatData(state.input)}
            </pre>
          </div>
        </div>
      )}

      {/* 传统输出 - 对非LLM节点或无LLM信息时显示 */}
      {state.output && state.status === 'completed' && !state.llmResponse && (
        <div className="mb-2">
          <div className="flex items-center space-x-2 mb-1.5">
            <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
            </svg>
            <span className="text-xs font-semibold text-gray-700">输出</span>
          </div>
          <div className="bg-white/80 rounded-lg p-3 border border-gray-200">
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono overflow-x-auto max-h-32 overflow-y-auto">
              {formatData(state.output)}
            </pre>
          </div>
        </div>
      )}

      {/* 错误信息 */}
      {state.error && state.status === 'error' && (
        <div className="mb-2">
          <div className="flex items-center space-x-2 mb-1.5">
            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-semibold text-red-700">错误</span>
          </div>
          <div className="bg-white/80 rounded-lg p-3 border border-red-200">
            <p className="text-xs text-red-700 whitespace-pre-wrap">
              {state.error}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default NodeExecutionCard;

