'use client';

import React, { useState, useEffect } from 'react';
import { PexelsVideoSearchNodeConfig, DataFormat } from '@/types';
import NodeTestPanel from './NodeTestPanel';
import FormatSelector from './FormatSelector';

interface PexelsVideoSearchConfigPanelProps {
  nodeId: string;
  config: PexelsVideoSearchNodeConfig;
  onSave: (config: PexelsVideoSearchNodeConfig) => void;
  onClose: () => void;
}

/**
 * Pexels Video Search Node Configuration Panel Component
 * Elegant Apple-style right-side configuration panel for Pexels Video Search nodes
 * Allows users to configure search keywords and video count
 */
const PexelsVideoSearchConfigPanel: React.FC<PexelsVideoSearchConfigPanelProps> = ({
  nodeId,
  config,
  onSave,
  onClose,
}) => {
  console.log('[PexelsVideoSearchConfigPanel] Rendering panel:', { 
    nodeId, 
    config,
    initialKeywordsLength: config.keywords?.length || 0,
    initialCount: config.count || 5
  });

  // State management
  const [keywords, setKeywords] = useState(config.keywords || '');
  const [count, setCount] = useState(config.count || 5);
  const [inputFormat, setInputFormat] = useState<DataFormat>(config.inputFormat || 'application/json');
  const [outputFormat, setOutputFormat] = useState<DataFormat>(config.outputFormat || 'application/json');
  const [isSaving, setIsSaving] = useState(false);

  // Update local state when config changes
  useEffect(() => {
    console.log('[PexelsVideoSearchConfigPanel] Config updated, refreshing state');
    setKeywords(config.keywords || '');
    setCount(config.count || 5);
    setInputFormat(config.inputFormat || 'application/json');
    setOutputFormat(config.outputFormat || 'application/json');
  }, [config]);

  const handleSave = () => {
    console.log('[PexelsVideoSearchConfigPanel] Saving configuration:', {
      nodeId,
      keywordsLength: keywords.length,
      hasKeywords: keywords.trim().length > 0,
      count
    });

    setIsSaving(true);

    const newConfig: PexelsVideoSearchNodeConfig = {
      keywords: keywords.trim(),
      count: count,
      inputFormat,
      outputFormat,
    };

    // Simulate brief save delay for UX feedback
    setTimeout(() => {
      onSave(newConfig);
      setIsSaving(false);
      onClose();
      console.log('[PexelsVideoSearchConfigPanel] Configuration saved successfully');
    }, 100);
  };

  const handleCancel = () => {
    console.log('[PexelsVideoSearchConfigPanel] Cancelling configuration, discarding changes');
    onClose();
  };

  const handleClear = () => {
    console.log('[PexelsVideoSearchConfigPanel] Clearing keywords content');
    setKeywords('');
  };

  const handleCountChange = (value: number) => {
    // Clamp value between 1 and 50
    const clampedValue = Math.max(1, Math.min(50, value));
    setCount(clampedValue);
  };

  const characterCount = keywords.length;
  const wordCount = keywords.trim() ? keywords.trim().split(/\s+/).length : 0;
  const hasKeywords = keywords.trim().length > 0;
  const isValidCount = count >= 1 && count <= 50;

  return (
    <div className="fixed inset-y-0 right-0 w-[35%] bg-white/95 backdrop-blur-xl shadow-2xl z-50 flex flex-col animate-slide-in-right border-l border-gray-200">
      {/* Header - Apple style with blur effect */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white/80 backdrop-blur-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Pexels Video Search</h2>
              <p className="text-xs text-gray-500">Configure search parameters</p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Close"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {/* Test Panel */}
        <NodeTestPanel
          nodeId={nodeId}
          nodeType="pexels-video-search"
          nodeLabel="Pexels Video Search"
          nodeConfig={config}
        />

        {/* Format Configuration */}
        <div className="space-y-4 p-4 bg-gradient-to-br from-gray-50 to-gray-100/50 border border-gray-200/80 rounded-xl">
          <div className="flex items-center space-x-2">
            <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
            <h3 className="text-sm font-semibold text-gray-900">Data Format</h3>
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
        
        {/* Search Keywords Area */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-900">
              Search Keywords
            </label>
            {hasKeywords && (
              <button
                onClick={handleClear}
                className="text-xs text-red-600 hover:text-red-700 font-medium transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <textarea
            value={keywords}
            onChange={(e) => {
              console.log('[PexelsVideoSearchConfigPanel] Keywords changed, new length:', e.target.value.length);
              setKeywords(e.target.value);
            }}
            placeholder="Enter search keywords for Pexels video search...

Examples:
• nature sunset ocean waves
• business meeting office
• city traffic night lights
• cooking food preparation

Tips:
• Use specific, descriptive keywords
• Multiple keywords will search for videos matching those terms
• More specific keywords yield better results"
            rows={12}
            className="w-full px-4 py-3 bg-gray-50/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-transparent transition-all resize-none text-sm text-gray-900 placeholder-gray-400"
          />
          
          {/* Character/Word Count */}
          <div className="flex items-center justify-between text-xs text-gray-500">
            <div className="flex items-center space-x-4">
              <span className="flex items-center space-x-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
              </span>
              <span className="flex items-center space-x-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>{characterCount} {characterCount === 1 ? 'character' : 'characters'}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Video Count Configuration */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-900">
            Number of Videos to Search
          </label>
          <div className="flex items-center space-x-3">
            <input
              type="number"
              min="1"
              max="50"
              value={count}
              onChange={(e) => {
                const value = parseInt(e.target.value, 10);
                if (!isNaN(value)) {
                  handleCountChange(value);
                }
              }}
              className="w-24 px-4 py-2 bg-gray-50/50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-transparent transition-all text-sm text-gray-900 text-center font-medium"
            />
            <input
              type="range"
              min="1"
              max="50"
              value={count}
              onChange={(e) => handleCountChange(parseInt(e.target.value, 10))}
              className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
          </div>
          <p className="text-xs text-gray-500">
            Search for {count} video{count !== 1 ? 's' : ''} from Pexels (1-50)
          </p>
        </div>

        {/* Info Section */}
        <div className="bg-indigo-50/50 border border-indigo-200 rounded-xl p-4 space-y-2">
          <div className="flex items-start space-x-2">
            <svg className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-indigo-900 mb-1">About Pexels Video Search</h4>
              <ul className="text-xs text-indigo-800 space-y-1">
                <li>• Searches high-quality free stock videos from Pexels</li>
                <li>• Input: Search keywords (can come from previous nodes)</li>
                <li>• Output: Array of video URLs for use in workflow</li>
                <li>• Results include video metadata and download links</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Footer - Action Buttons */}
      <div className="px-6 py-4 border-t border-gray-200 bg-gray-50/80 backdrop-blur-lg flex items-center justify-between">
        <button
          onClick={handleCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-200/60 rounded-lg transition-colors"
        >
          Cancel
        </button>
        
        <button
          onClick={handleSave}
          disabled={!hasKeywords || !isValidCount || isSaving}
          className={`
            px-6 py-2 text-sm font-semibold rounded-lg transition-all duration-200
            ${hasKeywords && isValidCount && !isSaving
              ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-700 hover:to-purple-700 shadow-md hover:shadow-lg'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }
          `}
        >
          {isSaving ? (
            <span className="flex items-center space-x-2">
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Saving...</span>
            </span>
          ) : (
            'Save Configuration'
          )}
        </button>
      </div>
    </div>
  );
};

export default PexelsVideoSearchConfigPanel;

