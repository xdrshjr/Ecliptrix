'use client';

import React from 'react';

import { ChatLLMNodeConfig } from '@/types';

interface ChatLLMNodeProps {
  id: string;
  data: {
    label: string;
    config?: ChatLLMNodeConfig;
  };
  selected?: boolean;
  onDelete?: () => void;
  onPortMouseDown?: (nodeId: string, portType: 'input' | 'output', portId: string, event: React.MouseEvent) => void;
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
  onDelete,
  onPortMouseDown 
}) => {
  console.log('[ChatLLMNode] Rendering node:', { 
    id, 
    label: data.label, 
    selected,
    config: data.config 
  });

  // Check if node is configured
  const isConfigured = !!(
    data.config?.systemPrompt ||
    data.config?.model ||
    data.config?.temperature !== undefined ||
    data.config?.maxTokens
  );

  const handleInputPortMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[ChatLLMNode] Input port mouse down:', { nodeId: id });
    if (onPortMouseDown) {
      onPortMouseDown(id, 'input', 'input-1', e);
    }
  };

  const handleOutputPortMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[ChatLLMNode] Output port mouse down:', { nodeId: id });
    if (onPortMouseDown) {
      onPortMouseDown(id, 'output', 'output-1', e);
    }
  };

  return (
    <div 
      className={`
        bg-white rounded-lg border-2 shadow-lg min-w-[200px] select-none
        ${selected ? 'border-blue-500 ring-2 ring-blue-200' : isConfigured ? 'border-green-400' : 'border-gray-300'}
        hover:shadow-xl transition-all duration-200
      `}
    >
      {/* Node Header */}
      <div className={`
        text-white px-4 py-2 rounded-t-md flex items-center justify-between
        ${isConfigured ? 'bg-gradient-to-r from-green-500 to-emerald-600' : 'bg-gradient-to-r from-purple-500 to-indigo-600'}
      `}>
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <span className="text-sm font-semibold">{data.label}</span>
          {isConfigured && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white/20 text-white">
              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Configured
            </span>
          )}
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
          <div 
            className="w-4 h-4 rounded-full bg-green-500 border-2 border-white shadow-md cursor-pointer hover:bg-green-600 transition-colors" 
            title="Input Port" 
            onMouseDown={handleInputPortMouseDown}
            data-port-type="input"
            data-port-id="input-1"
            data-node-id={id}
          />
          <span className="text-xs text-gray-600 select-none">Input</span>
        </div>

        {/* Node Configuration Display */}
        {isConfigured ? (
          <div className="text-xs space-y-1">
            <div className="flex items-center space-x-1">
              <span className="text-gray-600 font-medium">Model:</span>
              <span className="text-gray-900">{data.config?.model || 'Not set'}</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="text-gray-600 font-medium">Temp:</span>
              <span className="text-gray-900">{data.config?.temperature?.toFixed(1) ?? 'N/A'}</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="text-gray-600 font-medium">Max Tokens:</span>
              <span className="text-gray-900">{data.config?.maxTokens || 'N/A'}</span>
            </div>
            {data.config?.systemPrompt && (
              <div className="pt-1 border-t border-gray-200">
                <div className="text-gray-600 font-medium mb-0.5">System Prompt:</div>
                <div className="text-gray-700 text-xs line-clamp-2 bg-gray-50 p-1.5 rounded">
                  {data.config.systemPrompt}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-center py-2">
            <div className="text-gray-400 italic mb-1">Not configured</div>
            <div className="text-xs text-gray-500">Click to configure</div>
          </div>
        )}

        {/* Output Port */}
        <div className="flex items-center justify-end space-x-2">
          <span className="text-xs text-gray-600 select-none">Output</span>
          <div 
            className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-md cursor-pointer hover:bg-blue-600 transition-colors" 
            title="Output Port" 
            onMouseDown={handleOutputPortMouseDown}
            data-port-type="output"
            data-port-id="output-1"
            data-node-id={id}
          />
        </div>
      </div>
    </div>
  );
});

ChatLLMNode.displayName = 'ChatLLMNode';

export default ChatLLMNode;

