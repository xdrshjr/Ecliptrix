'use client';

import React, { useState, useEffect } from 'react';
import { StartNodeConfig, DataFormat } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import NodeTestPanel from './NodeTestPanel';
import FormatSelector from './FormatSelector';

interface StartNodeConfigPanelProps {
  nodeId: string;
  config: StartNodeConfig;
  onSave: (config: StartNodeConfig) => void;
  onClose: () => void;
}

/**
 * Start Node Configuration Panel Component
 * Figma-style right-side configuration panel for Start nodes
 * Allows users to set input content for the workflow start node
 */
const StartNodeConfigPanel: React.FC<StartNodeConfigPanelProps> = ({
  nodeId,
  config,
  onSave,
  onClose,
}) => {
  console.log('[StartNodeConfigPanel] Rendering panel:', {
    nodeId,
    config,
    initialInputLength: config.input?.length || 0
  });

  const { t } = useLocale();

  // State management
  const [input, setInput] = useState(config.input || '');
  const [outputFormat, setOutputFormat] = useState<DataFormat>(config.outputFormat || 'application/json');
  const [isSaving, setIsSaving] = useState(false);

  // Update local state when config changes
  useEffect(() => {
    console.log('[StartNodeConfigPanel] Config updated, refreshing input');
    setInput(config.input || '');
    setOutputFormat(config.outputFormat || 'application/json');
  }, [config]);

  const handleSave = () => {
    console.log('[StartNodeConfigPanel] Saving configuration:', {
      nodeId,
      inputLength: input.length,
      hasInput: input.trim().length > 0
    });

    setIsSaving(true);

    const newConfig: StartNodeConfig = {
      input: input.trim(),
      outputFormat: outputFormat,
    };

    // Simulate brief save delay for UX feedback
    setTimeout(() => {
      onSave(newConfig);
      setIsSaving(false);
      onClose();
      console.log('[StartNodeConfigPanel] Configuration saved successfully');
    }, 100);
  };

  const handleCancel = () => {
    console.log('[StartNodeConfigPanel] Cancelling configuration, discarding changes');
    onClose();
  };

  const handleClear = () => {
    console.log('[StartNodeConfigPanel] Clearing input content');
    setInput('');
  };

  const characterCount = input.length;
  const wordCount = input.trim() ? input.trim().split(/\s+/).length : 0;
  const hasInput = input.trim().length > 0;

  return (
    <div className="fixed inset-y-0 right-0 w-[35%] bg-card z-50 flex flex-col animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-md bg-green-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Start Node Configuration</h2>
            <p className="text-xs text-muted-foreground">Node ID: {nodeId}</p>
          </div>
        </div>
        <button
          onClick={handleCancel}
          className="w-8 h-8 rounded-lg hover:bg-accent transition-colors flex items-center justify-center"
          aria-label={t.common.closePanel}
        >
          <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {/* Test Panel */}
        <NodeTestPanel
          nodeId={nodeId}
          nodeType="start"
          nodeLabel="Start Node"
          nodeConfig={config}
        />

        {/* Format Configuration */}
        <div className="space-y-4 p-4 bg-muted border border-border rounded-md">
          <div className="flex items-center space-x-2">
            <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
            <h3 className="text-sm font-semibold text-foreground">Data Format</h3>
          </div>
          
          <FormatSelector
            label="Output Format"
            value={outputFormat}
            onChange={setOutputFormat}
            type="output"
            helpText="Format of data sent to the next node. Start node only has output (no input from previous node)."
          />
        </div>
        
        {/* Input Area */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-foreground">
              Initial Input Content
            </label>
            {hasInput && (
              <button
                onClick={handleClear}
                className="text-xs text-destructive hover:text-destructive font-medium transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <textarea
            value={input}
            onChange={(e) => {
              console.log('[StartNodeConfigPanel] Input changed, new length:', e.target.value.length);
              setInput(e.target.value);
            }}
            placeholder="Enter initial input content for the workflow...

This input will be:
• Passed to the next node as initial data
• Overridden by user chat messages when executing from chat interface
• Used as default input when running from workflow canvas

Examples:
• Instructions or prompts for LLM nodes
• Initial data or context
• Default test input"
            rows={16}
            className="w-full px-4 py-3 bg-muted border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-colors resize-none text-sm text-foreground placeholder-gray-400 font-mono"
          />
          
          {/* Character/Word Count */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center space-x-4">
              <span>{characterCount} character{characterCount !== 1 ? 's' : ''}</span>
              <span>•</span>
              <span>{wordCount} word{wordCount !== 1 ? 's' : ''}</span>
            </div>
            {hasInput ? (
              <span className="text-green-500 font-medium flex items-center">
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Has input
              </span>
            ) : (
              <span className="text-muted-foreground">Empty</span>
            )}
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-green-500/10 border border-green-500/30 rounded-md p-4">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-foreground mb-1">How to use</h4>
              <ul className="text-xs text-green-500 space-y-1">
                <li>• This input serves as the initial data for your workflow</li>
                <li>• When running from chat interface, user messages override this input</li>
                <li>• When running from workflow canvas, this input is used as default</li>
                <li>• The input is passed to the next connected node</li>
                <li>• Leave empty if you only want to use chat interface input</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Preview Section (if input exists) */}
        {hasInput && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">
              Preview
            </label>
            <div className="bg-card border border-border rounded-md p-4 max-h-40 overflow-y-auto">
              <pre className="text-xs text-foreground whitespace-pre-wrap font-sans break-words">
                {input}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-border bg-muted">
        <div className="flex items-center justify-end space-x-3">
          <button
            onClick={handleCancel}
            disabled={isSaving}
            className="px-5 py-2.5 text-sm font-medium text-foreground bg-card border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2.5 text-sm font-medium text-primary-foreground bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {isSaving ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Save Input</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StartNodeConfigPanel;

