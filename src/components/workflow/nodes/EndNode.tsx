'use client';

import React from 'react';
import { BaseWorkflowNode, BaseNodeProps } from './BaseWorkflowNode';

/**
 * End Node Component
 * Represents the ending point of a workflow with an input port
 * Memoized to prevent unnecessary re-renders during drag operations
 */
const EndNode: React.FC<BaseNodeProps> = React.memo((props) => {
  const { id, data, selected, onDelete, onPortMouseDown, executionStatus } = props;
  
  console.log('[EndNode] Rendering node:', { 
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
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
          </svg>
        ),
        gradientColors: 'bg-red-600',
        hasInputPort: true,
        hasOutputPort: false,
        inputPortLabel: 'Input',
        isConfigured: true,
        renderContent: () => (
          <div className="text-xs text-muted-foreground text-center py-1">
            Workflow End Point
          </div>
        ),
      }}
    />
  );
});

EndNode.displayName = 'EndNode';

export default EndNode;

