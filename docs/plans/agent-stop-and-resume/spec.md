# Agent Stop & Resume — Design Spec

Feature directory: `docs/plans/agent-stop-and-resume/`
Owner role: Solution Architect (design only — no implementation)
Target surface: `src/components/video/components/VideoChatWindow/`, `src/components/video/hooks/useAgentExecution*.ts`, `src/lib/video-editing-agent/`, `src/app/api/video-editing-agent/chat/route.ts`
Document version: **v2** (post-review — see `## 评审记录` for changes)

---

## 评审记录

Reviewer: senior reviewer (Anthropic engineering). Review date: 2026-05-11.

The review checked the v1 design against the four standard dimensions (feasibility, completeness, consistency with `CLAUDE.md` and the actual codebase, right-sizing). Findings are listed below with severity. Every **P0** and **P1** item has been resolved directly in the body of this v2 document; the relevant section numbers are pointed at by each entry.

### P0 — must fix before implementation

| # | Concern | Verified against | Resolution |
|---|---------|------------------|------------|
| P0-1 | `AbortSignal.any` is referenced unconditionally in the new abort plumbing, but the existing route (`route.ts:92-94`) already feature-detects it (`'any' in AbortSignal ? AbortSignal.any(...) : ...`). The spec must keep that fence so deployments on Node ≤ 18 do not crash on first request. | `src/app/api/video-editing-agent/chat/route.ts` — existing thinking phase | §2.4 now mandates the same feature-detect fence and adds a fallback strategy (manual `abort` listener relay). |
| P0-2 | The spec relies *only* on `request.signal.addEventListener('abort', …)` to detect a client disconnect. In Next.js 15 App Router on Node-runtime route handlers, `request.signal` does NOT reliably fire when the client drops an in-progress streaming response — the canonical signal is the `cancel(reason)` callback on the `ReadableStream` constructor. Without that, the server side will keep the agent alive until `AGENT_TIMEOUT` (30 min) and the entire feature regresses to today's broken behaviour. | Next.js docs + pattern audit of `route.ts:319` (`new ReadableStream({ async start(controller) { ... } })`) | §2.4 now wires **both** paths: the `request.signal` listener AND a `cancel(reason)` handler on the ReadableStream constructor; both call into the same idempotent `abortBundle.trigger(reason)`. |
| P0-3 | The spec does not specify what `agent.prompt()` does when `agent.abort()` is called — pi-agent-core's `Agent.abort()` does not reliably cause `prompt()` to resolve in a finite time, which would deadlock the existing `Promise.race([agent.prompt(...), timeoutPromise])` construct and prevent the `finally` block from running cleanup. | `node_modules/@mariozechner/pi-agent-core/dist/Agent.d.ts:144` (signature only — no behavioural contract) | §2.4 now adds a third leg to the race — `Promise.race([agent.prompt(...), timeoutPromise, abortPromise])` — where `abortPromise` is a deferred that the abort listener resolves. The `finally` is guaranteed to run within ~1 s of the user click. |

### P1 — must address before merge

