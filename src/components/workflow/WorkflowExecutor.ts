/**
 * Workflow Executor Service
 * 
 * Handles the execution of workflow graphs from Start to End nodes.
 * Executes nodes sequentially following connection paths and passes
 * outputs from one node to the next.
 * 
 * Supports data format conversion between nodes.
 */

import {
  WorkflowNode,
  WorkflowConnection,
  WorkflowExecutionState,
  WorkflowNodeExecutionState,
  WorkflowExecutionLog,
  ChatLLMNodeConfig,
  TextInputNodeConfig,
  StartNodeConfig,
  DataFormat,
} from '@/types';
import { convertFormat, detectFormat } from '@/lib/utils/formatConverter';
import { http, ApiError } from '@/lib/api/http-client';

export type ExecutionCallback = (state: WorkflowExecutionState) => void;

export class WorkflowExecutor {
  private nodes: WorkflowNode[];
  private connections: WorkflowConnection[];
  private executionState: WorkflowExecutionState;
  private onStateChange: ExecutionCallback;
  private abortController: AbortController | null = null;
  private userInput: string | null = null; // Store user input from chat interface

  constructor(
    nodes: WorkflowNode[],
    connections: WorkflowConnection[],
    onStateChange: ExecutionCallback,
    userInput?: string | null
  ) {
    this.nodes = nodes;
    this.connections = connections;
    this.onStateChange = onStateChange;
    this.userInput = userInput || null;
    
    // Initialize execution state
    this.executionState = {
      isRunning: false,
      currentNodeId: null,
      nodeStates: {},
      logs: [],
    };
    
    // Initialize all nodes as pending
    nodes.forEach(node => {
      this.executionState.nodeStates[node.id] = {
        nodeId: node.id,
        status: 'pending',
      };
    });
    
    console.log('[WorkflowExecutor] Initialized with user input:', {
      hasUserInput: !!this.userInput,
      userInputLength: this.userInput?.length || 0
    });
  }

  /**
   * Start workflow execution from the Start node
   */
  async execute(): Promise<void> {
    console.log('[WorkflowExecutor] Starting workflow execution', {
      nodesCount: this.nodes.length,
      connectionsCount: this.connections.length,
      timestamp: new Date().toISOString()
    });

    this.abortController = new AbortController();
    this.executionState.isRunning = true;
    this.executionState.startTime = new Date();
    this.executionState.logs = [];
    
    this.addLog('info', undefined, 'Workflow execution started');
    this.notifyStateChange();

    try {
      // Find the Start node
      const startNode = this.nodes.find(node => node.type === 'start');
      if (!startNode) {
        throw new Error('No Start node found in workflow');
      }

      this.addLog('info', startNode.id, `Found Start node: ${startNode.data.label}`);

      // Build execution path from Start to End
      const executionPath = this.buildExecutionPath(startNode);
      
      if (executionPath.length === 0) {
        throw new Error('No execution path found. Please connect Start node to End node.');
      }

      this.addLog('info', undefined, `Execution path built with ${executionPath.length} nodes`, {
        path: executionPath.map(n => n.data.label)
      });

      // Execute nodes in order
      let previousOutput: any = null;
      
      for (const node of executionPath) {
        // Check if execution was aborted
        if (this.abortController.signal.aborted) {
          this.addLog('warning', undefined, 'Workflow execution aborted by user');
          break;
        }

        // Execute the node
        previousOutput = await this.executeNode(node, previousOutput);
      }

      // Execution completed
      this.executionState.isRunning = false;
      this.executionState.currentNodeId = null;
      this.executionState.endTime = new Date();
      
      const duration = this.executionState.endTime.getTime() - this.executionState.startTime!.getTime();
      
      console.log('[WorkflowExecutor] Workflow execution completed:', {
        duration: `${(duration / 1000).toFixed(2)}s`,
        finalOutput: previousOutput,
        timestamp: new Date().toISOString()
      });
      
      // Add completion log with final output
      this.addLog('success', undefined, `Workflow execution completed successfully in ${(duration / 1000).toFixed(2)}s`, {
        output: this.createSafeLogObject(previousOutput),
        duration
      });
      
      // Ensure final state update is sent
      this.notifyStateChange();
      
    } catch (error: any) {
      console.error('[WorkflowExecutor] Execution error:', error);
      this.executionState.isRunning = false;
      this.executionState.currentNodeId = null;
      this.executionState.endTime = new Date();
      this.addLog('error', undefined, `Workflow execution failed: ${error.message}`, {
        error: error.message,
        errorType: error.name,
        stack: error.stack,
      });
    }

    this.notifyStateChange();
  }

  /**
   * Abort the current workflow execution
   */
  abort(): void {
    if (this.abortController) {
      console.log('[WorkflowExecutor] Aborting workflow execution');
      this.abortController.abort();
      this.addLog('warning', undefined, 'Workflow execution aborted');
    }
  }

  /**
   * Build execution path from Start node to End node
   * Uses BFS to traverse the graph
   */
  private buildExecutionPath(startNode: WorkflowNode): WorkflowNode[] {
    const path: WorkflowNode[] = [];
    const visited = new Set<string>();
    const queue: WorkflowNode[] = [startNode];

    while (queue.length > 0) {
      const currentNode = queue.shift()!;
      
      if (visited.has(currentNode.id)) {
        continue;
      }
      
      visited.add(currentNode.id);
      path.push(currentNode);

      // If we reached the End node, we're done
      if (currentNode.type === 'end') {
        break;
      }

      // Find next nodes connected to current node's output
      const nextNodes = this.getNextNodes(currentNode.id);
      queue.push(...nextNodes);
    }

    return path;
  }

  /**
   * Get nodes connected to the output of the given node
   */
  private getNextNodes(nodeId: string): WorkflowNode[] {
    const nextNodeIds = this.connections
      .filter(conn => conn.source === nodeId)
      .map(conn => conn.target);

    return this.nodes.filter(node => nextNodeIds.includes(node.id));
  }

