'use client';

import React from 'react';

interface ChatLLMNodeProps {
  id: string;
  data: {
    label: string;
    config?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
    };
  };
  selected?: boolean;
  onDelete?: () => void;
}

/**
 * Chat LLM Node Component
 * Represents a Chat LLM node in the workflow canvas
 * Memoized to prevent unnecessary re-renders during drag operations
 */
const ChatLLMNode: React.FC<ChatLLMNodeProps> = React.memo(({ 
  id, 
  data, 
  selected = false,
  onDelete 
}) => {
  console.log('[ChatLLMNode] Rendering node:', { 
    id, 
    label: data.label, 
    selected,
    config: data.config 
  });

  return (
    <div 
      className={`
        bg-white rounded-lg border-2 shadow-lg min-w-[200px]
        ${selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300'}
        hover:shadow-xl transition-all duration-200
      `}
    >
      {/* Node Header */}
      <div className="bg-gradient-to-r from-purple-500 to-indigo-600 text-white px-4 py-2 rounded-t-md flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <span className="text-sm font-semibold">{data.label}</span>
        </div>
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              console.log('[ChatLLMNode] Delete button clicked:', { id });
              onDelete();
            }}
            className="hover:bg-white/20 rounded p-1 transition-colors"
            title="Delete node"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Node Body */}
      <div className="p-4 space-y-3">
        {/* Input Port */}
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-green-500 border-2 border-white shadow-md" title="Input" />
          <span className="text-xs text-gray-600">Input</span>
        </div>

        {/* Node Configuration Display */}
        <div className="text-xs text-gray-500 space-y-1">
          <div>Model: {data.config?.model || 'gpt-4'}</div>
          <div>Temperature: {data.config?.temperature ?? 0.7}</div>
          <div>Max Tokens: {data.config?.maxTokens || 2000}</div>
        </div>

        {/* Output Port */}
        <div className="flex items-center justify-end space-x-2">
          <span className="text-xs text-gray-600">Output</span>
          <div className="w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow-md" title="Output" />
        </div>
      </div>
    </div>
  );
});

ChatLLMNode.displayName = 'ChatLLMNode';

export default ChatLLMNode;

