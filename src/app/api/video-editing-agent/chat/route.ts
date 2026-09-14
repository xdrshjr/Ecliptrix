import { NextRequest, NextResponse } from 'next/server';
import { backendConfig } from '@/lib/config/backend';
import { normalizeApiType, streamLlmChat, type LlmApiType } from '@/lib/llm/streamLlmChat';
import { createVideoEditingAgent, subscribeAgentEvents } from '@/lib/video-editing-agent/agent';
import type { AgentChatRequest, SSEEvent } from '@/lib/video-editing-agent/types';
import type { ChatMessage, TimelineState, MaterialItem } from '@/types';

// SWEEP-EXCEPTION: third-party LLM Agent SDK with custom SSE/heartbeat lifecycle
// ─────────────────────────────────────────────────────────────────────────
// Pattern E (counted toward the 5-route escape-hatch budget).
// This route hosts a long-running streaming LLM Agent — it cannot be a dumb
// proxy. It does ONE backend call (`/api/model-settings/resolve/chat`) to
// resolve credentials, then runs the Agent SDK locally with custom tool
// invocation, heartbeat keepalive, and SSE event ID tracking. Only the
// backend call was migrated to `backendConfig.baseUrl`.

const AGENT_TIMEOUT = 1_800_000; // 30 minutes — storyboard generation can take 4+ minutes; long tool chains need headroom

const THINKING_TIMEOUT = 30_000;
const THINKING_HEARTBEAT_INTERVAL = 15_000;
/** Comment frame interval for the whole stream lifetime (see keepAliveId). */
const STREAM_KEEPALIVE_INTERVAL_MS = 15_000;

function buildThinkingPrompt(
  userMessage: string,
  timelineState: TimelineState | null,
  materials: MaterialItem[],
): string {
  const trackSummary = timelineState?.tracks?.map(t => {
    const itemCount = t.items?.length ?? 0;
    return `${t.name} (${t.type}): ${itemCount} clips`;
  }).join('\n') ?? 'No tracks';

  const materialSummary = materials.length > 0
    ? materials.slice(0, 20).map(m => `- ${m.name} (${m.type}, ${m.format}${m.duration ? `, ${m.duration.toFixed(1)}s` : ''})`).join('\n')
    : 'No materials';

  const totalDuration = timelineState?.totalDuration ?? 0;

  return `You are a professional video editing assistant. Before executing the user's editing task, analyze the request and plan the execution approach.

## Current Project State
- Timeline tracks:
${trackSummary}
- Materials library:
${materialSummary}
- Total duration: ${totalDuration.toFixed(1)}s

## User Request
${userMessage}

## Please Consider
1. What is the user's goal?
2. How many steps are needed? Which tools for each step?
3. Are there any constraints to be aware of?

Output your analysis concisely in bullet points, no more than 300 characters.`;
}

