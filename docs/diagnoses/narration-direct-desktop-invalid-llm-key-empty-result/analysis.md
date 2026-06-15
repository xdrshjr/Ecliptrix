# Packaged Desktop Narration Direct Shows Empty Model Result

## Problem description

In the packaged desktop app, the video editor's narration-direct generation
flow fails after the user submits a request in the right-side AI assistant. The
left-side narration draft does not receive streamed generated text. The UI
shows:

> 妯″瀷鏈繑鍥炰换浣曞唴瀹癸紝璇烽噸璇?
The development path can appear healthy because it is run with the repository
environment and a locally configured LLM key, while the packaged desktop app
uses the user's desktop `userData` environment and/or in-app model settings.

## Reproduction steps

### Packaged desktop reproduction

1. Launch the packaged app:
   `M:/takoAI/Ecliptrix/desktop/release/win-unpacked/Ecliptrix.exe`
2. Open a video editing project.
3. Open the narration direct generation modal.
4. In the right-side AI assistant, submit any request, for example
   `鍐欎竴娈?30 绉掑皬鐙楀搧绉嶄粙缁峘.
5. Observe that the left draft does not stream generated narration and the
   assistant reports `妯″瀷鏈繑鍥炰换浣曞唴瀹癸紝璇烽噸璇昤.
6. Inspect the packaged frontend log:
   `C:/Users/jdqqj/AppData/Roaming/ecliptrix-desktop/logs/frontend.log`
7. The same request is logged as an upstream LLM authentication failure, not as
   a successful empty model completion.

Relevant log excerpt from the local packaged run:

```text
C:/Users/jdqqj/AppData/Roaming/ecliptrix-desktop/logs/frontend.log:563
[Chat API] Model: qwen3-next-80b-a3b-instruct
C:/Users/jdqqj/AppData/Roaming/ecliptrix-desktop/logs/frontend.log:566
[Chat API] Calling LLM API (api_type=openai) base=https://dashscope.aliyuncs.com/compatible-mode/v1
C:/Users/jdqqj/AppData/Roaming/ecliptrix-desktop/logs/frontend.log:569
[Chat API] LLM upstream error: 401 - {"error":{"message":"Incorrect API key provided...","type":"invalid_request_error","code":"invalid_api_key"}}
C:/Users/jdqqj/AppData/Roaming/ecliptrix-desktop/logs/frontend.log:570
[Chat API] Response failed: LLM upstream error: 401
```

Additional current packaged-log samples show the same path at
`frontend.log:568` and `frontend.log:577`: `/api/chat` resolves model
`qwen3-next-80b-a3b-instruct`, calls
`https://dashscope.aliyuncs.com/compatible-mode/v1`, and receives
`401 invalid_api_key`. This rules out backend startup, renderer routing, and
HTTP request construction as the primary failure: the packaged server reaches
the external LLM boundary and the provider rejects the credential.

### Minimal local repro of the misleading UI state

This reproduces the old client-side SSE handling without calling a real LLM:

```powershell
@'
const sse = 'data: {"error":"LLM upstream error: 401","message":"invalid_api_key"}\n\ndata: [DONE]\n\n';
let buffer = '';
let accumulated = '';
let accumulatedReasoning = '';
for (const part of [sse]) {
  buffer += part;
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    const tl = line.trim();
    if (!tl || !tl.startsWith('data: ')) continue;
    const data = tl.slice(6);
    if (data === '[DONE]') continue;
    const parsed = JSON.parse(data);
    const chunk = typeof parsed.content === 'string' ? parsed.content : '';
    const reasoningChunk = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';
    if (chunk.length === 0 && reasoningChunk.length === 0) continue;
    if (chunk) accumulated += chunk;
    if (reasoningChunk) accumulatedReasoning += reasoningChunk;
  }
}
const summary = accumulated.trim()
  ? 'Left draft updated.'
  : accumulatedReasoning.trim()
    ? 'reasoning-only'
    : 'The model returned nothing - please retry.';
console.log(summary);
'@ | node -
```

