'use client';

import React from 'react';

interface EndNodeProps {
  id: string;
  data: {
    label: string;
  };
  selected?: boolean;
  onDelete?: () => void;
  onPortMouseDown?: (nodeId: string, portType: 'input', portId: string, event: React.MouseEvent) => void;
  executionStatus?: 'pending' | 'executing' | 'completed' | 'error';
}

/**
 * End Node Component
 * Represents the ending point of a workflow with an input port
 * Memoized to prevent unnecessary re-renders during drag operations
 */
const EndNode: React.FC<EndNodeProps> = React.memo(({ 
  id, 
  data, 
  selected = false,
  onDelete,
  onPortMouseDown,
  executionStatus = 'pending'
}) => {
  console.log('[EndNode] Rendering node:', { 
    id, 
    label: data.label, 
    selected,
    executionStatus
  });

  const handlePortMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[EndNode] Input port mouse down:', { nodeId: id });
    if (onPortMouseDown) {
      onPortMouseDown(id, 'input', 'input-1', e);
    }
  };

  return (
    <div 
      className={`
        bg-white rounded-lg border-2 shadow-lg min-w-[180px] select-none relative
        ${selected ? 'border-blue-500 ring-2 ring-blue-200' : 
          executionStatus === 'executing' ? 'border-yellow-500 ring-2 ring-yellow-200' :
          executionStatus === 'completed' ? 'border-green-500 ring-2 ring-green-200' :
          executionStatus === 'error' ? 'border-red-500 ring-2 ring-red-200' :
          'border-gray-300'}
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
      <div className="bg-gradient-to-r from-red-500 to-rose-600 text-white px-4 py-2 rounded-t-md flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
          </svg>
          <span className="text-sm font-semibold">{data.label}</span>
        </div>
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              console.log('[EndNode] Delete button clicked:', { id });
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
            className="w-4 h-4 rounded-full bg-green-500 border-2 border-white shadow-md cursor-pointer hover:bg-green-600 transition-colors relative"
            title="Input Port"
            onMouseDown={handlePortMouseDown}
            data-port-type="input"
            data-port-id="input-1"
            data-node-id={id}
          />
          <span className="text-xs text-gray-600 select-none">Input</span>
        </div>

        <div className="text-xs text-gray-500 text-center">
          Workflow End Point
        </div>
      </div>
    </div>
  );
});

EndNode.displayName = 'EndNode';

export default EndNode;

