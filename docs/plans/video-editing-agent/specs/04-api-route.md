# Spec 04: API Route 设计

## 1. 概述

本文档描述视频编辑 Agent 的 API Route，负责接收前端请求、创建 Agent 实例、管理工具执行，并通过 SSE 实时推送事件到前端。

## 2. 路由定义

### 2.1 端点

```
POST /api/video-editing-agent/chat
```

文件位置：`src/app/api/video-editing-agent/chat/route.ts`

### 2.2 请求格式

```
伪代码:

Request Body (JSON):
{
    messages: ChatMessage[]         // 完整对话历史
    timelineState: TimelineState    // 当前时间线状态
    materials: MaterialItem[]       // 当前素材库
    agentMode: boolean              // Agent 模式是否开启（应为 true）
}
```

### 2.3 响应格式

SSE（Server-Sent Events）流式响应：

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

## 3. Route Handler 实现

```
伪代码:

export async function POST(request: Request):
    body = await request.json()
    { messages, timelineState, materials } = body

    // 1. 读取 LLM 配置（复用 CHAT LLM）
    llmApiUrl = process.env.LLM_API_URL
    llmApiKey = process.env.LLM_API_KEY
    llmModel = process.env.LLM_MODEL

    if not llmApiUrl or not llmApiKey:
        return Response.json({ error: "LLM not configured" }, { status: 500 })

    // 2. 创建 SSE 流
    stream = new ReadableStream({
        async start(controller):
            encoder = new TextEncoder()

            function send(data):
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

            try:
                // 3. 创建 Agent
                agent = createVideoEditingAgent({
                    llmApiUrl,
                    llmApiKey,
                    llmModel,
                    timelineState,
                    materials,
                    conversationHistory: messages
                })

                // 4. 订阅事件并转发 SSE
                agent.subscribe((event) => {
                    handleAgentEvent(event, send)
                })

                // 5. 启动 Agent
                send({ type: "agent_start" })
                userMessage = messages[messages.length - 1].content
                await agent.prompt(userMessage)
                send({ type: "agent_end" })

            catch error:
                send({ type: "error", message: error.message })

            finally:
                controller.enqueue(encoder.encode("data: [DONE]\n\n"))
                controller.close()
    })

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        }
    })
```

## 4. Agent 创建与配置

```
伪代码:

import { Agent } from "@mariozechner/pi-agent-core"
import { getModel } from "@mariozechner/pi-ai"

function createVideoEditingAgent(config):
    // 配置 LLM 模型
    model = getModel("openai", {
        apiUrl: config.llmApiUrl,
        apiKey: config.llmApiKey,
        modelId: config.llmModel
    })

    // 创建工具执行上下文
    // 注意：timelineState 在此为引用，工具执行时会通过 operations 追踪变更
    // 但实际状态修改发生在前端
    toolContext = {
        timelineState: config.timelineState,
        materials: config.materials,
        operations: [],  // 收集所有操作指令
        updateTimeline: (operation) => {
            toolContext.operations.push(operation)
            // 同时更新本地 timelineState 副本，供后续工具使用
            applyOperationLocally(toolContext.timelineState, operation)
        }
    }

    // 构建工具
    tools = buildVideoEditingTools(toolContext)

    // 创建 Agent
    agent = new Agent({
        initialState: {
            systemPrompt: buildSystemPrompt(config.timelineState),
            model: model,
            thinkingLevel: "none",
            tools: tools,
            messages: convertToAgentMessages(config.conversationHistory)
        }
    })

    return agent
```

## 5. 事件处理

```
伪代码:

function handleAgentEvent(event, send):
    switch event.type:
        case "turn_start":
            send({ type: "turn_start" })

        case "message_start":
            send({ type: "message_start" })

        case "message_update":
            // 流式文字片段
            send({
                type: "text_delta",
                content: event.text || event.content || ""
            })

        case "message_end":
            send({ type: "message_end" })

        case "tool_execution_start":
            // 工具开始执行
            send({
                type: "tool_call",
                toolCallId: event.toolCallId,
                toolName: event.tool?.name || event.toolName,
                params: event.params || event.input
            })

        case "tool_execution_update":
            // 工具执行中间更新（可选）
            send({
                type: "tool_update",
                toolCallId: event.toolCallId,
                toolName: event.tool?.name || event.toolName,
                update: event.update
            })

        case "tool_execution_end":
            // 工具执行完成，附带操作指令
            result = event.result || event.output
            // 从 toolContext.operations 中提取本次操作
            operation = extractLatestOperation(event.toolCallId)

            send({
                type: "tool_result",
                toolCallId: event.toolCallId,
                toolName: event.tool?.name || event.toolName,
                result: result,
                operation: operation  // 前端需要这个来应用变更
            })

        case "turn_end":
            send({ type: "turn_end" })
```

