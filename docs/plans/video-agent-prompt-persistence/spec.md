# Video Editing Agent — System Prompt Persistence Across Turns (Spec v2)

> **Feature slug:** `video-agent-prompt-persistence`
> **Author:** Subtask #0 (方案设计) — solution architect
> **Reviewer:** Subtask #1 (评审与修复) — senior reviewer
> **Status:** v2 — review notes appended near the top, P0/P1 issues resolved inline
> **Companion subtasks:** #1 评审与修复 ✅ → #2 代码开发 → #3 Review 与提交

---

## 评审记录 (Review Notes)

> Review pass executed by Subtask #1 against `src/lib/video-editing-agent/**`, `src/types/index.ts`, `src/app/api/video-editing-chat/route.ts`, and `package.json`. Severity legend: **P0** = blocker / wrong-by-construction · **P1** = must fix before implementation · **P2** = advisory, document only.

### P0 — none

The design correctly identifies the bug, scopes the fix to the Next.js / shared-lib surface, and respects the existing convention that Next.js routes rebuild the system prompt every turn. No structural blockers.

### P1 — fixed in v2

1. **`AgentToolCallRecord.status` enum was documented incorrectly.** §5.1 originally listed `'running' | 'success' | 'error' | 'undone'` but the real type in `src/types/index.ts:90` is `'executing' | 'completed' | 'error' | 'undone'`. Left unfixed, the implementer would have written `status === 'success'` checks that never match, silently dropping every `explore_tools` call from the appendix. Fixed inline in §5.1, and the filter rule in §2.7 is rewritten in terms of the real enum.

2. **Token-budget unit test relied on a whitespace-split word count.** §6.1 originally proposed a `words × 1.3` heuristic; this under-counts Chinese (which has no whitespace) by an order of magnitude, so the budget assertion would always pass even when the prompt blew past the 3500-token ceiling. Replaced with the same char-based formula already used in §7 R8 (`prompt.length < 14000` chars as the hard ceiling) so the test actually fires on regressions.

3. **`coreToolkitOverride` escape hatch in §2.7 was not in the public interface.** The data-flow snippet introduced a `coreToolkitOverride?` parameter, but §4.1 `BuildSystemPromptInput` did not list it. Either drop or expose. We chose **drop** — tests can construct a stub `ToolRegistry` (already needed for `formatCoreToolkit`), so the extra field was dead surface. §2.7 and §4.1 are now consistent.

4. **R3 mitigation said "throws if a name is not registered".** Throwing inside `createVideoEditingAgent` aborts the API route and 500s the user request. The mitigation now downgrades the registry-drift check to a `console.warn` plus a "tool unavailable" stub line in the prompt; the unit test asserts the warning is logged. Hard build-time check stays out of the request path.

5. **Generic-chat path test coverage missing.** §3 row 9 introduces `buildEditingChatSystemPrompt` but §6.1 had no test for it. Added a smoke test (asserts the new prompt covers the six listed responsibilities and is non-empty).

6. **`scanExploredCategories` did not address `'undone'` status.** The user can undo an agent turn that included `explore_tools`; replaying that category in the appendix would resurrect guidance the user explicitly rolled back. §2.7 / §6.1 now exclude `status === 'undone'` in addition to `'error'`. Added to the unit-test list.

7. **`CategoryId` export path.** `historyScan.ts` needs to import `CategoryId` and `ON_DEMAND_CATEGORY_IDS`. The current `registry/index.ts` re-exports both, but the spec's §3 was silent on this — added a confirming note in §3 row 3 so the implementer doesn't accidentally redefine the type.

### P2 — advisory, captured but not blocking

- §2.6 quoted the existing `/api/video-editing-chat` system prompt as "100-token"; reading the route shows it's closer to 150 tokens. Doesn't affect the fix; advisory only.
- The `Token budget: < 600 tokens` JSDoc on `buildSystemPrompt` will become stale once Layer A lands. Implementer should bump the comment to ≤ 3500 tokens in the same commit (added to §3 row 1 as a sub-bullet).
- §6.1 snapshot-test assertions use `toContain` per R9 — keep that discipline. Do not introduce full-string snapshots for a 3500-token output.
- §4.1 lists `formatToolOverview` under "existing helpers stay exported" but §3 row 1 also modifies its body to drop the redundant on-demand index. Both are true; clarified the export is unchanged but the body is updated.
- R7 (provider ignores system prompt) is correctly out of scope for v1, but a follow-up should add a guard rail for any future open-source provider added to `resolveModelFormat` in `agent.ts`. Captured in §8.

---

## 1. Overview

### 1.1 What we are building

