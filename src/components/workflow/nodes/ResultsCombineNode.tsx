'use client';

import React from 'react';
import { BaseWorkflowNode, BaseNodeProps } from './BaseWorkflowNode';
import { ResultsCombineNodeConfig } from '@/types';

/**
 * Results Combine Node Component
 * Accepts array input, transforms each item via LLM, and combines results
 * Features elegant blue color scheme following Apple design principles
 * Memoized to prevent unnecessary re-renders during drag operations
 */
const ResultsCombineNode: React.FC<BaseNodeProps> = React.memo((props) => {
  const { id, data, selected, onDelete, onPortMouseDown, executionStatus } = props;
  
  const config = data.config as ResultsCombineNodeConfig | undefined;
  const isConfigured = !!(
    config?.systemPrompt ||
    config?.model ||
    config?.temperature !== undefined ||
    config?.maxTokens
  );
  
  const hasOutputSchema = !!(config?.outputSchema && config.outputSchema.length > 0);
  
  console.log('[ResultsCombineNode] Rendering node:', { 
    id, 
    label: data.label, 
    selected,
    hasConfig: !!config,
    hasOutputSchema,
    executionStatus
  });

  return (
    <BaseWorkflowNode
      {...props}
      config={{
        icon: (
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        ),
        gradientColors: isConfigured 
          ? 'bg-gradient-to-r from-blue-500 to-blue-600' 
          : 'bg-muted',
        hasInputPort: true,
        hasOutputPort: true,
        inputPortLabel: 'Array Input',
        outputPortLabel: 'Combined',
        isConfigured,
        renderContent: () => (
          isConfigured ? (
            <div className="text-xs space-y-1.5">
              {/* Model Information */}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-medium">Model:</span>
                <span className="text-foreground text-xs">{config?.model || 'Not set'}</span>
              </div>
              
              {/* Temperature */}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-medium">Temp:</span>
                <span className="text-foreground text-xs">{config?.temperature?.toFixed(1) ?? 'N/A'}</span>
              </div>
              
              {/* Array Input Badge */}
              <div className="pt-1 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-medium">Input Type:</span>
                  <div className="inline-flex items-center px-2 py-0.5 bg-blue-100 border border-blue-300 rounded">
                    <svg className="w-3 h-3 text-blue-700 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                    <span className="text-xs font-semibold text-blue-700">Array[]</span>
                  </div>
                </div>
              </div>
              
              {/* Output Schema Info */}
              {hasOutputSchema && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-medium">Schema:</span>
                  <span className="text-green-700 text-xs flex items-center">
                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Defined
                  </span>
                </div>
              )}
              
              {/* Output Format Badge */}
              <div className="pt-1 border-t border-border">
                <div className="flex items-center justify-center">
                  <div className="inline-flex items-center px-2 py-1 bg-blue-50 border border-blue-200 rounded-md">
                    <svg className="w-3 h-3 text-blue-700 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    <span className="text-xs font-semibold text-blue-700">Combines & Standardizes</span>
                  </div>
                </div>
              </div>
              
              {/* System Prompt Preview */}
              {config?.systemPrompt && (
                <div className="pt-1 border-t border-border">
                  <div className="text-muted-foreground font-medium mb-0.5">Transform Prompt:</div>
                  <div className="text-foreground text-xs bg-muted p-1.5 rounded max-h-16 overflow-y-auto line-clamp-3">
                    {config.systemPrompt.substring(0, 80)}
                    {config.systemPrompt.length > 80 && '...'}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-center py-1">
              <div className="text-muted-foreground italic">Not configured</div>
              <div className="text-xs text-muted-foreground mt-0.5">Double click to configure</div>
              <div className="mt-2 flex items-center justify-center">
                <div className="inline-flex items-center px-2 py-1 bg-blue-50 border border-blue-200 rounded-md">
                  <svg className="w-3 h-3 text-blue-600 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  <span className="text-xs font-medium text-blue-600">Combines Results</span>
                </div>
              </div>
            </div>
          )
        ),
      }}
    />
  );
});

ResultsCombineNode.displayName = 'ResultsCombineNode';

export default ResultsCombineNode;

