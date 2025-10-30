'use client';

import React, { useState, useEffect } from 'react';
import { VideoExportNodeConfig, DataFormat } from '@/types';

interface VideoExportConfigPanelProps {
  nodeId: string;
  config: VideoExportNodeConfig;
  onConfigChange: (config: VideoExportNodeConfig) => void;
  onClose: () => void;
}

/**
 * Video Export Config Panel Component
 * Configuration panel for Video Export Node
 * Apple-style clean, minimalist design with blue theme
 */
const VideoExportConfigPanel: React.FC<VideoExportConfigPanelProps> = ({
  nodeId,
  config,
  onConfigChange,
  onClose,
}) => {
  // Local state for form fields
  const [videoUrlsText, setVideoUrlsText] = useState('');
  const [inputFormat, setInputFormat] = useState<DataFormat>(config.inputFormat || 'array');

  // Initialize form fields from config
  useEffect(() => {
    if (config.videoUrls) {
      if (typeof config.videoUrls === 'string') {
        setVideoUrlsText(config.videoUrls);
      } else if (Array.isArray(config.videoUrls)) {
        setVideoUrlsText(config.videoUrls.join('\n'));
      }
    }
    
    if (config.inputFormat) {
      setInputFormat(config.inputFormat);
    }
  }, [config]);

  console.log('[VideoExportConfigPanel] Rendering config panel:', {
    nodeId,
    hasVideoUrls: !!config.videoUrls,
    inputFormat: config.inputFormat
  });

  // Handle save configuration
  const handleSave = () => {
    const urls = videoUrlsText
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.length > 0);

    const newConfig: VideoExportNodeConfig = {
      ...config,
      videoUrls: urls.length === 1 ? urls[0] : urls,
      inputFormat,
      outputFormat: 'application/json', // Always output as JSON for materials data
    };

    console.log('[VideoExportConfigPanel] Saving configuration:', {
      nodeId,
      videoUrlsCount: urls.length,
      inputFormat,
      newConfig
    });

    onConfigChange(newConfig);
    onClose();
  };

  // Handle cancel
  const handleCancel = () => {
    console.log('[VideoExportConfigPanel] Configuration cancelled:', { nodeId });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-sm">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Video Export Configuration</h2>
                <p className="text-sm text-gray-500">Export videos to Materials Management</p>
              </div>
            </div>
            <button
              onClick={handleCancel}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Close"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body - Scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {/* Video URLs Input */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-900">
              Video URLs
              <span className="text-red-500 ml-1">*</span>
            </label>
            <p className="text-xs text-gray-600 mb-2">
              Enter video URLs (one per line). Can be absolute URLs or relative paths.
            </p>
            <textarea
              value={videoUrlsText}
              onChange={(e) => setVideoUrlsText(e.target.value)}
              placeholder="https://example.com/video1.mp4&#10;https://example.com/video2.mp4&#10;/static/video/local-video.mp4"
              className="w-full h-48 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-sm font-mono"
              rows={8}
            />
            <div className="flex items-center space-x-2 text-xs text-gray-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>
                {videoUrlsText.split('\n').filter(url => url.trim().length > 0).length} video URL(s) entered
              </span>
            </div>
          </div>

          {/* Input Format Selection */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-900">
              Input Format
            </label>
            <p className="text-xs text-gray-600 mb-2">
              How video URLs are provided to this node
            </p>
            <div className="grid grid-cols-3 gap-3">
              {(['text/plain', 'application/json', 'array'] as DataFormat[]).map((format) => (
                <button
                  key={format}
                  onClick={() => setInputFormat(format)}
                  className={`px-4 py-3 rounded-xl border-2 transition-all ${
                    inputFormat === format
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="text-sm font-semibold">
                    {format === 'text/plain' ? 'Text' : format === 'application/json' ? 'JSON' : 'Array'}
                  </div>
                  <div className="text-xs mt-0.5 opacity-75">
                    {format === 'text/plain' 
                      ? 'Plain text' 
                      : format === 'application/json'
                      ? 'JSON format'
                      : 'Array format'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-start space-x-3">
              <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-blue-900 mb-1">How it works</h4>
                <ul className="text-xs text-blue-800 space-y-1">
                  <li>• This node converts video URLs into Materials Management format</li>
                  <li>• After execution, a button will appear to navigate to Video Editing</li>
                  <li>• All video materials will be automatically imported into the Materials panel</li>
                  <li>• Supports both single video URL and multiple video URLs</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Last Execution Result */}
          {config.lastExecutionResult && (
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-900">
                Last Execution Result
              </label>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-sm font-semibold ${
                    config.lastExecutionSuccess ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {config.lastExecutionSuccess ? '✓ Success' : '✗ Failed'}
                  </span>
                  {config.lastExecutionTime && (
                    <span className="text-xs text-gray-500">
                      {new Date(config.lastExecutionTime).toLocaleString()}
                    </span>
                  )}
                </div>
                <pre className="text-xs text-gray-700 font-mono bg-white p-3 rounded-lg overflow-x-auto max-h-32">
                  {JSON.stringify(config.lastExecutionResult, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer - Actions */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3 flex-shrink-0">
          <button
            onClick={handleCancel}
            className="px-6 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 hover:border-gray-400 transition-all font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!videoUrlsText.trim()}
            className="px-6 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg font-medium"
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoExportConfigPanel;