The Video Editing tab's left-side AI Agent panel today works correctly **only on the user's very first turn**. On the first turn the agent is guided by a rich system prompt (`buildSystemPrompt` in `src/lib/video-editing-agent/systemPrompt.ts`) that explains the always-available tools, the on-demand category list, the workflow recipes (script → TTS → search → assemble), and the hard timeline constraints. The agent calls `explore_tools(category)` on demand to receive the **detailed parameter schemas** of advanced tools (search_video, generate_video_script, generate_tts, generate_storyboard …) which are then returned as a single `toolResult` message. With those schemas freshly visible in context, the LLM completes the task.

On the **second and subsequent turns**, the user observes that the agent behaves as if it has forgotten how the tools work — it skips `explore_tools`, fabricates parameters, calls `add_to_track` with `default-video-*` placeholder IDs, or refuses to execute the obvious workflow it had just executed minutes earlier. The proximate cause is that the detailed tool schemas live only inside earlier `toolResult` messages: by turn 2 they are buried deep in history, the model's attention discounts them, and certain providers (Kimi via `anthropic-messages`, non-streaming completions) effectively lose them after a single `message_end`. The L0 system prompt itself remains, but the L0 prompt deliberately omits per-tool schemas (see code comment "Token budget: < 600 tokens"), so without the buried `explore_tools` result the LLM is operating on a category index instead of an instruction sheet.

This feature makes the agent's tool-and-workflow guidance **turn-independent**: every LLM round trip — first, second, tenth — must see, inside the system prompt itself, the same comprehensive instructions about which tools exist, how to call them, and how to plan a video-editing workflow. The current "lazy `explore_tools`" pattern is replaced with a "system-prompt-resident" pattern, with `explore_tools` retained as a thin fallback for genuinely rare tools. The same fix is applied to the simpler `/api/video-editing-chat` path, which today re-builds an even shorter system prompt and discards prior conversation entirely.

### 1.2 Why

* **Bug fix.** This is the headline complaint in the original task: "第二次问答的时候它就仿佛忘了工具该怎么使用". Production users hit this every time they have a multi-step conversation with the editing agent, which is the dominant interaction pattern.
* **Provider robustness.** The agent must work across OpenAI completions, Anthropic Messages (Claude / Kimi-coding), and Volcano-style endpoints. Some of these are non-streaming and some normalise tool messages differently. Putting the load-bearing context in `system` instead of trusting that prior `toolResult` blocks survive the round trip removes a whole class of provider drift.
* **Determinism for the constraint engine.** The hard constraints (video-track-must-be-longest, no overlap, anti-fabrication of material IDs) currently live in the L0 prompt and are turn-stable. The tool-usage and workflow guidance — which is *the same kind of load-bearing rule* — should live alongside them, not be lazily revealed.
* **No backend changes required.** Both routes (`/api/video-editing-agent/chat` and `/api/video-editing-chat`) are stateless Next.js handlers that build the prompt on every request. We can land the fix entirely on the Next.js / shared-lib side.

### 1.3 Non-goals

* Persisting agent state across page reloads (already handled — `useAgentExecution` rehydrates `messages` from the conversation store).
* Replacing pi-agent-core or migrating off the `explore_tools` meta tool. The tool stays; we just stop *requiring* it for the common workflow.
* Server-side conversation summarisation / LLM-based memory compaction. Out of scope.
* Backend `chat_router.py` / `chat_service.py` cleanup. Those remain as-is; only the Next.js proxy route is touched. (See §7 R6.)

---

## 2. Technical Design

### 2.1 Current call graph (as-is)

```
Frontend                                Next.js Route                           pi-agent-core / LLM
─────────                              ──────────────                            ───────────────────
useAgentExecution.sendAgentMessage  ──> POST /api/video-editing-agent/chat  ──> createVideoEditingAgent
  body: { messages: full history,                                                  systemPrompt = buildSystemPrompt(...)  ← rebuilt every turn ✅
          timelineState, materials,       performThinkingPhase()                  messages     = convertToAgentMessages(history)  ← excludes 'system' ✅
          sessionToken }                  createVideoEditingAgent(...)            tools        = buildAllAgentTools(registry)     ← all categories registered ✅
                                          subscribeAgentEvents(...)               agent.prompt(lastUser)
                                          agent.prompt(lastUserMessage)
```

The L0 system prompt currently produced by `buildSystemPrompt`:

1. Role (1 sentence)
2. Rules (anti-fabrication of material IDs, 5-failure circuit breaker, BGM volume)
3. **Tool directory** — 10 always-available tools listed by `name + 1-line desc`, then 6 on-demand categories listed by `id + 1-line description`. **No parameter schemas.**
4. Project status (Tracks: …, Duration: …, Materials: …)
5. Operation guide ("call explore_tools first then use the tool")
6. Script-and-narration workflow (4 steps, plus 3 hard rules)
7. Smart result handling (add to timeline vs library only)
8. Hard constraints (video track longest, no overlap, reflect-and-fix loop)

### 2.2 Failure mode walk-through (the bug)

Turn 1 — user: "做一个 30 秒的猫咪科普分镜视频":

