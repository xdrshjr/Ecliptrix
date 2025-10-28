'use client';

import React, { useState } from 'react';

export interface NodeTestPanelProps {
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  nodeConfig: any;
  onTest?: (input: any) => Promise<{ output: any; error?: string }>;
}

/**
 * Get default input JSON for each node type
 */
const getDefaultInputJson = (nodeType: string): string => {
  switch (nodeType) {
    case 'start':
      return JSON.stringify({
        "text": "Hello, this is the workflow start"
      }, null, 2);
    
    case 'text-input':
      return JSON.stringify({
        "text": "Previous node output",
        "message": "Input from previous step"
      }, null, 2);
    
    case 'chat-llm':
      return JSON.stringify({
        "text": "What is artificial intelligence?",
        "message": "User question or prompt"
      }, null, 2);
    
    case 'pexels-video-search':
      return JSON.stringify({
        "keywords": "beautiful nature landscape",
        "text": "Search keywords from previous node"
      }, null, 2);
    
    case 'tavily-search':
      return JSON.stringify({
        "keywords": "artificial intelligence trends 2024",
        "text": "Search keywords from previous node"
      }, null, 2);
    
    case 'volcano-tts':
      return JSON.stringify({
        "text": "Hello, this is a test of the Volcano text-to-speech system.",
        "message": "Text to convert to speech"
      }, null, 2);
    
    case 'to-array':
      return JSON.stringify({
        "text": "Apple, Banana, Orange, Grape, Watermelon",
        "message": "List of fruits to convert to array"
      }, null, 2);
    
    case 'results-combine':
      return JSON.stringify([
        {
          "name": "Product A",
          "price": "$29.99",
          "category": "Electronics"
        },
        {
          "title": "Product B",
          "cost": "49.99 USD",
          "type": "Books"
        },
        {
          "product": "Product C",
          "value": 19.99,
          "group": "Home & Garden"
        }
      ], null, 2);
    
    case 'end':
      return JSON.stringify({
        "result": "Final workflow output",
        "data": {
          "status": "completed",
          "output": "Processing result"
        }
      }, null, 2);
    
    default:
      return JSON.stringify({
        "text": "Sample input"
      }, null, 2);
  }
};

/**
 * Node Test Panel Component
 * Provides a test/debug interface for individual nodes
 * - Edit input JSON
 * - Run single node test
 * - View output JSON
 * - Apple-style clean design with gray-black color scheme
 */
const NodeTestPanel: React.FC<NodeTestPanelProps> = ({
  nodeId,
  nodeType,
  nodeLabel,
  nodeConfig,
  onTest
}) => {
  const [inputJson, setInputJson] = useState<string>(getDefaultInputJson(nodeType));
  const [outputJson, setOutputJson] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  console.log('[NodeTestPanel] Rendering:', { 
    nodeId, 
    nodeType,
    nodeLabel,
    hasConfig: !!nodeConfig,
    isExpanded
  });

  const handleTest = async () => {
    console.log('[NodeTestPanel] Test button clicked:', { nodeId, nodeType });
    
    setIsLoading(true);
    setError(null);
    setOutputJson('');

    try {
      // Parse input JSON
      let parsedInput;
      try {
        parsedInput = JSON.parse(inputJson);
      } catch (e) {
        throw new Error('Invalid input JSON format');
      }

      console.log('[NodeTestPanel] Testing node with input:', { 
        nodeId, 
        nodeType,
        input: parsedInput 
      });

      // Call backend API to test single node
      const response = await fetch('/api/workflow/test-node', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          node_id: nodeId,
          node_type: nodeType,
          node_label: nodeLabel,
          node_config: nodeConfig,
          input: parsedInput,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || data.message || 'Test failed');
      }

      console.log('[NodeTestPanel] Test completed successfully:', { 
        nodeId,
        output: data.output 
      });

      // Display output
      setOutputJson(JSON.stringify(data.output, null, 2));

      // Call optional callback
      if (onTest) {
        await onTest({ output: data.output });
      }

    } catch (err: any) {
      console.error('[NodeTestPanel] Test failed:', err);
      setError(err.message || 'Test execution failed');
      setOutputJson('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (value: string) => {
    setInputJson(value);
    setError(null); // Clear error when user edits
  };

  return (
    <div className="mb-6 bg-gradient-to-br from-gray-50 to-gray-100/50 border border-gray-200/80 rounded-xl overflow-hidden">
      {/* Header - Collapsible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-100/60 transition-colors"
      >
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center shadow-sm">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-gray-900">Test & Debug</h3>
            <p className="text-xs text-gray-500">Test this node independently</p>
          </div>
        </div>
        <svg 
          className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Input JSON Editor */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-700">
              Input JSON
            </label>
            <textarea
              value={inputJson}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder='{\n  "key": "value"\n}'
              rows={6}
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400/50 focus:border-gray-400 transition-all resize-none text-xs font-mono text-gray-800"
              disabled={isLoading}
            />
          </div>

          {/* Test Button */}
          <button
            onClick={handleTest}
            disabled={isLoading}
            className="w-full px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-br from-gray-700 to-gray-900 rounded-lg hover:from-gray-800 hover:to-black transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Testing...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Run Test</span>
              </>
            )}
          </button>

          {/* Error Display */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start space-x-2">
                <svg className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1">
                  <p className="text-xs font-medium text-red-800">Test Failed</p>
                  <p className="text-xs text-red-700 mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Output JSON Display */}
          {outputJson && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-gray-700">
                  Output JSON
                </label>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(outputJson);
                  }}
                  className="text-xs text-gray-700 hover:text-black font-medium transition-colors"
                >
                  Copy
                </button>
              </div>
              <div className="relative">
                <pre className="w-full px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs font-mono text-gray-800 max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
                  {outputJson}
                </pre>
                <div className="absolute top-2 right-2">
                  <div className="inline-flex items-center px-2 py-1 bg-green-500/10 border border-green-500/20 rounded-md">
                    <svg className="w-3 h-3 text-green-600 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-xs font-medium text-green-700">Success</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Info Box */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <div className="flex items-start space-x-2">
              <svg className="w-4 h-4 text-gray-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-gray-700">
                Test your node independently before running the full workflow. Edit the input JSON to simulate different scenarios.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NodeTestPanel;