  /**
   * Convert input data to the format expected by the node
   */
  private convertInputFormat(node: WorkflowNode, input: any): any {
    const config = node.data.config as any;
    const inputFormat = config?.inputFormat as DataFormat | undefined;
    
    // If no input format specified, return as-is (backward compatibility)
    if (!inputFormat) {
      return input;
    }
    
    // Detect current format
    const currentFormat = detectFormat(input);
    
    console.log('[WorkflowExecutor] Converting input format:', {
      nodeId: node.id,
      from: currentFormat,
      to: inputFormat,
    });
    
    // Convert format
    const result = convertFormat({
      from: currentFormat,
      to: inputFormat,
      data: input,
    });
    
    if (!result.success) {
      console.error('[WorkflowExecutor] Input format conversion failed:', result.error);
      this.addLog('warning', node.id, `Input format conversion failed: ${result.error}`, {
        from: currentFormat,
        to: inputFormat,
      });
      // Return original input on conversion failure
      return input;
    }
    
    this.addLog('info', node.id, `Input converted from ${currentFormat} to ${inputFormat}`, result.details);
    return result.data;
  }
  
  /**
   * Convert output data to the format specified by the node
   */
  private convertOutputFormat(node: WorkflowNode, output: any): any {
    const config = node.data.config as any;
    const outputFormat = config?.outputFormat as DataFormat | undefined;
    
    // If no output format specified, return as-is (backward compatibility)
    if (!outputFormat) {
      return output;
    }
    
    // Detect current format
    const currentFormat = detectFormat(output);
    
    console.log('[WorkflowExecutor] Converting output format:', {
      nodeId: node.id,
      from: currentFormat,
      to: outputFormat,
    });
    
    // Convert format
    const result = convertFormat({
      from: currentFormat,
      to: outputFormat,
      data: output,
    });
    
    if (!result.success) {
      console.error('[WorkflowExecutor] Output format conversion failed:', result.error);
      this.addLog('warning', node.id, `Output format conversion failed: ${result.error}`, {
        from: currentFormat,
        to: outputFormat,
      });
      // Return original output on conversion failure
      return output;
    }
    
    this.addLog('info', node.id, `Output converted from ${currentFormat} to ${outputFormat}`, result.details);
    return result.data;
  }

  /**
   * Execute a single node
   */
  private async executeNode(node: WorkflowNode, input: any): Promise<any> {
    // Convert input format if specified
    const convertedInput = this.convertInputFormat(node, input);
    
    // Create safe input preview for logging
    const inputPreview = this.createSafeLogObject(convertedInput);
    
    console.log(`[WorkflowExecutor] ========== Executing Node ==========`, {
      nodeId: node.id,
      nodeType: node.type,
      nodeLabel: node.data.label,
      hasInput: !!convertedInput,
      inputType: typeof convertedInput,
      inputPreview: inputPreview,
      timestamp: new Date().toISOString()
    });

    // Update node state to executing
    this.executionState.currentNodeId = node.id;
    this.executionState.nodeStates[node.id] = {
      nodeId: node.id,
      status: 'executing',
      input: inputPreview, // Store safe version
      startTime: new Date(),
    };
    
    this.addLog('info', node.id, `Executing node: ${node.data.label}`, { 
      input: inputPreview,
      nodeType: node.type 
    });
    this.notifyStateChange();

    try {
      let output: any = null;

      // Execute based on node type (using converted input)
      switch (node.type) {
        case 'start':
          output = await this.executeStartNode(node);
          break;
        
        case 'text-input':
          output = await this.executeTextInputNode(node, convertedInput);
          break;
        
        case 'chat-llm':
          output = await this.executeChatLLMNode(node, convertedInput);
          break;
        
        case 'pexels-video-search':
          output = await this.executePexelsVideoSearchNode(node, convertedInput);
          break;
        
        case 'tavily-search':
          output = await this.executeTavilySearchNode(node, convertedInput);
          break;
        
        case 'volcano-tts':
          output = await this.executeVolcanoTTSNode(node, convertedInput);
          break;
        
        case 'to-array':
          output = await this.executeToArrayNode(node, convertedInput);
          break;
        
        case 'results-combine':
          output = await this.executeResultsCombineNode(node, convertedInput);
          break;
        
        case 'ai-video-generate':
          output = await this.executeAIVideoGenerateNode(node, convertedInput);
          break;
        
        case 'video-export':
          output = await this.executeVideoExportNode(node, convertedInput);
          break;
        
        case 'end':
          output = await this.executeEndNode(node, convertedInput);
          break;
        
        default:
          throw new Error(`Unknown node type: ${node.type}`);
      }
      
      // Convert output format if specified
      output = this.convertOutputFormat(node, output);

      // Calculate execution duration
      const endTime = new Date();
      const duration = endTime.getTime() - this.executionState.nodeStates[node.id].startTime!.getTime();

      // Update node state to completed
      this.executionState.nodeStates[node.id] = {
        ...this.executionState.nodeStates[node.id],
        status: 'completed',
        output,
        endTime,
      };
      
      // Create safe output for logging
      const outputPreview = this.createSafeLogObject(output);
      
      console.log(`[WorkflowExecutor] ========== Node Completed ==========`, {
        nodeId: node.id,
        nodeLabel: node.data.label,
        duration: `${duration}ms`,
        hasOutput: !!output,
        outputType: typeof output,
        outputPreview: outputPreview,
        timestamp: new Date().toISOString()
      });
      
      this.addLog('success', node.id, `Node completed: ${node.data.label}`, { 
        output: outputPreview,
        duration,
        executionTime: `${(duration / 1000).toFixed(2)}s`
      });
      this.notifyStateChange();

      return output;
      
    } catch (error: any) {
      console.error(`[WorkflowExecutor] ========== Node Failed ==========`, {
        nodeId: node.id,
        nodeLabel: node.data.label,
        errorMessage: error.message,
        errorStack: error.stack,
        timestamp: new Date().toISOString()
      });
      
      // Update node state to error
      this.executionState.nodeStates[node.id] = {
        ...this.executionState.nodeStates[node.id],
        status: 'error',
        error: error.message,
        endTime: new Date(),
      };
      
      this.addLog('error', node.id, `Node failed: ${node.data.label}`, { 
        error: error.message,
        errorType: error.name,
        stack: error.stack
      });
      this.notifyStateChange();
      
      throw error;
    }
  }