1. Agent reads L0 prompt, sees `storyboard_tools` listed → calls `explore_tools({category: "storyboard_tools"})`.
2. `formatExploreToolsResult` returns ~2 KB of detailed schema (`generate_storyboard(script, …)`, `describe_storyboard`, `compose_storyboard`, …) inside a `toolResult` message.
3. Agent calls `generate_video_script` (also explored as `script_tools`), receives `narration_text`, then `generate_storyboard(script=…)`, then `batch_storyboard_video`, then `compose_storyboard`. ✅

Turn 2 — user: "再做一个 60 秒的版本":

1. Frontend posts the **entire** prior history. `convertToAgentMessages` faithfully reconstructs `assistant` + `toolResult` blocks.
2. Agent re-creates with a fresh L0 prompt. The 2 KB `explore_tools` payload from turn 1 is in the `messages[]` array but is now message #4 of ~12.
3. Some providers truncate; others underweight prior `toolResult` content because it doesn't match the user's *new* topic. The model's plan is built on the L0 prompt alone.
4. The L0 prompt does NOT contain `generate_storyboard`'s parameter shape. The model "remembers" the tool exists and calls it with wrong arguments — or skips planning entirely and starts dropping `add_to_track` calls with fabricated `materialId`s, which trips the 5-failure circuit breaker. ❌

This matches the user's report exactly.

### 2.3 New design — "Self-contained system prompt"

The fix has three layers, applied in order of permanence:

**Layer A — Static workflow toolkit baked into the system prompt.** The set of tools that drive 95% of editing sessions (`search_video`, `search_image`, `search_audio`, `generate_ai_image`, `generate_ai_video`, `image_to_video`, `generate_tts`, `batch_generate_tts`, `generate_video_script`, `expand_video_script`, `generate_storyboard`, `describe_storyboard`, `batch_storyboard_video`, `compose_storyboard`, `add_external_material`) becomes part of the L0 prompt by default — name, one-paragraph description, parameter signature line, and a usage hint. We stop relying on the LLM to discover them via `explore_tools`. Source of truth is `ToolRegistry`, so the prompt stays in sync as tools are added/renamed.

**Layer B — Dynamic recall of explored categories.** For any rare/experimental category the user *did* drill into via `explore_tools` in an earlier turn, we re-inject that category's `formatExploreToolsResult` block into **the system prompt** of every subsequent turn (not just into history). Detection is purely structural: scan `conversationHistory` for assistant messages whose `agentToolCalls` array contains a tool call whose `name === 'explore_tools'`, take the union of `params.category` values, dedupe, and emit each one's expanded block.

**Layer C — Always-on workflow recipes.** The "Script-and-narration workflow", "Storyboard workflow", and "Search-and-assemble workflow" sections are promoted from "operation guide" hints to a dedicated `## 工作流配方 (Workflow Recipes)` block, each recipe written as an explicit ordered list of tool calls with parameter examples. This is the section the LLM should consult on every turn; today it has to recover it by reading prior assistant messages.

### 2.4 Updated system-prompt structure

Order is significant — earlier sections weigh more across providers:

```
1. Role and stance                                       (~50 tokens)
2. Hard rules (anti-fabrication, failure-stop, BGM)      (~120 tokens)
3. Always-available tools (10 baseline tools)            (~250 tokens)
4. CORE WORKFLOW TOOLKIT  ← NEW (Layer A)                (~900 tokens)
   - search_video / search_image / search_audio
   - generate_ai_image / generate_ai_video / image_to_video
   - generate_tts / batch_generate_tts (+voice list)
   - generate_video_script / expand_video_script
   - generate_storyboard / describe_storyboard /
     batch_storyboard_video / compose_storyboard
5. Project status                                        (~80 tokens)
6. Workflow recipes (Layer C, expanded)                  (~400 tokens)
7. Smart result handling                                 (~80 tokens)
8. Hard constraints (video-track-longest, no overlap)    (~250 tokens)
9. Previously explored advanced categories (Layer B)     (variable, ≤ 800 tokens)
```

Total target ceiling: **≤ 3500 tokens** for the new L0 prompt (vs ~600 today). This is well within all supported model context windows (128k+) and avoids cache-busting because:

* Sections 1–8 are deterministic given `(timelineState, materials, categorySummaries)`. Same inputs → same prompt → cache hit.
* Section 9 is the only variable suffix and is appended last so the prefix stays stable.

### 2.5 Conversation-history compaction (non-blocking optimisation)

Even with the system prompt fully self-contained, the on-the-wire history can be made cheaper by compressing prior `explore_tools` `toolResult` payloads down to a 1-line stub now that their content is duplicated in the prompt. This is **optional** for v1 — we will only add the stub if profiling shows token bloat — and is gated behind a feature flag. The implementation hook lives in `convertToAgentMessages` and is described in §3 / §6.

### 2.6 Generic-chat path (`/api/video-editing-chat`)