Observed output:

```text
The model returned nothing - please retry.
```

## Root cause analysis

The failure has two layers.

First, the packaged desktop app is calling the configured OpenAI-compatible
provider with an invalid DashScope API key. `src/lib/llm/streamLlmChat.ts:94`
sends the request with `Authorization: Bearer <apiKey>`, and
`src/lib/llm/streamLlmChat.ts:104` converts a non-2xx upstream response into a
normalized `{ kind: 'error', status, message }` event. The packaged log proves
that the upstream response is `401 invalid_api_key`.

Second, `/api/chat` keeps the browser response as HTTP 200 SSE after the stream
has already started. On upstream failure, it emits an SSE error frame and then
`[DONE]` at `src/app/api/chat/route.ts:176` and
`src/app/api/chat/route.ts:181`. That is a reasonable streaming contract, but
clients must explicitly handle the `{ error, message }` frame.

The misleading empty-result symptom happens when a client only reads
`content`/`reasoning` chunks and skips frames without either field. The old
narration direct consumer reached the finalize branch with both `accumulated`
and `accumulatedReasoning` empty, so it displayed the generic empty result
message. The current checkout contains the right shape of fix in
`src/components/video/hooks/useNarrationChat.ts:184` through
`src/components/video/hooks/useNarrationChat.ts:193`: detect
`parsed.error` before the empty chunk guard at
`src/components/video/hooks/useNarrationChat.ts:197`, set `errorMessage`, and
let the finalizer choose the failure branch at
`src/components/video/hooks/useNarrationChat.ts:242`.

Desktop-specific configuration explains why this appears after packaging:
`src/app/api/chat/route.ts:48` through `src/app/api/chat/route.ts:85` first
asks the packaged backend to resolve `/api/model-settings/resolve/chat`, and
only falls back to frontend environment variables if no usable backend model
setting is returned. The packaged backend implementation at
`desktop/release/win-unpacked/resources/backend/app/services/model_settings_service.py:560`
through
`desktop/release/win-unpacked/resources/backend/app/services/model_settings_service.py:593`
returns the database-assigned provider key before considering env vars; its
env fallback is at lines `595` through `643`. Separately,
`desktop/main/frontendService.js:21` through `desktop/main/frontendService.js:29`
passes `userEnv` into the standalone Next server, while
`desktop/main/envCheck.js:52` through `desktop/main/envCheck.js:63` only strips
placeholder values matching `your_*`. Neither the database assignment path nor
the env fallback validates a real-looking but incorrect/expired key before the
generation request. Such a key therefore reaches the Next chat route, and the
first real LLM call fails with `401 invalid_api_key`.

Review counter-evidence: the current local packaged frontend bundle is not
obviously missing the consumer-side SSE error fix. The standalone server bundle
at
`desktop/release/win-unpacked/resources/frontend/.next/server/app/api/chat/route.js`
contains the same `LLM upstream error` SSE frame as the source route, and the
client chunk
`desktop/release/win-unpacked/resources/frontend/.next/static/chunks/app/page-c46dfea43cbc91ba.js`
contains a minified `typeof e.error === "string"` branch before the
`content` handling. Therefore, if this exact packaged directory still shows the
generic empty-result message, either a different installed package is being
run, a different `/api/chat` consumer path still ignores error frames, or the
reported UI text is stale relative to the rebuilt bundle. The 401 itself is
still fully explained by the invalid credential.

Historical commit context:

- `5dfaacf92463046db3d176c3778c67ad0e03e4a0` handled the no-key case by
  returning a structured 503 from `/api/chat`.
- The current observed logs are not the no-key case. They show a configured
  but invalid key, so `/api/chat` starts SSE normally and then receives a 401
  from the upstream provider.