  /**
   * Execute Start node
   */
  private async executeStartNode(node: WorkflowNode): Promise<any> {
    console.log('[WorkflowExecutor] Executing Start node', {
      hasUserInput: !!this.userInput,
      hasConfigInput: !!(node.data.config as StartNodeConfig)?.input
    });
    
    await this.simulateDelay(500);
    
    // Priority: user input from chat > configured input > empty
    let inputContent = '';
    
    if (this.userInput) {
      // User input from chat interface takes highest priority
      inputContent = this.userInput;
      console.log('[WorkflowExecutor] Using user input from chat interface:', {
        inputLength: inputContent.length
      });
    } else {
      // Otherwise use configured input
      const config = node.data.config as StartNodeConfig;
      inputContent = config?.input || '';
      console.log('[WorkflowExecutor] Using configured input:', {
        inputLength: inputContent.length,
        hasConfigInput: !!config?.input
      });
    }
    
    return {
      text: inputContent,
      message: 'Workflow started',
      source: this.userInput ? 'chat' : 'config'
    };
  }

  /**
   * Execute Text Input node
   */
  private async executeTextInputNode(node: WorkflowNode, input: any): Promise<any> {
    console.log('[WorkflowExecutor] Executing Text Input node', { input });
    
    const config = node.data.config as TextInputNodeConfig;
    
    if (!config?.content) {
      throw new Error('Text Input node is not configured. Please add content.');
    }

    await this.simulateDelay(300);
    
    // Text input node outputs its configured content
    return {
      text: config.content,
      previousInput: input,
    };
  }

  /**
   * Create a safe version of an object for logging, removing circular references and DOM elements
   */
  private createSafeLogObject(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    if (typeof obj !== 'object') {
      return obj;
    }
    
    // Check if it's a DOM element or React component
    if (obj instanceof Element || obj instanceof Node) {
      return '[DOM Element]';
    }
    
    try {
      const seen = new WeakSet();
      return JSON.parse(JSON.stringify(obj, (key, value) => {
        // Skip React internals and DOM references
        if (typeof key === 'string' && (key.startsWith('_') || key.startsWith('__react') || key.startsWith('__fiber'))) {
          return undefined;
        }
        
        // Handle circular references
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
          
          // Skip DOM elements and React components
          if (value instanceof Element || value instanceof Node) {
            return '[DOM Element]';
          }
        }
        
        return value;
      }));
    } catch (error) {
      console.warn('[WorkflowExecutor] Could not create safe log object:', error);
      return { error: 'Could not serialize object safely' };
    }
  }

  /**
   * Safely serialize an object to string, avoiding circular references and DOM elements
   */
  private safeSerialize(obj: any): string {
    if (obj === null || obj === undefined) {
      return '';
    }
    
    if (typeof obj === 'string') {
      return obj;
    }
    
    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return String(obj);
    }
    
    // Check if it's a DOM element or React component
    if (obj instanceof Element || obj instanceof Node) {
      console.warn('[WorkflowExecutor] Detected DOM element in input, extracting text content');
      return obj.textContent || '';
    }
    
    // Check for React Fiber or circular references
    if (obj && typeof obj === 'object') {
      // Try to extract known text fields first
      if (obj.text) return String(obj.text);
      if (obj.message) return String(obj.message);
      if (obj.content) return String(obj.content);
      
      // Attempt safe JSON serialization with circular reference handling
      try {
        const seen = new WeakSet();
        const sanitized = JSON.stringify(obj, (key, value) => {
          // Skip React internals and DOM references
          if (key.startsWith('_') || key.startsWith('__react') || key.startsWith('__fiber')) {
            return undefined;
          }
          
          // Handle circular references
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
              return '[Circular]';
            }
            seen.add(value);
            
            // Skip DOM elements and React components
            if (value instanceof Element || value instanceof Node) {
              return '[DOM Element]';
            }
          }
          
          return value;
        });
        return sanitized;
      } catch (error) {
        console.error('[WorkflowExecutor] Failed to serialize object:', error);
        return String(obj);
      }
    }
    
    return String(obj);
  }

  /**
   * Execute Chat LLM node
   */
  private async executeChatLLMNode(node: WorkflowNode, input: any): Promise<any> {
    // Safely serialize input for logging (avoid circular references)
    const safeInputLog = this.safeSerialize(input).substring(0, 200);
    
    console.log('[WorkflowExecutor] Executing Chat LLM node', { 
      nodeId: node.id,
      inputPreview: safeInputLog,
      inputType: typeof input,
      timestamp: new Date().toISOString()
    });
    
    const config = node.data.config as ChatLLMNodeConfig;
    
    if (!config?.model || !config?.systemPrompt) {
      throw new Error('Chat LLM node is not fully configured. Please set model and system prompt.');
    }

    this.addLog('info', node.id, 'Calling LLM API...', { 
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      systemPromptLength: config.systemPrompt.length
    });

    // Extract user message from input using safe serialization
    let userMessage = '';
    if (typeof input === 'string') {
      userMessage = input;
    } else if (input?.text) {
      userMessage = String(input.text);
    } else if (input?.message) {
      userMessage = String(input.message);
    } else if (input?.content) {
      userMessage = String(input.content);
    } else {
      // Use safe serialization to avoid circular reference errors
      userMessage = this.safeSerialize(input);
    }
    
    // Ensure we have a valid message
    if (!userMessage || userMessage.trim().length === 0) {
      throw new Error('Chat LLM node requires a valid input message.');
    }
    
    console.log('[WorkflowExecutor] Extracted user message', {
      messageLength: userMessage.length,
      messagePreview: userMessage.substring(0, 100) + (userMessage.length > 100 ? '...' : '')
    });

    // Store LLM prompts in node execution state for display
    this.executionState.nodeStates[node.id] = {
      ...this.executionState.nodeStates[node.id],
      llmSystemPrompt: config.systemPrompt,
      llmUserPrompt: userMessage,
      llmModel: config.model,
      llmTemperature: config.temperature,
      llmMaxTokens: config.maxTokens,
    };
    this.notifyStateChange();

    try {
      // Call the LLM API
      let response: Response;
      try {
        response = await http.stream('/api/chat', {
          messages: [
            {
              role: 'system',
              content: config.systemPrompt,
            },
            {
              role: 'user',
              content: userMessage,
            },
          ],
        }, {
          timeoutMs: 600_000,
          signal: this.abortController?.signal,
        });
      } catch (httpError) {
        if (httpError instanceof ApiError) {
          throw new Error(httpError.message || `API request failed with status ${httpError.status}`);
        }
        throw httpError;
      }

      // Read the streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      let accumulatedContent = '';
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              // Handle the format from /api/chat endpoint
              if (parsed.content) {
                accumulatedContent += parsed.content;
              }
              // Also handle standard OpenAI format (fallback)
              else if (parsed.choices?.[0]?.delta?.content) {
                accumulatedContent += parsed.choices[0].delta.content;
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      console.log('[WorkflowExecutor] LLM response received', {
        nodeId: node.id,
        responseLength: accumulatedContent.length,
        contentPreview: accumulatedContent.substring(0, 100) + (accumulatedContent.length > 100 ? '...' : ''),
        timestamp: new Date().toISOString()
      });

      // Store LLM response in node execution state for display
      this.executionState.nodeStates[node.id] = {
        ...this.executionState.nodeStates[node.id],
        llmResponse: accumulatedContent,
      };
      this.notifyStateChange();

      this.addLog('success', node.id, 'LLM response received', { 
        responseLength: accumulatedContent.length,
        model: config.model
      });

      return {
        text: accumulatedContent,
        llmResponse: accumulatedContent,
        previousInput: input,
      };

    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('LLM request aborted');
      }
      throw new Error(`LLM request failed: ${error.message}`);
    }
  }

  /**
   * Execute Volcano TTS node
   */
  private async executeVolcanoTTSNode(node: WorkflowNode, input: any): Promise<any> {
    console.log('[WorkflowExecutor] Executing Volcano TTS node', { 
      nodeId: node.id,
      input,
      timestamp: new Date().toISOString()
    });
    
    const config = node.data.config as any;
    
    // Get text from config or input
    let text = config?.text || '';
    
    // If input is provided and has text, use it (allows dynamic text from previous nodes)
    if (input) {
      if (typeof input === 'string') {
        text = input;
      } else if (input?.text) {
        text = input.text;
      } else if (input?.message) {
        text = input.message;
      } else if (input?.content) {
        text = input.content;
      }
    }
    
    if (!text || text.trim().length === 0) {
      throw new Error('Volcano TTS node requires text content. Please configure text or provide it as input.');
    }
    
    const voiceType = config?.voiceType || 'zh_male_shaonianzixin_moon_bigtts';
    const speedRatio = config?.speedRatio || 1.0;
    
    this.addLog('info', node.id, `Converting text to speech (${text.length} chars)`, { 
      textLength: text.length,
      voiceType,
      speedRatio
    });

    try {
      // Call the TTS API via sentences endpoint
      let result: any;
      try {
        result = await http.post<any>('/api/tts/convert-sentences', {
          segment_id: node.id,
          sentences: [
            {
              sentence_id: `${node.id}-1`,
              text: text.trim(),
              order: 0
            }
          ],
          voice_type: voiceType,
          speed_ratio: speedRatio,
          task_id: `workflow-${Date.now()}`,
        }, { timeoutMs: 600_000 });
      } catch (httpError) {
        if (httpError instanceof ApiError) {
          throw new Error(httpError.message || `TTS request failed with status ${httpError.status}`);
        }
        throw httpError;
      }
      
      console.log('[WorkflowExecutor] TTS response received', {
        nodeId: node.id,
        success: result.success,
        audioUrl: result.concatenated_audio_url,
        duration: result.total_duration,
        timestamp: new Date().toISOString()
      });

      if (!result.success) {
        throw new Error(result.message || 'TTS conversion failed');
      }

      this.addLog('success', node.id, 'Speech synthesis completed', { 
        audioUrl: result.concatenated_audio_url,
        duration: result.total_duration,
        voiceType
      });

      return {
        text: text,
        audio_url: result.concatenated_audio_url,
        duration: result.total_duration,
        voice_type: voiceType,
        speed_ratio: speedRatio,
        sentence_results: result.sentence_results,
        previousInput: input,
      };

    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('TTS request aborted');
      }
      throw new Error(`TTS request failed: ${error.message}`);
    }
  }

  /**
   * Execute To Array node
   * Converts any input data to array format using LLM with schema support
   */
  private async executeToArrayNode(node: WorkflowNode, input: any): Promise<any> {
    const config = node.data.config as any;
    const elementType = config?.elementType || 'string';
    const hasObjectSchema = !!(config?.objectSchema && config.objectSchema.length > 0);
    
    console.log('[WorkflowExecutor] Executing To Array node with schema', { 
      nodeId: node.id,
      elementType,
      hasObjectSchema,
      schemaFieldCount: hasObjectSchema ? config.objectSchema.length : 0,
      input,
      timestamp: new Date().toISOString()
    });
    
    if (!config?.model || !config?.systemPrompt) {
      throw new Error('To Array node requires model and systemPrompt configuration. Please configure the node.');
    }

    // Extract user message from input
    let userMessage = '';
    if (typeof input === 'string') {
      userMessage = input;
    } else if (input?.text) {
      userMessage = input.text;
    } else if (input?.message) {
      userMessage = input.message;
    } else {
      userMessage = JSON.stringify(input);
    }

    const schemaInfo = elementType === 'object' && hasObjectSchema
      ? `with ${config.objectSchema.length} field(s)`
      : `of type ${elementType}`;

    this.addLog('info', node.id, `Converting data to array format ${schemaInfo}`, { 
      inputLength: userMessage.length,
      model: config.model,
      elementType,
      hasObjectSchema
    });

    try {
      // Call the test-node API to execute the to-array conversion
      let result: any;
      try {
        result = await http.post<any>('/api/workflow/test-node', {
          node_id: node.id,
          node_type: 'to-array',
          node_label: node.data.label,
          node_config: config,
          input: input,
        }, {
          timeoutMs: 600_000,
          signal: this.abortController?.signal,
        });
      } catch (httpError) {
        if (httpError instanceof ApiError) {
          throw new Error(httpError.message || `Array conversion failed with status ${httpError.status}`);
        }
        throw httpError;
      }
      
      console.log('[WorkflowExecutor] To Array conversion response received', {
        nodeId: node.id,
        success: result.success,
        outputLength: Array.isArray(result.output) ? result.output.length : 0,
        elementType,
        timestamp: new Date().toISOString()
      });

      if (!result.success) {
        throw new Error(result.error || result.message || 'Array conversion failed');
      }

      const arrayOutput = result.output;

      // Store LLM details if available
      if (result.llm_details) {
        this.executionState.nodeStates[node.id] = {
          ...this.executionState.nodeStates[node.id],
          llmSystemPrompt: result.llm_details.systemPrompt,
          llmUserPrompt: result.llm_details.userPrompt,
          llmResponse: result.llm_details.response,
          llmModel: result.llm_details.model,
          llmTemperature: result.llm_details.temperature,
          llmMaxTokens: result.llm_details.maxTokens,
        };
        this.notifyStateChange();
      }

      this.addLog('success', node.id, `Array conversion completed: ${Array.isArray(arrayOutput) ? arrayOutput.length : 0} ${elementType} element(s)`, { 
        arrayLength: Array.isArray(arrayOutput) ? arrayOutput.length : 0,
        elementType,
        hasObjectSchema,
        model: config.model
      });

      return arrayOutput;

    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Array conversion aborted');
      }
      throw new Error(`Array conversion failed: ${error.message}`);
    }
  }

  /**
   * Execute Results Combine node
   * Takes an array input, transforms each item via LLM, and combines results
   */
  private async executeResultsCombineNode(node: WorkflowNode, input: any): Promise<any> {
    const config = node.data.config as any;
    
    console.log('[WorkflowExecutor] Executing Results Combine node', { 
      nodeId: node.id,
      input,
      timestamp: new Date().toISOString()
    });
    
    if (!config?.model || !config?.systemPrompt) {
      throw new Error('Results Combine node requires model and systemPrompt configuration. Please configure the node.');
    }

    // Extract array from input
    let inputArray: any[] = [];
    if (Array.isArray(input)) {
      inputArray = input;
    } else if (input?.array && Array.isArray(input.array)) {
      inputArray = input.array;
    } else if (input?.items && Array.isArray(input.items)) {
      inputArray = input.items;
    } else if (input?.results && Array.isArray(input.results)) {
      inputArray = input.results;
    } else if (typeof input === 'object' && input !== null) {
      // If input is a single object, wrap it in an array
      inputArray = [input];
    } else {
      throw new Error('Results Combine node requires an array input or object that can be converted to array.');
    }

    if (inputArray.length === 0) {
      this.addLog('warning', node.id, 'Input array is empty, returning empty array', {});
      return [];
    }

    this.addLog('info', node.id, `Processing ${inputArray.length} items for combination`, { 
      inputLength: inputArray.length,
      model: config.model,
      hasOutputSchema: !!config.outputSchema
    });

    // Store LLM configuration info (will be enhanced with responses as items are processed)
    this.executionState.nodeStates[node.id] = {
      ...this.executionState.nodeStates[node.id],
      llmSystemPrompt: config.systemPrompt,
      llmModel: config.model,
      llmTemperature: config.temperature,
      llmMaxTokens: config.maxTokens,
      llmUserPrompt: `Processing array of ${inputArray.length} items`, // Summary of input
    };
    this.notifyStateChange();

    try {
      const transformedResults: any[] = [];
      const llmResponses: string[] = []; // Collect LLM responses from each item
      let successCount = 0;
      let errorCount = 0;

      // Process each item
      for (let i = 0; i < inputArray.length; i++) {
        const item = inputArray[i];
        
        console.log(`[WorkflowExecutor] Transforming item ${i + 1}/${inputArray.length}`, {
          nodeId: node.id,
          itemIndex: i
        });

        this.addLog('info', node.id, `Transforming item ${i + 1}/${inputArray.length}`, {
          itemIndex: i,
          itemPreview: this.createSafeLogObject(item)
        });

        try {
          // Call the test-node API to execute the transformation
          let result: any;
          try {
            result = await http.post<any>('/api/workflow/test-node', {
              node_id: `${node.id}-item-${i}`,
              node_type: 'results-combine-item',
              node_label: `${node.data.label} - Item ${i + 1}`,
              node_config: config,
              input: item,
            }, {
              timeoutMs: 600_000,
              signal: this.abortController?.signal,
            });
          } catch (httpError) {
            if (httpError instanceof ApiError) {
              throw new Error(httpError.message || `Transformation failed with status ${httpError.status}`);
            }
            throw httpError;
          }
          
          if (!result.success) {
            throw new Error(result.error || result.message || 'Transformation failed');
          }

          transformedResults.push(result.output);
          successCount++;

          // Collect LLM response if available
          if (result.llm_details?.response) {
            llmResponses.push(`Item ${i + 1}: ${result.llm_details.response.substring(0, 100)}...`);
          }

          this.addLog('success', node.id, `Item ${i + 1} transformed successfully`, {
            itemIndex: i,
            output: this.createSafeLogObject(result.output)
          });

        } catch (itemError: any) {
          errorCount++;
          console.error(`[WorkflowExecutor] Failed to transform item ${i + 1}:`, itemError);
          
          this.addLog('warning', node.id, `Failed to transform item ${i + 1}: ${itemError.message}`, {
            itemIndex: i,
            error: itemError.message
          });
          
          // Continue processing other items instead of failing completely
        }
      }

      console.log('[WorkflowExecutor] Results Combine completed', {
        nodeId: node.id,
        totalItems: inputArray.length,
        successCount,
        errorCount,
        timestamp: new Date().toISOString()
      });

      // Update node state with aggregated LLM responses
      if (llmResponses.length > 0) {
        this.executionState.nodeStates[node.id] = {
          ...this.executionState.nodeStates[node.id],
          llmResponse: `Processed ${successCount} items:\n${llmResponses.slice(0, 5).join('\n')}${llmResponses.length > 5 ? `\n... and ${llmResponses.length - 5} more` : ''}`,
        };
        this.notifyStateChange();
      }

      this.addLog('success', node.id, `Combined ${successCount} items (${errorCount} failed)`, { 
        totalItems: inputArray.length,
        successCount,
        errorCount,
        model: config.model
      });

      return transformedResults;

    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Results combination aborted');
      }
      throw new Error(`Results combination failed: ${error.message}`);
    }
  }

  /**
   * Execute Pexels Video Search node
   */
  /**
   * Execute Tavily Search node
   */
  private async executeTavilySearchNode(node: WorkflowNode, input: any): Promise<any> {
    console.log('[WorkflowExecutor] Executing Tavily Search node', { 
      nodeId: node.id,
      input,
      timestamp: new Date().toISOString()
    });
    
    const config = node.data.config as any;
    
    // Get keywords from config or input
    let keywords = config?.keywords || '';
    
    // If input is provided and has keywords, use it (allows dynamic keywords from previous nodes)
    if (input) {
      if (typeof input === 'string') {
        keywords = input;
      } else if (input?.keywords) {
        keywords = input.keywords;
      } else if (input?.text) {
        keywords = input.text;
      } else if (input?.message) {
        keywords = input.message;
      }
    }
    
    if (!keywords || keywords.trim().length === 0) {
      throw new Error('Tavily Search node requires keywords. Please configure keywords or provide them as input.');
    }
    
    const searchCount = config?.count || 5;
    
    this.addLog('info', node.id, `Searching with Tavily: "${keywords}"`, { 
      keywords,
      searchCount
    });

    try {
      // Call the Tavily search API
      let data: any;
      try {
        data = await http.post<any>('/api/workflow/tavily-search', {
          keywords: keywords.trim(),
          count: searchCount,
        }, { timeoutMs: 600_000 });
      } catch (httpError) {
        if (httpError instanceof ApiError) {
          throw new Error(httpError.message || `Tavily search failed: ${httpError.status}`);
        }
        throw httpError;
      }

      if (!data.success) {
        throw new Error(data.message || 'Tavily search failed');
      }

      const results = data.results || [];
      
      this.addLog('success', node.id, `Found ${results.length} search results`, {
        resultsCount: results.length,
        keywords
      });

      console.log('[WorkflowExecutor] Tavily search completed', {
        nodeId: node.id,
        resultsCount: results.length
      });

      return {
        results: results,
        count: results.length,
        keywords: keywords.trim(),
      };

    } catch (error: any) {
      console.error('[WorkflowExecutor] Tavily search error:', error);
      this.addLog('error', node.id, `Tavily search failed: ${error.message}`, { error: error.message });
      throw new Error(`Tavily search failed: ${error.message}`);
    }
  }

  /**
   * Execute Pexels Video Search node
   * Supports both single string input and string array input
   */
  private async executePexelsVideoSearchNode(node: WorkflowNode, input: any): Promise<any> {
    console.log('[WorkflowExecutor] Executing Pexels Video Search node', { 
      nodeId: node.id,
      input,
      inputType: typeof input,
      isArray: Array.isArray(input),
      timestamp: new Date().toISOString()
    });
    
    const config = node.data.config as any;
    const inputFormat = config?.inputFormat || 'application/json';
    const outputFormat = config?.outputFormat || 'application/json';
    const videoCount = config?.count || 5;
    
    // Parse input to extract keywords array based on input format
    let keywordsArray: string[] = [];
    
    console.log('[WorkflowExecutor] Parsing input with format:', { inputFormat, outputFormat });
    
    // Step 1: Extract keywords from input or config
    if (input) {
      if (inputFormat === 'array') {
        // Expect array input
        if (Array.isArray(input)) {
          keywordsArray = input.map(item => 
            typeof item === 'string' ? item : JSON.stringify(item)
          ).filter(k => k && k.trim().length > 0);
          console.log('[WorkflowExecutor] Parsed array input:', { count: keywordsArray.length });
        } else {
          // Convert single value to array
          const keyword = typeof input === 'string' ? input : 
                         input?.keywords || input?.text || input?.message || JSON.stringify(input);
          if (keyword && keyword.trim().length > 0) {
            keywordsArray = [keyword];
          }
          console.log('[WorkflowExecutor] Converted single input to array');
        }
      } else if (inputFormat === 'text/plain') {
        // Expect plain text input
        const keyword = typeof input === 'string' ? input : 
                       input?.keywords || input?.text || input?.message || JSON.stringify(input);
        if (keyword && keyword.trim().length > 0) {
          keywordsArray = [keyword];
        }
        console.log('[WorkflowExecutor] Parsed text/plain input:', { keyword });
      } else {
        // application/json - auto-detect input type
        if (Array.isArray(input)) {
          keywordsArray = input.map(item => 
            typeof item === 'string' ? item : JSON.stringify(item)
          ).filter(k => k && k.trim().length > 0);
          console.log('[WorkflowExecutor] Auto-detected array input:', { count: keywordsArray.length });
        } else if (typeof input === 'string') {
          keywordsArray = [input];
          console.log('[WorkflowExecutor] Auto-detected string input');
        } else if (input?.keywords) {
          const kw = input.keywords;
          keywordsArray = Array.isArray(kw) ? kw : [kw];
          console.log('[WorkflowExecutor] Extracted from input.keywords');
        } else if (input?.text) {
          keywordsArray = [input.text];
          console.log('[WorkflowExecutor] Extracted from input.text');
        } else if (input?.message) {
          keywordsArray = [input.message];
          console.log('[WorkflowExecutor] Extracted from input.message');
        } else {
          keywordsArray = [JSON.stringify(input)];
          console.log('[WorkflowExecutor] Stringified input object');
        }
      }
    }
    
    // Fallback to config keywords if no input keywords
    if (keywordsArray.length === 0 && config?.keywords) {
      keywordsArray = [config.keywords];
      console.log('[WorkflowExecutor] Using config keywords as fallback');
    }
    
    // Validate we have keywords
    if (keywordsArray.length === 0) {
      throw new Error('Pexels Video Search node requires keywords. Please configure keywords or provide them as input.');
    }
    
    console.log('[WorkflowExecutor] Processing keywords:', { 
      count: keywordsArray.length, 
      keywords: keywordsArray 
    });
    
    // Log the search operation
    if (keywordsArray.length === 1) {
      this.addLog('info', node.id, `Searching Pexels for videos: "${keywordsArray[0]}"`, { 
        keywords: keywordsArray[0],
        videoCount,
        orientation: 'mixed'
      });
    } else {
      this.addLog('info', node.id, `Searching Pexels for videos with ${keywordsArray.length} queries`, { 
        keywordsCount: keywordsArray.length,
        keywords: keywordsArray,
        videoCountPerQuery: videoCount,
        orientation: 'mixed'
      });
    }

    try {
      // Step 2: Execute searches for each keyword
      const allVideoResults: any[] = [];
      let totalFoundCount = 0;
      
      for (let i = 0; i < keywordsArray.length; i++) {
        const keyword = keywordsArray[i].trim();
        if (!keyword) continue;
        
        console.log(`[WorkflowExecutor] Searching for keyword ${i + 1}/${keywordsArray.length}: "${keyword}"`);
        
        this.addLog('info', node.id, `Searching: "${keyword}" (${i + 1}/${keywordsArray.length})`, { 
          keyword,
          progress: `${i + 1}/${keywordsArray.length}`
        });
        
        // Call the Pexels video search API
        let data: any;
        try {
          data = await http.post<any>('/api/video-search', {
            query: keyword,
            max_videos: videoCount,
            orientation: 'mixed',
          }, {
            timeoutMs: 600_000,
            signal: this.abortController?.signal,
          });
        } catch (httpError) {
          const errorMessage = httpError instanceof ApiError
            ? (httpError.message || `HTTP ${httpError.status}`)
            : (httpError instanceof Error ? httpError.message : String(httpError));
          this.addLog('warning', node.id, `Search failed for "${keyword}": ${errorMessage}`, {
            keyword,
            error: errorMessage
          });
          console.warn(`[WorkflowExecutor] Search failed for "${keyword}":`, httpError);
          continue; // Continue with next keyword instead of failing completely
        }
        
        console.log(`[WorkflowExecutor] Search response for "${keyword}":`, {
          success: data.success,
          totalFound: data.total_found,
          videosCount: data.videos?.length || 0
        });

        if (!data.success) {
          this.addLog('warning', node.id, `No results for "${keyword}": ${data.message}`, {
            keyword
          });
          console.warn(`[WorkflowExecutor] No results for "${keyword}":`, data.message);
          continue;
        }

        // Extract video URLs from the response
        const videos = data.videos || [];
        const videoResults = videos.map((video: any) => ({
          id: video.id,
          url: video.url,
          videoUrl: video.video_url,
          thumbnail: video.image,
          width: video.width,
          height: video.height,
          duration: video.duration,
          user: video.user,
          keyword: keyword, // Tag with search keyword
        }));
        
        allVideoResults.push(...videoResults);
        totalFoundCount += data.total_found || 0;
        
        this.addLog('success', node.id, `Found ${videoResults.length} videos for "${keyword}"`, { 
          keyword,
          found: videoResults.length,
          progress: `${i + 1}/${keywordsArray.length}`
        });
      }

      // Log final results
      this.addLog('success', node.id, `Completed: Found ${allVideoResults.length} total videos from ${keywordsArray.length} searches`, { 
        totalVideos: allVideoResults.length,
        totalSearches: keywordsArray.length,
        totalFound: totalFoundCount
      });
      
      console.log('[WorkflowExecutor] All searches completed:', {
        totalVideos: allVideoResults.length,
        searches: keywordsArray.length
      });

      // Step 3: Format output based on output format
      let formattedOutput: any;
      
      if (outputFormat === 'array') {
        // Return simple array of video URLs
        formattedOutput = allVideoResults.map((v: any) => v.videoUrl);
        console.log('[WorkflowExecutor] Output formatted as array:', { count: formattedOutput.length });
      } else if (outputFormat === 'text/plain') {
        // Return newline-separated URLs
        formattedOutput = allVideoResults.map((v: any) => v.videoUrl).join('\n');
        console.log('[WorkflowExecutor] Output formatted as text/plain');
      } else {
        // application/json - return detailed object
        formattedOutput = {
          videos: allVideoResults,
          videoUrls: allVideoResults.map((v: any) => v.videoUrl),
          totalFound: totalFoundCount,
          keywords: keywordsArray,
          keywordCount: keywordsArray.length,
          count: allVideoResults.length,
        };
        console.log('[WorkflowExecutor] Output formatted as JSON object');
      }

      return formattedOutput;
      
    } catch (error: any) {
      console.error('[WorkflowExecutor] Pexels Video Search failed:', error);
      this.addLog('error', node.id, 'Failed to search Pexels videos', { 
        error: error.message,
        keywords: keywordsArray
      });
      throw error;
    }
  }

  /**
   * Execute AI Video Generate node
   */
  private async executeAIVideoGenerateNode(node: WorkflowNode, input: any): Promise<any> {
    console.log('[WorkflowExecutor] Executing AI Video Generate node', { 
      nodeId: node.id,
      input,
      timestamp: new Date().toISOString()
    });

    try {
      const config = node.data.config as any;
      
      // Prepare inputs from node configuration
      const inputs = {
        textInput: config?.textInput || '',
        videoInput: config?.videoInput || '',
        audioInput: config?.audioInput || '',
        imageInput: config?.imageInput || '',
        textInputFormat: config?.textInputFormat || 'text/plain',
        videoInputFormat: config?.videoInputFormat || 'text/plain',
        audioInputFormat: config?.audioInputFormat || 'text/plain',
        imageInputFormat: config?.imageInputFormat || 'text/plain',
      };

      // If there's input from previous node, merge it into textInput
      if (input) {
        if (typeof input === 'string') {
          inputs.textInput = input;
        } else if (typeof input === 'object') {
          inputs.textInput = JSON.stringify(input, null, 2);
          inputs.textInputFormat = 'application/json';
        }
      }

      // Validate that at least one input is provided
      if (!inputs.textInput && !inputs.videoInput && !inputs.audioInput && !inputs.imageInput) {
        throw new Error('At least one input is required for AI Video Generate node');
      }

      this.addLog('info', node.id, 'Calling AI Video Generate API', {
        hasText: !!inputs.textInput,
        hasVideo: !!inputs.videoInput,
        hasAudio: !!inputs.audioInput,
        hasImage: !!inputs.imageInput,
      });

      // Call AI Video Generate API
      let result: any;
      try {
        result = await http.post<any>('/api/workflow/ai-video-generate', {
          nodeId: node.id,
          taskId: 'workflow-execution',
          inputs,
          config: {
            systemPrompt: config?.systemPrompt,
            temperature: config?.temperature,
            maxTokens: config?.maxTokens,
          },
        }, { timeoutMs: 600_000 });
      } catch (httpError) {
        if (httpError instanceof ApiError) {
          throw new Error(httpError.message || `API call failed: ${httpError.status}`);
        }
        throw httpError;
      }

      if (!result.success) {
        throw new Error(result.message || 'AI Video Generate failed');
      }

      console.log('[WorkflowExecutor] AI Video Generate completed successfully', {
        nodeId: node.id,
        hasTimelineData: !!result.timelineData,
      });

      this.addLog('success', node.id, 'AI Video Generate completed successfully', {
        tracksCount: result.timelineData?.tracks?.length || 0,
      });

      // Return the timeline data
      return {
        success: true,
        timelineData: result.timelineData,
        message: 'Video timeline generated successfully',
      };

    } catch (error: any) {
      console.error('[WorkflowExecutor] AI Video Generate failed:', error);
      this.addLog('error', node.id, 'Failed to generate video timeline', { 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Execute Video Export node
   */
  private async executeVideoExportNode(node: WorkflowNode, input: any): Promise<any> {
    console.log('[WorkflowExecutor] Executing Video Export node', { 
      nodeId: node.id,
      input,
      timestamp: new Date().toISOString()
    });

    try {
      const config = node.data.config as any;
      
      // Get video URLs from either input or config
      let videoUrls: string | string[] = input || config?.videoUrls || '';

      // If input is provided, prioritize it
      if (input) {
        if (typeof input === 'string') {
          videoUrls = input;
        } else if (Array.isArray(input)) {
          videoUrls = input;
        } else if (typeof input === 'object' && input.videoUrls) {
          videoUrls = input.videoUrls;
        } else {
          // Try to extract URLs from object
          videoUrls = JSON.stringify(input);
        }
      }

      // Validate that we have video URLs
      if (!videoUrls || (Array.isArray(videoUrls) && videoUrls.length === 0) || 
          (typeof videoUrls === 'string' && !videoUrls.trim())) {
        throw new Error('Video URLs are required for Video Export node');
      }

      // Convert to array for logging
      const urlsArray = Array.isArray(videoUrls) ? videoUrls : [videoUrls];
      
      this.addLog('info', node.id, `Exporting ${urlsArray.length} video(s) to materials`, {
        videoCount: urlsArray.length,
        videoUrls: urlsArray,
      });

      // Call Video Export API
      let result: any;
      try {
        result = await http.post<any>('/api/workflow/video-export', {
          nodeId: node.id,
          taskId: 'workflow-execution',
          inputs: {
            videoUrls,
            inputFormat: config?.inputFormat || 'array',
          },
          config: {
            videoUrls,
            inputFormat: config?.inputFormat || 'array',
          },
        }, { timeoutMs: 600_000 });
      } catch (httpError) {
        if (httpError instanceof ApiError) {
          throw new Error(httpError.message || `API call failed: ${httpError.status}`);
        }
        throw httpError;
      }

      if (!result.success) {
        throw new Error(result.message || 'Video Export failed');
      }

      console.log('[WorkflowExecutor] Video Export completed successfully', {
        nodeId: node.id,
        materialsCount: result.materials?.length || 0,
      });

      this.addLog('success', node.id, `Successfully exported ${result.materials?.length || 0} video(s) to materials`, {
        materialsCount: result.materials?.length || 0,
        materials: result.materials,
      });

      // Return the materials data
      return {
        success: true,
        materials: result.materials,
        message: `Exported ${result.materials?.length || 0} video(s) to materials`,
      };

    } catch (error: any) {
      console.error('[WorkflowExecutor] Video Export failed:', error);
      this.addLog('error', node.id, 'Failed to export videos to materials', { 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Execute End node
   */
  private async executeEndNode(node: WorkflowNode, input: any): Promise<any> {
    console.log('[WorkflowExecutor] Executing End node', { input });
    await this.simulateDelay(300);
    
    // End node just receives the final output
    return {
      finalResult: input,
      message: 'Workflow completed',
    };
  }

  /**
   * Add a log entry
   */
  private addLog(
    level: 'info' | 'success' | 'warning' | 'error',
    nodeId: string | undefined,
    message: string,
    details?: any
  ): void {
    const node = nodeId ? this.nodes.find(n => n.id === nodeId) : undefined;
    
    const log: WorkflowExecutionLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      level,
      nodeId,
      nodeName: node?.data.label,
      message,
      details,
    };

    this.executionState.logs.push(log);
    
    console.log(`[WorkflowExecutor] Log [${level}]:`, message, details || '');
  }

  /**
   * Notify state change to callback
   */
  private notifyStateChange(): void {
    this.onStateChange({ ...this.executionState });
  }

  /**
   * Simulate delay for demo purposes
   */
  private simulateDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