Today this route's `formatMessages` injects a 100-token system prompt and forwards the *raw* `messages[]` from the client. There is no equivalent of the agent's tool flow — this endpoint is plain Q&A — but the same "every-turn" principle applies: the system prompt should be rich enough for the model to give consistent guidance regardless of how deep into the conversation the user is. We replace the inline literal with a new shared module `buildEditingChatSystemPrompt()` that produces a stable, expanded prompt (covering script writing, edit suggestions, timeline planning, material recommendations, common pitfalls), and we keep the rest of `formatMessages` unchanged.

### 2.7 Data flow with the fix

```
sendAgentMessage(text)
   └─> POST /api/video-editing-agent/chat
         └─> createVideoEditingAgent({ ..., conversationHistory })
               ├── exploredCategories = scanExploredCategories(conversationHistory)   // new
               ├── systemPrompt = buildSystemPrompt({                                  // expanded
               │      timelineState, materials,
               │      registry,                       // <- now passes registry, not just summaries
               │      exploredCategories,             // <- new
               │   })
               ├── initialMessages = convertToAgentMessages(history)
               └── new Agent({ systemPrompt, messages: initialMessages, tools, ... })
```

`scanExploredCategories(history: ChatMessage[]): CategoryId[]` is a pure function defined alongside the converter. It walks every assistant message, filters `agentToolCalls` where `name === 'explore_tools'` AND `status === 'completed'` (the only positive-success state in the real `AgentToolCallRecord.status` enum — see §5.1 for the full enum), extracts `params.category`, validates against `ON_DEMAND_CATEGORY_IDS`, and returns the dedup'd ordered list. Calls with status `'executing'`, `'error'`, or `'undone'` are excluded — `'undone'` is excluded so we don't resurrect guidance the user explicitly rolled back; `'executing'` is excluded because the result hasn't materialised yet (and likely won't for a turn that's already in history).

`buildSystemPrompt` is changed in two ways: signature widens to take a `ToolRegistry` (so it can pull schemas) plus an `exploredCategories` array; body adds Layer A and Layer B sections. Existing callers in tests are updated. There is **no** `coreToolkitOverride` parameter — tests inject a stub `ToolRegistry` instead, which keeps the public surface tight.

### 2.8 Observability

* Every agent invocation logs the system-prompt token estimate at `[VideoEditingAgent] systemPrompt tokens≈XXXX exploredCategories=[…]` (info level). This makes it trivial to confirm the fix is active and to spot regressions where the prompt shrinks back to the old size.
* A debug flag `VIDEO_AGENT_PROMPT_DEBUG=1` (read once at module load) dumps the full final prompt to stdout. Off by default in prod.

---

## 3. File / Module Change Plan

