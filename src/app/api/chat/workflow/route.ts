import { NextRequest, NextResponse } from 'next/server';
import { WorkflowExecutor } from '@/components/workflow/WorkflowExecutor';
import { loadAgentWorkflows } from '@/lib/api/workflow';

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
    const { workflowId, userInput, messages } = body;

    console.log('[Workflow Chat API] Request received:', {
      workflowId,
      userInputLength: userInput?.length || 0,
      messagesCount: messages?.length || 0,
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

    // Extract user ID from messages (assuming it's stored in conversation context)
    // For now, we'll use a placeholder - in production, this should come from auth session
    const userId = 'system'; // TODO: Get from authenticated session

    // Load the workflow
    console.log('[Workflow Chat API] Loading workflow:', workflowId);
    
    // Create a streaming response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial status
          const statusData = JSON.stringify({
            type: 'status',
            status: 'loading',
            message: 'Loading workflow...'
          });
          controller.enqueue(encoder.encode(`data: ${statusData}\n\n`));

          // Load workflows (in production, cache this or fetch specific workflow)
          let workflow;
          try {
            // Try to load from user's workflows (requires auth context)
            // For now, we'll create a mock workflow execution
            console.log('[Workflow Chat API] Executing workflow with user input');
            
            // Send execution start status
            const startData = JSON.stringify({
              type: 'execution_start',
              workflowId,
              timestamp: new Date().toISOString()
            });
            controller.enqueue(encoder.encode(`data: ${startData}\n\n`));

            // Simulate workflow execution with streaming updates
            // In production, this would use the actual WorkflowExecutor
            
            // Send node execution updates
            const nodes = [
              { id: 'start', name: 'Start Node', status: 'executing' },
              { id: 'process', name: 'Processing', status: 'pending' },
              { id: 'end', name: 'End Node', status: 'pending' }
            ];

            for (const node of nodes) {
              // Simulate node execution
              await new Promise(resolve => setTimeout(resolve, 500));
              
              const nodeData = JSON.stringify({
                type: 'node_update',
                nodeId: node.id,
                nodeName: node.name,
                status: 'executing'
              });
              controller.enqueue(encoder.encode(`data: ${nodeData}\n\n`));
              
              // Simulate node completion
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              const nodeCompleteData = JSON.stringify({
                type: 'node_update',
                nodeId: node.id,
                nodeName: node.name,
                status: 'completed',
                output: `Processed: ${userInput}`
              });
              controller.enqueue(encoder.encode(`data: ${nodeCompleteData}\n\n`));
            }

            // Send final result
            const resultData = JSON.stringify({
              type: 'final_result',
              content: `Workflow processed your input: "${userInput}"\n\nThis is a placeholder response. In production, this would contain the actual workflow execution result.`,
              timestamp: new Date().toISOString()
            });
            controller.enqueue(encoder.encode(`data: ${resultData}\n\n`));

          } catch (loadError) {
            console.error('[Workflow Chat API] Error loading workflow:', loadError);
            const errorData = JSON.stringify({
              type: 'error',
              error: 'Failed to load workflow'
            });
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          }

          // Send completion signal
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();

        } catch (error) {
          console.error('[Workflow Chat API] Stream error:', error);
          const errorData = JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
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

