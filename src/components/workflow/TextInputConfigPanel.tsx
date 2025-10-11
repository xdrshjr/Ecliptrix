'use client';

import React, { useState, useEffect } from 'react';
import { TextInputNodeConfig } from '@/types';

interface TextInputConfigPanelProps {
  nodeId: string;
  config: TextInputNodeConfig;
  onSave: (config: TextInputNodeConfig) => void;
  onClose: () => void;
}

/**
 * Text Input Configuration Panel Component
 * Elegant Apple-style right-side configuration panel for Text Input nodes
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

  // State management
  const [content, setContent] = useState(config.content || '');
  const [isSaving, setIsSaving] = useState(false);

  // Update local state when config changes
  useEffect(() => {
    console.log('[TextInputConfigPanel] Config updated, refreshing content');
    setContent(config.content || '');
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
    <div className="fixed inset-y-0 right-0 w-[35%] bg-white/95 backdrop-blur-xl shadow-2xl z-50 flex flex-col animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200/80">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Text Input Configuration</h2>
            <p className="text-xs text-gray-500">Node ID: {nodeId}</p>
          </div>
        </div>
        <button
          onClick={handleCancel}
          className="w-8 h-8 rounded-lg hover:bg-gray-100 transition-colors flex items-center justify-center"
          aria-label="Close panel"
        >
          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {/* Text Input Area */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-900">
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
            className="w-full px-4 py-3 bg-gray-50/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-transparent transition-all resize-none text-sm text-gray-900 placeholder-gray-400 font-mono"
          />
          
          {/* Character/Word Count */}
          <div className="flex items-center justify-between text-xs text-gray-500">
            <div className="flex items-center space-x-4">
              <span>{characterCount} character{characterCount !== 1 ? 's' : ''}</span>
              <span>•</span>
              <span>{wordCount} word{wordCount !== 1 ? 's' : ''}</span>
            </div>
            {hasContent ? (
              <span className="text-teal-600 font-medium flex items-center">
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Has content
              </span>
            ) : (
              <span className="text-gray-400">Empty</span>
            )}
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <svg className="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-teal-900 mb-1">How to use</h4>
              <ul className="text-xs text-teal-800 space-y-1">
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
            <label className="block text-sm font-medium text-gray-900">
              Preview
            </label>
            <div className="bg-white border border-gray-200 rounded-xl p-4 max-h-40 overflow-y-auto">
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans break-words">
                {content}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-gray-200/80 bg-gray-50/30">
        <div className="flex items-center justify-end space-x-3">
          <button
            onClick={handleCancel}
            disabled={isSaving}
            className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-600 rounded-lg hover:from-teal-600 hover:to-cyan-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
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

