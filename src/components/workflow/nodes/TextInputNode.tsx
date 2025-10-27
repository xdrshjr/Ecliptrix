'use client';

import React from 'react';
import { BaseWorkflowNode, BaseNodeProps } from './BaseWorkflowNode';
import { TextInputNodeConfig } from '@/types';

/**
 * Text Input Node Component
 * Represents a text input node in the workflow canvas
 * Allows users to input text content that can be passed to other nodes
 * Memoized to prevent unnecessary re-renders during drag operations
 */
const TextInputNode: React.FC<BaseNodeProps> = React.memo((props) => {
  const { id, data, selected, onDelete, onPortMouseDown, executionStatus } = props;
  
  const config = data.config as TextInputNodeConfig | undefined;
  const isConfigured = !!(config?.content && config.content.trim().length > 0);
  const displayContent = config?.content || '';
  
  console.log('[TextInputNode] Rendering node:', { 
    id, 
    label: data.label, 
    selected,
    hasContent: !!config?.content,
    executionStatus
  });

  return (
    <BaseWorkflowNode
      {...props}
      config={{
        icon: (
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        ),
        gradientColors: isConfigured 
          ? 'bg-gradient-to-r from-teal-500 to-cyan-600' 
          : 'bg-gradient-to-r from-gray-400 to-gray-500',
        hasInputPort: true,
        hasOutputPort: true,
        inputPortLabel: 'Input',
        outputPortLabel: 'Output',
        isConfigured,
        renderContent: () => (
          isConfigured ? (
            <div className="text-xs space-y-1">
              <div className="text-gray-600 font-medium text-xs">Content:</div>
              <div className="text-gray-700 text-xs bg-gray-50 p-2 rounded border border-gray-200 max-h-20 overflow-y-auto break-words whitespace-pre-wrap">
                {displayContent.length > 100 
                  ? `${displayContent.substring(0, 100)}...` 
                  : displayContent}
              </div>
              {displayContent.length > 100 && (
                <div className="text-xs text-gray-400 italic">
                  Double click for full content
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-center py-1">
              <div className="text-gray-400 italic">No content</div>
              <div className="text-xs text-gray-500 mt-0.5">Double click to configure</div>
            </div>
          )
        ),
      }}
    />
  );
});

TextInputNode.displayName = 'TextInputNode';

export default TextInputNode;

