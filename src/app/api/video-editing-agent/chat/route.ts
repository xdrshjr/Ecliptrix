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
          providerType: data.provider_type as string | undefined,
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

  return { apiUrl, apiKey, model, providerType: undefined as string | undefined };
};

export async function POST(request: NextRequest) {
  try {
    // Parse body as text first, then JSON — to get useful error logging if parsing fails
    const rawText = await request.text();
    let body: AgentChatRequest;
    try {
      body = JSON.parse(rawText) as AgentChatRequest;
    } catch (parseError) {
      console.error('[VideoEditingAgent] JSON parse failed. Raw body length:', rawText.length, 'Preview:', rawText.slice(0, 500));
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }
    const { messages, timelineState, materials } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    // Tolerate null/undefined timelineState and materials — new editor sessions
    // may not have a timeline yet. Provide sensible defaults instead of rejecting.
    const effectiveTimelineState = timelineState && Array.isArray(timelineState.tracks)
      ? timelineState
      : {
          tracks: [
            { id: 'video-track-1', name: 'Video Track', type: 'video' as const, height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0, items: [] },
            { id: 'image-track-1', name: 'Image Track', type: 'video' as const, height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1, items: [] },
            { id: 'audio-track-1', name: 'Audio Track 1', type: 'audio' as const, height: 60, isLocked: false, isMuted: false, isVisible: true, volume: 200, order: 2, items: [] },
            { id: 'audio-track-2', name: 'Audio Track 2', type: 'audio' as const, height: 60, isLocked: false, isMuted: false, isVisible: true, volume: 10, order: 3, items: [] },
            { id: 'subtitle-track-1', name: 'Subtitle Track', type: 'subtitle' as const, height: 50, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 4, items: [] },
          ],
          currentTime: 0,
          totalDuration: 0,
          zoomLevel: 1,
          selectedItems: [],
          playbackRate: 1,
          isPlaying: false,
          snapToGrid: true,
          gridSize: 0.5,
          scrollLeft: 0,
        };

    const effectiveMaterials = Array.isArray(materials) ? materials : [];

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user' || !lastMessage.content) {
      return NextResponse.json({ error: 'Last message must be a non-empty user message' }, { status: 400 });
    }

    const config = await getConfig();
    const lastUserMessage = lastMessage.content;

    console.log(`[VideoEditingAgent] Starting agent for: "${lastUserMessage.slice(0, 100)}"`);

    // Read Last-Event-ID header for SSE resumption support
    const lastEventIdHeader = request.headers.get('Last-Event-ID');
    const lastEventId = lastEventIdHeader !== null ? parseInt(lastEventIdHeader, 10) : -1;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Incremental event ID counter for SSE deduplication / resumption.
        // If the client reconnects with Last-Event-ID, we still emit all
        // events (the server-side Agent re-runs), but the client can use
        // the IDs to skip already-processed events.
        let eventIdCounter = 0;

        const send = (data: SSEEvent | string) => {
          try {
            const currentId = eventIdCounter++;
            const payload = typeof data === 'string' ? data : JSON.stringify(data);
            controller.enqueue(encoder.encode(`id: ${currentId}\ndata: ${payload}\n\n`));
          } catch {
            // Controller may be closed
          }
        };

        // Send stream-start comment to prevent proxy buffering
        controller.enqueue(encoder.encode(`: stream-start\n\n`));

        // Log if this is a reconnection attempt
        if (lastEventId >= 0) {
          console.log(`[VideoEditingAgent] Reconnection detected — client last event ID: ${lastEventId}`);
        }

        try {
          // Create agent
          const origin = new URL(request.url).origin;
          const { agent, toolContext } = createVideoEditingAgent({
            llmApiUrl: config.apiUrl,
            llmApiKey: config.apiKey,
            llmModel: config.model,
            providerType: config.providerType,
            timelineState: effectiveTimelineState,
            materials: effectiveMaterials,
            conversationHistory: messages,
            apiBaseUrl: origin,
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
