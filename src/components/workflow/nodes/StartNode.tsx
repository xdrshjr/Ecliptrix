'use client';

import React from 'react';
import { BaseWorkflowNode, BaseNodeProps } from './BaseWorkflowNode';

/**
 * Start Node Component
 * Represents the starting point of a workflow with an output port
 * Memoized to prevent unnecessary re-renders during drag operations
 */
const StartNode: React.FC<BaseNodeProps> = React.memo((props) => {
  const { id, data, selected, onDelete, onPortMouseDown, executionStatus } = props;
  
  console.log('[StartNode] Rendering node:', { 
    id, 
    label: data.label, 
    selected,
    executionStatus
  });

  return (
    <BaseWorkflowNode
      {...props}
      config={{
        icon: (
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        gradientColors: 'bg-gradient-to-r from-green-500 to-emerald-600',
        hasInputPort: false,
        hasOutputPort: true,
        outputPortLabel: 'Output',
        isConfigured: true,
        renderContent: () => (
          <div className="text-xs text-gray-500 text-center py-1">
            Workflow Start Point
          </div>
        ),
      }}
    />
  );
});

StartNode.displayName = 'StartNode';

export default StartNode;

