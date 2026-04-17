'use client';

import React from 'react';
import { WorkflowNodeExecutionState } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';

interface NodeExecutionCardProps {
  nodeName: string;
  nodeId: string;
  state: WorkflowNodeExecutionState;
  order: number; // 执行顺序
}

/**
 * Node Execution Card Component
 * Displays individual node execution status, timing, input/output
 * Figma-style: clean, theme-aware card design
 */
const NodeExecutionCard: React.FC<NodeExecutionCardProps> = ({
  nodeName,
  nodeId,
  state,
  order,
}) => {
  const { t } = useLocale();

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
          color: 'text-muted-foreground',
          bgColor: 'bg-muted',
          borderColor: 'border-border',
          label: t.workflowNodes.execution.waiting,
          labelColor: 'text-muted-foreground bg-accent',
        };
      case 'executing':
        return {
          icon: (
            <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          ),
          color: 'text-primary',
          bgColor: 'bg-primary/10',
          borderColor: 'border-primary/30',
          label: t.workflowNodes.execution.executing,
          labelColor: 'text-primary bg-primary/15',
        };
      case 'completed':
        return {
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          color: 'text-green-500',
          bgColor: 'bg-green-500/10',
          borderColor: 'border-green-500/30',
          label: t.workflowNodes.execution.completed,
          labelColor: 'text-green-500 bg-green-500/15',
        };
      case 'error':
        return {
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          color: 'text-red-500',
          bgColor: 'bg-destructive/10',
          borderColor: 'border-destructive/30',
          label: t.workflowNodes.execution.failed,
          labelColor: 'text-destructive bg-destructive/15',
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
        rounded-md border ${config.borderColor} ${config.bgColor}
        p-4 transition-colors duration-300
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          {/* 执行顺序 */}
          <div className="w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center">
            <span className="text-sm font-bold text-foreground">{order}</span>
          </div>
          
          {/* 节点名称 */}
          <div>
            <h4 className="text-sm font-semibold text-foreground">{nodeName}</h4>
            <p className="text-xs text-muted-foreground font-mono">{nodeId}</p>
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
          <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs text-muted-foreground">
            {t.workflowNodes.execution.executionTime} <span className="font-medium text-foreground">{executionTime}</span>
          </span>
        </div>
      )}

      {/* LLM 系统提示词 - 仅对LLM节点显示 */}
      {state.llmSystemPrompt && (
        <div className="mb-3">
          <div className="flex items-center space-x-2 mb-1.5">
            <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-xs font-semibold text-primary">{t.workflowNodes.execution.systemPrompt}</span>
            {state.llmModel && (
              <span className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded">
                {state.llmModel}
              </span>
            )}
          </div>
          <div className="bg-primary/10 rounded-lg p-3 border border-primary/30">
            <pre className="text-xs text-foreground whitespace-pre-wrap font-mono overflow-x-auto max-h-32 overflow-y-auto">
              {state.llmSystemPrompt}
            </pre>
          </div>
        </div>
      )}

      {/* LLM 用户提示词（输入） */}
      {state.llmUserPrompt && (
        <div className="mb-3">
          <div className="flex items-center space-x-2 mb-1.5">
            <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-xs font-semibold text-foreground">{t.workflowNodes.execution.userInput}</span>
          </div>
          <div className="bg-card rounded-lg p-3 border border-primary/30">
            <pre className="text-xs text-foreground whitespace-pre-wrap font-mono overflow-x-auto max-h-32 overflow-y-auto">
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
            <span className="text-xs font-semibold text-foreground">{t.workflowNodes.execution.modelReply}</span>
          </div>
          <div className="bg-green-500/10 rounded-lg p-3 border border-green-500/30">
            <pre className="text-xs text-foreground whitespace-pre-wrap font-mono overflow-x-auto max-h-32 overflow-y-auto">
              {state.llmResponse}
            </pre>
          </div>
        </div>
      )}

      {/* 传统输入 - 对非LLM节点或无LLM信息时显示 */}
      {state.input && !state.llmUserPrompt && (
        <div className="mb-3">
          <div className="flex items-center space-x-2 mb-1.5">
            <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            <span className="text-xs font-semibold text-foreground">{t.workflowNodes.execution.input}</span>
          </div>
          <div className="bg-card rounded-lg p-3 border border-border">
            <pre className="text-xs text-foreground whitespace-pre-wrap font-mono overflow-x-auto max-h-32 overflow-y-auto">
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
            <span className="text-xs font-semibold text-foreground">{t.workflowNodes.execution.output}</span>
          </div>
          <div className="bg-card rounded-lg p-3 border border-border">
            <pre className="text-xs text-foreground whitespace-pre-wrap font-mono overflow-x-auto max-h-32 overflow-y-auto">
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
            <span className="text-xs font-semibold text-destructive">{t.workflowNodes.execution.error}</span>
          </div>
          <div className="bg-card rounded-lg p-3 border border-destructive/30">
            <p className="text-xs text-destructive whitespace-pre-wrap">
              {state.error}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default NodeExecutionCard;

