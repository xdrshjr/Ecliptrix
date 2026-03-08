# Video Editing Agent Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the agent engine layer that integrates pi-agent-core into Ecliptrix for video editing agent mode.

**Architecture:** The agent engine runs in a Next.js API Route. Each request creates a fresh Agent instance with 7 video editing tools. The Agent communicates with an OpenAI-compatible LLM and streams events back via SSE. Tools produce operation instructions that the frontend applies to the timeline.

**Tech Stack:** pi-agent-core (Agent, AgentTool), pi-ai (Model, Message types), @sinclair/typebox (tool parameter schemas), Next.js API Route (SSE streaming)

---

## Key API Findings (from actual pi-agent-core types)

- `AgentTool.execute` must return `AgentToolResult<T>` = `{ content: (TextContent | ImageContent)[], details: T }`
- `Agent` constructor takes `AgentOptions` with `initialState?: Partial<AgentState>`
- `AgentState` requires: `systemPrompt`, `model`, `thinkingLevel`, `tools`, `messages`
- `AgentEvent.message_update` carries `assistantMessageEvent` (text_delta has `.delta` field)
- `AgentEvent.tool_execution_start` has `toolCallId`, `toolName`, `args`
- `AgentEvent.tool_execution_end` has `toolCallId`, `toolName`, `result`, `isError`
- `Model<Api>` must be constructed manually for custom endpoints: `{ id, name, api: "openai-completions", provider: "openai", baseUrl, reasoning, input, cost, contextWindow, maxTokens }`
- `Agent.prompt(string)` is supported directly
- `convertToLlm` callback is needed to convert AgentMessage[] → Message[] for LLM calls
- pi-ai `UserMessage` = `{ role: "user", content: string, timestamp: number }`
- pi-ai `AssistantMessage` = `{ role: "assistant", content: (TextContent|ThinkingContent|ToolCall)[], ... }`
- pi-ai `ToolResultMessage` = `{ role: "toolResult", toolCallId, toolName, content, isError, timestamp }`

---

### Task 1: Type Definitions

**Files:**
- Create: `src/lib/video-editing-agent/types.ts`

**Step 1: Create the types file**

Define all types needed by the agent engine:
- `ToolContext` — shared context passed to all tools via closure
- `TimelineOperation` — discriminated union of all operation types
- `SSEEvent` — discriminated union of all SSE event types sent to frontend
- `AgentChatRequest` — request body shape for the API route
- `VideoEditingAgentConfig` — config passed to createVideoEditingAgent

Reference types from `@/types` (TimelineState, TimelineItem, Track, MaterialItem, ChatMessage).
Reference types from pi-agent-core (AgentTool, AgentToolResult) and pi-ai (TextContent, Model).

**Step 2: Commit**

```bash
git add src/lib/video-editing-agent/types.ts
git commit -m "[add] video editing agent type definitions"
```

---

### Task 2: System Prompt Builder

**Files:**
- Create: `src/lib/video-editing-agent/systemPrompt.ts`

**Step 1: Implement buildSystemPrompt and formatTimelineSummary**

- `formatTimelineSummary(timelineState: TimelineState)` → compact text summary of tracks/clips
- `buildSystemPrompt(timelineState: TimelineState)` → full system prompt with role, rules, and timeline summary

The system prompt should be in English per spec.

**Step 2: Commit**

```bash
git add src/lib/video-editing-agent/systemPrompt.ts
git commit -m "[add] video editing agent system prompt builder"
```

---

### Task 3: Message Converter

**Files:**
- Create: `src/lib/video-editing-agent/messageConverter.ts`

**Step 1: Implement convertToAgentMessages**

Convert `ChatMessage[]` (app format) → pi-ai `Message[]` for the Agent's `convertToLlm` callback.

Key mappings:
- `ChatMessage { role: 'user' }` → `UserMessage { role: "user", content: string, timestamp: number }`
- `ChatMessage { role: 'assistant', isAgentMessage: true, agentToolCalls }` → `AssistantMessage` with ToolCall content items + subsequent `ToolResultMessage` entries
- `ChatMessage { role: 'assistant' }` (normal) → `AssistantMessage { role: "assistant", content: [{ type: "text", text }], ... }`

**Step 2: Implement defaultConvertToLlm**

This is the `convertToLlm` function for the Agent constructor. It takes `AgentMessage[]` and filters/maps to `Message[]`. Since our agent messages ARE pi-ai Messages (UserMessage/AssistantMessage/ToolResultMessage), this simply filters out any non-standard messages.

**Step 3: Commit**

```bash
git add src/lib/video-editing-agent/messageConverter.ts
git commit -m "[add] video editing agent message format converter"
```

---

### Task 4: 7 Video Editing Tools

**Files:**
- Create: `src/lib/video-editing-agent/tools/index.ts`
- Create: `src/lib/video-editing-agent/tools/getTimeline.ts`
- Create: `src/lib/video-editing-agent/tools/searchMaterials.ts`
- Create: `src/lib/video-editing-agent/tools/addToTrack.ts`
- Create: `src/lib/video-editing-agent/tools/trimClip.ts`
- Create: `src/lib/video-editing-agent/tools/deleteClip.ts`
- Create: `src/lib/video-editing-agent/tools/moveClip.ts`
- Create: `src/lib/video-editing-agent/tools/resizeClip.ts`

**Step 1: Create helper functions in index.ts**

