import { NextRequest, NextResponse } from 'next/server';
import { backendConfig } from '@/lib/config/backend';
import { createVideoEditingAgent, subscribeAgentEvents } from '@/lib/video-editing-agent/agent';
import type { AgentChatRequest, SSEEvent } from '@/lib/video-editing-agent/types';

// SWEEP-EXCEPTION: third-party LLM Agent SDK with custom SSE/heartbeat lifecycle
// ─────────────────────────────────────────────────────────────────────────
// Pattern E (counted toward the 5-route escape-hatch budget).
// This route hosts a long-running streaming LLM Agent — it cannot be a dumb
// proxy. It does ONE backend call (`/api/model-settings/resolve/chat`) to
// resolve credentials, then runs the Agent SDK locally with custom tool
// invocation, heartbeat keepalive, and SSE event ID tracking. Only the
// backend call was migrated to `backendConfig.baseUrl`.

const AGENT_TIMEOUT = 600_000; // 10 minutes — storyboard generation can take 4+ minutes

export const maxDuration = 600; // 10 minutes (for Vercel/serverless platforms)

/**
 * Read the caller's bare session token from the incoming request. Supports
 * both the canonical `Authorization: Bearer <token>` header and the legacy
 * `x-session-token` header kept for backwards compatibility. The `Bearer `
 * prefix is stripped — callers re-add it where needed (`Bearer ${token}`).
 *
 * Returns `undefined` when the request carries no credentials — callers
 * should handle that case rather than silently dropping auth.
 */
function readIncomingAuth(request: NextRequest): string | undefined {
  const auth = request.headers.get('authorization');
  if (auth) {
    return auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  }
  const legacy = request.headers.get('x-session-token');
  if (legacy) {
    return legacy;
  }
  return undefined;
}

/**
 * Resolve the LLM credentials/model for this Agent invocation.
 *
 * Must forward the caller's session token to the backend — otherwise the
 * backend `SessionAuthMiddleware` returns 401 and `getConfig()` silently
 * falls back to `.env` defaults, which means any user-selected model from
 * `model_settings` (Kimi / GLM / Claude custom) is ignored. That bug was
 * diagnosed on 2026-04-07 alongside the main "fetch failed" incident.
 */
