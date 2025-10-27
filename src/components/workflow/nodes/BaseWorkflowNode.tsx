'use client';

import React from 'react';

/**
 * Base props for all workflow nodes
 */
export interface BaseNodeProps {
  id: string;
  data: {
    label: string;
    config?: any;
  };
  selected?: boolean;
  onDelete?: () => void;
  onPortMouseDown?: (nodeId: string, portType: 'input' | 'output', portId: string, event: React.MouseEvent) => void;
  executionStatus?: 'pending' | 'executing' | 'completed' | 'error';
}

/**
 * Node configuration for base component
 */
export interface NodeConfig {
  icon: React.ReactNode;
  gradientColors: string;
  hasInputPort?: boolean;
  hasOutputPort?: boolean;
  inputPortLabel?: string;
  outputPortLabel?: string;
  isConfigured?: boolean;
  renderContent: () => React.ReactNode;
}

/**
 * Base Workflow Node Component
 * Provides common functionality for all workflow nodes
 * - Execution status indicators
 * - Delete button
 * - Input/Output ports
 * - Apple-style clean design
 */
export const BaseWorkflowNode: React.FC<BaseNodeProps & { config: NodeConfig }> = React.memo(({ 
  id, 
  data, 
  selected = false,
  onDelete,
  onPortMouseDown,
  executionStatus = 'pending',
  config
}) => {
  console.log('[BaseWorkflowNode] Rendering node:', { 
    id, 
    label: data.label, 
    selected,
    executionStatus,
    isConfigured: config.isConfigured
  });

  const handleInputPortMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[BaseWorkflowNode] Input port mouse down:', { nodeId: id });
    if (onPortMouseDown) {
      onPortMouseDown(id, 'input', 'input-1', e);
    }
  };

  const handleOutputPortMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[BaseWorkflowNode] Output port mouse down:', { nodeId: id });
    if (onPortMouseDown) {
      onPortMouseDown(id, 'output', 'output-1', e);
    }
  };

  // Determine border and ring colors based on state
  const getBorderClasses = () => {
    if (selected) return 'border-blue-500 ring-2 ring-blue-200';
    if (executionStatus === 'executing') return 'border-yellow-500 ring-2 ring-yellow-200';
    if (executionStatus === 'completed') return 'border-green-500 ring-2 ring-green-200';
    if (executionStatus === 'error') return 'border-red-500 ring-2 ring-red-200';
    if (config.isConfigured) return 'border-gray-400';
    return 'border-gray-300';
  };

  return (
    <div 
      className={`
        bg-white rounded-xl border-2 shadow-sm min-w-[200px] max-w-[280px] select-none relative
        ${getBorderClasses()}
        hover:shadow-md transition-all duration-200
      `}
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
      
      {/* Node Header */}
      <div className={`
        text-white px-3 py-2 rounded-t-lg flex items-center justify-between
        ${config.gradientColors}
      `}>
        <div className="flex items-center space-x-2">
          <div className="w-4 h-4 flex-shrink-0">
            {config.icon}
          </div>
          <span className="text-sm font-medium">{data.label}</span>
          {config.isConfigured && (
            <div className="w-1.5 h-1.5 rounded-full bg-white/80" title="Configured" />
          )}
        </div>
        {onDelete && (
          <button
            onMouseDown={(e) => {
              e.stopPropagation();
              console.log('[BaseWorkflowNode] Delete button mouseDown - preventing drag:', { id });
            }}
            onClick={(e) => {
              e.stopPropagation();
              console.log('[BaseWorkflowNode] Delete button clicked:', { id });
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

      {/* Node Body */}
      <div className="p-3 space-y-2.5">
        {/* Input Port */}
        {config.hasInputPort && (
          <div className="flex items-center space-x-2">
            <div 
              className="w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow-sm cursor-pointer hover:scale-110 transition-transform" 
              title={config.inputPortLabel || "Input Port"}
              onMouseDown={handleInputPortMouseDown}
              data-port-type="input"
              data-port-id="input-1"
              data-node-id={id}
            />
            <span className="text-xs text-gray-500 select-none">{config.inputPortLabel || 'Input'}</span>
          </div>
        )}

        {/* Node Content */}
        <div className="py-1">
          {config.renderContent()}
        </div>

        {/* Output Port */}
        {config.hasOutputPort && (
          <div className="flex items-center justify-end space-x-2">
            <span className="text-xs text-gray-500 select-none">{config.outputPortLabel || 'Output'}</span>
            <div 
              className="w-3 h-3 rounded-full bg-indigo-500 border-2 border-white shadow-sm cursor-pointer hover:scale-110 transition-transform" 
              title={config.outputPortLabel || "Output Port"}
              onMouseDown={handleOutputPortMouseDown}
              data-port-type="output"
              data-port-id="output-1"
              data-node-id={id}
            />
          </div>
        )}
      </div>
    </div>
  );
});

BaseWorkflowNode.displayName = 'BaseWorkflowNode';

