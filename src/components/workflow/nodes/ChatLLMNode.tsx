'use client';

import React from 'react';
import { BaseWorkflowNode, BaseNodeProps } from './BaseWorkflowNode';
import { ChatLLMNodeConfig } from '@/types';

/**
 * Chat LLM Node Component
 * Represents a Chat LLM node in the workflow canvas
 * Memoized to prevent unnecessary re-renders during drag operations
 */
const ChatLLMNode: React.FC<BaseNodeProps> = React.memo((props) => {
  const { id, data, selected, onDelete, onPortMouseDown, executionStatus } = props;
  
  const config = data.config as ChatLLMNodeConfig | undefined;
  const isConfigured = !!(
    config?.systemPrompt ||
    config?.model ||
    config?.temperature !== undefined ||
    config?.maxTokens
  );
  
  console.log('[ChatLLMNode] Rendering node:', { 
    id, 
    label: data.label, 
    selected,
    hasConfig: !!config,
    executionStatus
  });

  return (
    <BaseWorkflowNode
      {...props}
      config={{
        icon: (
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        ),
        gradientColors: isConfigured 
          ? 'bg-gradient-to-r from-purple-500 to-indigo-600' 
          : 'bg-gradient-to-r from-gray-400 to-gray-500',
        hasInputPort: true,
        hasOutputPort: true,
        inputPortLabel: 'Input',
        outputPortLabel: 'Output',
        isConfigured,
        renderContent: () => (
          isConfigured ? (
            <div className="text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Model:</span>
                <span className="text-gray-900 text-xs">{config?.model || 'Not set'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Temp:</span>
                <span className="text-gray-900 text-xs">{config?.temperature?.toFixed(1) ?? 'N/A'}</span>
              </div>
              {config?.systemPrompt && (
                <div className="pt-1 border-t border-gray-200">
                  <div className="text-gray-600 font-medium mb-0.5">System Prompt:</div>
                  <div className="text-gray-700 text-xs bg-gray-50 p-1.5 rounded max-h-16 overflow-y-auto line-clamp-3">
                    {config.systemPrompt.substring(0, 80)}
                    {config.systemPrompt.length > 80 && '...'}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-center py-1">
              <div className="text-gray-400 italic">Not configured</div>
              <div className="text-xs text-gray-500 mt-0.5">Double click to configure</div>
            </div>
          )
        ),
      }}
    />
  );
});

ChatLLMNode.displayName = 'ChatLLMNode';

export default ChatLLMNode;
