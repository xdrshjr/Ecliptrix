'use client';

import React from 'react';
import { BaseNodeProps } from './BaseWorkflowNode';
import { AIVideoGenerateNodeConfig } from '@/types';

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
          className={`w-2.5 h-2.5 rounded-full border-2 border-white shadow-sm cursor-pointer hover:scale-110 transition-transform ${
            hasData ? 'bg-blue-500' : 'bg-gray-400'
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
        <span className={`text-xs select-none ${hasData ? 'text-gray-700 font-medium' : 'text-gray-500'}`}>
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
    if (isConfigured) return 'border-gray-600';
    return 'border-gray-400';
  };

  return (
    <div 
      className={`
        bg-white rounded-xl border-2 shadow-sm select-none relative
        ${getBorderClasses()}
        hover:shadow-md transition-all duration-200
      `}
      style={{ 
        width: '480px',  // Wide horizontal node
        minHeight: '140px'
      }}
    >
      {/* Execution Status Indicator */}
      {executionStatus === 'executing' && (
        <div className="absolute -top-2 -right-2 w-5 h-5 bg-yellow-500 rounded-full flex items-center justify-center animate-pulse shadow-md z-10">
          <svg className="w-3 h-3 text-white animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      )}
      {executionStatus === 'completed' && (
        <div className="absolute -top-2 -right-2 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center shadow-md z-10">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
      {executionStatus === 'error' && (
        <div className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center shadow-md z-10">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      )}
      
      {/* Node Header - Gray-Black Theme */}
      <div className={`
        text-white px-3 py-2 rounded-t-lg flex items-center justify-between
        ${isConfigured 
          ? 'bg-gradient-to-r from-gray-700 to-gray-900' 
          : 'bg-gradient-to-r from-gray-500 to-gray-700'}
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
            <div className="w-1.5 h-1.5 rounded-full bg-white/80" title="Configured" />
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
            title="Delete node"
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
          <div className="text-xs font-medium text-gray-600 mb-2">Inputs</div>
          {renderInputPort('input-text', '文案', 'textInput')}
          {renderInputPort('input-video', '视频', 'videoInput')}
          {renderInputPort('input-audio', '音频', 'audioInput')}
          {renderInputPort('input-image', '图片', 'imageInput')}
        </div>

        {/* Center: Content Display */}
        <div className="flex-1 px-4">
          {isConfigured ? (
            <div className="text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Status:</span>
                <span className="text-gray-900 text-xs">
                  {config?.lastExecutionSuccess !== undefined 
                    ? (config.lastExecutionSuccess ? '✓ Success' : '✗ Failed')
                    : 'Ready'}
                </span>
              </div>
              {config?.lastExecutionTime && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 font-medium">Last Run:</span>
                  <span className="text-gray-900 text-xs">
                    {new Date(config.lastExecutionTime).toLocaleTimeString()}
                  </span>
                </div>
              )}
              {config?.lastExecutionError && (
                <div className="pt-1 border-t border-gray-200">
                  <div className="text-red-600 text-xs">
                    Error: {config.lastExecutionError.substring(0, 60)}
                    {config.lastExecutionError.length > 60 && '...'}
                  </div>
                </div>
              )}
              {config?.systemPrompt && (
                <div className="pt-1 border-t border-gray-200">
                  <div className="text-gray-600 font-medium mb-0.5">Prompt:</div>
                  <div className="text-gray-700 text-xs bg-gray-50 p-1.5 rounded max-h-12 overflow-y-auto">
                    {config.systemPrompt.substring(0, 80)}
                    {config.systemPrompt.length > 80 && '...'}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-center py-2">
              <div className="text-gray-400 italic">Not configured</div>
              <div className="text-xs text-gray-500 mt-0.5">Double click to configure</div>
            </div>
          )}
        </div>

        {/* Right Side: Output Port */}
        <div className="flex-shrink-0 w-24 flex flex-col items-end">
          <div className="text-xs font-medium text-gray-600 mb-2">Output</div>
          <div className="flex items-center space-x-1.5">
            <span className="text-xs text-gray-700 font-medium select-none">Timeline</span>
            <div 
              className="w-2.5 h-2.5 rounded-full bg-indigo-500 border-2 border-white shadow-sm cursor-pointer hover:scale-110 transition-transform" 
              title="Output Port"
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

