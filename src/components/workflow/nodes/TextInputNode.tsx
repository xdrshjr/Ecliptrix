'use client';

import React from 'react';
import { TextInputNodeConfig } from '@/types';

interface TextInputNodeProps {
  id: string;
  data: {
    label: string;
    config?: TextInputNodeConfig;
  };
  selected?: boolean;
  onDelete?: () => void;
  onPortMouseDown?: (nodeId: string, portType: 'input' | 'output', portId: string, event: React.MouseEvent) => void;
  executionStatus?: 'pending' | 'executing' | 'completed' | 'error';
}

/**
 * Text Input Node Component
 * Represents a text input node in the workflow canvas
 * Allows users to input text content that can be passed to other nodes
 * Memoized to prevent unnecessary re-renders during drag operations
 */
const TextInputNode: React.FC<TextInputNodeProps> = React.memo(({ 
  id, 
  data, 
  selected = false,
  onDelete,
  onPortMouseDown,
  executionStatus = 'pending'
}) => {
  console.log('[TextInputNode] Rendering node:', { 
    id, 
    label: data.label, 
    selected,
    config: data.config,
    hasContent: !!data.config?.content,
    executionStatus
  });

  // Check if node is configured
  const isConfigured = !!(data.config?.content && data.config.content.trim().length > 0);
  const displayContent = data.config?.content || '';

  const handleInputPortMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[TextInputNode] Input port mouse down:', { nodeId: id });
    if (onPortMouseDown) {
      onPortMouseDown(id, 'input', 'input-1', e);
    }
  };

  const handleOutputPortMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[TextInputNode] Output port mouse down:', { nodeId: id });
    if (onPortMouseDown) {
      onPortMouseDown(id, 'output', 'output-1', e);
    }
  };

  return (
    <div 
      className={`
        bg-white rounded-lg border-2 shadow-lg min-w-[200px] max-w-[280px] select-none relative
        ${selected ? 'border-blue-500 ring-2 ring-blue-200' : 
          executionStatus === 'executing' ? 'border-yellow-500 ring-2 ring-yellow-200' :
          executionStatus === 'completed' ? 'border-green-500 ring-2 ring-green-200' :
          executionStatus === 'error' ? 'border-red-500 ring-2 ring-red-200' :
          isConfigured ? 'border-teal-400' : 'border-gray-300'}
        hover:shadow-xl transition-all duration-200
      `}
    >
      {/* Execution Status Indicator */}
      {executionStatus === 'executing' && (
        <div className="absolute -top-2 -right-2 w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center animate-pulse shadow-lg z-10">
          <svg className="w-4 h-4 text-white animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      )}
      {executionStatus === 'completed' && (
        <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-lg z-10">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
      {executionStatus === 'error' && (
        <div className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center shadow-lg z-10">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      )}
      
      {/* Node Header */}
      <div className={`
        text-white px-4 py-2 rounded-t-md flex items-center justify-between
        ${isConfigured ? 'bg-gradient-to-r from-teal-500 to-cyan-600' : 'bg-gradient-to-r from-gray-500 to-gray-600'}
      `}>
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
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
              console.log('[TextInputNode] Delete button clicked:', { id });
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

        {/* Node Content Display */}
        {isConfigured ? (
          <div className="text-xs space-y-1">
            <div className="text-gray-600 font-medium mb-1">Content:</div>
            <div className="text-gray-700 text-xs bg-gray-50 p-2 rounded border border-gray-200 max-h-24 overflow-y-auto break-words whitespace-pre-wrap">
              {displayContent.length > 150 
                ? `${displayContent.substring(0, 150)}...` 
                : displayContent}
            </div>
            {displayContent.length > 150 && (
              <div className="text-xs text-gray-400 italic mt-1">
                Double click to view full content
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-center py-2">
            <div className="text-gray-400 italic mb-1">No content</div>
            <div className="text-xs text-gray-500">Double click to add text</div>
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

TextInputNode.displayName = 'TextInputNode';

export default TextInputNode;