| # | File (relative to repo root) | Action | One-line intent |
|---|------------------------------|--------|------------------|
| 1 | `src/lib/video-editing-agent/systemPrompt.ts` | **modify** | Widen `buildSystemPrompt` signature; add `formatCoreToolkit`, `formatWorkflowRecipes`, `formatExploredCategoriesAppendix`; update `formatToolOverview` body (export unchanged) to drop the redundant on-demand index when Layer A covers it. **Also:** bump the `Token budget: < 600 tokens` JSDoc on `buildSystemPrompt` to `≤ 3500 tokens` so the comment doesn't lie about the new ceiling. |
| 2 | `src/lib/video-editing-agent/promptParts.ts` | **create** | New module hosting the static blobs: `CORE_TOOLKIT_TOOL_NAMES`, `WORKFLOW_RECIPES_MD`, voice-type table (lifted from `exploreTools.ts`'s usage hints), and per-category usage-hint strings. Single source of truth so `exploreTools.ts` can re-import them instead of duplicating literals. |
| 3 | `src/lib/video-editing-agent/historyScan.ts` | **create** | Export `scanExploredCategories(messages: ChatMessage[]): CategoryId[]` plus `extractAgentToolCalls(msg)` helper. Pure functions, no side effects. **Note:** `CategoryId` and `ON_DEMAND_CATEGORY_IDS` are already re-exported by `registry/index.ts` (see `tools/exploreTools.ts:3` for the canonical import). Do not redefine them. |
| 4 | `src/lib/video-editing-agent/agent.ts` | **modify** | Lines 78–95: call `scanExploredCategories(config.conversationHistory)`, pass `registry` and `exploredCategories` into the new `buildSystemPrompt` call. Add the `console.log` token estimate from §2.8. No other behavioural changes. |
| 5 | `src/lib/video-editing-agent/messageConverter.ts` | **modify (small)** | Optional: add `compactExploreToolsResults: boolean` param (default `false`, off in v1) that replaces large prior `explore_tools` tool-result content with a 1-line stub. Wired but unused until profiling demands it. Keeps the door open without committing to compaction now. |
| 6 | `src/lib/video-editing-agent/tools/exploreTools.ts` | **modify** | Re-import `WORKFLOW_RECIPES_MD` and the per-category usage-hint strings from `promptParts.ts` to avoid drift. No change to public behaviour. |
| 7 | `src/lib/video-editing-agent/types.ts` | **modify (small)** | Extend `VideoEditingAgentConfig` doc to note `conversationHistory` now drives both message replay *and* the explored-categories appendix. No breaking type changes. |
| 8 | `src/app/api/video-editing-agent/chat/route.ts` | **no change** | Already passes `messages` through. The fix is fully internal to `createVideoEditingAgent`. |
| 9 | `src/lib/video-editing-chat/buildEditingChatSystemPrompt.ts` | **create** | Export `buildEditingChatSystemPrompt(): string` returning the new expanded generic-chat system prompt described in §2.6. |
| 10 | `src/app/api/video-editing-chat/route.ts` | **modify** | Replace the inline `systemMessage.content` literal in `formatMessages` (lines 95–106) with a call to `buildEditingChatSystemPrompt()`. Forward existing `messages` array unchanged. |
| 11 | `src/lib/video-editing-agent/__tests__/systemPrompt.test.ts` | **create** | Snapshot tests: empty timeline + no explored cats; populated timeline + 2 explored cats; verify Layer A / B / C present; verify token-estimate within ceiling. |
| 12 | `src/lib/video-editing-agent/__tests__/historyScan.test.ts` | **create** | Tests for `scanExploredCategories`: no agent messages, 1 explore call, multiple, errored explore call (excluded), unknown category (excluded). |
| 13 | `src/lib/video-editing-agent/__tests__/agent.test.ts` | **modify** if exists / **create** if not | Integration test: build a 3-turn `ChatMessage[]` with a turn-1 `explore_tools(storyboard_tools)`; create the agent; assert the agent's `initialState.systemPrompt` contains the storyboard category's expanded block. |
| 14 | `docs/plans/video-agent-prompt-persistence/spec.md` | **this file** | The design itself. |

> **Excluded on purpose:** backend `chat_router.py`, `chat_service.py`, frontend chat UI components (`AIAssistantPanel.tsx`, `useAIAssistant.ts`), pi-agent-core, model-settings resolver. None of them is on the failure path; touching them would be scope creep.

---

## 4. Interface Design

### 4.1 Internal TypeScript surface

```ts
// src/lib/video-editing-agent/systemPrompt.ts (modified)

export interface BuildSystemPromptInput {
  timelineState: TimelineState;
  materials: MaterialItem[];
  registry: ToolRegistry;                  // NEW — replaces categorySummaries
  exploredCategories: CategoryId[];        // NEW — from scanExploredCategories
}

export function buildSystemPrompt(input: BuildSystemPromptInput): string;

// Existing helpers stay exported (signature unchanged; used by tests + back-compat).
// NOTE: body is updated per §3 row 1 to drop the redundant on-demand index when Layer A
// already covers those tools — this is an internal change, not a breaking interface change.
export function formatToolOverview(summaries: CategorySummary[]): string;
export function formatExploreToolsResult(
  categoryName: string, categoryId: string,
  tools: ToolInfo[], usageHints: string,
): string;
export function formatCompactSummary(
  state: TimelineState, materials: MaterialItem[],
): string;

// NEW helpers:
export function formatCoreToolkit(registry: ToolRegistry): string;
export function formatWorkflowRecipes(): string;
export function formatExploredCategoriesAppendix(
  registry: ToolRegistry, exploredCategories: CategoryId[],
): string;
```

```ts
// src/lib/video-editing-agent/historyScan.ts (new)

export function scanExploredCategories(messages: ChatMessage[]): CategoryId[];
export function extractAgentToolCalls(message: ChatMessage): AgentToolCallRecord[];
```

```ts
// src/lib/video-editing-chat/buildEditingChatSystemPrompt.ts (new)

export function buildEditingChatSystemPrompt(): string;
```

### 4.2 Backwards compatibility

`buildSystemPrompt` changes signature from positional `(timelineState, materials, categorySummaries)` to single `BuildSystemPromptInput` object. Only one caller exists in the codebase (`agent.ts` line 85) — it is updated in the same commit. Tests covered in §3 row 11. **No public API leaves the repo**, so this is a safe internal refactor.

### 4.3 No HTTP / WebSocket changes

`/api/video-editing-agent/chat` request body shape (`AgentChatRequest`) is unchanged. SSE event shape (`SSEEvent`) is unchanged. `/api/video-editing-chat` request and response are unchanged.

### 4.4 No CLI changes

This feature does not introduce or alter any CLI/script entrypoint.

---

## 5. Data Model

**No database migration is required.** This feature changes only in-memory shapes inside the Next.js process.

### 5.1 In-memory shapes

The reused types come from `@/types`:

```ts
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  isAgentMessage?: boolean;
  agentToolCalls?: AgentToolCallRecord[];   // <- the field we walk
  pendingOperations?: AgentTimelineOperation[];
  timelineSnapshot?: TimelineState;
  // ... other UI-only fields
}

interface AgentToolCallRecord {
  id: string;
  name: string;                              // <- 'explore_tools' is what we filter on
  params: Record<string, unknown>;           // <- params.category is what we read
  status: 'executing' | 'completed' | 'error' | 'undone';   // canonical, see src/types/index.ts:90
  result?: unknown;
}

type CategoryId =
  | 'query_tools' | 'editing_tools'
  | 'search_tools' | 'ai_gen_tools' | 'tts_tools'
  | 'script_tools' | 'storyboard_tools' | 'material_tools';
```

### 5.2 Persistence

Agent conversation messages are already persisted by the existing project / conversation store (see `useAgentExecution`'s `updateConversationMessages`). The explored-categories list is derived on every turn from that same persisted history — there is **no new persisted state**.

---

## 6. Testing & Acceptance Criteria

### 6.1 Unit tests

* `historyScan.test.ts`
  * empty messages → `[]`
  * messages with no `agentToolCalls` → `[]`
  * messages with one completed `explore_tools(storyboard_tools)` call → `['storyboard_tools']`
  * messages with `explore_tools` calls in 3 different turns covering 2 unique categories → ordered, deduped 2-element list
  * `explore_tools` call with `status === 'error'` → excluded
  * `explore_tools` call with `status === 'undone'` → excluded (user rolled the turn back; we shouldn't replay its category)
  * `explore_tools` call with `status === 'executing'` → excluded (still in flight; no tool result yet)
  * `explore_tools` call with `params.category` not in `ON_DEMAND_CATEGORY_IDS` → excluded (defensive)

* `systemPrompt.test.ts`
  * Snapshot 1 — fresh project, no explored categories: prompt contains "## 始终可用的工具", "## 核心工作流工具", "## 工作流配方", "## 强制约束", does NOT contain "## 已加载的高级工具".
  * Snapshot 2 — same project, `exploredCategories: ['storyboard_tools', 'tts_tools']`: prompt also contains "## 已加载的高级工具" with both `generate_storyboard` and `generate_tts` parameter signatures.
  * **Length ceiling** — `expect(prompt.length).toBeLessThan(14000)` for both snapshots. This is the char-based floor agreed in §7 R8: 14000 chars ≈ 3500 tokens worst-case for mixed Chinese/English. We deliberately do *not* use a whitespace-split word count, because Chinese has no whitespace and would always pass.
  * Registry-drift behaviour — call `formatCoreToolkit` with a stub registry that's missing one tool listed in `CORE_TOOLKIT_TOOL_NAMES`; assert `console.warn` is called once and the prompt contains a clear "tool unavailable" stub line for that name. **Does not throw.**

* `agent.test.ts` (integration)
  * Build a fixture of 3 `ChatMessage`s including a turn-1 `explore_tools(script_tools)` call with `status: 'completed'`.
  * Call `createVideoEditingAgent({ ..., conversationHistory: fixture })`.
  * Assert `agent.initialState.systemPrompt.includes('generate_video_script')` AND `... .includes('expand_video_script')`.

* `buildEditingChatSystemPrompt.test.ts` (smoke)
  * Output is non-empty.
  * Contains the six responsibilities listed in §2.6 (script writing, edit suggestions, timeline planning, material recommendations, technical Q&A, copy polish — assert by Chinese substring match for each).
  * Length under 4000 chars (this prompt is plain Q&A, not the agent's system prompt — its budget is much smaller).

### 6.2 Manual acceptance scenario (the bug repro)

Steps:
1. Start the stack (`bash start.sh --dev`), open Video Editing tab, create a fresh project.
2. Turn 1 — type: "做一个 30 秒的猫咪科普分镜视频". Verify the agent calls `explore_tools` then `generate_video_script` → `generate_storyboard` → `compose_storyboard` and the timeline gets populated.
3. Turn 2 — without reloading, type: "再做一个 60 秒的版本". **Expected:** the agent immediately calls `generate_video_script(duration_target: 60)` followed by `generate_storyboard` — no fabricated material IDs, no "I don't know how to use this tool" responses, no 5-failure circuit-breaker abort.
4. Turn 3 — type: "把背景音乐加上 10% 音量". **Expected:** agent calls `search_audio` then `add_to_track` with the BGM at the agreed-upon low volume.
5. Repeat scenarios with both an OpenAI-completions model and an Anthropic-Messages model (Claude / Kimi-coding) via the model-settings resolver — both must succeed.

### 6.3 Acceptance criteria (Definition of Done for the *implementation* subtask)

* `npm run type-check` passes.
* `npm run lint` shows no new warnings/errors.
* Vitest unit tests in §6.1 pass.
* Manual scenario §6.2 passes against a dev-mode stack.
* The agent's first-turn behaviour is unchanged for tasks that previously worked.
* `[VideoEditingAgent] systemPrompt tokens≈…` log line appears on every agent invocation.
* No new entries in `git status` outside the file list in §3.

### 6.4 Regression checklist

* `explore_tools` tool itself still works when the LLM chooses to call it (Layer A is additive — not a removal). Verified by retaining the existing `exploreTools.ts` and adding a unit test that the tool's `execute()` still returns the formatted text.
* Long conversations (≥ 20 messages, several explored categories) build a prompt under the 3500 token ceiling. Add a length assertion in the agent test to fail loudly if a future contributor balloons the prompt.

---

## 7. Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | **Prompt grows past the per-provider safe ceiling**, especially when many categories have been explored. | Medium | High (rate limits, latency, cost) | Hard ceiling 3500 tokens enforced by unit test (§6.3). `formatExploredCategoriesAppendix` truncates the per-category block at the documented size and de-duplicates. Tools with very long parameter schemas (e.g. `generate_storyboard`) get a "see explore_tools for the full schema" tail when their formatted block exceeds 600 tokens. |
| R2 | **Cache invalidation churn.** Anthropic prompt cache keys on prompt prefix; if the system prompt changes per turn, cache hit rate drops. | Medium | Medium (cost) | The variable suffix (Layer B) is appended *last*. Sections 1–8 are byte-identical for the same `(timelineState, materials)` snapshot, so the Anthropic cache prefix lands consistently. Confirmed by inspecting Anthropic SDK behaviour (cacheControl on the last cached block). |
| R3 | **Drift between `promptParts.ts` and the actual tool registry** (a tool gets renamed, the prompt still references the old name). | Medium | Medium (LLM hallucinates the old name) | `formatCoreToolkit(registry)` reads tool names directly off the registry instead of hard-coding them. The static piece is the *list of tool names to expose* (`CORE_TOOLKIT_TOOL_NAMES: readonly string[]`); descriptions come from `tool.description`. **Drift detection is non-fatal:** if a name in `CORE_TOOLKIT_TOOL_NAMES` is not registered, `formatCoreToolkit` emits a single `console.warn('[VideoEditingAgent] core toolkit name "X" not found in registry; falling back to one-line stub.')` and writes a "(currently unavailable)" stub line in place of that tool's block. Throwing inside `createVideoEditingAgent` would crash the API route and 500 the user request, which is worse than a degraded prompt. The unit test in §6.1 asserts the warn-and-stub behaviour. |
| R4 | **Behavioural regression** for tasks that previously worked. The expanded prompt could over-prescribe and make the agent rigid. | Low | High | Manual §6.2 scenario covers the canonical first-turn paths. Workflow recipes are written as "when X, prefer Y" not "you MUST always Y", preserving model judgement. Observability log gives us a quick rollback signal (token count + circuit-breaker rate). |
| R5 | **`scanExploredCategories` mis-attribution**, e.g. picks up a `tool_calls` block that wasn't actually `explore_tools`. | Low | Low | Strict filter (exact name match `=== 'explore_tools'`, valid `params.category` ∈ `ON_DEMAND_CATEGORY_IDS`, `status !== 'error'`). Unit-tested in §6.1. |
| R6 | **Backend `/video-editing-chat` route** still rebuilds its own short prompt and is reachable independently from the same Next.js page. | Low | Low | Out of scope — backend `chat_router.py` is *not* called from the agent panel; it backs a different chat surface (the doc-content side panel `useAIAssistant`). The frontend-side `/api/video-editing-chat` route is the only one we touch (file #10). Documented here so the v2 reviewer doesn't re-open scope. |
| R7 | **Provider that ignores system prompt** (some open-source models). | Low | Medium | Workflow recipes are duplicated in the first user-message turn's preamble *only when the agent detects an unsupported provider*. Out of scope for v1; tracked as a follow-up. The LLMs Ecliptrix officially supports (OpenAI, Anthropic, Kimi-coding) all honour `system`. |
| R8 | **Token-estimate logging miscounts** for non-Latin scripts (Chinese tokens are denser than the word-count heuristic). | Low | Low | Replace the heuristic with `text.length / 2` for the warning threshold (Chinese-aware), document that this is a *floor* not a tight estimate. The hard ceiling is enforced as `text.length < 14000` characters (≈ 3500 tokens worst case). |
| R9 | **Test fragility** — snapshot tests over a 3500-token string break on every prompt tweak. | Medium | Low | Don't snapshot the full string. Use `expect(prompt).toContain(...)` for structural assertions plus a single "must be under N chars" length assertion. Listed in §6.1. |
| R10 | **`compactExploreToolsResults` flag accidentally enabled** breaks history replay. | Low | Medium | Default `false` everywhere; no caller turns it on in v1. The flag is a placeholder for a follow-up; v1 reviewers should not gate on it. Marked as `@beta` in the JSDoc. |

---

## 8. Out-of-band notes for the v2 reviewer

* **Read order:** §2.2 explains the bug, §2.3–§2.4 the fix, §3 the file list, §6 the tests. Skim §7 last.
* **Subtask #1 should focus on:** (a) confirming the failure-mode walk-through matches what `pi-agent-core` does in practice for Anthropic-Messages providers (a 5-minute look at the SDK is enough), (b) right-sizing the 3500-token ceiling against the slowest supported model, (c) sanity-checking that `scanExploredCategories` isn't fooled by `agentToolCalls` whose `name` happens to equal a category id. Anything stronger than P1 should be fixed inline; P2 belongs in the advisory column.
* **What is intentionally not in v1:** server-side memory/summarisation, backend `chat_service.py` changes, removing `explore_tools` entirely, prompt-cache instrumentation. All of these are reasonable follow-ups but unrelated to the user-facing bug being fixed here.
* **Follow-up tracked from review:** when `agent.ts:resolveModelFormat` adds any provider known to drop the system prompt (the v1 supported set — OpenAI, Anthropic, Kimi-coding — all honour it), expand R7's "duplicate workflow recipes into the first user-message preamble" path. Not in scope for this implementation; flag it for the next agent-runtime owner.

---

## 实施过程发现的方案缺陷 (Issues Found During Implementation)

> 以下条目由 Subtask #2 在落地代码时记录。每条都说明了发现的偏差、为何选择当前修正路径，以及如有需要是否要在后续 subtask 重新评估。

1. **`add_external_material` 在仓库中不存在。** §2.3 / §3 row 1 / §4.1 多处把
   `add_external_material` 列在 Layer A 的 `CORE_TOOLKIT_TOOL_NAMES` 中，但
   `src/lib/video-editing-agent/tools/addMaterialToLibrary.ts` 注册时使用的实际工具名是
   `add_material_to_library`（见 line 46）。如按字面照搬，`formatCoreToolkit` 的 drift 检测
   会触发并写出一条 `(currently unavailable)` 占位行，反而让用户感觉素材入库工具不可用。
   实施时已改为 `add_material_to_library`，与 registry 真实名称对齐。
   建议后续如要统一命名，可在另一个独立 subtask 里把工具重命名为 `add_external_material`
   或在 spec 里改为当前真实名 — 不在本次范围内处理。

2. **Layer B 附录未做 per-block / 总量截断，3 个已探索类别会突破 14000 char 硬上限。**
   §2.4 / §7 R1 都说明了每类 ≤ 600 tokens、整体 ≤ 800 tokens 的目标，但仅描述为
   "tools with very long parameter schemas… get a 'see explore_tools for the full schema' tail"。
   实施过程中确认：3 个类别（script/storyboard/tts）合计 ≈ 9000+ chars，加上其它段后
   prompt 实测 ~18000 chars，超过 14000 上限。
   实施补丁：在 `formatExploredCategoriesAppendix` 内新增 `APPENDIX_BLOCK_CHAR_CEILING=2400`
   与 `APPENDIX_TOTAL_CHAR_CEILING=3200`，per-block 与总量任一超限即截断并加尾注引导
   `explore_tools` 重新加载。这与 §7 R1 提到的"see explore_tools for the full schema"
   尾注一致，未引入新的公共 API。

---

## 评审结论 (Review Verdict)

**有条件通过 (Approved with Conditions)**

The design is sound, the bug diagnosis matches the failing-mode walk-through I can verify against the source, and the file plan is right-sized — no source files outside `src/lib/video-editing-agent/**`, the `/api/video-editing-chat` route, and one new shared module. All P0 / P1 concerns from the Review Notes have been resolved inline in this v2 document. Implementation may proceed (Subtask #2) under the following conditions:

1. **Honour the corrected `AgentToolCallRecord.status` enum.** `scanExploredCategories` filters on `status === 'completed'` (not `'success'`), and excludes `'undone'` and `'executing'` per §2.7 / §6.1. Misreading this is the easiest way to ship a no-op fix.
2. **Char-based length ceiling, not word count.** The token-budget unit test must use `prompt.length < 14000`. Whitespace heuristics fail for Chinese and would let a regression past CI.
3. **Registry drift is non-fatal.** `formatCoreToolkit` warns and stubs; it does not throw. Verified by the §6.1 registry-drift unit test.
4. **No new public API.** `BuildSystemPromptInput` is the only signature change; no `coreToolkitOverride` field, no changes to `/api/video-editing-agent/chat` request body, no SSE event additions.
5. **JSDoc honesty.** Update the `Token budget: < 600 tokens` comment on `buildSystemPrompt` to `≤ 3500 tokens` in the same commit that lands Layer A — drift between a comment and reality is how the next reviewer gets misled.
6. **Smoke test for `buildEditingChatSystemPrompt`.** Required per §6.1, even if minimal.

If the implementation passes the unit + manual scenarios in §6 and a `[VideoEditingAgent] systemPrompt tokens≈…` log line is visible on every agent invocation, the fix is shippable.