## 6. 本地时间线状态更新

服务端需要在工具执行后更新本地 timelineState 副本，以便后续工具看到一致的状态：

```
伪代码:

function applyOperationLocally(timelineState, operation):
    switch operation.type:
        case "add_clip":
            track = timelineState.tracks.find(t => t.id === operation.clip.trackId)
            if track:
                track.items.push({
                    id: operation.clip.id,
                    materialId: operation.clip.materialId,
                    startTime: operation.clip.startTime,
                    duration: operation.clip.duration,
                    clipStart: operation.clip.clipStart,
                    clipEnd: operation.clip.clipEnd,
                    originalDuration: operation.clip.originalDuration,
                    volume: operation.clip.volume
                })

        case "trim_clip":
            clip = findClipInState(timelineState, operation.clipId)
            if clip:
                clip.clipStart = operation.clipStart
                clip.clipEnd = operation.clipEnd
                clip.duration = operation.duration

        case "delete_clip":
            track = timelineState.tracks.find(t => t.id === operation.trackId)
            if track:
                track.items = track.items.filter(i => i.id !== operation.clipId)

        case "move_clip":
            // 从源轨道移除
            fromTrack = timelineState.tracks.find(t => t.id === operation.fromTrackId)
            clipIndex = fromTrack.items.findIndex(i => i.id === operation.clipId)
            clip = fromTrack.items.splice(clipIndex, 1)[0]
            // 更新位置并添加到目标轨道
            clip.startTime = operation.newStartTime
            toTrack = timelineState.tracks.find(t => t.id === operation.toTrackId)
            toTrack.items.push(clip)

        case "resize_clip":
            clip = findClipInState(timelineState, operation.clipId)
            if clip:
                clip.duration = operation.newDuration
```

## 7. 对话历史转换

```
伪代码:

function convertToAgentMessages(chatMessages: ChatMessage[]):
    agentMessages = []

    for each msg in chatMessages:
        if msg.role === 'user':
            agentMessages.push({
                role: 'user',
                content: msg.content
            })

        else if msg.role === 'assistant':
            if msg.isAgentMessage and msg.agentToolCalls:
                // Agent 消息需要还原工具调用记录
                // 这样 Agent 知道之前调用了哪些工具
                agentMessages.push({
                    role: 'assistant',
                    content: msg.content,
                    toolCalls: msg.agentToolCalls.map(tc => ({
                        id: tc.id,
                        name: tc.name,
                        input: tc.params
                    }))
                })
                // 工具结果也需要作为 toolResult 消息
                for each tc in msg.agentToolCalls:
                    if tc.result:
                        agentMessages.push({
                            role: 'toolResult',
                            toolCallId: tc.id,
                            content: JSON.stringify(tc.result)
                        })
            else:
                // 普通 assistant 消息
                agentMessages.push({
                    role: 'assistant',
                    content: msg.content
                })

    return agentMessages
```

## 8. 超时与中断

### 8.1 超时处理

```
伪代码:

// 设置最大执行时间 120 秒
const AGENT_TIMEOUT = 120_000

// 在 agent.prompt() 外围设置超时
timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Agent timeout")), AGENT_TIMEOUT)
)

try:
    await Promise.race([agent.prompt(userMessage), timeoutPromise])
catch error:
    if error.message === "Agent timeout":
        send({ type: "error", message: "Agent timed out. Please try a simpler request." })
```

### 8.2 用户中断

暂不支持用户主动中断 Agent 执行。未来可通过 AbortController 实现。

## 9. 错误处理

```
伪代码:

// 顶层错误处理
try:
    // ... Agent 执行
catch error:
    if error instanceof LLMError:
        send({ type: "error", message: "Failed to connect to LLM: " + error.message })
    else if error instanceof ToolExecutionError:
        send({ type: "error", message: "Tool execution failed: " + error.message })
    else:
        send({ type: "error", message: "Unexpected error: " + error.message })
        console.error("[VideoEditingAgent] Error:", error)
```

## 10. 文件结构

```
src/app/api/video-editing-agent/
└── chat/
    └── route.ts            # API Route handler

src/lib/video-editing-agent/
├── agent.ts                # Agent 创建与配置
├── tools/
│   ├── index.ts            # 工具注册与导出
│   ├── getTimeline.ts      # get_timeline 工具
│   ├── searchMaterials.ts  # search_materials 工具
│   ├── addToTrack.ts       # add_to_track 工具
│   ├── trimClip.ts         # trim_clip 工具
│   ├── deleteClip.ts       # delete_clip 工具
│   ├── moveClip.ts         # move_clip 工具
│   └── resizeClip.ts       # resize_clip 工具
├── types.ts                # Agent 相关类型定义
├── systemPrompt.ts         # System prompt 构建
└── messageConverter.ts     # 消息格式转换
```