async function performThinkingPhase(
  send: (data: SSEEvent | string) => void,
  encoder: TextEncoder,
  controller: ReadableStreamDefaultController,
  userMessage: string,
  conversationHistory: ChatMessage[],
  timelineState: TimelineState | null,
  materials: MaterialItem[],
  config: { apiUrl: string; apiKey: string; model: string; providerType?: string; apiType: LlmApiType },
  signal: AbortSignal,
): Promise<void> {
  let thinkingHeartbeatId: ReturnType<typeof setInterval> | null = null;

  try {
    send({ type: 'thinking_start' });

    thinkingHeartbeatId = setInterval(() => {
      try {
        controller.enqueue(encoder.encode(': heartbeat\n\n'));
      } catch {
        if (thinkingHeartbeatId !== null) {
          clearInterval(thinkingHeartbeatId);
          thinkingHeartbeatId = null;
        }
      }
    }, THINKING_HEARTBEAT_INTERVAL);

    const recentHistory = conversationHistory.slice(-6, -1);
    const thinkingPrompt = buildThinkingPrompt(userMessage, timelineState, materials);

    const thinkingController = new AbortController();
    const timeoutId = setTimeout(() => thinkingController.abort(), THINKING_TIMEOUT);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const combinedSignal = typeof AbortSignal !== 'undefined' && 'any' in AbortSignal
      ? (AbortSignal as any).any([thinkingController.signal, signal])
      : thinkingController.signal;

    try {
      for await (const event of streamLlmChat({
        config: {
          apiUrl: config.apiUrl,
          apiKey: config.apiKey,
          model: config.model,
          apiType: config.apiType,
        },
        messages: [
          { role: 'system', content: thinkingPrompt },
          ...recentHistory.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: userMessage },
        ],
        maxTokens: 800,
        signal: combinedSignal,
      })) {
        if (event.kind === 'error') {
          console.warn('[ThinkingPhase] LLM call failed:', event.status, event.message);
          break;
        }
        if (event.kind === 'content') {
          send({ type: 'thinking_delta', content: event.text });
        }
        // Reasoning/thinking deltas are swallowed here — the "thinking phase"
        // surfaces final content to the user while the internal chain-of-
        // thought stays internal.
      }
    } finally {
      clearTimeout(timeoutId);
    }

    send({ type: 'thinking_end' });
  } catch (error) {
    console.warn('[ThinkingPhase] Error (continuing to execution):', error);
    try { send({ type: 'thinking_end' }); } catch { /* already closed */ }
  } finally {
    if (thinkingHeartbeatId !== null) {
      clearInterval(thinkingHeartbeatId);
    }
  }
}

export const maxDuration = 1800; // 30 minutes (for Vercel/serverless platforms)

/**
 * Resolve the LLM credentials/model for this Agent invocation.
 *
 * Reads `model_settings` from the local backend so a model the owner picked
 * in the settings centre (Kimi / GLM / Claude custom) wins over the `.env`
 * defaults. The backend is unauthenticated (single local owner), so this is
 * a plain GET.
 */
type AgentResolvedConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
  providerType: string | undefined;
  apiType: LlmApiType;
};