| # | Concern | Verified against | Resolution |
|---|---------|------------------|------------|
| P1-4 | `useAgentExecution.ts:454-459` already auto-calls `cancelExecution()` whenever `activeConversationId` changes mid-turn. With v1's seal logic that effect would now stamp `isCancelled=true` on the previous conversation's in-flight assistant — even though the user merely navigated away, never clicked Stop. That is misleading UX and pollutes the resume system note. | `src/components/video/hooks/useAgentExecution.ts:454-459` | §2.6 now distinguishes two cancel paths — `cancelByUser()` (seals + flags `isCancelled`) and `cancelByNavigation()` (only stops the stream, leaves message un-flagged so resume on the *original* conversation works without the "stopped by user" preamble). The conversation-switch effect calls the second path. |
| P1-5 | Cancellation during the **thinking phase** is unspecified. Today the thinking phase runs its own `thinkingController` that's combined with `request.signal` via `AbortSignal.any` (with feature detection). The spec needs to confirm that when the user clicks Stop *before* the agent loop starts, the thinking phase tears down cleanly and the SSE stream emits the `cancelled` event (otherwise the UI sees an `agent_end`-less stream and times out). | `route.ts:88-94` — combined-signal pattern | §2.4 explicitly covers the thinking-phase case: the `abortBundle.trigger()` runs *regardless* of whether the agent has started, and the `cancelled` SSE event is emitted before the route function returns. |
| P1-6 | v1's reload behaviour is inconsistent. The existing on-mount sweep at `useAgentExecution.ts:436-448` resets `isStreaming=false` but does not flip `isCancelled` to true. So a hard refresh during a turn leaves the message in a half-state: the bubble shows neither "streaming" nor "stopped"; on the next user turn the resume path will *not* inject the `cancelled_by_user` marker because nothing in the message says it was cancelled. | `src/components/video/hooks/useAgentExecution.ts:436-448` | §2.6 step 5 (new) extends the on-mount sweep: any message that had `isStreaming === true` on mount is also flipped to `isCancelled = true`, and any tool-call still in `executing` status is demoted to `cancelled`. This makes the resume contract identical for "user-clicked-stop" and "browser-was-refreshed-mid-turn." |
| P1-7 | `toolContext.operations` (Map of toolCallId → operation) is never cleared on abort. If the same agent instance is somehow reused (today it isn't, but the abort path is now visible policy), in-flight entries leak. More importantly, a tool that was mid-write at the moment of abort may have *already inserted* an entry in the map while its async work was discarded — leaving a phantom operation that would be sent to the client as a `tool_result` if ever surfaced. | `src/lib/video-editing-agent/agent.ts:74-80` (`updateTimeline`/`recordOperation` write into the same Map) | §2.4 step 4b: on abort, drop entries from `toolContext.operations` whose `toolCallId` is still in the agent's "started but not ended" set. |
| P1-8 | The new abort listener and the existing `AGENT_TIMEOUT` watcher both call `agent.abort()`. They can race, especially under heartbeat-driven activity-reset. Order of operations and idempotency are unspecified, risking double-close on the SSE controller (`controller.close()` throws `TypeError: Invalid state` on second call). | `route.ts:373-381` (`resetTimeout` → `agent.abort()`) | §2.4 introduces an `abortBundle.trigger(reason)` that is idempotent (`if (triggered) return; triggered = true`). Both the timeout path and the client-abort path call this single function; `controller.close()` is wrapped in `try { } catch { }` per the existing convention. |
| P1-9 | The "system note about prior cancellation" injected by `messageConverter` (§2.7) is appended for *every* cancelled assistant in history. After 5 stop-and-resume cycles the conversation seeds 5 system notes — the LLM gets noisier each turn. Right-sized behaviour is to inject the note only for the **most recent** cancelled assistant; older cancellations are visible via the assistant message itself and don't need restating. | Reasoning from spec §2.7 | §2.7 now restricts the system note to the latest cancelled assistant only (i.e. emitted at most once, after the last `assistant` entry whose `isCancelled === true`). |
| P1-10 | The pi-ai / pi-agent-core message contract requires every assistant `toolCall` block to be followed by a matching `toolResult` — otherwise the next LLM call returns `400 invalid request: tool_use without tool_result`. v1's converter mostly handles this but does not state the contract for the "still executing" defensive branch (line 6.2 §2.7). | `messageConverter.ts:72-89` (existing pairing); pi-ai message validation (`anthropic-messages` provider) | §2.7 sharpens: the synthesised cancelled-tool result MUST use the exact `toolCallId` and `toolName` of the assistant's `toolCall`, MUST set `isError: true`, and MUST emit a JSON-stringified body `{"error":"cancelled_by_user","detail":"<tool> was interrupted by the user before it could complete"}`. |
| P1-11 | `'cancelled'` is added to `AgentToolCallRecord.status`, but consumers across the codebase pattern-match on the union exhaustively (rendering, persistence revive, undo selection). v1 only mentions extending the type but does not list the touch-points. A missed match site shows a runtime crash or "Unknown status" badge. | `grep -r AgentToolCallRecord` produces hits in `AgentToolCallCard.tsx`, `TimelineChatPanel`, `OperationApplier.ts`, `useAgentExecution.ts:420` (status: 'undone' as const), `messageConverter.ts:84` | §3 now lists all status-union readers as modify-targets and §5.2 enumerates the visual treatment (icon, color, undo-button hidden) for the new status. |

### P2 — minor / nice to have (not blocking)

| # | Concern | Status |
|---|---------|--------|
| P2-12 | Long tool names (`batch_storyboard_video`, `understand_video_script`) may overflow the 22 px bar at `text-[11px]`. Recommend `truncate` + tooltip. | Noted in §2.5; implementer may apply at their discretion. |
| P2-13 | The amber color palette is not currently in this project's Tailwind theme tokens (the existing palette uses `primary`, `accent`, `muted`, `destructive`, `border` — see `components.json` "new-york" style). Hardcoded `bg-amber-*` classes will work but may drift from theme. | Noted; alternative `bg-yellow-50` / use of CSS variables suggested in §2.5. |
| P2-14 | Spec writes "EN and ZH" — the project's actual locale keys are `en` and `zh-CN` (verified at `src/lib/i18n.ts:5619`). | Corrected in §3 i18n row. |
| P2-15 | The right-side ghost "Stop" button on the busy bar duplicates the red square button next to the textarea. Consider dropping it for visual minimalism. | Kept as optional; flagged for design-review at implementation time. |
| P2-16 | Wrap the `controller.close()` calls in try/catch (already standard in this route per `route.ts:328`). | Already noted in risk register; reaffirmed in §2.4. |

---

## 1. Overview

The video editing surface (`/editor`) embeds an Agent-style chat panel on the left. The agent runs as a long-lived SSE turn that may include a chain of LLM completions and dozens of tool calls (Pexels search, TTS, storyboard composition, timeline mutations). Today the only way to stop a turn that is going sideways is to refresh the browser — there is no user-visible stop affordance, the send button just spins, and there is no surface indicating that an agent turn is active. Worse, a refresh leaves the server-side agent loop running until the configured 30-minute timeout because the abort signal is not propagated into the pi-agent-core `agent.prompt()` execution. This feature delivers a first-class stop interaction.

This spec describes three coordinated changes. First, the chat input area gets a visible "agent is executing" affordance: the send button swaps to a red stop button while a turn is in flight, and a narrow status bar (≈22 px tall) appears just above the input area showing what the agent is currently doing. Second, when the user clicks stop, the front-end aborts the SSE fetch *and* the server-side Next.js route propagates that abort into the agent loop so the underlying pi-agent-core `Agent`, the LLM streaming call, and any in-flight tool fetches are all torn down — no more orphaned 30-minute turns. Third, when the user types again after a stop, the next turn picks up cleanly from the partial trajectory: the aborted assistant message remains in the conversation, every tool call that finished is preserved with its result, the in-flight tool (if any) is sealed with a cancellation marker, and the system prompt rebuild plus the message-to-Agent-history converter feed that partial trajectory back into the next `agent.prompt()` so the model continues from where it left off.

The change is intentionally scoped to the video-editing agent panel (`useAgentExecution` + `VideoChatWindow` + `/api/video-editing-agent/chat`). The general workflow chat (`/api/chat`) and the workflow-builder are unaffected. The user-visible contract is: clicking stop *will* end the current turn within ~1 s, *will not* drop completed work (operations already applied to the timeline stay applied), and the next user input continues the thread rather than restarting it.

## 2. Technical Design

### 2.1 Component map (as-is)

```
VideoEditingInterface.tsx
 └── useAgentExecution            ── orchestrator hook (composite)
      ├── useAgentExecutionState  ── owns AgentExecutionState, manager ref
      │    └── SSEStreamManager   ── fetch() + ReadableStream parser, cancel()
      ├── AgentEventRouter        ── routes SSE events to OperationApplier
      ├── AgentStateManager       ── per-turn message-state, subscribe()
      └── OperationApplier        ── applies timeline ops, undo registry
 └── VideoChatWindow
      ├── TimelineChatPanel       ── messages + LiveExecutionIndicator
      └── <input form>            ── textarea + send button (no stop UI today)

/api/video-editing-agent/chat (POST, SSE)
 ├── performThinkingPhase         ── streamed thinking deltas, has its own signal
 ├── createVideoEditingAgent      ── builds pi-agent-core Agent + ToolContext
 └── agent.prompt(lastUserMessage)── the long-running loop (NOT bound to req signal)
```

The front-end already has `cancelExecution`; what is missing is (a) any UI to invoke it, (b) a server-side hook on `request.signal` that calls `agent.abort()`, and (c) explicit conversation-history shape for partial/aborted turns.

### 2.2 Sequence — happy path (stop while a tool is running)

```
User clicks Stop
  └─► VideoChatWindow handleStopClick()
       └─► onCancel()  (prop wired to agent.cancelExecution in VideoEditingInterface)
            └─► useAgentExecutionState.cancelExecution()
                 └─► SSEStreamManager.cancel()
                      └─► AbortController.abort() on the fetch
                           ──► browser drops the SSE connection
            └─► stateManager.finalize() + emit a synthetic 'cancelled' event
                 └─► AgentStateManager marks isStreaming=false, sets
                     status:'cancelled', flushes pending tool-calls as
                     'cancelled' so the bubble does not show a spinner
            └─► OperationApplier left intact (already-applied ops remain)
            └─► updateConversationMessages — message persists with the
                 cancellation seal

Server side (the abort hits the route)
  Next.js sets request.signal.aborted = true
  └─► route.ts: signal.addEventListener('abort', onAbort)
       └─► agent.abort()                  (pi-agent-core stops the LLM stream)
       └─► toolContext.abortController.abort()  (in-flight tool fetches)
       └─► clear all heartbeat / total timers
       └─► controller.close() on the ReadableStream
       └─► route function returns
```

### 2.3 Sequence — resume after stop

```
User types a new message and hits Send
  └─► VideoEditingInterface.sendAgentMessage(text)
       └─► useAgentExecution.sendAgentMessage()
            └─► reads conversations[activeConversationId].messages
                 (contains the aborted assistant msg with partial
                  agentToolCalls, partial content, isCancelled=true)
            └─► creates a fresh agent message placeholder for the new turn
            └─► POST /api/video-editing-agent/chat with `messages`
                 = full history including the cancelled assistant

Server side
  convertToAgentMessages(history.slice(0, -1)) sees an assistant
   message with role:'assistant', content:<partial text>,
   toolCalls:<all completed + the one cancelled with status:'cancelled'>.
   The converter emits assistant + tool-result pairs in pi-agent-core's
   expected shape so the LLM's chat history contains:
     ...user→assistant(partial+toolUses)→toolResults(including one
     synthesized {error:'cancelled by user'})→user(new message).
  agent.prompt(newUserMessage) starts; the model has full context of
   where the prior turn stopped and continues forward.
```

### 2.4 Server-side abort plumbing (revised — addresses P0-1, P0-2, P0-3, P1-5, P1-7, P1-8)

In `route.ts` the existing code captures `request.signal` for the thinking phase but never wires it to `agent.prompt()`. The fix introduces an idempotent `abortBundle` plus **three independent** wake-up paths so the server reliably tears down whether the client disconnects, the route's own timeout fires, or pi-agent-core's `prompt()` does not settle on its own after `agent.abort()`.

#### 2.4.1 The `abortBundle` (idempotent)

```ts
const abortBundle = (() => {
  let triggered = false;
  let triggerReason: 'client_aborted' | 'server_timeout' | 'thinking_aborted' = 'client_aborted';
  // abortPromise is the third leg of the race in §2.4.4 — it lets the
  // outer await unblock as soon as the user clicks Stop, even if pi-agent-
  // core's `prompt()` does not resolve after `agent.abort()`.
  let resolveAbortPromise: ((reason: typeof triggerReason) => void) | null = null;
  const abortPromise = new Promise<typeof triggerReason>((resolve) => {
    resolveAbortPromise = resolve;
  });

  return {
    agent,                                  // from createVideoEditingAgent
    toolAbort: new AbortController(),       // shared by every tool fetch (see §2.4.2)
    thinkingAbort: new AbortController(),   // used by performThinkingPhase
    abortPromise,
    isTriggered: () => triggered,
    trigger(reason: typeof triggerReason) {
      if (triggered) return;                // P1-8: idempotent — safe to call from multiple paths
      triggered = true;
      triggerReason = reason;
      try { abortBundle.agent.abort(); } catch { /* already disposed */ }
      try { abortBundle.toolAbort.abort(); } catch {}
      try { abortBundle.thinkingAbort.abort(); } catch {}
      cleanupHeartbeat();                   // existing helper in route.ts
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = undefined; }
      // P1-7: drop in-flight tool operations from the shared map so
      // they cannot leak into a future `tool_result` event or a stale
      // OperationApplier replay.
      for (const id of pendingToolCallIds) {
        toolContext.operations.delete(id);
      }
      try { send({ type: 'cancelled', reason }); } catch {}
      try { controller.close(); } catch {}   // double-close is swallowed
      resolveAbortPromise?.(reason);
    },
  };
})();
```

`pendingToolCallIds` is a small `Set<string>` populated by the `tool_execution_start` handler inside `subscribeAgentEvents` and drained by `tool_execution_end` — wiring it through is a one-line change (the registry already knows the IDs).

#### 2.4.2 Tool-context plumbing

`toolContext` (defined in `src/lib/video-editing-agent/types.ts`) gains a new optional field `abortSignal?: AbortSignal`. Every tool helper that issues `fetch(...)` (centralised in `src/lib/video-editing-agent/tools/apiHelper.ts`'s `toolFetch`) already accepts a caller-provided signal and combines it with the per-request timeout via `AbortSignal.any` (with a feature-detect fallback — see §2.4.3). The change in `toolFetch` is to merge `context.abortSignal` into the same combine, so any of {caller signal, per-request timeout, route-wide abort} can short-circuit the fetch.

Tools that wrap a synchronous SDK call (e.g. Volcano TTS inside `generateTts`, ARK polling) wrap their await in `Promise.race([sdkCall(), abortRace(ctx.abortSignal)])` where `abortRace(signal)` returns a promise that rejects with a `DOMException('Aborted', 'AbortError')` when the signal fires. Per the existing storyboard convention documented in `CLAUDE.md` ("on local timeout, we do NOT call ARK cancel; the remote task runs to completion on its own and its result is discarded"), we adopt the same policy for user-aborted tasks: the remote SDK call is allowed to finish server-side; its result is dropped.

#### 2.4.3 Three wake-up paths into `abortBundle.trigger`

```ts
// Path A — the client closed the connection (browser fetch().signal aborted).
// Next.js MAY surface this via request.signal in node-runtime POST handlers.
// We attach the listener but treat it as best-effort — Path B is the canonical
// signal for streaming-response cancellation.
const reqSignal = (request as unknown as { signal?: AbortSignal }).signal;
if (reqSignal) {
  if (reqSignal.aborted) {
    abortBundle.trigger('client_aborted');
  } else {
    reqSignal.addEventListener('abort', () => abortBundle.trigger('client_aborted'), { once: true });
  }
}

// Path B — the SAME ReadableStream's cancel() callback. THIS is the path
// guaranteed to fire when the client tears down a streaming response
// (P0-2). It is wired into the ReadableStream constructor:
const stream = new ReadableStream({
  async start(controller) { /* ... existing body ... */ },
  cancel(reason) {
    console.log('[VideoEditingAgent] ReadableStream.cancel fired:', reason);
    abortBundle.trigger('client_aborted');
  },
});

// Path C — the route-wide AGENT_TIMEOUT watchdog (already exists).
// `resetTimeout` is rewritten to call abortBundle.trigger('server_timeout')
// instead of agent.abort() directly, so it goes through the same idempotent
// path as the client abort (P1-8).
```

**Feature-detect fence (P0-1):** `AbortSignal.any` is used in `toolFetch` and (already) in `performThinkingPhase`. The route preserves the existing pattern from `route.ts:92-94`:

```ts
const combinedSignal = (typeof AbortSignal !== 'undefined' && 'any' in AbortSignal)
  ? (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([thinkingController.signal, abortBundle.thinkingAbort.signal])
  : abortBundle.thinkingAbort.signal; // fallback: rely on bundle to propagate
```

For the fallback (Node where `AbortSignal.any` is unavailable, i.e. < 19), we relay manually: `thinkingController.signal.addEventListener('abort', () => abortBundle.thinkingAbort.abort())` so a thinking-phase timeout still tears down the bundle.

#### 2.4.4 The race that guarantees the route returns within ~1 s of abort (P0-3)

Replace the existing two-leg race with a three-leg race:

```ts
try {
  await Promise.race([
    agent.prompt(lastUserMessage),         // may not settle after abort()
    timeoutPromise,                         // 30-min watchdog (existing)
    abortBundle.abortPromise.then(() => {  // NEW: fires within ~1 s of trigger()
      throw new Error('aborted_by_user');
    }),
  ]);
} catch (err) {
  // 'aborted_by_user' / 'Agent timeout' both flow here; the cancelled SSE
  // event was already emitted from inside trigger(), so we just bail
  // without sending another error event.
  if ((err as Error).message !== 'aborted_by_user') throw err;
} finally {
  clearTimeout(timeoutId);
  cleanupHeartbeat();
}
```

This guarantees that the `finally` (and the subsequent `send('[DONE]') + controller.close()` from the existing code) executes within ~1 s of the user click, regardless of whether `pi-agent-core` actually resolves `prompt()` post-abort.

#### 2.4.5 Thinking-phase cancellation (P1-5)

Stopping during the thinking phase (before the agent loop starts) follows the same flow: `abortBundle.trigger('thinking_aborted')` aborts `thinkingController` (via the relay or `AbortSignal.any`), which causes the `streamLlmChat` for-await loop to throw `AbortError`, which the existing `try/catch` in `performThinkingPhase` swallows. The `cancelled` SSE event is then emitted by `trigger()` and the route returns through the same `finally` block — the route never reaches `agent.prompt()` and the response stream closes cleanly. The front-end's `SSEStreamManager` sees `cancelled` (a stream-end event per §4.1) and finalises the message.

### 2.5 Front-end stop UI

`VideoChatWindow.tsx` already receives `agentIsExecuting`, `executionState`, and `onCancel`. The current send button shows a spinner when `inputDisabled`. The redesign:

- **Send button slot** becomes a polymorphic button. When `agentIsExecuting` is true it renders as a 32×32 square with `bg-red-600 hover:bg-red-700` and a stop-square icon; `type="button"`; `onClick={handleStopClick}`. The tooltip / aria-label uses a new i18n string `t.videoChatWindow.stopAgentTooltip`. When `!agentIsExecuting` the button stays as today (paper-plane icon, submit type).
- **Narrow status bar.** A new `<AgentBusyBar />` component renders only when `agentIsExecuting`. It is a `flex-shrink-0` strip sitting between the action-buttons bar and the input form (i.e. inserted in JSX *just above* the form). Height ~22 px (`h-[22px]`), padding `px-3`, font-size `text-[11px]`, color `text-amber-700 dark:text-amber-300`, background `bg-amber-50 dark:bg-amber-950/30`, top/bottom border `border-y border-amber-200 dark:border-amber-900`. Left side: a pulsing dot + label that summarises `executionState`:
  - `executionState.isThinking` → `t.videoChatWindow.agentBusyThinking` ("Agent is thinking…")
  - `executionState.currentTool` non-null → `t.videoChatWindow.agentBusyTool({ tool })`
  - else → `t.videoChatWindow.agentBusyWorking`
  Right side: an inline ghost button "Stop" that also calls `onCancel`. The right-side action is optional secondary affordance; the primary stop is still the red button next to the textarea.

The existing `LiveExecutionIndicator` inside `TimelineChatPanel` is left as is. It lives inside the scroll area, the new bar is fixed above the input — they serve different visual jobs.

### 2.6 State machine reconciliation (revised — addresses P1-4 and P1-6)

`useAgentExecutionState` already exposes `status: 'idle' | 'executing' | 'retrying' | 'error' | 'cancelled' | 'completed'`. On `cancelExecution()` the status becomes `cancelled`. The composite `useAgentExecution` exposes **two** cancel paths so that user-initiated stops and incidental teardowns (conversation switch, unmount) do not produce identical artifacts in the conversation history.

#### 2.6.1 `cancelByUser()` — primary path (red button, busy-bar Stop)

1. Call `cancelExecState()` as today.
2. Walk `stateManager.getToolCalls()` and mark any tool whose status is still `executing` as `cancelled`.
3. Set the in-flight assistant message's `isCancelled = true`, `isStreaming = false`, and append a single trailing line `\n\n_[Stopped by user]_` to `content` *only if* the message has non-empty content; otherwise leave content untouched so the bubble does not show a stub.
4. Persist via `updateConversationMessages` so reload-safety is preserved (the messages array is what `useAgentExecution` reads on the next turn).

#### 2.6.2 `cancelByNavigation()` — incidental path (conversation switch, route unmount)

The existing `useEffect` at `useAgentExecution.ts:454-459` calls `cancelExecution` on `activeConversationId` change. This is rewritten to call `cancelByNavigation()` which:

1. Calls `cancelExecState()` (same as user path — stops the SSE).
2. Sets `isStreaming = false` on the in-flight message.
3. Does **not** set `isCancelled = true` and does **not** append the `_[Stopped by user]_` marker.

Rationale: the user merely navigated away — they may come back to that conversation and expect the *next* user message to resume *as if it were a continuation of the same turn*, without the LLM seeing a "the user stopped you" system note. Tool calls still in-flight are demoted to `cancelled` (because the trajectory genuinely was interrupted) but the assistant message's `isCancelled` flag stays false, so §2.7's system-note injector does not fire for this conversation on next turn.

The same `cancelByNavigation()` is called from the cleanup effect at `useAgentExecution.ts:465-470` (component unmount).

#### 2.6.3 On-mount revive sweep (P1-6)

Extend the existing on-mount cleanup loop at `useAgentExecution.ts:436-448` from "demote `isStreaming → false`" to **also**:

- Set `isCancelled = true` on any message that had `isStreaming === true` on mount, **unless** it has zero `agentToolCalls` and an empty `content` (in which case treat it as a no-op turn and just delete it — matches today's behaviour where a stub is never shown).
- Demote any tool call still in `executing` status to `cancelled`.

This makes the resume contract identical regardless of how the prior turn ended: the next user message after a hard refresh sees the same trajectory shape that an explicit Stop click would produce.

```ts
// pseudo-code
useEffect(() => {
  for (const conv of conversations) {
    const dirty = conv.messages.some(
      m => m.isStreaming || (m.agentToolCalls?.some(tc => tc.status === 'executing'))
    );
    if (!dirty) continue;
    const cleaned = conv.messages.flatMap(m => {
      if (!m.isStreaming && !m.agentToolCalls?.some(tc => tc.status === 'executing')) {
        return [m];
      }
      const isStub = !m.content && (!m.agentToolCalls || m.agentToolCalls.length === 0);
      if (isStub) return []; // drop the empty turn
      return [{
        ...m,
        isStreaming: false,
        isCancelled: true,
        agentToolCalls: m.agentToolCalls?.map(tc =>
          tc.status === 'executing' ? { ...tc, status: 'cancelled' as const } : tc
        ),
      }];
    });
    updateConversationMessages(conv.id, cleaned);
  }
}, []); // mount-only
```

### 2.7 Conversation history for resume (revised — addresses P1-9, P1-10)

`messageConverter.convertToAgentMessages(history)` is the only place that translates `ChatMessage[]` into pi-agent-core's `AgentMessage[]`. To support resume we extend its assistant-message handler. The current implementation lives at `messageConverter.ts:33-103`.

**Per-assistant transformation.** For each assistant message with `isAgentMessage === true`:

- Emit the assistant message with its (partial) `content` as a `text` block (existing behaviour at line 46-48).
- Emit `toolCall` entries for every record in `agentToolCalls`, regardless of status (existing behaviour at line 50-57).
- For each tool call, emit a corresponding `toolResult` message — it MUST share the exact `toolCallId` (`tc.id`) and `toolName` (`tc.name`) of the assistant's `toolCall` block, otherwise the next LLM call returns `400 invalid_request: tool_use without tool_result` on the `anthropic-messages` provider:
  - status `completed` → `{ content: [{ type: 'text', text: JSON.stringify(tc.result) }], isError: false }` (existing).
  - status `error` → `{ content: [{ type: 'text', text: JSON.stringify(tc.result) }], isError: true }` (existing).
  - status `undone` → emit as `completed` (existing implicit behaviour — undone is a UI-only flag).
  - status **`cancelled`** (new branch) → `{ content: [{ type: 'text', text: '{"error":"cancelled_by_user","detail":"<tool> was interrupted by the user before it could complete"}' }], isError: true }`.
  - status **`executing`** (defensive — should not occur after §2.6's seal but the on-mount sweep is best-effort) → treated identically to `cancelled` above.

**System-note tail (revised — P1-9).** If **the most recent assistant message in `history` has `isCancelled === true`**, append exactly one synthetic system message *after* the converter's loop finishes (so it sits at the end of the produced `Message[]`, just before the new user prompt is appended by `agent.prompt()`):

```ts
{ role: 'system', content: 'The previous turn was stopped by the user. Acknowledge briefly, then resume from the current timeline state — do NOT re-execute the cancelled tool unless the user explicitly asks.' }
```

Older cancelled assistants in the history are NOT given their own system note — the cancelled tool-result already in the history carries the signal. Limiting the note to "the most recent cancellation" prevents N stop/resume cycles from injecting N system notes.

**Note on system-message handling.** `messageConverter.ts:105` currently has the comment "Skip 'system' messages — they're handled via systemPrompt." This refers to *user-facing system messages stored in the chat history*. The new injection above creates a *fresh* `Message` of role `'system'` and pushes it directly onto the produced `Message[]`; it bypasses the loop's role-based router and therefore is not affected by that skip.

### 2.8 LiveExecutionIndicator and AgentBusyBar — relationship

| Concern | LiveExecutionIndicator | AgentBusyBar |
|---|---|---|
| Location | Inline at the bottom of the timeline scroll area | Fixed above input form |
| Visibility | While status ∈ {executing, retrying} *and* the user is scrolled near bottom | Always while status ∈ {executing, retrying} |
| Affordance | None (pure display) | "Stop" button (secondary to the red send-slot button) |
| Removed? | No — kept for context-rich progress (current tool + completed count) | New |

## 3. File / Module Change Plan

| File | Change kind | One-line intent |
|---|---|---|
| `src/components/video/components/VideoChatWindow/VideoChatWindow.tsx` | modify | Render `<AgentBusyBar />` above input; swap send button to red stop button while `agentIsExecuting`; wire `onCancel`. |
| `src/components/video/components/VideoChatWindow/AgentBusyBar.tsx` | create | New narrow 22 px status strip with pulsing dot, status label, and ghost Stop button. |
| `src/components/video/components/VideoChatWindow/index.ts` | modify | Export `AgentBusyBar`. |
| `src/components/video/hooks/useAgentExecution.ts` | modify | Extend `cancelExecution` to seal pending tool calls as `cancelled` and mark the assistant message `isCancelled=true`. |
| `src/components/video/hooks/useAgentExecutionState.ts` | modify | Forward a synthetic `cancelled` event to `onEvent` callbacks so downstream routers can clean up. |
| `src/lib/video-editing-agent/types.ts` | modify | Add `isCancelled?: boolean` to `ChatMessage`-style shapes used here; add `'cancelled'` to `AgentToolCallRecord.status` union; add `abortSignal: AbortSignal` to `ToolContext`; add `'cancelled'` SSE event type. |
| `src/types/index.ts` | modify | Mirror `isCancelled` on shared `ChatMessage` type and `'cancelled'` on tool-call status union. |
| `src/lib/video-editing-agent/AgentStateManager.ts` | modify | Add `markCancelled()` method that seals in-flight tool calls and sets a cancellation flag for the message update. |
| `src/lib/video-editing-agent/AgentEventRouter.ts` | modify | Handle new `'cancelled'` SSE event by invoking `stateManager.markCancelled`. |
| `src/lib/video-editing-agent/SSEStreamManager.ts` | modify (small) | On `cancel()`, suppress the `onError` classification path so a user-initiated abort does not surface as an error in the UI. |
| `src/lib/video-editing-agent/messageConverter.ts` | modify | Emit assistant + tool-result entries for cancelled tool calls; append a `system` note when the prior turn was cancelled. |
| `src/lib/video-editing-agent/tools/apiHelper.ts` | modify | Thread `toolContext.abortSignal` into every `fetch()` call. |
| `src/lib/video-editing-agent/tools/*.ts` (those that issue HTTP) | modify | Pass `signal: ctx.abortSignal` to fetch wrappers; wrap external SDK awaits in abort-aware races where the SDK does not support a signal. |
| `src/app/api/video-editing-agent/chat/route.ts` | modify | Build `abortBundle`, attach `request.signal` listener, propagate abort to `agent.abort()` and `toolAbort`, emit `{type:'cancelled'}` then close the stream. |
| `src/lib/i18n.ts` | modify | Add `stopAgentTooltip`, `agentBusyThinking`, `agentBusyWorking`, `agentBusyTool` (with `{tool}` slot), `stopButtonLabel`, `agentToolCancelled` to both `en` and `zh-CN` locales (verified locale keys at `i18n.ts:2796` and `i18n.ts:5619`). |
| `src/components/video/components/VideoChatWindow/AgentToolCallCard.tsx` | modify | Render `'cancelled'` status: muted icon, grey text, hide undo button (P1-11 — exhaustive union match site). |
| `src/components/video/components/VideoChatWindow/timeline/*` (TimelineChatPanel and any tool-call renderers) | modify | Same as above — handle `'cancelled'` in any `switch (status)` block (P1-11). |
| `src/lib/video-editing-agent/OperationApplier.ts` | modify | Skip operations whose source tool-call has `status === 'cancelled'` so the timeline never receives a partially-built op from an aborted tool (P1-7 reload safety). |
| `src/components/video/components/VideoChatWindow/__tests__/VideoChatWindow.stop.test.tsx` | create | Renders with `agentIsExecuting=true`, asserts red stop button + busy bar appear, click triggers `onCancel`. |
| `src/components/video/hooks/__tests__/useAgentExecution.cancel.test.ts` | create | Drives cancel flow, asserts message seal (`isCancelled`, tool-call `cancelled` status, content suffix). |
| `src/lib/video-editing-agent/__tests__/messageConverter.cancelled.test.ts` | create | Verifies converter shape for messages containing cancelled tool calls + cancelled assistant. |
| `src/lib/video-editing-agent/__tests__/abort.integration.test.ts` | create | Spawns the route handler, mid-flight aborts the request, verifies `agent.abort()` was called and stream closes. |
| `docs/plans/agent-stop-and-resume/spec.md` | create | This document. |

## 4. Interface Design

### 4.1 SSE wire protocol (additions)

A new event type `cancelled` is emitted by the server when `request.signal` aborts, before closing the stream:

```
event payload : { type: 'cancelled', reason: 'client_aborted' | 'server_timeout', timestamp: number }
```

The front-end treats `cancelled` as a terminal event equivalent to `agent_end` for stream-end purposes (the `SSEStreamManager.isStreamEndEvent` predicate accepts it), but it routes through `AgentEventRouter.handleCancelled` rather than `agent_end` so the message is sealed with the cancellation marker rather than the normal completion finalize.

### 4.2 Client → server contract

Unchanged. The POST body to `/api/video-editing-agent/chat` is the same `AgentChatRequest`. Cancellation is signalled out-of-band by aborting the fetch (`AbortController.abort()`), not by a separate HTTP call.

### 4.3 Component prop additions

`VideoChatWindow` — no new props. The existing `agentIsExecuting`, `executionState`, and `onCancel` carry the new UI. `AgentBusyBar` (new) accepts:

```ts
interface AgentBusyBarProps {
  executionState: AgentExecutionState;
  onCancel: () => void;
}
```

### 4.4 Hook additions

`useAgentExecution` return shape gains no new fields; `cancelExecution` is now guaranteed to leave a consistent partial message behind (documented in the JSDoc).

## 5. Data Model

### 5.1 `ChatMessage` extension

Add one optional flag (existing `isStreaming` semantics already cover the in-progress case; we need a separate flag for "this was stopped" because the bubble UI distinguishes the two):

```ts
interface ChatMessage {
  // ...existing fields
  isCancelled?: boolean;      // NEW: true if user stopped the turn
}
```

### 5.2 `AgentToolCallRecord.status` union extension

```ts
type ToolCallStatus =
  | 'executing'
  | 'completed'
  | 'error'
  | 'undone'
  | 'cancelled';   // NEW
```

UI rendering for `cancelled` mirrors `error` (muted icon + grey text) but uses the i18n label `agentToolCancelled`.

### 5.3 `ToolContext` extension

```ts
interface ToolContext {
  // ...existing fields
  abortSignal: AbortSignal;   // NEW: passed into every fetch and SDK call
}
```

### 5.4 Persistence

`ChatMessage` is already serialised via the existing persistence revive path (`src/lib/persistence/*`). `isCancelled` is a primitive bool, no migration is needed; existing messages on reload simply read it as `undefined`/false. Same for the new `cancelled` tool status — readers must handle the new union value but no on-disk schema change is required.

## 6. Testing & Acceptance Criteria

### 6.1 Unit tests

1. **`useAgentExecution.cancel`** — simulate `sendAgentMessage`, advance through one `tool_call` event, then call `cancelExecution`. Assert:
   - `agent.agentIsExecuting === false`
   - The assistant message has `isCancelled === true` and `isStreaming === false`.
   - Any tool call in `executing` state is now `cancelled`.
   - The trailing content marker is present iff the assistant emitted any content.
2. **`messageConverter` resume shape** — feed a `ChatMessage[]` with a cancelled assistant. Assert the produced `AgentMessage[]` contains the assistant + a tool-result for each tool call (including `cancelled` → error output), and a system note message tail.
3. **`SSEStreamManager.cancel` no-error** — start a stream, call `cancel()`, assert `onError` was *not* invoked.
4. **`AgentBusyBar` render** — snapshot the three states (thinking, tool-running, generic working).

### 6.2 Integration tests

5. **Route abort propagation — `request.signal` path** — drive `/api/video-editing-agent/chat` with a mocked Agent whose `prompt()` returns a never-resolving promise. Abort via the request-level `AbortController`. Assert `agent.abort()` was called and the response stream was closed within ~1 s (the new third leg of the race).
6. **Route abort propagation — `ReadableStream.cancel` path (P0-2 regression test)** — same mocked Agent, but trigger the abort by calling `reader.cancel()` on the consumer side (simulating a browser disconnect that does *not* surface via `request.signal`). Assert the same outcome: `agent.abort()` called, `cancelled` event emitted, stream closed within ~1 s.
7. **Idempotent trigger** — fire `request.signal` abort and the `AGENT_TIMEOUT` watchdog within the same tick. Assert `agent.abort()` is called exactly once and `controller.close()` does not throw (P1-8 regression).
8. **Thinking-phase abort** — abort the request *during* `thinking_delta` streaming. Assert: the `cancelled` event is emitted, the route function returns within ~1 s, and `agent.prompt()` is never called (because the abort fired before the agent loop began) (P1-5).
9. **End-to-end resume** — use the existing react testing harness for `VideoEditingInterface`. Send a message, mock SSE to emit two `tool_call`/`tool_result` pairs then stall. Click stop. Send a follow-up message. Assert the second POST body's `messages` array contains the cancelled assistant with both completed tool calls and a `cancelled` third entry, and that `convertToAgentMessages` produces a single trailing `system` note (P1-9: only one note even after 3 cancel-resume cycles).
10. **Reload-safety** — seed `localStorage` with a conversation containing a message that has `isStreaming === true` and a tool call in `executing`. Mount `VideoEditingInterface`. Assert post-mount the message has `isCancelled === true`, `isStreaming === false`, and the tool call is `cancelled` (P1-6).
11. **`cancelByNavigation` does not poison resume** — start a turn, switch to a different conversation mid-flight, switch back. Assert the original conversation's message has `isCancelled === undefined/false` and that on next send, `convertToAgentMessages` does NOT inject the cancellation system note (P1-4).

### 6.3 Manual acceptance checklist

- [ ] While idle, the send button is the paper-plane icon; the busy bar is hidden.
- [ ] After sending in agent mode, within ≤1 s the send button turns red and the busy bar appears above the textarea.
- [ ] The busy bar updates as the agent transitions thinking → tool 1 → tool 2 → text streaming.
- [ ] Clicking the red button (or the secondary Stop in the bar) ends the turn in ≤1 s — the bubble shows the cancelled marker.
- [ ] In server logs, the route emits "Agent aborted by client" and exits; no orphan tool fetches keep running.
- [ ] Typing a new message and sending it produces an agent turn that *acknowledges* the stop (e.g. "Continuing from where we left off…") and uses already-applied timeline operations.
- [ ] Timeline ops that finished before the stop are not undone.
- [ ] Switching conversations while executing still cancels cleanly (covered by existing logic; verify the new seal path runs).
- [ ] Both EN and ZH locales render the new strings.

## 7. Risks & Mitigations

- **Risk:** pi-agent-core's `Agent.abort()` may not synchronously stop an in-flight `fetch` inside a tool. *Mitigation:* the new `toolContext.abortSignal` is the primary kill switch for tools — `agent.abort()` stops the LLM stream, the tool signal stops tool fetches; both fire together.
- **Risk:** Some tools (e.g. ARK image generation polling, storyboard) hold internal queues and may not honour an external `AbortSignal`. *Mitigation:* wrap their await in `Promise.race([call, abortPromise(signal)])` so the tool function returns; the backend job may still complete server-side (acceptable — its result is discarded, matching the existing storyboard-timeout behaviour documented in CLAUDE.md).
- **Risk:** Aborting mid-`text_delta` could leave the assistant content with a torn UTF-8 sequence. *Mitigation:* the SSE stream is parsed line-by-line; `text_delta` events are atomic — partial events never reach the state manager because the buffered chunk is incomplete until the `\n\n` boundary.
- **Risk:** Resume causes the LLM to re-execute the cancelled tool. *Mitigation:* the system-note tail and the `cancelled_by_user` tool error give the model the signal it needs; we also keep the system prompt's "do not retry user-cancelled tools" line (to be added to `systemPrompt.ts` as part of this work in a follow-up — out of scope for the implementation pass but flagged for the prompt author).
- **Risk:** The new busy bar shifts the chat layout and breaks existing automated tests / Playwright selectors. *Mitigation:* the bar is conditionally rendered (`agentIsExecuting && <AgentBusyBar />`), so idle-state DOM is unchanged. Add `data-testid="agent-busy-bar"` to ease assertions.
- **Risk:** Persistence of `isCancelled` and `cancelled` status across browser reload — existing cleanup-on-mount loop in `useAgentExecution.ts` resets `isStreaming` to false but leaves `isCancelled` intact (correct). *Mitigation:* add a corresponding sweep that demotes any lingering `executing` tool-call status to `cancelled` on mount (defensive), so a hard refresh during a turn yields the same end-state as an explicit stop.
- **Risk:** Heartbeat keep-alive comments (`: heartbeat`) emitted between `request.signal.abort()` and `controller.close()` could throw. *Mitigation:* the existing `try { controller.enqueue(...) } catch {}` pattern already swallows post-close enqueues; verify by inspection during implementation.

---

**End of spec.** A downstream engineer should be able to read this top-to-bottom and implement the change without making further design decisions. Open question deliberately left to implementation: the exact text of the cancellation marker (line 6.2 step 3) — propose `_[Stopped by user]_` but defer final wording to the i18n owner.

---

## 评审结论

**有条件通过 (Approved with conditions).**

The v1 design is sound in shape — the three-piece structure (UI affordance, server-side abort, conversation-history shape for resume) is the right decomposition, the file-change table is concrete, and the test plan covers the right surface. The review surfaced three P0 issues and eight P1 issues, all of which are now resolved in this v2 document. Implementation may proceed once the conditions below are satisfied.

### Conditions for sign-off

1. **§2.4.3 Path B is mandatory.** The `ReadableStream.cancel(reason)` callback is the only signal guaranteed to fire when a browser drops a streaming response in Next.js 15 App Router (Node runtime). Implementer must wire both `request.signal` (Path A, best-effort) AND `cancel(reason)` (Path B, canonical). Skipping Path B regresses the feature to today's broken behaviour.

2. **§2.4.4 three-leg race is mandatory.** `Promise.race([agent.prompt(...), timeoutPromise, abortBundle.abortPromise])` — without the abort-promise leg, an `agent.abort()` that does not cause `prompt()` to settle will deadlock the route's `finally` block and leak the heartbeat timer. This must be in the first PR.

3. **§2.6.1 vs §2.6.2 split is mandatory.** A single shared `cancelExecution()` for both user-stop and conversation-switch will pollute the resume system note (P1-4). Implementer must implement two separate functions and verify by integration test #11.

4. **§2.7 single-note rule is mandatory.** The system note for prior cancellation MUST be emitted at most once (for the most recent `isCancelled === true` assistant), not per-cancellation-in-history. Verified by the assertion in integration test #9.

5. **P1-11 union exhaustiveness.** Before merge, run `tsc --noEmit` and confirm no new "switch is not exhaustive" warnings appear in the components and helpers added to §3 (the `'cancelled'` status must be handled at every match site). Adding `'cancelled'` is a breaking change to the union and any forgotten match site is a runtime crash.

### Out-of-scope, but tracked

- **System-prompt instruction "do not retry user-cancelled tools"** — flagged in §7 risk register and confirmed out of scope here. Recommend a follow-up issue against `systemPrompt.ts` to add this rule explicitly to the L0 prompt; the converter's system note (§2.7) is a partial mitigation but a permanent prompt rule is more robust.
- **Telemetry / observability** — no spec content for "user pressed Stop" event tracking. If product wants stop-rate metrics, file a follow-up — out of scope for this spec.
- **AgentBusyBar visual polish** (P2-12, P2-13, P2-15) — left as implementer judgement; not blocking.

### Sign-off

This v2 document is approved for downstream implementation, contingent on the five mandatory conditions above being satisfied in the implementation PR. Reviewer recommends a single follow-up review pass at PR-time focused on §2.4 (the abort plumbing is the highest-risk surface) and integration tests #5-#11.

---

## 实施过程发现的方案缺陷 (Issues Found During Implementation)

Implementer: 2026-05-11. Below are deviations from §2.7's letter that were necessary because the underlying `pi-ai` SDK does not match the spec's assumed shape. Behaviour was preserved.

### I-1 — `pi-ai` has no `system` role in its `Message` union

§2.7 specifies injecting a `{ role: 'system', content: '...' }` message after the converter loop, "bypassing the loop's role-based router." However, `@mariozechner/pi-ai`'s `Message` type is `UserMessage | AssistantMessage | ToolResultMessage` (see `node_modules/@mariozechner/pi-ai/dist/types.d.ts:142`) — there is no `SystemMessage`. The SDK accepts only a single `systemPrompt` field on the `Agent` constructor and does not surface a way to push additional system instructions into the message array post-construction.

**Resolution.** The "previous turn was stopped" note is emitted as a `UserMessage` with an explicit `[System note] …` prefix in its `content`. This is the standard cross-provider workaround for chat APIs that don't accept multiple system messages, and it preserves the spec's contract: the LLM sees a single, prominent instruction that the prior turn was cancelled, exactly once, immediately before the new user prompt. The single-note rule (§2.7 / P1-9 / mandatory condition #4) is implemented identically.

### I-2 — Agent event tracking for `pendingToolCallIds`

§2.4's abort bundle relies on `pendingToolCallIds` being populated by the `tool_execution_start` SSE handler inside `subscribeAgentEvents`. The existing `subscribeAgentEvents` signature does not expose a way for the caller to read those IDs back. Rather than reshape the signature (out of scope per the design's "no rename / refactor / cleanup" rule), the route adds a parallel `agent.subscribe(...)` listener that maintains its own `pendingToolCallIds` set. Same on-the-wire behaviour, no API change.

### I-3 — `OperationApplier` defensive guard already covered by `undoOperation`

§3 lists `OperationApplier.ts` as "Skip operations whose source tool-call has `status === 'cancelled'`." Investigation showed there is no code path that re-applies operations from `pendingOperations` on reload — operations are only applied via live SSE events. The server-side `triggerAbort` drops in-flight tool entries from `toolContext.operations` (per §2.4 step 4b / P1-7) before any `tool_result` can reach the client, and `undoOperation` returns `false` for unknown `toolCallId`s. No additional guard was needed in `OperationApplier.ts`; the defence is delivered by the route and the existing `undoOperation` lookup miss.