Implement shared helpers used by multiple tools:
- `findMaterial(materials, id)` → MaterialItem | undefined
- `findTrack(timelineState, id)` → Track | undefined
- `findClip(timelineState, clipId)` → { item: TimelineItem, trackId: string } | null
- `getDefaultTrackForType(type)` → string
- `getTrackEndTime(track)` → number
- `buildVideoEditingTools(context: ToolContext)` → AgentTool[]

**Step 2: Implement each tool**

Each tool file exports a `createXxxTool(context: ToolContext): AgentTool` function.

Key pattern for each tool (example: addToTrack):
```typescript
import { Type } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

export function createAddToTrackTool(context: ToolContext): AgentTool {
  return {
    name: "add_to_track",
    label: "Add to Track",
    description: "...",
    parameters: Type.Object({ ... }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      // validation + operation creation
      // context.updateTimeline(operation)
      return {
        content: [{ type: "text", text: "Added clip..." }],
        details: { success: true, clip: { ... } }
      };
    }
  };
}
```

Note: `AgentToolResult` requires both `content` (for LLM to read) and `details` (for app logic).

**Step 3: Commit**

```bash
git add src/lib/video-editing-agent/tools/
git commit -m "[add] 7 video editing agent tools"
```

---

### Task 5: Agent Factory

**Files:**
- Create: `src/lib/video-editing-agent/agent.ts`

**Step 1: Implement createVideoEditingAgent**

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";

function createVideoEditingAgent(config: VideoEditingAgentConfig): { agent: Agent, toolContext: ToolContext } {
  // 1. Construct Model manually for custom OpenAI endpoint
  const model: Model<"openai-completions"> = {
    id: config.llmModel,
    name: config.llmModel,
    api: "openai-completions",
    provider: "openai",
    baseUrl: config.llmApiUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };

  // 2. Create ToolContext with mutable timelineState
  const toolContext: ToolContext = { ... };

  // 3. Build tools
  const tools = buildVideoEditingTools(toolContext);

  // 4. Create Agent
  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(config.timelineState),
      model,
      thinkingLevel: "off",
      tools,
      messages: [],  // history injected via convertToLlm
    },
    convertToLlm: defaultConvertToLlm,
  });

  // 5. Inject conversation history as initial messages
  const historyMessages = convertToAgentMessages(config.conversationHistory);
  if (historyMessages.length > 0) {
    agent.replaceMessages(historyMessages);
  }

  return { agent, toolContext };
}
```

**Step 2: Implement applyOperationLocally**

Mutates the server-side timelineState copy so subsequent tools see consistent state.

**Step 3: Commit**

```bash
git add src/lib/video-editing-agent/agent.ts
git commit -m "[add] video editing agent factory with LLM model config"
```

---

### Task 6: SSE Event Handler

**Files:**
- Create: `src/lib/video-editing-agent/eventHandler.ts`

**Step 1: Implement streamAgentEvents**

Subscribe to Agent events and map them to SSE format:

```typescript
function streamAgentEvents(
  agent: Agent,
  toolContext: ToolContext,
  send: (data: SSEEvent) => void
) {
  agent.subscribe((event) => {
    switch (event.type) {
      case "message_update": {
        const evt = event.assistantMessageEvent;
        if (evt.type === "text_delta") {
          send({ type: "text_delta", content: evt.delta });
        }
        break;
      }
      case "tool_execution_start":
        send({ type: "tool_call", toolCallId: event.toolCallId, toolName: event.toolName, params: event.args });
        break;
      case "tool_execution_end": {
        const operation = toolContext.lastOperation;
        send({ type: "tool_result", toolCallId: event.toolCallId, toolName: event.toolName, result: event.result?.details ?? event.result, operation });
        toolContext.lastOperation = null;
        break;
      }
      // ... other events
    }
  });
}
```

Key insight: `event.result` from tool_execution_end is the `AgentToolResult`, so `event.result.details` contains our app-level result. The `operation` is tracked via `toolContext.lastOperation` set during tool execute.

**Step 2: Commit**

```bash
git add src/lib/video-editing-agent/eventHandler.ts
git commit -m "[add] agent event to SSE mapping handler"
```

---

### Task 7: API Route

**Files:**
- Create: `src/app/api/video-editing-agent/chat/route.ts`

**Step 1: Implement POST handler**

Follow the existing pattern from `src/app/api/chat/route.ts`:
- Parse request body (messages, timelineState, materials)
- Get LLM config (reuse getConfig pattern)
- Create ReadableStream with SSE headers
- Inside stream: create agent, subscribe to events, call agent.prompt()
- Timeout with Promise.race (120s)
- Error handling with SSE error events
- End with `data: [DONE]\n\n`

**Step 2: Commit**

```bash
git add src/app/api/video-editing-agent/chat/route.ts
git commit -m "[add] video editing agent chat API route with SSE streaming"
```

---

### Task 8: Extend ChatMessage Type

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Add agent-related fields to ChatMessage**

Add optional fields to the existing `ChatMessage` interface:
- `isAgentMessage?: boolean`
- `agentToolCalls?: AgentToolCallRecord[]`
- `timelineSnapshot?: TimelineState`
- `pendingOperations?: TimelineOperation[]`
- `isUndone?: boolean`

Also add the `AgentToolCallRecord` interface and `TimelineOperation` type (re-exported from agent types).

**Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "[update] extend ChatMessage with agent mode fields"
```

---

### Task 9: Verify Build

**Step 1: Run type check**

```bash
npm run type-check
```

Fix any TypeScript errors.

**Step 2: Final commit if fixes needed**

```bash
git commit -m "[fix] resolve type errors in agent engine"
```
