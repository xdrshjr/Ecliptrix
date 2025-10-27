'use client';

import React from 'react';
import { BaseWorkflowNode, BaseNodeProps } from './BaseWorkflowNode';
import { TavilySearchNodeConfig } from '@/types';

/**
 * Tavily Search Node Component
 * Represents a Tavily search node in the workflow canvas
 * Searches for content based on configured keywords using Tavily API
 * Outputs search results list for use in subsequent workflow nodes
 * Memoized to prevent unnecessary re-renders during drag operations
 */
const TavilySearchNode: React.FC<BaseNodeProps> = React.memo((props) => {
  const { id, data, selected, onDelete, onPortMouseDown, executionStatus } = props;
  
  const config = data.config as TavilySearchNodeConfig | undefined;
  const isConfigured = !!(config?.keywords && config.keywords.trim().length > 0);
  const displayKeywords = config?.keywords || '';
  const searchCount = config?.count || 5;
  
  console.log('[TavilySearchNode] Rendering node:', { 
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
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        ),
        gradientColors: isConfigured 
          ? 'bg-gradient-to-r from-emerald-500 to-teal-600' 
          : 'bg-gradient-to-r from-gray-400 to-gray-500',
        hasInputPort: true,
        hasOutputPort: true,
        inputPortLabel: 'Keywords',
        outputPortLabel: 'Results',
        isConfigured,
        renderContent: () => (
          isConfigured ? (
            <div className="text-xs space-y-1.5">
              <div>
                <div className="text-gray-600 font-medium mb-0.5">Keywords:</div>
                <div className="text-gray-700 text-xs bg-emerald-50/50 p-1.5 rounded border border-emerald-200 max-h-16 overflow-y-auto">
                  {displayKeywords.length > 60 
                    ? `${displayKeywords.substring(0, 60)}...` 
                    : displayKeywords}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Count:</span>
                <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold">
                  {searchCount}
                </span>
              </div>
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

TavilySearchNode.displayName = 'TavilySearchNode';

export default TavilySearchNode;

