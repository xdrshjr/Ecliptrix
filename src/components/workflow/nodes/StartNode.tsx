'use client';

import React from 'react';

interface StartNodeProps {
  id: string;
  data: {
    label: string;
  };
  selected?: boolean;
  onDelete?: () => void;
  onPortMouseDown?: (nodeId: string, portType: 'output', portId: string, event: React.MouseEvent) => void;
}

/**
 * Start Node Component
 * Represents the starting point of a workflow with an output port
 * Memoized to prevent unnecessary re-renders during drag operations
 */
const StartNode: React.FC<StartNodeProps> = React.memo(({ 
  id, 
  data, 
  selected = false,
  onDelete,
  onPortMouseDown
}) => {
  console.log('[StartNode] Rendering node:', { 
    id, 
    label: data.label, 
    selected
  });

  const handlePortMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[StartNode] Output port mouse down:', { nodeId: id });
    if (onPortMouseDown) {
      onPortMouseDown(id, 'output', 'output-1', e);
    }
  };

  return (
    <div 
      className={`
        bg-white rounded-lg border-2 shadow-lg min-w-[180px] select-none
        ${selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300'}
        hover:shadow-xl transition-all duration-200
      `}
    >
      {/* Node Header */}
      <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-4 py-2 rounded-t-md flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-semibold">{data.label}</span>
        </div>
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              console.log('[StartNode] Delete button clicked:', { id });
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
        <div className="text-xs text-gray-500 text-center">
          Workflow Start Point
        </div>

        {/* Output Port */}
        <div className="flex items-center justify-end space-x-2">
          <span className="text-xs text-gray-600 select-none">Output</span>
          <div 
            className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-md cursor-pointer hover:bg-blue-600 transition-colors relative"
            title="Output Port"
            onMouseDown={handlePortMouseDown}
            data-port-type="output"
            data-port-id="output-1"
            data-node-id={id}
          />
        </div>
      </div>
    </div>
  );
});

StartNode.displayName = 'StartNode';

export default StartNode;