- `d710b0704f8f0d4724f444de5aecf6f1a7ddaab1` in the current checkout handles
  SSE error frames in consumers; the packaged app must be rebuilt from this or
  equivalent logic to stop showing the empty-result fallback.

## Impact surface

Affected users:

- Packaged desktop users whose model settings or desktop `.env` contain an
  invalid, expired, revoked, or wrong-provider LLM API key.
- Users of the narration direct generation panel, especially the right-side AI
  assistant path that writes streamed output into the left narration draft.

Potentially affected adjacent features:

- Any UI that consumes `/api/chat` SSE and ignores `{ error, message }` frames.
- Other direct LLM routes using the same desktop credentials can fail with the
  same upstream `401`, as seen in the prompt polish and FAST_LLM translation
  log entries.

Unaffected:

- Backend health and local desktop startup. The backend and frontend services
  become healthy; the failure happens at the external LLM boundary.
- Video project autosave, local storage, TTS, and media serving are unrelated
  to this specific symptom.

## Candidate fixes

| Fix | Summary | Invasiveness | Risk | Effort |
| --- | --- | --- | --- | --- |
| F1: Handle SSE error frames in all `/api/chat` consumers | Detect `data: {"error":...,"message":...}` before the empty `content/reasoning` guard, route it to the normal error UI, and never write error text into the left draft. | Low | Low; touches client SSE parsing only. | Low |
| F2: Rebuild/package desktop from the source that contains F1 | Ensure the installed `resources/frontend` bundle includes the fixed consumer code. | Low | Medium; packaging may pick stale `win-unpacked` resources if not cleaned. | Low |
| F3: Validate configured model keys at save/assignment time | Make model settings reject or clearly mark invalid credentials before users reach generation. Keep runtime 401 handling as defense in depth. | Medium | Medium; touches model settings UX/API and provider-specific test paths. | Medium |

## Recommended fix

Apply F1 and F2 as the immediate bug fix: every `/api/chat` SSE consumer must
treat `{ error, message }` as a terminal failure before applying the empty
chunk guard, then rebuild the packaged desktop app from that source. This
directly fixes the misleading `妯″瀷鏈繑鍥炰换浣曞唴瀹癸紝璇烽噸璇昤 symptom with the smallest
code surface.

F3 should follow as hardening. It will not make an invalid key generate
narration, but it prevents users from saving a configuration that only fails at
generation time. The product should still show a clear runtime error if the key
is later revoked or expires.

No code-only fix can make a `401 invalid_api_key` response produce narration
content. A valid model credential is required for actual generation.

## 璇勫缁撹

Final recommended fix: repair the packaged desktop CHAT model credential path,
not the streaming parser. The next implementation step should make model
settings reject or refuse to assign a provider unless
`model_settings_service.test_connection()` succeeds with the same
`api_url`/`api_key`/`model_name` that `/api/model-settings/resolve/chat` will
return, and the installed/userData configuration must be updated to a valid
DashScope key. The already-present SSE error-frame handling is still required
as defense in depth, but by itself it only changes the message from the generic
empty-result fallback to an actionable 401 failure; it cannot generate
narration from a provider response of `invalid_api_key`.

Justification:

- The failing packaged logs prove `/api/chat` reaches DashScope and receives
  provider `401 invalid_api_key`; this is not an empty model completion.
- The executed credential source can be either backend database assignment or
  desktop env fallback. Both currently accept real-looking invalid keys until a
  live generation call fails.
- Current source, and the inspected local packaged frontend bundle, already
  contain the minimal SSE error-frame consumer fix. Rebuilding is necessary
  only for packages that do not contain that code; it is not sufficient to make
  generation succeed while the resolved key remains invalid.
- Runtime handling must remain explicit for revoked/expired keys, but the
  minimum product fix that prevents this recurring is to validate and block
  bad CHAT credentials at save/assignment time and require a valid credential
  for actual narration generation.