const getConfig = async (): Promise<AgentResolvedConfig> => {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
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
          apiType: normalizeApiType(data.api_type),
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
  const apiType = normalizeApiType(process.env.LLM_API_TYPE);

  if (!apiKey) {
    throw new Error('API key not configured');
  }

  return { apiUrl, apiKey, model, providerType: undefined, apiType };
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
    const { messages, timelineState, materials, projectId } = body as AgentChatRequest & { projectId?: string };

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

    const config = await getConfig();
    const lastUserMessage = lastMessage.content;

    console.log(`[VideoEditingAgent] Starting agent for: "${lastUserMessage.slice(0, 100)}"`);

    const lastEventIdHeader = request.headers.get('Last-Event-ID');
    const lastEventId = lastEventIdHeader !== null ? parseInt(lastEventIdHeader, 10) : -1;

    // Capture the request's AbortSignal once at the top — Next.js POST
    // handlers expose `request.signal` (best-effort for streaming responses
    // on Node runtime). The canonical disconnect signal for streaming
    // responses is the ReadableStream's `cancel(reason)` callback (see
    // Path B below) — we wire both, going through the same idempotent
    // `abortBundle.trigger()` so double-fires are safe.
    const reqSignal = (request as unknown as { signal?: AbortSignal }).signal;

    // We need to share the abortBundle between start() and cancel() on the
    // ReadableStream constructor. The bundle is constructed lazily inside
    // start() because it depends on the live `agent` / `toolContext` /
    // `controller` references that only exist there. cancel() therefore
    // dereferences this slot via the closure.
    let triggerClientAbort: ((reason?: string) => void) | null = null;

    // Whole-stream keepalive. The thinking and tool heartbeats leave gaps,
    // e.g. while the LLM streams long tool-call arguments, and the client
    // drops a connection after 90 s without data. Declared outside start()
    // so cancel() can stop it too.
    let keepAliveId: ReturnType<typeof setInterval> | null = null;
    const stopKeepAlive = (): void => {
      if (keepAliveId !== null) {
        clearInterval(keepAliveId);
        keepAliveId = null;
      }
    };

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
        keepAliveId = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
          } catch {
            // The controller is closed, so the stream is over.
            stopKeepAlive();
          }
        }, STREAM_KEEPALIVE_INTERVAL_MS);

        if (lastEventId >= 0) {
          console.log(`[VideoEditingAgent] Reconnection detected — client last event ID: ${lastEventId}`);
        }

        // ────────────────────────────────────────────────────────────────
        // Abort bundle — single idempotent kill-switch shared by:
        //   • request.signal listener (Path A — Node-runtime best-effort)
        //   • ReadableStream.cancel(reason) (Path B — canonical for stream
        //     disconnects)
        //   • the AGENT_TIMEOUT watchdog (Path C — existing)
        //   • the thinking-phase teardown (so a Stop during the thinking
        //     phase emits the cancelled event and exits cleanly)
        //
        // Constructed BEFORE the thinking phase so the request-signal
        // listener can be attached immediately.
        // ────────────────────────────────────────────────────────────────
        const thinkingAbort = new AbortController();
        const toolAbort = new AbortController();
        const pendingToolCallIds = new Set<string>();

        // Forward declarations — populated once agent / cleanupHeartbeat /
        // timeoutId are in scope. Wrapped in refs so trigger() reads the
        // live values rather than snapshotting them at construction time.
        const refs: {
          agent: import('@mariozechner/pi-agent-core').Agent | null;
          toolContext: import('@/lib/video-editing-agent/types').ToolContext | null;
          cleanupHeartbeat: (() => void) | null;
          timeoutId: ReturnType<typeof setTimeout> | undefined;
        } = {
          agent: null,
          toolContext: null,
          cleanupHeartbeat: null,
          timeoutId: undefined,
        };

        type AbortReason = 'client_aborted' | 'server_timeout' | 'thinking_aborted';
        let abortTriggered = false;
        let resolveAbortPromise: ((reason: AbortReason) => void) | null = null;
        const abortPromise = new Promise<AbortReason>((resolve) => {
          resolveAbortPromise = resolve;
        });

        const triggerAbort = (reason: AbortReason): void => {
          if (abortTriggered) return;
          abortTriggered = true;
          console.log(`[VideoEditingAgent] Abort triggered: ${reason}`);
          try { refs.agent?.abort(); } catch { /* already disposed */ }
          try { toolAbort.abort(); } catch { /* already aborted */ }
          try { thinkingAbort.abort(); } catch { /* already aborted */ }
          refs.cleanupHeartbeat?.();
          if (refs.timeoutId !== undefined) {
            clearTimeout(refs.timeoutId);
            refs.timeoutId = undefined;
          }
          // P1-7: drop in-flight tool entries from the shared operations
          // map so they cannot leak into a future tool_result or replay.
          if (refs.toolContext) {
            pendingToolCallIds.forEach((id) => {
              refs.toolContext?.operations.delete(id);
            });
          }
          try { send({ type: 'cancelled', reason, timestamp: Date.now() }); } catch { /* controller may be closed */ }
          resolveAbortPromise?.(reason);
        };

        triggerClientAbort = (_reason?: string) => triggerAbort('client_aborted');

        // Path A — best-effort request.signal listener
        if (reqSignal) {
          if (reqSignal.aborted) {
            triggerAbort('client_aborted');
          } else {
            reqSignal.addEventListener(
              'abort',
              () => triggerAbort('client_aborted'),
              { once: true },
            );
          }
        }

        try {
          // Thinking phase — combined signal so a route-level abort during
          // thinking tears the LLM stream down immediately. Feature-detect
          // AbortSignal.any so deployments on Node < 19 do not crash.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const thinkingCombinedSignal: AbortSignal = (typeof AbortSignal !== 'undefined' && 'any' in AbortSignal)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ? (AbortSignal as any).any([thinkingAbort.signal, reqSignal ?? new AbortController().signal])
            : thinkingAbort.signal;
          await performThinkingPhase(
            send,
            encoder,
            controller,
            lastUserMessage,
            messages,
            effectiveTimelineState,
            effectiveMaterials,
            config,
            thinkingCombinedSignal,
          );

          // If abort happened during thinking, bail out before constructing
          // the agent — the cancelled SSE event was already emitted by
          // triggerAbort and the finally block below closes the stream.
          if (abortTriggered) {
            return;
          }

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
            apiType: config.apiType,
            timelineState: effectiveTimelineState,
            materials: effectiveMaterials,
            conversationHistory: messages,
            apiBaseUrl,
            projectId,
          });

          // Wire the route-wide tool-abort signal into the ToolContext so
          // every internal fetch and SDK race honours the same kill-switch.
          toolContext.abortSignal = toolAbort.signal;
          refs.agent = agent;
          refs.toolContext = toolContext;

          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          let rejectTimeout: ((err: Error) => void) | undefined;
          const resetTimeout = () => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
              // Route the watchdog through triggerAbort so client-abort
              // and server-timeout share one idempotent code path
              // (avoids double-close on the SSE controller).
              triggerAbort('server_timeout');
              rejectTimeout?.(new Error('Agent timeout'));
            }, AGENT_TIMEOUT);
            refs.timeoutId = timeoutId;
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
          refs.cleanupHeartbeat = cleanupHeartbeat;

          // Track in-flight tool-call IDs so triggerAbort can drop their
          // entries from toolContext.operations (P1-7). The agent event
          // subscription already fires `tool_call` / `tool_result` events
          // through `send`, so we wire a parallel observer below.
          const onToolExecutionStart = () => {
            startToolHeartbeat();
          };
          const onToolExecutionEnd = () => {
            stopToolHeartbeat();
          };

          // Hook the agent's own event stream so we can track pending
          // tool-call IDs without changing subscribeAgentEvents' signature.
          const trackUnsub = agent.subscribe((event) => {
            if (event.type === 'tool_execution_start') {
              pendingToolCallIds.add(event.toolCallId);
            } else if (event.type === 'tool_execution_end') {
              pendingToolCallIds.delete(event.toolCallId);
            }
          });

          subscribeAgentEvents(agent, toolContext, send, resetTimeout, onToolExecutionStart, onToolExecutionEnd);

          const timeoutPromise = new Promise<never>((_, reject) => {
            rejectTimeout = reject;
            resetTimeout();
          });

          try {
            // Three-leg race per spec §2.4.4 — the abortPromise leg
            // guarantees the route returns within ~1s of user-clicked Stop
            // even if pi-agent-core's prompt() does not settle after
            // agent.abort().
            await Promise.race([
              agent.prompt(lastUserMessage),
              timeoutPromise,
              abortPromise.then((reason) => {
                throw new Error(`aborted_by_user:${reason}`);
              }),
            ]);
          } finally {
            clearTimeout(timeoutId);
            cleanupHeartbeat();
            try { trackUnsub(); } catch { /* already unsubscribed */ }
          }

          console.log('[VideoEditingAgent] Agent completed successfully');
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);

          if (message.startsWith('aborted_by_user:')) {
            // Cancelled SSE event was already emitted from inside
            // triggerAbort — no additional error event needed.
            console.log('[VideoEditingAgent] Aborted (cancelled event already sent):', message);
          } else if (message === 'Agent timeout') {
            // Watchdog already routed through triggerAbort — but emit a
            // human-facing error event so the UI shows the timeout message
            // instead of just a silent cancellation.
            console.error('[VideoEditingAgent] Error:', message);
            send({ type: 'error', message: `Agent timed out after ${AGENT_TIMEOUT / 1000}s of inactivity. Completed operations have been preserved. Try breaking the task into smaller steps.` });
          } else {
            console.error('[VideoEditingAgent] Error:', message);
            send({ type: 'error', message: `Agent error: ${message}` });
          }
        } finally {
          stopKeepAlive();
          try { send('[DONE]'); } catch { /* controller may already be closed */ }
          try { controller.close(); } catch { /* already closed by triggerAbort */ }
        }
      },
      cancel(reason) {
        // Path B — canonical signal for streaming-response disconnect on
        // Next.js 15 App Router (Node runtime). request.signal is best-
        // effort; this is the path guaranteed to fire when the client
        // tears down the stream mid-flight.
        console.log('[VideoEditingAgent] ReadableStream.cancel fired:', reason);
        stopKeepAlive();
        triggerClientAbort?.(typeof reason === 'string' ? reason : 'stream_cancelled');
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
