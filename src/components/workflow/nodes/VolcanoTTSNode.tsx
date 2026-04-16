'use client';

import React from 'react';
import { BaseWorkflowNode, BaseNodeProps } from './BaseWorkflowNode';
import { VolcanoTTSNodeConfig } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';

/**
 * Volcano TTS Node Component
 * Represents a Volcano voice synthesis node in the workflow canvas
 * Allows users to convert text to speech using Volcano TTS API
 * Memoized to prevent unnecessary re-renders during drag operations
 */
const VolcanoTTSNode: React.FC<BaseNodeProps> = React.memo((props) => {
  const { id, data, selected, onDelete, onPortMouseDown, executionStatus } = props;
  const { t } = useLocale();
  
  const config = data.config as VolcanoTTSNodeConfig | undefined;
  const isConfigured = !!(config?.text && config.text.trim().length > 0 && config?.voiceType);
  const displayText = config?.text || '';
  const displayVoiceType = config?.voiceType || t.workflowNodes.status.notSelected;
  
  console.log('[VolcanoTTSNode] Rendering node:', { 
    id, 
    label: data.label, 
    selected,
    hasText: !!config?.text,
    voiceType: config?.voiceType,
    executionStatus,
    isConfigured
  });

  // Get voice type display name
  const getVoiceTypeName = (voiceTypeId: string): string => {
    // Extract a readable name from voice type ID
    if (voiceTypeId === t.workflowNodes.status.notSelected) return voiceTypeId;
    
    // Try to get the last part after underscore
    const parts = voiceTypeId.split('_');
    if (parts.length >= 3) {
      // Format: zh_female_name_... -> Name
      return parts[2].charAt(0).toUpperCase() + parts[2].slice(1);
    }
    
    return voiceTypeId;
  };

  return (
    <BaseWorkflowNode
      {...props}
      config={{
        icon: (
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        ),
        gradientColors: isConfigured 
          ? 'bg-gradient-to-r from-orange-500 to-orange-600' 
          : 'bg-muted',
        hasInputPort: true,
        hasOutputPort: true,
        inputPortLabel: t.workflowNodes.ports.textInput,
        outputPortLabel: t.workflowNodes.ports.audioOutput,
        isConfigured,
        renderContent: () => (
          isConfigured ? (
            <div className="text-xs space-y-1.5">
              <div className="space-y-1">
                <div className="text-muted-foreground font-medium text-xs">{t.workflowNodes.status.voice}:</div>
                <div className="text-orange-700 text-xs bg-orange-50 px-2 py-1 rounded border border-orange-200 font-medium truncate">
                  {getVoiceTypeName(displayVoiceType)}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground font-medium text-xs">{t.workflowNodes.status.text}:</div>
                <div className="text-foreground text-xs bg-muted p-2 rounded border border-border max-h-16 overflow-y-auto break-words whitespace-pre-wrap">
                  {displayText.length > 80 
                    ? `${displayText.substring(0, 80)}...` 
                    : displayText}
                </div>
              </div>
              {displayText.length > 80 && (
                <div className="text-xs text-muted-foreground italic">
                  {t.workflowNodes.status.doubleClickForFullContent}
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-center py-1">
              <div className="text-muted-foreground italic">{t.workflowNodes.status.notConfigured}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{t.workflowNodes.status.doubleClickToConfigure}</div>
            </div>
          )
        ),
      }}
    />
  );
});

VolcanoTTSNode.displayName = 'VolcanoTTSNode';

export default VolcanoTTSNode;

