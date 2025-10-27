'use client';

import React from 'react';
import { BaseWorkflowNode, BaseNodeProps } from './BaseWorkflowNode';
import { ToArrayNodeConfig } from '@/types';

/**
 * To Array Node Component
 * Converts any input format to array format using LLM
 * Features elegant gray color scheme following Apple design principles
 * Memoized to prevent unnecessary re-renders during drag operations
 */
const ToArrayNode: React.FC<BaseNodeProps> = React.memo((props) => {
  const { id, data, selected, onDelete, onPortMouseDown, executionStatus } = props;
  
  const config = data.config as ToArrayNodeConfig | undefined;
  const isConfigured = !!(
    config?.systemPrompt ||
    config?.model ||
    config?.temperature !== undefined ||
    config?.maxTokens
  );
  
  console.log('[ToArrayNode] Rendering node:', { 
    id, 
    label: data.label, 
    selected,
    hasConfig: !!config,
    executionStatus
  });

  return (
    <BaseWorkflowNode
      {...props}
      config={{
        icon: (
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
        ),
        gradientColors: isConfigured 
          ? 'bg-gradient-to-r from-gray-500 to-gray-600' 
          : 'bg-gradient-to-r from-gray-400 to-gray-500',
        hasInputPort: true,
        hasOutputPort: true,
        inputPortLabel: 'Input',
        outputPortLabel: 'Array',
        isConfigured,
        renderContent: () => (
          isConfigured ? (
            <div className="text-xs space-y-1.5">
              {/* Model Information */}
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Model:</span>
                <span className="text-gray-900 text-xs">{config?.model || 'Not set'}</span>
              </div>
              
              {/* Temperature */}
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Temp:</span>
                <span className="text-gray-900 text-xs">{config?.temperature?.toFixed(1) ?? 'N/A'}</span>
              </div>
              
              {/* Output Format Badge */}
              <div className="pt-1 border-t border-gray-200">
                <div className="flex items-center justify-center">
                  <div className="inline-flex items-center px-2 py-1 bg-gray-100 border border-gray-300 rounded-md">
                    <svg className="w-3 h-3 text-gray-700 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                    <span className="text-xs font-semibold text-gray-700">Array Output</span>
                  </div>
                </div>
              </div>
              
              {/* System Prompt Preview */}
              {config?.systemPrompt && (
                <div className="pt-1 border-t border-gray-200">
                  <div className="text-gray-600 font-medium mb-0.5">Conversion Prompt:</div>
                  <div className="text-gray-700 text-xs bg-gray-50 p-1.5 rounded max-h-16 overflow-y-auto line-clamp-3">
                    {config.systemPrompt.substring(0, 80)}
                    {config.systemPrompt.length > 80 && '...'}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-center py-1">
              <div className="text-gray-400 italic">Not configured</div>
              <div className="text-xs text-gray-500 mt-0.5">Double click to configure</div>
              <div className="mt-2 flex items-center justify-center">
                <div className="inline-flex items-center px-2 py-1 bg-gray-50 border border-gray-200 rounded-md">
                  <svg className="w-3 h-3 text-gray-500 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  <span className="text-xs font-medium text-gray-500">Outputs Array</span>
                </div>
              </div>
            </div>
          )
        ),
      }}
    />
  );
});

ToArrayNode.displayName = 'ToArrayNode';

export default ToArrayNode;

