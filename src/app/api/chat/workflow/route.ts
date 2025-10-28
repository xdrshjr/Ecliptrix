import { NextRequest, NextResponse } from 'next/server';
import { ServerWorkflowExecutor } from '@/lib/workflow/ServerWorkflowExecutor';

/**
 * POST /api/chat/workflow
 * 
 * Execute a workflow with user input and stream the results back
 * This endpoint combines workflow execution with chat-like streaming response
 */
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  
  try {
    const body = await request.json();
    const { workflowId, userInput, messages, nodes, connections } = body;

    console.log('[Workflow Chat API] Request received:', {
      workflowId,
      userInputLength: userInput?.length || 0,
      messagesCount: messages?.length || 0,
      nodesCount: nodes?.length || 0,
      connectionsCount: connections?.length || 0,
      timestamp: new Date().toISOString()
    });

    if (!workflowId) {
      console.error('[Workflow Chat API] Missing workflowId in request');
      return NextResponse.json(
        { error: 'Workflow ID is required' },
        { status: 400 }
      );
    }

    if (!userInput) {
      console.error('[Workflow Chat API] Missing userInput in request');
      return NextResponse.json(
        { error: 'User input is required' },
        { status: 400 }
      );
    }

    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
      console.error('[Workflow Chat API] Missing or invalid nodes in request');
      return NextResponse.json(
        { error: 'Workflow nodes are required' },
        { status: 400 }
      );
    }

    if (!connections || !Array.isArray(connections)) {
      console.error('[Workflow Chat API] Missing or invalid connections in request');
      return NextResponse.json(
        { error: 'Workflow connections are required' },
        { status: 400 }
      );
    }
    
    // Create a streaming response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial status
          const statusData = JSON.stringify({
            type: 'status',
            status: 'loading',
            message: 'Initializing workflow execution...'
          });
          controller.enqueue(encoder.encode(`data: ${statusData}\n\n`));

          console.log('[Workflow Chat API] Starting workflow execution:', {
            workflowId,
            nodesCount: nodes.length,
            connectionsCount: connections.length,
            timestamp: new Date().toISOString()
          });
          
          // Send execution start status
          const startData = JSON.stringify({
            type: 'execution_start',
            workflowId,
            timestamp: new Date().toISOString()
          });
          controller.enqueue(encoder.encode(`data: ${startData}\n\n`));

          // Create workflow executor with callbacks for streaming updates
          const executor = new ServerWorkflowExecutor(
            nodes,
            connections,
            {
              onNodeUpdate: (nodeId, nodeName, status, output, error) => {
                console.log('[Workflow Chat API] Node update:', {
                  nodeId,
                  nodeName,
                  status,
                  hasOutput: !!output,
                  hasError: !!error
                });
                
                const nodeData = JSON.stringify({
                  type: 'node_update',
                  nodeId,
                  nodeName,
                  status,
                  output: status === 'completed' ? output : undefined,
                  error: error,
                  startTime: status === 'executing' ? new Date().toISOString() : undefined,
                  endTime: status === 'completed' || status === 'error' ? new Date().toISOString() : undefined
                });
                controller.enqueue(encoder.encode(`data: ${nodeData}\n\n`));
              },
              onLog: (level, message, nodeId, nodeName, details) => {
                console.log(`[Workflow Chat API] Log [${level}]:`, message, {
                  nodeId,
                  nodeName,
                  details
                });
                
                const logData = JSON.stringify({
                  type: 'log',
                  level,
                  message,
                  nodeId,
                  nodeName,
                  details,
                  timestamp: new Date().toISOString()
                });
                controller.enqueue(encoder.encode(`data: ${logData}\n\n`));
              },
              onComplete: (finalOutput) => {
                console.log('[Workflow Chat API] Workflow execution completed:', {
                  hasFinalOutput: !!finalOutput,
                  timestamp: new Date().toISOString()
                });
                
                // Format final output for display
                let content = '';
                if (finalOutput?.finalResult) {
                  const result = finalOutput.finalResult;
                  if (typeof result === 'string') {
                    content = result;
                  } else if (result?.text) {
                    content = result.text;
                  } else if (result?.llmResponse) {
                    content = result.llmResponse;
                  } else {
                    content = JSON.stringify(result, null, 2);
                  }
                } else if (typeof finalOutput === 'string') {
                  content = finalOutput;
                } else {
                  content = JSON.stringify(finalOutput, null, 2);
                }
                
                const resultData = JSON.stringify({
                  type: 'final_result',
                  content,
                  timestamp: new Date().toISOString()
                });
                controller.enqueue(encoder.encode(`data: ${resultData}\n\n`));
                
                // Send completion signal
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
              },
              onError: (error) => {
                console.error('[Workflow Chat API] Workflow execution error:', error);
                
                const errorData = JSON.stringify({
                  type: 'error',
                  error: error.message
                });
                controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
                
                // Send completion signal
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
              }
            },
            userInput
          );

          // Execute the workflow
          await executor.execute();

        } catch (error) {
          console.error('[Workflow Chat API] Stream error:', error);
          const errorData = JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      }
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('[Workflow Chat API] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS handler for CORS preflight requests
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}


