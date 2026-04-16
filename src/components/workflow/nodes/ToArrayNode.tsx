'use client';

import React from 'react';
import { BaseWorkflowNode, BaseNodeProps } from './BaseWorkflowNode';
import { ToArrayNodeConfig } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';

/**
 * To Array Node Component
 * Converts any input format to array format using LLM
 * Features elegant gray color scheme following Apple design principles
 * Memoized to prevent unnecessary re-renders during drag operations
 */
const ToArrayNode: React.FC<BaseNodeProps> = React.memo((props) => {
  const { id, data, selected, onDelete, onPortMouseDown, executionStatus } = props;
  const { t } = useLocale();
  
  const config = data.config as ToArrayNodeConfig | undefined;
  const isConfigured = !!(
    config?.systemPrompt ||
    config?.model ||
    config?.temperature !== undefined ||
    config?.maxTokens
  );
  
  const elementType = config?.elementType || 'string';
  const hasObjectSchema = !!(config?.objectSchema && config.objectSchema.length > 0);
  
  console.log('[ToArrayNode] Rendering node:', { 
    id, 
    label: data.label, 
    selected,
    hasConfig: !!config,
    elementType,
    hasObjectSchema,
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
          ? 'bg-secondary'
          : 'bg-muted',
        hasInputPort: true,
        hasOutputPort: true,
        inputPortLabel: t.workflowNodes.ports.input,
        outputPortLabel: t.workflowNodes.ports.array,
        isConfigured,
        renderContent: () => (
          isConfigured ? (
            <div className="text-xs space-y-1.5">
              {/* Model Information */}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-medium">{t.workflowNodes.status.model}:</span>
                <span className="text-foreground text-xs">{config?.model || t.workflowNodes.status.notSet}</span>
              </div>

              {/* Temperature */}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-medium">{t.workflowNodes.status.temperature}:</span>
                <span className="text-foreground text-xs">{config?.temperature?.toFixed(1) ?? 'N/A'}</span>
              </div>
              
              {/* Element Type Badge */}
              <div className="pt-1 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-medium">{t.workflowNodes.status.typeLabel}:</span>
                  <div className="inline-flex items-center px-2 py-0.5 bg-accent border border-border rounded">
                    <span className="text-xs font-semibold text-foreground capitalize">{elementType}</span>
                  </div>
                </div>
              </div>
              
              {/* Object Schema Info */}
              {elementType === 'object' && hasObjectSchema && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-medium">{t.workflowNodes.status.fields}:</span>
                  <span className="text-foreground text-xs">{t.workflowNodes.status.fieldsCount.replace('{count}', String(config?.objectSchema?.length || 0))}</span>
                </div>
              )}
              
              {/* Output Format Badge */}
              <div className="pt-1 border-t border-border">
                <div className="flex items-center justify-center">
                  <div className="inline-flex items-center px-2 py-1 bg-accent border border-border rounded-md">
                    <svg className="w-3 h-3 text-foreground mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                    <span className="text-xs font-semibold text-foreground">Array[{elementType}]</span>
                  </div>
                </div>
              </div>
              
              {/* System Prompt Preview */}
              {config?.systemPrompt && (
                <div className="pt-1 border-t border-border">
                  <div className="text-muted-foreground font-medium mb-0.5">{t.workflowNodes.status.conversionPrompt}:</div>
                  <div className="text-foreground text-xs bg-muted p-1.5 rounded max-h-16 overflow-y-auto line-clamp-3">
                    {config.systemPrompt.substring(0, 80)}
                    {config.systemPrompt.length > 80 && '...'}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-center py-1">
              <div className="text-muted-foreground italic">{t.workflowNodes.status.notConfigured}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{t.workflowNodes.status.doubleClickToConfigure}</div>
              <div className="mt-2 flex items-center justify-center">
                <div className="inline-flex items-center px-2 py-1 bg-muted border border-border rounded-md">
                  <svg className="w-3 h-3 text-muted-foreground mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  <span className="text-xs font-medium text-muted-foreground">{t.workflowNodes.status.outputsArray}</span>
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