const getConfig = async (authToken: string | undefined) => {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
      headers['x-session-token'] = authToken;
    }
    const res = await fetch(
      backendConfig.joinPath('/api/model-settings/resolve/chat'),
      {
        method: 'GET',
        headers,
      },
    );
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
    } else {
      console.warn(
        `[VideoEditingAgent] model-settings/resolve/chat returned ${res.status}; falling back to env vars`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[VideoEditingAgent] Failed to fetch model settings (${msg}); falling back to env vars`);
  }

  const apiUrl = process.env.LLM_API_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-3.5-turbo';

  if (!apiKey) {
    throw new Error('API key not configured');
  }

  return { apiUrl, apiKey, model, providerType: undefined as string | undefined };
};

/**
 * Build the loopback apiBaseUrl passed to Agent tools.
 *
 * Production: the Agent runs inside the Next.js server container. If we use
 * the public origin (e.g. `https://ecliptrix.com`), tool fetches must round
 * trip through nginx / certbot HTTPS / DNS / hairpin NAT — any of which can
 * make undici throw `TypeError: fetch failed` (observed 2026-04-07 incident).
 *
 * Instead we point at `http://127.0.0.1:<port>` — the local Next.js process
 * itself — so tool fetches stay inside the same machine.
 *
 * Port resolution order:
 *   1. `AGENT_LOOPBACK_PORT` — explicit override for deployments that don't
 *      use the systemd `Environment=PORT=...` convention (e.g. pm2, docker
 *      compose, next-dev). ALWAYS wins.
 *   2. `PORT` — set by `ops/templates/ecliptrix-frontend.service`
 *      (`Environment=PORT=@@FRONTEND_PORT@@`) so every production deploy
 *      using ops/install.sh picks up the right port automatically.
 *   3. `3000` — dev/Next.js default fallback; matches the `npm run dev`
 *      behaviour for local work.
 */
function resolveAgentLoopbackUrl(): string {
  const port =
    process.env.AGENT_LOOPBACK_PORT ??
    process.env.PORT ??
    '3000';
  return `http://127.0.0.1:${port}`;
}

export async function POST(request: NextRequest) {
  try {
    const rawText = await request.text();
    let body: AgentChatRequest;
    try {
      body = JSON.parse(rawText) as AgentChatRequest;
    } catch (parseError) {
      console.error('[VideoEditingAgent] JSON parse failed. Raw body length:', rawText.length, 'Preview:', rawText.slice(0, 500));
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }
    const { messages, timelineState, materials, sessionToken: bodyToken } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    const effectiveTimelineState = timelineState && Array.isArray(timelineState.tracks)
      ? timelineState
      : {
          tracks: [
            { id: 'video-track-1', name: 'Video Track', type: 'video' as const, height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0, items: [] },
            { id: 'image-track-1', name: 'Image Track', type: 'video' as const, height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1, items: [] },
            { id: 'audio-track-1', name: 'Audio Track 1', type: 'audio' as const, height: 60, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 2, items: [] },
            { id: 'audio-track-2', name: 'Audio Track 2', type: 'audio' as const, height: 60, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 3, items: [] },
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

    // Read auth from header first, fall back to body (belt-and-suspenders for
    // environments where the Authorization header is silently stripped).
    const incomingAuthToken = readIncomingAuth(request) ?? bodyToken;

    if (!incomingAuthToken) {
      console.error('[VideoEditingAgent] No auth token found — returning 401 immediately. Header:', request.headers.get('authorization') ? 'present' : 'missing', 'Body token:', bodyToken ? 'present' : 'missing');
      return NextResponse.json(
        { success: false, message: '未提供认证凭证', error_code: 'UNAUTHORIZED', error_details: { reason: 'Missing session token' } },
        { status: 401 },
      );
    }

    const config = await getConfig(incomingAuthToken);
    const lastUserMessage = lastMessage.content;

    console.log(`[VideoEditingAgent] Starting agent for: "${lastUserMessage.slice(0, 100)}"`);

    const lastEventIdHeader = request.headers.get('Last-Event-ID');
    const lastEventId = lastEventIdHeader !== null ? parseInt(lastEventIdHeader, 10) : -1;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
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

        controller.enqueue(encoder.encode(`: stream-start\n\n`));

        if (lastEventId >= 0) {
          console.log(`[VideoEditingAgent] Reconnection detected — client last event ID: ${lastEventId}`);
        }

        try {
          // Use loopback, NOT new URL(request.url).origin — in production the
          // origin is the public HTTPS domain which the server-side container
          // cannot reliably reach back through nginx (see diagnosis report
          // 2026-04-07).
          const apiBaseUrl = resolveAgentLoopbackUrl();
          const { agent, toolContext } = createVideoEditingAgent({
            llmApiUrl: config.apiUrl,
            llmApiKey: config.apiKey,
            llmModel: config.model,
            providerType: config.providerType,
            timelineState: effectiveTimelineState,
            materials: effectiveMaterials,
            conversationHistory: messages,
            apiBaseUrl,
            authToken: incomingAuthToken,
          });

          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          let rejectTimeout: ((err: Error) => void) | undefined;
          const resetTimeout = () => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
              agent.abort();
              rejectTimeout?.(new Error('Agent timeout'));
            }, AGENT_TIMEOUT);
          };

          const HEARTBEAT_INTERVAL_MS = 15_000;
          let toolHeartbeatInterval: ReturnType<typeof setInterval> | null = null;
          let activeToolCount = 0;

          const startToolHeartbeat = () => {
            activeToolCount++;
            if (toolHeartbeatInterval === null) {
              toolHeartbeatInterval = setInterval(() => {
                try {
                  controller.enqueue(encoder.encode(': heartbeat\n\n'));
                } catch {
                  if (toolHeartbeatInterval !== null) {
                    clearInterval(toolHeartbeatInterval);
                    toolHeartbeatInterval = null;
                  }
                }
              }, HEARTBEAT_INTERVAL_MS);
            }
          };

          const stopToolHeartbeat = () => {
            activeToolCount = Math.max(0, activeToolCount - 1);
            if (activeToolCount === 0 && toolHeartbeatInterval !== null) {
              clearInterval(toolHeartbeatInterval);
              toolHeartbeatInterval = null;
            }
          };

          const cleanupHeartbeat = () => {
            if (toolHeartbeatInterval !== null) {
              clearInterval(toolHeartbeatInterval);
              toolHeartbeatInterval = null;
            }
            activeToolCount = 0;
          };

          subscribeAgentEvents(agent, toolContext, send, resetTimeout, startToolHeartbeat, stopToolHeartbeat);

          const timeoutPromise = new Promise<never>((_, reject) => {
            rejectTimeout = reject;
            resetTimeout();
          });

          try {
            await Promise.race([
              agent.prompt(lastUserMessage),
              timeoutPromise,
            ]);
          } finally {
            clearTimeout(timeoutId);
            cleanupHeartbeat();
          }

          console.log('[VideoEditingAgent] Agent completed successfully');
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('[VideoEditingAgent] Error:', message);

          if (message === 'Agent timeout') {
            send({ type: 'error', message: `Agent timed out after ${AGENT_TIMEOUT / 1000}s of inactivity. Completed operations have been preserved. Try breaking the task into smaller steps.` });
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
