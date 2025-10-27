'use client';

import React, { useState, useEffect } from 'react';
import { ToArrayNodeConfig, LLMModel, DataFormat, ArrayElementType, ObjectSchemaField } from '@/types';
import { fetchLLMModels } from '@/lib/api/llm';
import NodeTestPanel from './NodeTestPanel';
import FormatSelector from './FormatSelector';

interface ToArrayConfigPanelProps {
  nodeId: string;
  config: ToArrayNodeConfig;
  onSave: (config: ToArrayNodeConfig) => void;
  onClose: () => void;
}

/**
 * To Array Configuration Panel Component
 * Elegant Apple-style gray-themed configuration panel for To Array nodes
 * Provides LLM model selection, conversion prompt configuration, and test functionality
 */
const ToArrayConfigPanel: React.FC<ToArrayConfigPanelProps> = ({
  nodeId,
  config,
  onSave,
  onClose,
}) => {
  console.log('[ToArrayConfigPanel] Rendering panel:', { nodeId, config });

  // State management
  const [systemPrompt, setSystemPrompt] = useState(
    config.systemPrompt || 
    'You are a data conversion assistant. Convert the input data into a clean JSON array format. Extract relevant items from the input and structure them as an array. Respond ONLY with a valid JSON array, no additional text or explanation.'
  );
  const [selectedModelId, setSelectedModelId] = useState(config.modelId || '');
  const [temperature, setTemperature] = useState(config.temperature ?? 0.3);
  const [maxTokens, setMaxTokens] = useState(config.maxTokens || 2000);
  const [inputFormat, setInputFormat] = useState<DataFormat>(config.inputFormat || 'application/json');
  const [outputFormat] = useState<DataFormat>('array'); // Always array for this node
  const [elementType, setElementType] = useState<ArrayElementType>(config.elementType || 'string');
  const [objectSchema, setObjectSchema] = useState<ObjectSchemaField[]>(config.objectSchema || []);
  const [availableModels, setAvailableModels] = useState<LLMModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load available models on mount
  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    console.log('[ToArrayConfigPanel] Loading available models');
    setIsLoadingModels(true);
    setLoadError(null);

    try {
      const models = await fetchLLMModels();
      setAvailableModels(models);
      console.log('[ToArrayConfigPanel] Loaded models:', models.length);

      // If no model is selected and models are available, select the first one
      if (!selectedModelId && models.length > 0) {
        setSelectedModelId(models[0].id);
      }
    } catch (error) {
      console.error('[ToArrayConfigPanel] Error loading models:', error);
      setLoadError('Failed to load models. Please try again.');
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleSave = () => {
    console.log('[ToArrayConfigPanel] Saving configuration:', {
      nodeId,
      systemPrompt,
      selectedModelId,
      temperature,
      maxTokens,
      elementType,
      schemaFieldCount: objectSchema.length,
    });

    const selectedModel = availableModels.find(m => m.id === selectedModelId);
    
    const newConfig: ToArrayNodeConfig = {
      systemPrompt,
      modelId: selectedModelId,
      model: selectedModel?.name || '',
      temperature,
      maxTokens,
      inputFormat,
      outputFormat: 'array', // Always array
      elementType,
      objectSchema: elementType === 'object' ? objectSchema : undefined,
    };

    onSave(newConfig);
    onClose();
  };

  const handleCancel = () => {
    console.log('[ToArrayConfigPanel] Cancelling configuration');
    onClose();
  };

  // Schema management functions
  const addSchemaField = () => {
    const newField: ObjectSchemaField = {
      name: `field_${objectSchema.length + 1}`,
      type: 'string',
      required: true,
      description: '',
    };
    setObjectSchema([...objectSchema, newField]);
  };

  const removeSchemaField = (index: number) => {
    const newSchema = objectSchema.filter((_, i) => i !== index);
    setObjectSchema(newSchema);
  };

  const updateSchemaField = (index: number, updates: Partial<ObjectSchemaField>) => {
    const newSchema = [...objectSchema];
    newSchema[index] = { ...newSchema[index], ...updates };
    setObjectSchema(newSchema);
  };

  const addNestedField = (parentIndex: number) => {
    const newSchema = [...objectSchema];
    if (!newSchema[parentIndex].objectSchema) {
      newSchema[parentIndex].objectSchema = [];
    }
    const nestedField: ObjectSchemaField = {
      name: `nested_field_${newSchema[parentIndex].objectSchema!.length + 1}`,
      type: 'string',
      required: true,
      description: '',
    };
    newSchema[parentIndex].objectSchema!.push(nestedField);
    setObjectSchema(newSchema);
  };

  const removeNestedField = (parentIndex: number, nestedIndex: number) => {
    const newSchema = [...objectSchema];
    if (newSchema[parentIndex].objectSchema) {
      newSchema[parentIndex].objectSchema = newSchema[parentIndex].objectSchema!.filter((_, i) => i !== nestedIndex);
    }
    setObjectSchema(newSchema);
  };

  const updateNestedField = (parentIndex: number, nestedIndex: number, updates: Partial<ObjectSchemaField>) => {
    const newSchema = [...objectSchema];
    if (newSchema[parentIndex].objectSchema) {
      newSchema[parentIndex].objectSchema![nestedIndex] = {
        ...newSchema[parentIndex].objectSchema![nestedIndex],
        ...updates
      };
    }
    setObjectSchema(newSchema);
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[35%] bg-white/95 backdrop-blur-xl shadow-2xl z-50 flex flex-col animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200/80">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-500 to-gray-700 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">To Array Configuration</h2>
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
          nodeType="to-array"
          nodeLabel="To Array"
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

          {/* Output Format (Fixed to Array) */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Output Format
            </label>
            <div className="w-full px-4 py-3 bg-gray-100 border border-gray-300 rounded-xl flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                <span className="text-sm font-semibold text-gray-700">Array</span>
              </div>
              <div className="inline-flex items-center px-2 py-1 bg-gray-600 rounded-md">
                <span className="text-xs font-medium text-white">Fixed</span>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              This node always outputs data in array format.
            </p>
          </div>
        </div>

        {/* Array Element Schema Configuration */}
        <div className="space-y-4 p-4 bg-gradient-to-br from-gray-50 to-gray-100/50 border border-gray-200/80 rounded-xl">
          <div className="flex items-center space-x-2">
            <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="text-sm font-semibold text-gray-900">Array Element Schema</h3>
          </div>

          {/* Element Type Selector */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Element Data Type
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(['string', 'number', 'boolean', 'object'] as ArrayElementType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => setElementType(type)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    elementType === type
                      ? 'bg-gray-600 text-white shadow-md'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500">
              Select the data type for elements in the output array
            </p>
          </div>

          {/* Object Schema Builder - Only shown when type is 'object' */}
          {elementType === 'object' && (
            <div className="space-y-3 pt-3 border-t border-gray-200">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">
                  Object Fields
                </label>
                <button
                  onClick={addSchemaField}
                  className="px-3 py-1.5 bg-gray-600 text-white text-xs font-medium rounded-lg hover:bg-gray-700 transition-colors flex items-center space-x-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Add Field</span>
                </button>
              </div>

              {objectSchema.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm italic">
                  No fields defined. Click &quot;Add Field&quot; to start building your schema.
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {objectSchema.map((field, index) => (
                    <div key={index} className="p-3 bg-white border border-gray-200 rounded-lg space-y-2">
                      {/* Field Header */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-700">Field {index + 1}</span>
                        <button
                          onClick={() => removeSchemaField(index)}
                          className="text-red-500 hover:text-red-700 transition-colors"
                          title="Remove field"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>

                      {/* Field Name */}
                      <div>
                        <input
                          type="text"
                          value={field.name}
                          onChange={(e) => updateSchemaField(index, { name: e.target.value })}
                          placeholder="Field name"
                          className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500/50"
                        />
                      </div>

                      {/* Field Type and Required */}
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={field.type}
                          onChange={(e) => updateSchemaField(index, { type: e.target.value as ArrayElementType })}
                          className="px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500/50"
                        >
                          <option value="string">String</option>
                          <option value="number">Number</option>
                          <option value="boolean">Boolean</option>
                          <option value="object">Object</option>
                        </select>
                        <label className="flex items-center space-x-2 px-3 py-2 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={field.required ?? true}
                            onChange={(e) => updateSchemaField(index, { required: e.target.checked })}
                            className="rounded border-gray-300"
                          />
                          <span className="text-xs text-gray-700">Required</span>
                        </label>
                      </div>

                      {/* Field Description */}
                      <div>
                        <input
                          type="text"
                          value={field.description || ''}
                          onChange={(e) => updateSchemaField(index, { description: e.target.value })}
                          placeholder="Field description (optional)"
                          className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500/50"
                        />
                      </div>

                      {/* Nested Object Fields */}
                      {field.type === 'object' && (
                        <div className="mt-2 pl-4 border-l-2 border-gray-300 space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-gray-600">Nested Fields</label>
                            <button
                              onClick={() => addNestedField(index)}
                              className="px-2 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-600 transition-colors"
                            >
                              + Add Nested
                            </button>
                          </div>

                          {field.objectSchema && field.objectSchema.length > 0 ? (
                            field.objectSchema.map((nestedField, nestedIndex) => (
                              <div key={nestedIndex} className="p-2 bg-gray-50 border border-gray-200 rounded space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-medium text-gray-600">Nested {nestedIndex + 1}</span>
                                  <button
                                    onClick={() => removeNestedField(index, nestedIndex)}
                                    className="text-red-500 hover:text-red-700"
                                    title="Remove nested field"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                                <input
                                  type="text"
                                  value={nestedField.name}
                                  onChange={(e) => updateNestedField(index, nestedIndex, { name: e.target.value })}
                                  placeholder="Nested field name"
                                  className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
                                />
                                <div className="grid grid-cols-2 gap-2">
                                  <select
                                    value={nestedField.type}
                                    onChange={(e) => updateNestedField(index, nestedIndex, { type: e.target.value as ArrayElementType })}
                                    className="px-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
                                  >
                                    <option value="string">String</option>
                                    <option value="number">Number</option>
                                    <option value="boolean">Boolean</option>
                                  </select>
                                  <label className="flex items-center space-x-1 px-2 py-1.5 border border-gray-200 rounded cursor-pointer hover:bg-white">
                                    <input
                                      type="checkbox"
                                      checked={nestedField.required ?? true}
                                      onChange={(e) => updateNestedField(index, nestedIndex, { required: e.target.checked })}
                                      className="rounded border-gray-300"
                                    />
                                    <span className="text-xs text-gray-700">Required</span>
                                  </label>
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-gray-500 italic">No nested fields</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Conversion Prompt */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-900">
            Conversion Prompt
          </label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Enter the system prompt for data conversion..."
            rows={6}
            className="w-full px-4 py-3 bg-gray-50/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-500/50 focus:border-transparent transition-all resize-none text-sm text-gray-900 placeholder-gray-400"
          />
          <p className="text-xs text-gray-500">
            Define how the LLM should convert input data to array format
          </p>
        </div>

        {/* Model Selection */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-900">
            LLM Model
          </label>
          {isLoadingModels ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
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
              className="w-full px-4 py-3 bg-gray-50/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-500/50 focus:border-transparent transition-all text-sm text-gray-900 cursor-pointer"
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
            Select the LLM model to use for data conversion
          </p>
        </div>

        {/* Temperature */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-900">
              Temperature
            </label>
            <span className="text-sm font-mono text-gray-600">{temperature.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-600"
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>0.0 (Precise)</span>
            <span>2.0 (Creative)</span>
          </div>
          <p className="text-xs text-gray-500">
            Lower values recommended for data conversion (0.0-0.5)
          </p>
        </div>

        {/* Max Tokens */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-900">
              Max Tokens
            </label>
            <span className="text-sm font-mono text-gray-600">{maxTokens}</span>
          </div>
          <input
            type="range"
            min="100"
            max="8000"
            step="100"
            value={maxTokens}
            onChange={(e) => setMaxTokens(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-600"
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>100</span>
            <span>8000</span>
          </div>
          <p className="text-xs text-gray-500">
            Maximum length of the generated array output
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
            disabled={isLoadingModels || !!loadError || !selectedModelId}
            className="px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-gray-600 to-gray-700 rounded-lg hover:from-gray-700 hover:to-gray-800 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
};

export default ToArrayConfigPanel;

