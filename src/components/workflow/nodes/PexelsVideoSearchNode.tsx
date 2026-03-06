'use client';

import React from 'react';
import { BaseWorkflowNode, BaseNodeProps } from './BaseWorkflowNode';
import { PexelsVideoSearchNodeConfig } from '@/types';

/**
 * Pexels Video Search Node Component
 * Represents a Pexels video search node in the workflow canvas
 * Searches for videos from Pexels based on configured keywords
 * Outputs video URLs list for use in subsequent workflow nodes
 * Memoized to prevent unnecessary re-renders during drag operations
 */
const PexelsVideoSearchNode: React.FC<BaseNodeProps> = React.memo((props) => {
  const { id, data, selected, onDelete, onPortMouseDown, executionStatus } = props;
  
  const config = data.config as PexelsVideoSearchNodeConfig | undefined;
  const isConfigured = !!(config?.keywords && config.keywords.trim().length > 0);
  const displayKeywords = config?.keywords || '';
  const videoCount = config?.count || 5;
  
  console.log('[PexelsVideoSearchNode] Rendering node:', { 
    id, 
    label: data.label, 
    selected,
    hasKeywords: !!config?.keywords,
    executionStatus
  });

  return (
    <BaseWorkflowNode
      {...props}
      config={{
        icon: (
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        ),
        gradientColors: isConfigured
          ? 'bg-secondary'
          : 'bg-muted',
        hasInputPort: true,
        hasOutputPort: true,
        inputPortLabel: 'Keywords',
        outputPortLabel: 'Videos',
        isConfigured,
        renderContent: () => (
          isConfigured ? (
            <div className="text-xs space-y-1.5">
              <div>
                <div className="text-muted-foreground font-medium mb-0.5">Keywords:</div>
                <div className="text-foreground text-xs bg-indigo-50/50 p-1.5 rounded border border-indigo-200 max-h-16 overflow-y-auto">
                  {displayKeywords.length > 60 
                    ? `${displayKeywords.substring(0, 60)}...` 
                    : displayKeywords}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-medium">Count:</span>
                <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs font-semibold">
                  {videoCount}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-xs text-center py-1">
              <div className="text-muted-foreground italic">Not configured</div>
              <div className="text-xs text-muted-foreground mt-0.5">Double click to configure</div>
            </div>
          )
        ),
      }}
    />
  );
});

PexelsVideoSearchNode.displayName = 'PexelsVideoSearchNode';

export default PexelsVideoSearchNode;
