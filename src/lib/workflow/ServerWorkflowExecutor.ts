/**
 * Server-side Workflow Executor
 * 
 * Handles the execution of workflow graphs from Start to End nodes on the server.
 * Similar to the client-side WorkflowExecutor but adapted for server environment.
 * Executes nodes sequentially following connection paths and passes outputs from one node to the next.
 */

import {
  WorkflowNode,
  WorkflowConnection,
  WorkflowNodeExecutionState,
} from '@/types';

export interface ServerExecutionCallback {
  onNodeUpdate: (nodeId: string, nodeName: string, status: 'executing' | 'completed' | 'error', output?: any, error?: string) => void;
  onLog: (level: 'info' | 'success' | 'warning' | 'error', message: string, nodeId?: string, nodeName?: string, details?: any) => void;
  onComplete: (finalOutput: any) => void;
  onError: (error: Error) => void;
}

export class ServerWorkflowExecutor {
  private nodes: WorkflowNode[];
  private connections: WorkflowConnection[];
  private callback: ServerExecutionCallback;
  private userInput: string | null = null;
  private aborted: boolean = false;

  constructor(
    nodes: WorkflowNode[],
    connections: WorkflowConnection[],
    callback: ServerExecutionCallback,
    userInput?: string | null
  ) {
    this.nodes = nodes;
    this.connections = connections;
    this.callback = callback;
    this.userInput = userInput || null;
    
    console.log('[ServerWorkflowExecutor] Initialized with:', {
      nodesCount: nodes.length,
      connectionsCount: connections.length,
      hasUserInput: !!this.userInput,
      userInputLength: this.userInput?.length || 0,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Start workflow execution from the Start node
   */
  async execute(): Promise<void> {
    console.log('[ServerWorkflowExecutor] Starting workflow execution');
    
    this.callback.onLog('info', 'Workflow execution started');

    try {
      // Find the Start node
      const startNode = this.nodes.find(node => node.type === 'start');
      if (!startNode) {
        throw new Error('No Start node found in workflow');
      }

      this.callback.onLog('info', `Found Start node: ${startNode.data.label}`, startNode.id, startNode.data.label);

      // Build execution path from Start to End
      const executionPath = this.buildExecutionPath(startNode);
      
      if (executionPath.length === 0) {
        throw new Error('No execution path found. Please connect Start node to End node.');
      }

      this.callback.onLog('info', `Execution path built with ${executionPath.length} nodes`);

      // Execute nodes in order
      let previousOutput: any = null;
      
      for (const node of executionPath) {
        // Check if execution was aborted
        if (this.aborted) {
          this.callback.onLog('warning', 'Workflow execution aborted by user');
          break;
        }

        // Execute the node
        previousOutput = await this.executeNode(node, previousOutput);
      }

      // Execution completed
      const duration = Date.now();
      
      console.log('[ServerWorkflowExecutor] Workflow execution completed:', {
        finalOutput: previousOutput,
        timestamp: new Date().toISOString()
      });
      
      // Add completion log with final output
      this.callback.onLog('success', `Workflow execution completed successfully`, undefined, undefined, {
        output: previousOutput
      });
      
      // Notify completion
      this.callback.onComplete(previousOutput);
      
    } catch (error: any) {
      console.error('[ServerWorkflowExecutor] Execution error:', error);
      this.callback.onLog('error', `Workflow execution failed: ${error.message}`);
      this.callback.onError(error);
    }
  }

  /**
   * Abort the current workflow execution
   */
  abort(): void {
    console.log('[ServerWorkflowExecutor] Aborting workflow execution');
    this.aborted = true;
    this.callback.onLog('warning', 'Workflow execution aborted');
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
   * Execute a single node
   */
  private async executeNode(node: WorkflowNode, input: any): Promise<any> {
    console.log(`[ServerWorkflowExecutor] Executing Node:`, {
      nodeId: node.id,
      nodeType: node.type,
      nodeLabel: node.data.label,
      hasInput: !!input,
      timestamp: new Date().toISOString()
    });

    // Notify node execution start
    this.callback.onNodeUpdate(node.id, node.data.label, 'executing');
    this.callback.onLog('info', `Executing node: ${node.data.label}`, node.id, node.data.label);

    try {
      let output: any = null;

      // Execute based on node type
      switch (node.type) {
        case 'start':
          output = await this.executeStartNode(node);
          break;
        
        case 'text-input':
          output = await this.executeTextInputNode(node, input);
          break;
        
        case 'chat-llm':
          output = await this.executeChatLLMNode(node, input);
          break;
        
        case 'pexels-video-search':
          output = await this.executePexelsVideoSearchNode(node, input);
          break;
        
        case 'tavily-search':
          output = await this.executeTavilySearchNode(node, input);
          break;
        
        case 'volcano-tts':
          output = await this.executeVolcanoTTSNode(node, input);
          break;
        
        case 'to-array':
          output = await this.executeToArrayNode(node, input);
          break;
        
        case 'end':
          output = await this.executeEndNode(node, input);
          break;
        
        default:
          throw new Error(`Unknown node type: ${node.type}`);
      }

      console.log(`[ServerWorkflowExecutor] Node Completed:`, {
        nodeId: node.id,
        nodeLabel: node.data.label,
        hasOutput: !!output,
        timestamp: new Date().toISOString()
      });
      
      // Notify node execution completion
      this.callback.onNodeUpdate(node.id, node.data.label, 'completed', output);
      this.callback.onLog('success', `Node completed: ${node.data.label}`, node.id, node.data.label, { 
        output: this.createSafeLogObject(output)
      });

      return output;
      
    } catch (error: any) {
      console.error(`[ServerWorkflowExecutor] Node Failed:`, {
        nodeId: node.id,
        nodeLabel: node.data.label,
        errorMessage: error.message,
        timestamp: new Date().toISOString()
      });
      
      // Notify node execution error
      this.callback.onNodeUpdate(node.id, node.data.label, 'error', undefined, error.message);
      this.callback.onLog('error', `Node failed: ${node.data.label}`, node.id, node.data.label, { 
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Execute Start node
   */
  private async executeStartNode(node: WorkflowNode): Promise<any> {
    console.log('[ServerWorkflowExecutor] Executing Start node');
    
    await this.simulateDelay(500);
    
    // Priority: user input from chat > configured input > empty
    let inputContent = '';
    
    if (this.userInput) {
      inputContent = this.userInput;
      console.log('[ServerWorkflowExecutor] Using user input from chat interface');
    } else {
      const config = node.data.config as any;
      inputContent = config?.input || '';
      console.log('[ServerWorkflowExecutor] Using configured input');
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
    console.log('[ServerWorkflowExecutor] Executing Text Input node');
    
    const config = node.data.config as any;
    
    if (!config?.content) {
      throw new Error('Text Input node is not configured. Please add content.');
    }

    await this.simulateDelay(300);
    
    return {
      text: config.content,
      previousInput: input,
    };
  }

  /**
   * Execute Chat LLM node
   */
  private async executeChatLLMNode(node: WorkflowNode, input: any): Promise<any> {
    console.log('[ServerWorkflowExecutor] Executing Chat LLM node');
    
    const config = node.data.config as any;
    
    if (!config?.model || !config?.systemPrompt) {
      throw new Error('Chat LLM node is not fully configured. Please set model and system prompt.');
    }

    // Extract user message from input
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
      userMessage = JSON.stringify(input);
    }
    
    if (!userMessage || userMessage.trim().length === 0) {
      throw new Error('Chat LLM node requires a valid input message.');
    }

    this.callback.onLog('info', 'Calling LLM API...', node.id, node.data.label);

    try {
      // Call the LLM API
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/chat`, {
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
              if (parsed.content) {
                accumulatedContent += parsed.content;
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      console.log('[ServerWorkflowExecutor] LLM response received');

      this.callback.onLog('success', 'LLM response received', node.id, node.data.label);

      return {
        text: accumulatedContent,
        llmResponse: accumulatedContent,
        previousInput: input,
      };

    } catch (error: any) {
      throw new Error(`LLM request failed: ${error.message}`);
    }
  }

  /**
   * Execute Volcano TTS node
   */
  private async executeVolcanoTTSNode(node: WorkflowNode, input: any): Promise<any> {
    console.log('[ServerWorkflowExecutor] Executing Volcano TTS node');
    
    const config = node.data.config as any;
    
    // Get text from config or input
    let text = config?.text || '';
    
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
      throw new Error('Volcano TTS node requires text content.');
    }
    
    const voiceType = config?.voiceType || 'zh_male_shaonianzixin_moon_bigtts';
    const speedRatio = config?.speedRatio || 1.0;
    
    this.callback.onLog('info', `Converting text to speech (${text.length} chars)`, node.id, node.data.label);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/tts/convert-sentences`, {
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

      if (!result.success) {
        throw new Error(result.message || 'TTS conversion failed');
      }

      this.callback.onLog('success', 'Speech synthesis completed', node.id, node.data.label);

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
      throw new Error(`TTS request failed: ${error.message}`);
    }
  }

  /**
   * Execute To Array node
   */
  private async executeToArrayNode(node: WorkflowNode, input: any): Promise<any> {
    const config = node.data.config as any;
    const elementType = config?.elementType || 'string';
    
    console.log('[ServerWorkflowExecutor] Executing To Array node');
    
    if (!config?.model || !config?.systemPrompt) {
      throw new Error('To Array node requires model and systemPrompt configuration.');
    }

    this.callback.onLog('info', `Converting data to array format`, node.id, node.data.label);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/workflow/test-node`, {
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
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || errorData.message || `Array conversion failed`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || result.message || 'Array conversion failed');
      }

      const arrayOutput = result.output;

      this.callback.onLog('success', `Array conversion completed`, node.id, node.data.label);

      return arrayOutput;

    } catch (error: any) {
      throw new Error(`Array conversion failed: ${error.message}`);
    }
  }

  /**
   * Execute Tavily Search node
   */
  private async executeTavilySearchNode(node: WorkflowNode, input: any): Promise<any> {
    console.log('[ServerWorkflowExecutor] Executing Tavily Search node');
    
    const config = node.data.config as any;
    
    let keywords = config?.keywords || '';
    
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
      throw new Error('Tavily Search node requires keywords.');
    }
    
    const searchCount = config?.count || 5;
    
    this.callback.onLog('info', `Searching with Tavily: "${keywords}"`, node.id, node.data.label);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/workflow/tavily-search`, {
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
        throw new Error(errorData.message || `Tavily search failed`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Tavily search failed');
      }

      const results = data.results || [];
      
      this.callback.onLog('success', `Found ${results.length} search results`, node.id, node.data.label);

      return {
        results: results,
        count: results.length,
        keywords: keywords.trim(),
      };

    } catch (error: any) {
      throw new Error(`Tavily search failed: ${error.message}`);
    }
  }

  /**
   * Execute Pexels Video Search node
   * Supports both single string input and string array input
   */
  private async executePexelsVideoSearchNode(node: WorkflowNode, input: any): Promise<any> {
    console.log('[ServerWorkflowExecutor] Executing Pexels Video Search node', {
      nodeId: node.id,
      input,
      inputType: typeof input,
      isArray: Array.isArray(input),
    });
    
    const config = node.data.config as any;
    const inputFormat = config?.inputFormat || 'application/json';
    const outputFormat = config?.outputFormat || 'application/json';
    const videoCount = config?.count || 5;
    
    // Parse input to extract keywords array based on input format
    let keywordsArray: string[] = [];
    
    console.log('[ServerWorkflowExecutor] Parsing input with format:', { inputFormat, outputFormat });
    
    // Step 1: Extract keywords from input or config
    if (input) {
      if (inputFormat === 'array') {
        // Expect array input
        if (Array.isArray(input)) {
          keywordsArray = input.map(item => 
            typeof item === 'string' ? item : JSON.stringify(item)
          ).filter(k => k && k.trim().length > 0);
          console.log('[ServerWorkflowExecutor] Parsed array input:', { count: keywordsArray.length });
        } else {
          // Convert single value to array
          const keyword = typeof input === 'string' ? input : 
                         input?.keywords || input?.text || input?.message || JSON.stringify(input);
          if (keyword && keyword.trim().length > 0) {
            keywordsArray = [keyword];
          }
          console.log('[ServerWorkflowExecutor] Converted single input to array');
        }
      } else if (inputFormat === 'text/plain') {
        // Expect plain text input
        const keyword = typeof input === 'string' ? input : 
                       input?.keywords || input?.text || input?.message || JSON.stringify(input);
        if (keyword && keyword.trim().length > 0) {
          keywordsArray = [keyword];
        }
        console.log('[ServerWorkflowExecutor] Parsed text/plain input:', { keyword });
      } else {
        // application/json - auto-detect input type
        if (Array.isArray(input)) {
          keywordsArray = input.map(item => 
            typeof item === 'string' ? item : JSON.stringify(item)
          ).filter(k => k && k.trim().length > 0);
          console.log('[ServerWorkflowExecutor] Auto-detected array input:', { count: keywordsArray.length });
        } else if (typeof input === 'string') {
          keywordsArray = [input];
          console.log('[ServerWorkflowExecutor] Auto-detected string input');
        } else if (input?.keywords) {
          const kw = input.keywords;
          keywordsArray = Array.isArray(kw) ? kw : [kw];
          console.log('[ServerWorkflowExecutor] Extracted from input.keywords');
        } else if (input?.text) {
          keywordsArray = [input.text];
          console.log('[ServerWorkflowExecutor] Extracted from input.text');
        } else if (input?.message) {
          keywordsArray = [input.message];
          console.log('[ServerWorkflowExecutor] Extracted from input.message');
        } else {
          keywordsArray = [JSON.stringify(input)];
          console.log('[ServerWorkflowExecutor] Stringified input object');
        }
      }
    }
    
    // Fallback to config keywords if no input keywords
    if (keywordsArray.length === 0 && config?.keywords) {
      keywordsArray = [config.keywords];
      console.log('[ServerWorkflowExecutor] Using config keywords as fallback');
    }
    
    // Validate we have keywords
    if (keywordsArray.length === 0) {
      throw new Error('Pexels Video Search node requires keywords. Please configure keywords or provide them as input.');
    }
    
    console.log('[ServerWorkflowExecutor] Processing keywords:', { 
      count: keywordsArray.length, 
      keywords: keywordsArray 
    });
    
    // Log the search operation
    if (keywordsArray.length === 1) {
      this.callback.onLog('info', `Searching Pexels for videos: "${keywordsArray[0]}"`, node.id, node.data.label);
    } else {
      this.callback.onLog('info', `Searching Pexels for videos with ${keywordsArray.length} queries`, node.id, node.data.label);
    }

    try {
      // Step 2: Execute searches for each keyword
      const allVideoResults: any[] = [];
      let totalFoundCount = 0;
      
      for (let i = 0; i < keywordsArray.length; i++) {
        const keyword = keywordsArray[i].trim();
        if (!keyword) continue;
        
        console.log(`[ServerWorkflowExecutor] Searching for keyword ${i + 1}/${keywordsArray.length}: "${keyword}"`);
        
        this.callback.onLog('info', `Searching: "${keyword}" (${i + 1}/${keywordsArray.length})`, node.id, node.data.label);
        
        // Call the Pexels video search API
        const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/video-search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: keyword,
            max_videos: videoCount,
            orientation: 'mixed',
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          this.callback.onLog('warning', `Search failed for "${keyword}": ${errorData.error || errorData.message}`, node.id, node.data.label);
          console.warn(`[ServerWorkflowExecutor] Search failed for "${keyword}":`, errorData);
          continue; // Continue with next keyword instead of failing completely
        }

        const data = await response.json();
        
        console.log(`[ServerWorkflowExecutor] Search response for "${keyword}":`, {
          success: data.success,
          totalFound: data.total_found,
          videosCount: data.videos?.length || 0
        });

        if (!data.success) {
          this.callback.onLog('warning', `No results for "${keyword}": ${data.message}`, node.id, node.data.label);
          console.warn(`[ServerWorkflowExecutor] No results for "${keyword}":`, data.message);
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
        
        this.callback.onLog('success', `Found ${videoResults.length} videos for "${keyword}"`, node.id, node.data.label);
      }

      // Log final results
      this.callback.onLog('success', `Completed: Found ${allVideoResults.length} total videos from ${keywordsArray.length} searches`, node.id, node.data.label);
      
      console.log('[ServerWorkflowExecutor] All searches completed:', {
        totalVideos: allVideoResults.length,
        searches: keywordsArray.length
      });

      // Step 3: Format output based on output format
      let formattedOutput: any;
      
      if (outputFormat === 'array') {
        // Return simple array of video URLs
        formattedOutput = allVideoResults.map((v: any) => v.videoUrl);
        console.log('[ServerWorkflowExecutor] Output formatted as array:', { count: formattedOutput.length });
      } else if (outputFormat === 'text/plain') {
        // Return newline-separated URLs
        formattedOutput = allVideoResults.map((v: any) => v.videoUrl).join('\n');
        console.log('[ServerWorkflowExecutor] Output formatted as text/plain');
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
        console.log('[ServerWorkflowExecutor] Output formatted as JSON object');
      }

      return formattedOutput;
      
    } catch (error: any) {
      console.error('[ServerWorkflowExecutor] Pexels Video Search failed:', error);
      throw new Error(`Pexels Video Search failed: ${error.message}`);
    }
  }

  /**
   * Execute End node
   */
  private async executeEndNode(node: WorkflowNode, input: any): Promise<any> {
    console.log('[ServerWorkflowExecutor] Executing End node');
    await this.simulateDelay(300);
    
    return {
      finalResult: input,
      message: 'Workflow completed',
    };
  }

  /**
   * Create a safe version of an object for logging
   */
  private createSafeLogObject(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    if (typeof obj !== 'object') {
      return obj;
    }
    
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (error) {
      return { error: 'Could not serialize object safely' };
    }
  }

  /**
   * Simulate delay
   */
  private simulateDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

