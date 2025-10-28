'use client';

import React, { useState, useEffect } from 'react';
import { ResultsCombineNodeConfig, LLMModel, DataFormat } from '@/types';
import { fetchLLMModels } from '@/lib/api/llm';
import NodeTestPanel from './NodeTestPanel';
import FormatSelector from './FormatSelector';

interface ResultsCombineConfigPanelProps {
  nodeId: string;
  config: ResultsCombineNodeConfig;
  onSave: (config: ResultsCombineNodeConfig) => void;
  onClose: () => void;
}

/**
 * Results Combine Configuration Panel Component
 * Elegant Apple-style right-side configuration panel for Results Combine nodes
 * Features blue theme to match the node
 */
const ResultsCombineConfigPanel: React.FC<ResultsCombineConfigPanelProps> = ({
  nodeId,
  config,
  onSave,
  onClose,
}) => {
  console.log('[ResultsCombineConfigPanel] Rendering panel:', { nodeId, config });

  // State management
  const [systemPrompt, setSystemPrompt] = useState(config.systemPrompt || '');
  const [selectedModelId, setSelectedModelId] = useState(config.modelId || '');
  const [temperature, setTemperature] = useState(config.temperature ?? 0.7);
  const [maxTokens, setMaxTokens] = useState(config.maxTokens || 2000);
  const [outputSchema, setOutputSchema] = useState(config.outputSchema || '');
  const [inputFormat, setInputFormat] = useState<DataFormat>(config.inputFormat || 'array');
  const [outputFormat, setOutputFormat] = useState<DataFormat>(config.outputFormat || 'array');
  const [availableModels, setAvailableModels] = useState<LLMModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  // Load available models on mount
  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    console.log('[ResultsCombineConfigPanel] Loading available models');
    setIsLoadingModels(true);
    setLoadError(null);

    try {
      const models = await fetchLLMModels();
      setAvailableModels(models);
      console.log('[ResultsCombineConfigPanel] Loaded models:', models.length);

      // If no model is selected and models are available, select the first one
      if (!selectedModelId && models.length > 0) {
        setSelectedModelId(models[0].id);
      }
    } catch (error) {
      console.error('[ResultsCombineConfigPanel] Error loading models:', error);
      setLoadError('Failed to load models. Please try again.');
    } finally {
      setIsLoadingModels(false);
    }
  };

  const validateSchema = (schema: string): boolean => {
    if (!schema || schema.trim().length === 0) {
      setSchemaError(null);
      return true; // Empty schema is valid
    }

    try {
      JSON.parse(schema);
      setSchemaError(null);
      return true;
    } catch (e: any) {
      setSchemaError('Invalid JSON format: ' + e.message);
      return false;
    }
  };

  const handleSchemaChange = (value: string) => {
    setOutputSchema(value);
    validateSchema(value);
  };

  const handleSave = () => {
    console.log('[ResultsCombineConfigPanel] Saving configuration:', {
      nodeId,
      systemPrompt,
      selectedModelId,
      temperature,
      maxTokens,
      hasOutputSchema: !!outputSchema,
    });

    // Validate schema before saving
    if (!validateSchema(outputSchema)) {
      console.error('[ResultsCombineConfigPanel] Cannot save with invalid schema');
      return;
    }

    const selectedModel = availableModels.find(m => m.id === selectedModelId);
    
    const newConfig: ResultsCombineNodeConfig = {
      systemPrompt,
      modelId: selectedModelId,
      model: selectedModel?.name || '',
      temperature,
      maxTokens,
      outputSchema,
      inputFormat,
      outputFormat,
    };

    onSave(newConfig);
    onClose();
  };

  const handleCancel = () => {
    console.log('[ResultsCombineConfigPanel] Cancelling configuration');
    onClose();
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[35%] bg-white/95 backdrop-blur-xl shadow-2xl z-50 flex flex-col animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200/80">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Results Combine Configuration</h2>
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
        {/* Test Panel */}
        <NodeTestPanel
          nodeId={nodeId}
          nodeType="results-combine"
          nodeLabel="Results Combine"
          nodeConfig={config}
        />

        {/* Format Configuration */}
        <div className="space-y-4 p-4 bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-200/80 rounded-xl">
          <div className="flex items-center space-x-2">
            <svg className="w-5 h-5 text-blue-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
            <h3 className="text-sm font-semibold text-gray-900">Data Format</h3>
          </div>
          
          <FormatSelector
            label="Input Format"
            value={inputFormat}
            onChange={setInputFormat}
            type="input"
            helpText="Format of data received from the previous node (typically array)."
          />

          <FormatSelector
            label="Output Format"
            value={outputFormat}
            onChange={setOutputFormat}
            type="output"
            helpText="Format of combined results sent to the next node."
          />
        </div>
        
        {/* System Prompt */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-900">
            Transformation System Prompt
          </label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Enter system prompt for transforming each input item to the standard format..."
            rows={6}
            className="w-full px-4 py-3 bg-gray-50/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all resize-none text-sm text-gray-900 placeholder-gray-400"
          />
          <p className="text-xs text-gray-500">
            Define how the LLM should transform each input item into the standardized output format
          </p>
        </div>

        {/* Output Schema */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-900">
            Output Schema (JSON)
          </label>
          <textarea
            value={outputSchema}
            onChange={(e) => handleSchemaChange(e.target.value)}
            placeholder={'{\n  "field1": "string",\n  "field2": "number"\n}'}
            rows={8}
            className={`w-full px-4 py-3 bg-gray-50/50 border rounded-xl focus:outline-none focus:ring-2 transition-all resize-none text-sm font-mono text-gray-900 placeholder-gray-400 ${
              schemaError 
                ? 'border-red-300 focus:ring-red-500/50' 
                : 'border-gray-200 focus:ring-blue-500/50'
            }`}
          />
          {schemaError && (
            <div className="flex items-start space-x-2 p-2 bg-red-50 border border-red-200 rounded-lg">
              <svg className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-red-700">{schemaError}</p>
            </div>
          )}
          <p className="text-xs text-gray-500">
            Define the expected JSON structure for each standardized output item (optional but recommended)
          </p>
        </div>

        {/* Model Selection */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-900">
            Model
          </label>
          {isLoadingModels ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : loadError ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
              <div className="flex items-center space-x-2">
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm text-red-700">{loadError}</span>
              </div>
              <button
                onClick={loadModels}
                className="mt-2 text-xs text-red-600 hover:text-red-700 font-medium"
              >
                Retry
              </button>
            </div>
          ) : (
            <select
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all text-sm text-gray-900 cursor-pointer"
            >
              {availableModels.length === 0 ? (
                <option value="">No models available</option>
              ) : (
                availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.display_name}
                  </option>
                ))
              )}
            </select>
          )}
          <p className="text-xs text-gray-500">
            Select the LLM model to use for transforming each input item
          </p>
        </div>

        {/* Temperature */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-900">
              Temperature
            </label>
            <span className="text-sm font-mono text-blue-600">{temperature.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>0.0 (Precise)</span>
            <span>2.0 (Creative)</span>
          </div>
          <p className="text-xs text-gray-500">
            Controls randomness: lower values make output more focused and deterministic
          </p>
        </div>

        {/* Max Tokens */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-900">
              Max Tokens
            </label>
            <span className="text-sm font-mono text-blue-600">{maxTokens}</span>
          </div>
          <input
            type="range"
            min="100"
            max="8000"
            step="100"
            value={maxTokens}
            onChange={(e) => setMaxTokens(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>100</span>
            <span>8000</span>
          </div>
          <p className="text-xs text-gray-500">
            Maximum length of the generated response for each transformation
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-gray-200/80 bg-gray-50/30">
        <div className="flex items-center justify-end space-x-3">
          <button
            onClick={handleCancel}
            className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isLoadingModels || !!loadError || !selectedModelId || !!schemaError}
            className="px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResultsCombineConfigPanel;

