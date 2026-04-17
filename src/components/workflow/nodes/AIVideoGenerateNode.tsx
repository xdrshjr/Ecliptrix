'use client';

import React from 'react';
import { BaseNodeProps } from './BaseWorkflowNode';
import { AIVideoGenerateNodeConfig } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';

/**
 * AI Video Generate Node Component
 * A horizontal (wide) node that accepts multiple optional inputs:
 * - Text (文案)
 * - Video (视频)
 * - Audio (音频)
 * - Image (图片)
 * 
 * Each input supports: string, JSON, and array formats
 * Uses VIDEO_CUT_LLM to convert inputs to Video Editing JSON format
 * Auto-imports result to Video Editing task on success
 * 
 * Design: Gray-black theme, horizontal layout (width >> height)
 */
const AIVideoGenerateNode: React.FC<BaseNodeProps> = React.memo((props) => {
  const { id, data, selected, onDelete, onPortMouseDown, executionStatus } = props;
  const { t } = useLocale();
  
  const config = data.config as AIVideoGenerateNodeConfig | undefined;
  
  // Check if node is configured
  const isConfigured = !!(
    config?.textInput ||
    config?.videoInput ||
    config?.audioInput ||
    config?.imageInput ||
    config?.systemPrompt
  );
  
  console.log('[AIVideoGenerateNode] Rendering node:', { 
    id, 
    label: data.label, 
    selected,
    hasConfig: !!config,
    executionStatus,
    isConfigured
  });

  // Helper to render input ports
  const renderInputPort = (portId: string, portLabel: string, dataKey: keyof AIVideoGenerateNodeConfig) => {
    const hasData = config && config[dataKey];
    
    return (
      <div className="flex items-center space-x-1.5 mb-2">
        <div 
          className={`w-2.5 h-2.5 rounded-full border-2 border-white cursor-pointer hover:scale-110 transition-transform ${
            hasData ? 'bg-blue-500' : 'bg-muted-foreground'
          }`}
          title={portLabel}
          onMouseDown={(e) => {
            e.stopPropagation();
            if (onPortMouseDown) {
              onPortMouseDown(id, 'input', portId, e);
            }
          }}
          data-port-type="input"
          data-port-id={portId}
          data-node-id={id}
        />
        <span className={`text-xs select-none ${hasData ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
          {portLabel}
        </span>
      </div>
    );
  };

  // Determine border and ring colors based on state
  const getBorderClasses = () => {
    if (selected) return 'border-blue-500 ring-2 ring-blue-200';
    if (executionStatus === 'executing') return 'border-yellow-500 ring-2 ring-yellow-200';
    if (executionStatus === 'completed') return 'border-green-500 ring-2 ring-green-200';
    if (executionStatus === 'error') return 'border-red-500 ring-2 ring-red-200';
    if (isConfigured) return 'border-border';
    return 'border-border';
  };

  return (
    <div 
      className={`
        bg-card rounded-md border-2 select-none relative
        ${getBorderClasses()}
        transition-all duration-200
      `}
      style={{ 
        width: '480px',  // Wide horizontal node
        minHeight: '140px'
      }}
    >
      {/* Execution Status Indicator */}
      {executionStatus === 'executing' && (
        <div className="absolute -top-2 -right-2 w-5 h-5 bg-yellow-500 rounded-full flex items-center justify-center animate-pulse z-10">
          <svg className="w-3 h-3 text-white animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      )}
      {executionStatus === 'completed' && (
        <div className="absolute -top-2 -right-2 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center z-10">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
      {executionStatus === 'error' && (
        <div className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center z-10">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      )}
      
      {/* Node Header - Gray-Black Theme */}
      <div className={`
        text-white px-3 py-2 rounded-t-lg flex items-center justify-between
        ${isConfigured
          ? 'bg-secondary'
          : 'bg-muted'}
      `}>
        <div className="flex items-center space-x-2">
          <div className="w-4 h-4 flex-shrink-0">
            {/* Video generation icon */}
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-sm font-medium">{data.label}</span>
          {isConfigured && (
            <div className="w-1.5 h-1.5 rounded-full bg-white/80" title={t.workflowNodes.tooltips.configured} />
          )}
        </div>
        {onDelete && (
          <button
            onMouseDown={(e) => {
              e.stopPropagation();
              console.log('[AIVideoGenerateNode] Delete button mouseDown - preventing drag:', { id });
            }}
            onClick={(e) => {
              e.stopPropagation();
              console.log('[AIVideoGenerateNode] Delete button clicked:', { id });
              onDelete();
            }}
            className="hover:bg-white/20 rounded p-0.5 transition-colors"
            title={t.workflowNodes.tooltips.deleteNode}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Node Body - Horizontal Layout */}
      <div className="p-3 flex items-start justify-between">
        {/* Left Side: Input Ports */}
        <div className="flex-shrink-0 w-24">
          <div className="text-xs font-medium text-muted-foreground mb-2">{t.workflowNodes.aiVideo.inputs}</div>
          {renderInputPort('input-text', t.workflowNodes.ports.copy, 'textInput')}
          {renderInputPort('input-video', t.workflowNodes.ports.video, 'videoInput')}
          {renderInputPort('input-audio', t.workflowNodes.ports.audio, 'audioInput')}
          {renderInputPort('input-image', t.workflowNodes.ports.image, 'imageInput')}
        </div>

        {/* Center: Content Display */}
        <div className="flex-1 px-4">
          {isConfigured ? (
            <div className="text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-medium">{`${t.workflowNodes.aiVideo.status}:`}</span>
                <span className="text-foreground text-xs">
                  {config?.lastExecutionSuccess !== undefined 
                    ? (config.lastExecutionSuccess ? `✓ ${t.workflowNodes.status.success}` : `✗ ${t.workflowNodes.status.failed}`)
                    : t.workflowNodes.status.ready}
                </span>
              </div>
              {config?.lastExecutionTime && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-medium">{`${t.workflowNodes.aiVideo.lastRun}:`}</span>
                  <span className="text-foreground text-xs">
                    {new Date(config.lastExecutionTime).toLocaleTimeString()}
                  </span>
                </div>
              )}
              {config?.lastExecutionError && (
                <div className="pt-1 border-t border-border">
                  <div className="text-red-600 text-xs">
                    {`${t.workflowNodes.aiVideo.error}:`} {config.lastExecutionError.substring(0, 60)}
                    {config.lastExecutionError.length > 60 && '...'}
                  </div>
                </div>
              )}
              {config?.systemPrompt && (
                <div className="pt-1 border-t border-border">
                  <div className="text-muted-foreground font-medium mb-0.5">{`${t.workflowNodes.aiVideo.prompt}:`}</div>
                  <div className="text-foreground text-xs bg-muted p-1.5 rounded max-h-12 overflow-y-auto">
                    {config.systemPrompt.substring(0, 80)}
                    {config.systemPrompt.length > 80 && '...'}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-center py-2">
              <div className="text-muted-foreground italic">{t.workflowNodes.aiVideo.notConfigured}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{t.workflowNodes.aiVideo.doubleClickConfigure}</div>
            </div>
          )}
        </div>

        {/* Right Side: Output Port */}
        <div className="flex-shrink-0 w-24 flex flex-col items-end">
          <div className="text-xs font-medium text-muted-foreground mb-2">{t.workflowNodes.ports.output}</div>
          <div className="flex items-center space-x-1.5">
            <span className="text-xs text-foreground font-medium select-none">{t.workflowNodes.ports.timeline}</span>
            <div 
              className="w-2.5 h-2.5 rounded-full bg-indigo-500 border-2 border-white cursor-pointer hover:scale-110 transition-transform" 
              title={t.workflowNodes.tooltips.outputPort}
              onMouseDown={(e) => {
                e.stopPropagation();
                if (onPortMouseDown) {
                  onPortMouseDown(id, 'output', 'output-1', e);
                }
              }}
              data-port-type="output"
              data-port-id="output-1"
              data-node-id={id}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

AIVideoGenerateNode.displayName = 'AIVideoGenerateNode';

export default AIVideoGenerateNode;

