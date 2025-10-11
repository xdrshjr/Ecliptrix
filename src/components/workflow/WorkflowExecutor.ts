/**
 * Workflow Executor Service
 * 
 * Handles the execution of workflow graphs from Start to End nodes.
 * Executes nodes sequentially following connection paths and passes
 * outputs from one node to the next.
 */

import {
  WorkflowNode,
  WorkflowConnection,
  WorkflowExecutionState,
  WorkflowNodeExecutionState,
  WorkflowExecutionLog,
  ChatLLMNodeConfig,
  TextInputNodeConfig,
} from '@/types';

export type ExecutionCallback = (state: WorkflowExecutionState) => void;

export class WorkflowExecutor {
  private nodes: WorkflowNode[];
  private connections: WorkflowConnection[];
  private executionState: WorkflowExecutionState;
  private onStateChange: ExecutionCallback;
  private abortController: AbortController | null = null;

  constructor(
    nodes: WorkflowNode[],
    connections: WorkflowConnection[],
    onStateChange: ExecutionCallback
  ) {
    this.nodes = nodes;
    this.connections = connections;
    this.onStateChange = onStateChange;
    
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
      this.addLog('success', undefined, `Workflow execution completed successfully in ${(duration / 1000).toFixed(2)}s`);
      
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
   * Execute a single node
   */
  private async executeNode(node: WorkflowNode, input: any): Promise<any> {
    console.log(`[WorkflowExecutor] Executing node: ${node.id} (${node.type})`, {
      nodeLabel: node.data.label,
      hasInput: !!input,
      timestamp: new Date().toISOString()
    });

    // Update node state to executing
    this.executionState.currentNodeId = node.id;
    this.executionState.nodeStates[node.id] = {
      nodeId: node.id,
      status: 'executing',
      input,
      startTime: new Date(),
    };
    
    this.addLog('info', node.id, `Executing node: ${node.data.label}`, { input });
    this.notifyStateChange();

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
        
        case 'end':
          output = await this.executeEndNode(node, input);
          break;
        
        default:
          throw new Error(`Unknown node type: ${node.type}`);
      }

      // Update node state to completed
      this.executionState.nodeStates[node.id] = {
        ...this.executionState.nodeStates[node.id],
        status: 'completed',
        output,
        endTime: new Date(),
      };
      
      this.addLog('success', node.id, `Node completed: ${node.data.label}`, { output });
      this.notifyStateChange();

      return output;
      
    } catch (error: any) {
      console.error(`[WorkflowExecutor] Node execution error:`, error);
      
      // Update node state to error
      this.executionState.nodeStates[node.id] = {
        ...this.executionState.nodeStates[node.id],
        status: 'error',
        error: error.message,
        endTime: new Date(),
      };
      
      this.addLog('error', node.id, `Node failed: ${node.data.label}`, { error: error.message });
      this.notifyStateChange();
      
      throw error;
    }
  }

  /**
   * Execute Start node
   */
  private async executeStartNode(node: WorkflowNode): Promise<any> {
    console.log('[WorkflowExecutor] Executing Start node');
    // Start node just passes through empty initial data
    await this.simulateDelay(500);
    return { message: 'Workflow started' };
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
   * Execute Chat LLM node
   */
  private async executeChatLLMNode(node: WorkflowNode, input: any): Promise<any> {
    console.log('[WorkflowExecutor] Executing Chat LLM node', { input });
    
    const config = node.data.config as ChatLLMNodeConfig;
    
    if (!config?.model || !config?.systemPrompt) {
      throw new Error('Chat LLM node is not fully configured. Please set model and system prompt.');
    }

    this.addLog('info', node.id, 'Calling LLM API...', { 
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens
    });

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

      this.addLog('success', node.id, 'LLM response received', { 
        responseLength: accumulatedContent.length 
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

