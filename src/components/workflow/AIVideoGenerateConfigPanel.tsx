'use client';

import React, { useState, useCallback } from 'react';
import { AIVideoGenerateNodeConfig, DataFormat } from '@/types';

interface AIVideoGenerateConfigPanelProps {
  nodeId: string;
  config: AIVideoGenerateNodeConfig;
  onSave: (config: AIVideoGenerateNodeConfig) => void;
  onClose: () => void;
}

/**
 * Configuration Panel for AI Video Generate Node
 * 
 * Features:
 * - Configure multiple inputs (text, video, audio, image)
 * - Specify input format for each (string, JSON, array)
 * - Configure LLM parameters
 * - Manual testing/debugging
 * - View execution results
 */
const AIVideoGenerateConfigPanel: React.FC<AIVideoGenerateConfigPanelProps> = ({
  nodeId,
  config,
  onSave,
  onClose
}) => {
  const [localConfig, setLocalConfig] = useState<AIVideoGenerateNodeConfig>(config);
  const [activeTab, setActiveTab] = useState<'inputs' | 'llm' | 'results'>('inputs');

  console.log('[AIVideoGenerateConfigPanel] Rendering config panel:', { 
    nodeId, 
    hasConfig: !!config,
    activeTab
  });

  const handleSave = useCallback(() => {
    console.log('[AIVideoGenerateConfigPanel] Saving config:', { nodeId, config: localConfig });
    onSave(localConfig);
    onClose();
  }, [nodeId, localConfig, onSave, onClose]);

  const handleCancel = useCallback(() => {
    console.log('[AIVideoGenerateConfigPanel] Canceling config');
    onClose();
  }, [onClose]);

  const updateConfig = useCallback((updates: Partial<AIVideoGenerateNodeConfig>) => {
    setLocalConfig(prev => ({ ...prev, ...updates }));
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-md shadow-lg w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-secondary">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-card/10 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary-foreground">AI Video Generate Configuration</h2>
              <p className="text-xs text-muted-foreground">Configure inputs and parameters</p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="p-2 hover:bg-accent/20 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-6">
          <button
            onClick={() => setActiveTab('inputs')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'inputs'
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Input Configuration
          </button>
          <button
            onClick={() => setActiveTab('llm')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'llm'
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            LLM Settings
          </button>
          <button
            onClick={() => setActiveTab('results')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'results'
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Execution Results
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Inputs Tab */}
          {activeTab === 'inputs' && (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Configure optional inputs. Each input supports string, JSON, or array format.
              </p>

              {/* Text Input */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  文案 (Text Input)
                </label>
                <textarea
                  value={localConfig.textInput || ''}
                  onChange={(e) => updateConfig({ textInput: e.target.value })}
                  placeholder="Enter text content, JSON object, or array..."
                  className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent resize-none"
                  rows={3}
                />
                <select
                  value={localConfig.textInputFormat || 'text/plain'}
                  onChange={(e) => updateConfig({ textInputFormat: e.target.value as DataFormat })}
                  className="text-sm px-2 py-1 border border-border rounded"
                >
                  <option value="text/plain">String</option>
                  <option value="application/json">JSON</option>
                  <option value="array">Array</option>
                </select>
              </div>

              {/* Video Input */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  视频 (Video Input)
                </label>
                <textarea
                  value={localConfig.videoInput || ''}
                  onChange={(e) => updateConfig({ videoInput: e.target.value })}
                  placeholder="Enter video URL, JSON object, or array..."
                  className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent resize-none"
                  rows={3}
                />
                <select
                  value={localConfig.videoInputFormat || 'text/plain'}
                  onChange={(e) => updateConfig({ videoInputFormat: e.target.value as DataFormat })}
                  className="text-sm px-2 py-1 border border-border rounded"
                >
                  <option value="text/plain">String</option>
                  <option value="application/json">JSON</option>
                  <option value="array">Array</option>
                </select>
              </div>

              {/* Audio Input */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  音频 (Audio Input)
                </label>
                <textarea
                  value={localConfig.audioInput || ''}
                  onChange={(e) => updateConfig({ audioInput: e.target.value })}
                  placeholder="Enter audio URL, JSON object, or array..."
                  className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent resize-none"
                  rows={3}
                />
                <select
                  value={localConfig.audioInputFormat || 'text/plain'}
                  onChange={(e) => updateConfig({ audioInputFormat: e.target.value as DataFormat })}
                  className="text-sm px-2 py-1 border border-border rounded"
                >
                  <option value="text/plain">String</option>
                  <option value="application/json">JSON</option>
                  <option value="array">Array</option>
                </select>
              </div>

              {/* Image Input */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  图片 (Image Input)
                </label>
                <textarea
                  value={localConfig.imageInput || ''}
                  onChange={(e) => updateConfig({ imageInput: e.target.value })}
                  placeholder="Enter image URL, JSON object, or array..."
                  className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent resize-none"
                  rows={3}
                />
                <select
                  value={localConfig.imageInputFormat || 'text/plain'}
                  onChange={(e) => updateConfig({ imageInputFormat: e.target.value as DataFormat })}
                  className="text-sm px-2 py-1 border border-border rounded"
                >
                  <option value="text/plain">String</option>
                  <option value="application/json">JSON</option>
                  <option value="array">Array</option>
                </select>
              </div>
            </div>
          )}

          {/* LLM Settings Tab */}
          {activeTab === 'llm' && (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Configure LLM parameters. Uses VIDEO_CUT_LLM from backend environment.
              </p>

              {/* System Prompt */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  System Prompt (Optional)
                </label>
                <textarea
                  value={localConfig.systemPrompt || ''}
                  onChange={(e) => updateConfig({ systemPrompt: e.target.value })}
                  placeholder="Override default system prompt for video timeline generation..."
                  className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent resize-none"
                  rows={6}
                />
              </div>

              {/* Temperature */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Temperature: {localConfig.temperature?.toFixed(1) || '0.7'}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={localConfig.temperature || 0.7}
                  onChange={(e) => updateConfig({ temperature: parseFloat(e.target.value) })}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Lower values make output more focused and deterministic
                </p>
              </div>

              {/* Max Tokens */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Max Tokens
                </label>
                <input
                  type="number"
                  min="100"
                  max="8000"
                  step="100"
                  value={localConfig.maxTokens || 2000}
                  onChange={(e) => updateConfig({ maxTokens: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent"
                />
              </div>

              {/* Info Box */}
              <div className="bg-primary/10 border border-primary/30 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <svg className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-sm text-primary">
                    <p className="font-medium mb-1">LLM Configuration</p>
                    <p className="text-xs">
                      This node uses the VIDEO_CUT_LLM configured in the backend environment 
                      (same as AI混剪). The LLM will merge all inputs and generate a timeline 
                      JSON in the Video Editing format.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Results Tab */}
          {activeTab === 'results' && (
            <div className="space-y-6">
              {localConfig.lastExecutionTime ? (
                <div className="space-y-4">
                  {/* Execution Status */}
                  <div className={`p-4 rounded-lg border-2 ${
                    localConfig.lastExecutionSuccess 
                      ? 'bg-green-50 border-green-200' 
                      : 'bg-red-50 border-red-200'
                  }`}>
                    <div className="flex items-center space-x-2 mb-2">
                      {localConfig.lastExecutionSuccess ? (
                        <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                      <span className={`font-medium ${
                        localConfig.lastExecutionSuccess ? 'text-green-800' : 'text-red-800'
                      }`}>
                        {localConfig.lastExecutionSuccess ? 'Execution Successful' : 'Execution Failed'}
                      </span>
                    </div>
                    <p className="text-sm text-foreground">
                      Last executed: {new Date(localConfig.lastExecutionTime).toLocaleString()}
                    </p>
                  </div>

                  {/* Error Message */}
                  {localConfig.lastExecutionError && (
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-foreground">
                        Error Message
                      </label>
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                        <pre className="text-xs text-red-800 whitespace-pre-wrap font-mono">
                          {localConfig.lastExecutionError}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Execution Result */}
                  {localConfig.lastExecutionResult && (
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-foreground">
                        Execution Result (Timeline JSON)
                      </label>
                      <div className="bg-muted border border-border rounded-lg p-3 max-h-96 overflow-y-auto">
                        <pre className="text-xs text-foreground whitespace-pre-wrap font-mono">
                          {JSON.stringify(localConfig.lastExecutionResult, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12">
                  <svg className="w-16 h-16 text-muted-foreground mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-muted-foreground text-sm">
                    No execution results yet. Run the workflow to see results.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 px-6 py-4 border-t border-border bg-muted">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-lg hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium text-primary-foreground bg-secondary hover:bg-accent transition-colors"
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIVideoGenerateConfigPanel;

