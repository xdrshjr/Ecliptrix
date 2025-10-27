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
      this.addLog('error', undefined, `Workflow execution failed: ${error.message}`, { error });
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

    try {
      // Call the LLM API
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
        }),
        signal: this.abortController?.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API request failed with status ${response.status}`);
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
      const response = await fetch('/api/tts/convert-sentences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `TTS request failed with status ${response.status}`);
      }

      const result = await response.json();
      
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
      const response = await fetch('/api/workflow/test-node', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          node_id: node.id,
          node_type: 'to-array',
          node_label: node.data.label,
          node_config: config,
          input: input,
        }),
        signal: this.abortController?.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || errorData.message || `Array conversion failed with status ${response.status}`);
      }

      const result = await response.json();
      
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
      const response = await fetch('/api/workflow/tavily-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          keywords: keywords.trim(),
          count: searchCount,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `Tavily search failed: ${response.statusText}`);
      }

      const data = await response.json();

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
   */
  private async executePexelsVideoSearchNode(node: WorkflowNode, input: any): Promise<any> {
    console.log('[WorkflowExecutor] Executing Pexels Video Search node', { 
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
      throw new Error('Pexels Video Search node requires keywords. Please configure keywords or provide them as input.');
    }
    
    const videoCount = config?.count || 5;
    
    this.addLog('info', node.id, `Searching Pexels for videos: "${keywords}"`, { 
      keywords,
      videoCount,
      orientation: 'mixed'
    });

    try {
      // Call the Pexels video search API
      const response = await fetch('/api/video-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: keywords.trim(),
          max_videos: videoCount,
          orientation: 'mixed',
        }),
        signal: this.abortController?.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || `API request failed with status ${response.status}`);
      }

      const data = await response.json();
      
      console.log('[WorkflowExecutor] Pexels search response:', {
        success: data.success,
        totalFound: data.total_found,
        videosCount: data.videos?.length || 0
      });

      if (!data.success) {
        throw new Error(data.message || 'Video search failed');
      }

      // Extract video URLs from the response
      const videos = data.videos || [];
      const videoUrls = videos.map((video: any) => ({
        id: video.id,
        url: video.url,
        videoUrl: video.video_url,
        thumbnail: video.image,
        width: video.width,
        height: video.height,
        duration: video.duration,
        user: video.user,
      }));

      this.addLog('success', node.id, `Found ${videoUrls.length} videos from Pexels`, { 
        totalFound: data.total_found,
        returned: videoUrls.length,
        keywords
      });

      return {
        videos: videoUrls,
        videoUrls: videoUrls.map((v: any) => v.videoUrl),
        totalFound: data.total_found,
        keywords,
        count: videoUrls.length,
      };
      
    } catch (error: any) {
      console.error('[WorkflowExecutor] Pexels Video Search failed:', error);
      this.addLog('error', node.id, 'Failed to search Pexels videos', { 
        error: error.message,
        keywords
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

