'use client';

import React, { useState, useEffect } from 'react';
import { ChatLLMNodeConfig, LLMModel, DataFormat } from '@/types';
import { fetchLLMModels } from '@/lib/api/llm';
import { useLocale } from '@/contexts/LocaleContext';
import NodeTestPanel from './NodeTestPanel';
import FormatSelector from './FormatSelector';

interface ChatLLMConfigPanelProps {
  nodeId: string;
  config: ChatLLMNodeConfig;
  onSave: (config: ChatLLMNodeConfig) => void;
  onClose: () => void;
}

/**
 * Chat LLM Configuration Panel Component
 * Elegant Apple-style right-side configuration panel for Chat LLM nodes
 */
const ChatLLMConfigPanel: React.FC<ChatLLMConfigPanelProps> = ({
  nodeId,
  config,
  onSave,
  onClose,
}) => {
  console.log('[ChatLLMConfigPanel] Rendering panel:', { nodeId, config });

  const { t } = useLocale();

  // State management
  const [systemPrompt, setSystemPrompt] = useState(config.systemPrompt || '');
  const [selectedModelId, setSelectedModelId] = useState(config.modelId || '');
  const [temperature, setTemperature] = useState(config.temperature ?? 0.7);
  const [maxTokens, setMaxTokens] = useState(config.maxTokens || 2000);
  const [inputFormat, setInputFormat] = useState<DataFormat>(config.inputFormat || 'application/json');
  const [outputFormat, setOutputFormat] = useState<DataFormat>(config.outputFormat || 'application/json');
  const [availableModels, setAvailableModels] = useState<LLMModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load available models on mount
  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    console.log('[ChatLLMConfigPanel] Loading available models');
    setIsLoadingModels(true);
    setLoadError(null);

    try {
      const models = await fetchLLMModels();
      setAvailableModels(models);
      console.log('[ChatLLMConfigPanel] Loaded models:', models.length);

      // If no model is selected and models are available, select the first one
      if (!selectedModelId && models.length > 0) {
        setSelectedModelId(models[0].id);
      }
    } catch (error) {
      console.error('[ChatLLMConfigPanel] Error loading models:', error);
      setLoadError(t.workflowConfig.common.loadFailed);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleSave = () => {
    console.log('[ChatLLMConfigPanel] Saving configuration:', {
      nodeId,
      systemPrompt,
      selectedModelId,
      temperature,
      maxTokens,
    });

    const selectedModel = availableModels.find(m => m.id === selectedModelId);
    
    const newConfig: ChatLLMNodeConfig = {
      systemPrompt,
      modelId: selectedModelId,
      model: selectedModel?.name || '',
      temperature,
      maxTokens,
      inputFormat,
      outputFormat,
    };

    onSave(newConfig);
    onClose();
  };

  const handleCancel = () => {
    console.log('[ChatLLMConfigPanel] Cancelling configuration');
    onClose();
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[35%] bg-card z-50 flex flex-col animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-md bg-secondary flex items-center justify-center">
            <svg className="w-5 h-5 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t.workflowConfig.chatLLM.title}</h2>
            <p className="text-xs text-muted-foreground">{t.workflowConfig.common.nodeIdLabel} {nodeId}</p>
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
          nodeType="chat-llm"
          nodeLabel={t.workflowConfig.chatLLM.title}
          nodeConfig={config}
        />

        {/* Format Configuration */}
        <div className="space-y-4 p-4 bg-muted border border-border rounded-md">
          <div className="flex items-center space-x-2">
            <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
            <h3 className="text-sm font-semibold text-foreground">{t.workflowConfig.common.dataFormat}</h3>
          </div>

          <FormatSelector
            label={t.workflowConfig.common.inputFormat}
            value={inputFormat}
            onChange={setInputFormat}
            type="input"
            helpText={t.workflowConfig.common.inputFormatHelp}
          />

          <FormatSelector
            label={t.workflowConfig.common.outputFormat}
            value={outputFormat}
            onChange={setOutputFormat}
            type="output"
            helpText={t.workflowConfig.common.outputFormatHelp}
          />
        </div>

        {/* System Prompt */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            {t.workflowConfig.chatLLM.systemPrompt}
          </label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder={t.workflowConfig.chatLLM.systemPromptPlaceholder}
            rows={6}
            className="w-full px-4 py-3 bg-muted border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-colors resize-none text-sm text-foreground placeholder-muted-foreground"
          />
          <p className="text-xs text-muted-foreground">
            {t.workflowConfig.chatLLM.systemPromptHelp}
          </p>
        </div>

        {/* Model Selection */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            {t.workflowConfig.chatLLM.model}
          </label>
          {!isLoadingModels && !loadError && availableModels.length > 0 && !selectedModelId && (
            <div role="status" className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-md text-sm text-amber-700 dark:text-amber-300">
              {t.workflowConfig.chatLLM.selectModelHint}
            </div>
          )}
          {isLoadingModels ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : loadError ? (
            <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-md">
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
                {t.workflowConfig.common.retry}
              </button>
            </div>
          ) : (
            <select
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              className="w-full px-4 py-3 bg-muted border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-colors text-sm text-foreground cursor-pointer"
            >
              {availableModels.length === 0 ? (
                <option value="">{t.workflowConfig.common.noModelsAvailable}</option>
              ) : (
                availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.display_name}
                  </option>
                ))
              )}
            </select>
          )}
          <p className="text-xs text-muted-foreground">
            {t.workflowConfig.chatLLM.modelHelp}
          </p>
        </div>

        {/* Temperature */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-foreground">
              {t.workflowConfig.chatLLM.temperature}
            </label>
            <span className="text-sm font-mono text-primary">{temperature.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t.workflowConfig.chatLLM.temperatureLow}</span>
            <span>{t.workflowConfig.chatLLM.temperatureHigh}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t.workflowConfig.chatLLM.temperatureHelp}
          </p>
        </div>

        {/* Max Tokens */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-foreground">
              {t.workflowConfig.chatLLM.maxTokens}
            </label>
            <span className="text-sm font-mono text-primary">{maxTokens}</span>
          </div>
          <input
            type="range"
            min="100"
            max="8000"
            step="100"
            value={maxTokens}
            onChange={(e) => setMaxTokens(parseInt(e.target.value))}
            className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>100</span>
            <span>8000</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t.workflowConfig.chatLLM.maxTokensHelp}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-border bg-muted">
        <div className="flex items-center justify-end space-x-3">
          <button
            onClick={handleCancel}
            className="px-5 py-2.5 text-sm font-medium text-foreground bg-card border border-border rounded-lg hover:bg-accent transition-colors"
          >
            {t.workflowConfig.common.cancel}
          </button>
          <button
            onClick={handleSave}
            disabled={isLoadingModels || !!loadError || !selectedModelId}
            className="px-5 py-2.5 text-sm font-medium text-primary-foreground bg-primary hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t.workflowConfig.common.saveConfiguration}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatLLMConfigPanel;

