import { NextRequest, NextResponse } from 'next/server';
import { createVideoEditingAgent, subscribeAgentEvents } from '@/lib/video-editing-agent/agent';
import type { AgentChatRequest, SSEEvent } from '@/lib/video-editing-agent/types';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';
const AGENT_TIMEOUT = 120_000; // 120 seconds

const getConfig = async () => {
  try {
    const res = await fetch(`${BACKEND_URL}/api/model-settings/resolve/chat`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.api_key) {
        return {
          apiUrl: data.api_url,
          apiKey: data.api_key,
          model: data.model_name,
        };
      }
    }
  } catch {
    console.warn('[VideoEditingAgent] Failed to fetch model settings, falling back to env vars');
  }

  const apiUrl = process.env.LLM_API_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-3.5-turbo';

  if (!apiKey) {
    throw new Error('API key not configured');
  }

  return { apiUrl, apiKey, model };
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AgentChatRequest;
    const { messages, timelineState, materials } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    if (!timelineState || !Array.isArray(timelineState.tracks)) {
      return NextResponse.json({ error: 'Valid timelineState with tracks is required' }, { status: 400 });
    }

    if (!materials || !Array.isArray(materials)) {
      return NextResponse.json({ error: 'Materials array is required' }, { status: 400 });
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user' || !lastMessage.content) {
      return NextResponse.json({ error: 'Last message must be a non-empty user message' }, { status: 400 });
    }

    const config = await getConfig();
    const lastUserMessage = lastMessage.content;

    console.log(`[VideoEditingAgent] Starting agent for: "${lastUserMessage.slice(0, 100)}"`);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: SSEEvent | string) => {
          try {
            const payload = typeof data === 'string' ? data : JSON.stringify(data);
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          } catch {
            // Controller may be closed
          }
        };

        // Send stream-start comment to prevent proxy buffering
        controller.enqueue(encoder.encode(`: stream-start\n\n`));

        try {
          // Create agent
          const { agent, toolContext } = createVideoEditingAgent({
            llmApiUrl: config.apiUrl,
            llmApiKey: config.apiKey,
            llmModel: config.model,
            timelineState,
            materials,
            conversationHistory: messages,
          });

          // Subscribe to events and forward as SSE
          subscribeAgentEvents(agent, toolContext, send);

          // Run agent with timeout + abort on timeout
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              agent.abort();
              reject(new Error('Agent timeout'));
            }, AGENT_TIMEOUT);
          });

          try {
            await Promise.race([
              agent.prompt(lastUserMessage),
              timeoutPromise,
            ]);
          } finally {
            clearTimeout(timeoutId);
          }

          console.log('[VideoEditingAgent] Agent completed successfully');
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('[VideoEditingAgent] Error:', message);

          if (message === 'Agent timeout') {
            send({ type: 'error', message: 'Agent timed out. Please try a simpler request.' });
          } else {
            send({ type: 'error', message: `Agent error: ${message}` });
          }
        } finally {
          send('[DONE]');
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[VideoEditingAgent] Unexpected error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
