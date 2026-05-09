'use client';

import React, { useState, useEffect } from 'react';
import { TextInputNodeConfig, DataFormat } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import NodeTestPanel from './NodeTestPanel';
import FormatSelector from './FormatSelector';

interface TextInputConfigPanelProps {
  nodeId: string;
  config: TextInputNodeConfig;
  onSave: (config: TextInputNodeConfig) => void;
  onClose: () => void;
}

/**
 * Text Input Configuration Panel Component
 * Figma-style right-side configuration panel for Text Input nodes
 * Allows users to input and save text content for the node
 */
const TextInputConfigPanel: React.FC<TextInputConfigPanelProps> = ({
  nodeId,
  config,
  onSave,
  onClose,
}) => {
  console.log('[TextInputConfigPanel] Rendering panel:', {
    nodeId,
    config,
    initialContentLength: config.content?.length || 0
  });

  const { t } = useLocale();

  // State management
  const [content, setContent] = useState(config.content || '');
  const [inputFormat, setInputFormat] = useState<DataFormat>(config.inputFormat || 'application/json');
  const [outputFormat, setOutputFormat] = useState<DataFormat>(config.outputFormat || 'application/json');
  const [isSaving, setIsSaving] = useState(false);

  // Update local state when config changes
  useEffect(() => {
    console.log('[TextInputConfigPanel] Config updated, refreshing content');
    setContent(config.content || '');
    setInputFormat(config.inputFormat || 'application/json');
    setOutputFormat(config.outputFormat || 'application/json');
  }, [config]);

  const handleSave = () => {
    console.log('[TextInputConfigPanel] Saving configuration:', {
      nodeId,
      contentLength: content.length,
      hasContent: content.trim().length > 0
    });

    setIsSaving(true);

    const newConfig: TextInputNodeConfig = {
      content: content.trim(),
      inputFormat: inputFormat,
      outputFormat: outputFormat,
    };

    // Simulate brief save delay for UX feedback
    setTimeout(() => {
      onSave(newConfig);
      setIsSaving(false);
      onClose();
      console.log('[TextInputConfigPanel] Configuration saved successfully');
    }, 100);
  };

  const handleCancel = () => {
    console.log('[TextInputConfigPanel] Cancelling configuration, discarding changes');
    onClose();
  };

  const handleClear = () => {
    console.log('[TextInputConfigPanel] Clearing text content');
    setContent('');
  };

  const characterCount = content.length;
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const hasContent = content.trim().length > 0;

  return (
    <div className="fixed inset-y-0 right-0 w-[35%] bg-card z-50 flex flex-col animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-md bg-teal-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Text Input Configuration</h2>
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
          nodeType="text-input"
          nodeLabel="Text Input"
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
            label="Input Format"
            value={inputFormat}
            onChange={setInputFormat}
            type="input"
            helpText="Format of data received from the previous node."
          />

          <FormatSelector
            label="Output Format"
            value={outputFormat}
            onChange={setOutputFormat}
            type="output"
            helpText="Format of data sent to the next node."
          />
        </div>
        
        {/* Text Input Area */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-foreground">
              Text Content
            </label>
            {hasContent && (
              <button
                onClick={handleClear}
                className="text-xs text-red-600 hover:text-red-700 font-medium transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <textarea
            value={content}
            onChange={(e) => {
              console.log('[TextInputConfigPanel] Content changed, new length:', e.target.value.length);
              setContent(e.target.value);
            }}
            placeholder="Enter your text content here...

You can use this node to:
• Store static text or instructions
• Provide input data to other nodes
• Define prompts or templates

The text will be passed through the output port to connected nodes."
            rows={16}
            className="w-full px-4 py-3 bg-muted border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-colors resize-none text-sm text-foreground placeholder-muted-foreground font-mono"
          />
          
          {/* Character/Word Count */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center space-x-4">
              <span>{characterCount} character{characterCount !== 1 ? 's' : ''}</span>
              <span>•</span>
              <span>{wordCount} word{wordCount !== 1 ? 's' : ''}</span>
            </div>
            {hasContent ? (
              <span className="text-primary font-medium flex items-center">
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Has content
              </span>
            ) : (
              <span className="text-muted-foreground">Empty</span>
            )}
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-primary/10 border border-primary/30 rounded-md p-4">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-foreground mb-1">How to use</h4>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Enter any text content you want to use in your workflow</li>
                <li>• Connect the output port to other nodes to pass the text</li>
                <li>• The input port can receive text from previous nodes</li>
                <li>• Double-click the node anytime to edit the content</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Preview Section (if content exists) */}
        {hasContent && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">
              Preview
            </label>
            <div className="bg-card border border-border rounded-md p-4 max-h-40 overflow-y-auto">
              <pre className="text-xs text-foreground whitespace-pre-wrap font-sans break-words">
                {content}
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
            className="px-5 py-2.5 text-sm font-medium text-primary-foreground bg-primary hover:bg-[var(--primary-hover)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {isSaving ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Save Content</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TextInputConfigPanel;

