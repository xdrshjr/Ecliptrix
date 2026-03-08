# Spec 03: 前端集成

## 1. 概述

本文档描述 Agent 模式在前端的集成方案，包括 Toggle 开关 UI、Agent 消息渲染、时间线操作应用、撤销机制和操作动画。

## 2. Agent Toggle 开关

### 2.1 位置与样式

- **位置**: ChatWindow 组件中，输入框上方区域
- **组件**: 小型 Toggle 滑动开关 + "Agent" 文字标签
- **默认状态**: 开启（enabled）
- **仅在视频编辑任务中显示**: 其他任务类型不显示此开关

```
伪代码 UI 布局:

<div class="chat-input-area">
    <!-- Agent Toggle：仅在视频编辑任务中显示 -->
    {isVideoEditingTask && (
        <div class="agent-toggle-bar">
            <label>Agent</label>
            <ToggleSwitch checked={agentMode} onChange={setAgentMode} />
        </div>
    )}

    <!-- 输入框 -->
    <ChatInput ... />
</div>
```

### 2.2 状态管理

- `agentMode` 状态存储在 `VideoEditingInterface` 或通过 props 传递到 ChatWindow
- 切换状态时保留对话历史（不清空消息）
- agentMode 状态持久化到任务的 uiState 中

### 2.3 行为差异

| 行为 | Agent 开启 | Agent 关闭 |
|------|------------|------------|
| 消息发送目标 | `/api/video-editing-agent/chat` | `/api/chat` 或 `/api/video-editing-chat` |
| 工具调用 | 有（7个工具） | 无 |
| 消息格式 | 包含时间线状态 + 素材 | 普通聊天消息 |
| 撤销按钮 | 显示（Agent 消息底部） | 不显示 |
| 输入框占位符 | "Tell the agent what to edit..." | "Type a message..." |

## 3. 消息发送流程

### 3.1 Agent 模式消息发送

```
伪代码:

async function sendAgentMessage(userMessage: string):
    // 1. 保存时间线快照（用于撤销）
    timelineSnapshot = deepClone(currentTimelineState)

    // 2. 添加用户消息到对话历史
    addMessage({ role: 'user', content: userMessage })

    // 3. 创建 Agent 回复占位消息
    agentMessage = addMessage({
        role: 'assistant',
        content: '',
        isAgentMessage: true,
        agentToolCalls: [],
        timelineSnapshot: timelineSnapshot,  // 快照附在消息上
        isStreaming: true
    })

    // 4. 发送 SSE 请求
    response = await fetch('/api/video-editing-agent/chat', {
        method: 'POST',
        body: JSON.stringify({
            messages: conversationHistory,
            timelineState: currentTimelineState,
            materials: currentMaterials
        })
    })

    // 5. 处理 SSE 流
    reader = response.body.getReader()
    processSSEStream(reader, agentMessage)
```

### 3.2 SSE 流处理

```
伪代码:

function processSSEStream(reader, agentMessage):
    pendingOperations = []

    while true:
        chunk = await reader.read()
        if chunk.done: break

        events = parseSSEEvents(chunk)
        for each event in events:
            switch event.type:
                case "text_delta":
                    // 追加流式文字到消息内容
                    agentMessage.content += event.content
                    updateMessageInUI(agentMessage)

                case "tool_call":
                    // 记录工具调用开始
                    toolCall = {
                        id: event.toolCallId,
                        name: event.toolName,
                        params: event.params,
                        status: 'executing',
                        result: null
                    }
                    agentMessage.agentToolCalls.push(toolCall)
                    updateMessageInUI(agentMessage)
                    // 在时间线上显示操作预览动画
                    showToolPreviewAnimation(event.toolName, event.params)

                case "tool_result":
                    // 更新工具调用结果
                    toolCall = findToolCall(agentMessage, event.toolCallId)
                    toolCall.status = event.result.success ? 'completed' : 'error'
                    toolCall.result = event.result
                    updateMessageInUI(agentMessage)

                    // 如果成功且有操作指令，应用到时间线
                    if event.result.success and event.result.operation:
                        applyOperationToTimeline(event.result.operation)
                        pendingOperations.push(event.result.operation)
                        // 播放完成动画
                        showToolCompleteAnimation(event.toolName, event.result)

                case "agent_end":
                    agentMessage.isStreaming = false
                    agentMessage.pendingOperations = pendingOperations
                    updateMessageInUI(agentMessage)

                case "error":
                    agentMessage.content += "\n\nError: " + event.message
                    agentMessage.isStreaming = false
                    updateMessageInUI(agentMessage)
```

## 4. Agent 消息渲染

### 4.1 消息结构

Agent 的回复消息包含以下部分，从上到下排列：

```
┌─────────────────────────────────────────┐
│ 🤖 Agent                                │
├─────────────────────────────────────────┤
│                                         │
│ "I'll add the intro video to the        │
│  timeline and trim it to 10 seconds."   │
│                                         │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ 🔧 search_materials                 │ │
│ │    query: "intro"                   │ │
│ │    ✅ Found 3 materials             │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ 🔧 add_to_track                    │ │
│ │    materialId: "mat-001"            │ │
│ │    ✅ Added to video-track-1 at 0s  │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ 🔧 trim_clip                       │ │
│ │    clipId: "clip-001"              │ │
│ │    clipEnd: 10                      │ │
│ │    ✅ Trimmed to 10s               │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ "Done! I've added the intro video and   │
│  trimmed it to 10 seconds."             │
│                                         │
├─────────────────────────────────────────┤
│              [↩ Undo]                   │
└─────────────────────────────────────────┘
```

### 4.2 工具调用卡片组件

新建 `AgentToolCallCard` 组件，显示单个工具调用：

```
伪代码:

AgentToolCallCard({ toolCall }):
    statusIcon = switch toolCall.status:
        "executing" → 旋转加载图标
        "completed" → 绿色勾号
        "error" → 红色叉号

    return (
        <div class="tool-call-card">
            <div class="tool-call-header">
                {statusIcon}
                <span class="tool-name">{toolCall.name}</span>
            </div>
            <div class="tool-call-params">
                // 展示关键参数（可折叠）
                {formatParams(toolCall.params)}
            </div>
            {toolCall.result && (
                <div class="tool-call-result">
                    {formatResult(toolCall.result)}
                </div>
            )}
        </div>
    )
```

### 4.3 AgentMessage 组件

扩展现有 `MessageBubble` 或创建新的 `AgentMessageBubble` 组件：

```
伪代码:

AgentMessageBubble({ message }):
    return (
        <div class="agent-message">
            {/* 流式文字内容 */}
            <div class="agent-text">
                <MarkdownRenderer content={message.content} />
            </div>

            {/* 工具调用卡片列表 */}
            {message.agentToolCalls.length > 0 && (
                <div class="agent-tool-calls">
                    {message.agentToolCalls.map(tc => (
                        <AgentToolCallCard toolCall={tc} />
                    ))}
                </div>
            )}

            {/* 撤销按钮 */}
            {message.isAgentMessage && !message.isStreaming && message.pendingOperations?.length > 0 && (
                <button class="undo-button" onClick={() => handleUndo(message)}>
                    ↩ Undo ({message.pendingOperations.length} operations)
                </button>
            )}
        </div>
    )
```

## 5. 撤销机制

### 5.1 时间线快照策略

- **保存时机**: 用户发送 Agent 消息时，在任何操作执行前保存当前时间线状态的深拷贝
- **保存位置**: 附在 Agent 回复消息的 `timelineSnapshot` 字段上
- **快照内容**: 完整的 `TimelineState`（所有 tracks + items）

### 5.2 撤销执行

```
伪代码:

function handleUndo(agentMessage):
    if not agentMessage.timelineSnapshot:
        return

    // 恢复时间线到快照状态
    restoreTimeline(agentMessage.timelineSnapshot)

    // 标记该消息的操作已撤销
    agentMessage.isUndone = true
    agentMessage.pendingOperations = []
    updateMessageInUI(agentMessage)

    // 可选：在消息底部显示"已撤销"状态
```

### 5.3 撤销后的行为

- 撤销后 Agent 对话历史保留（不删除消息）
- 用户可以继续对话，Agent 会通过 get_timeline 获取最新状态
- 已撤销的消息不会影响后续 Agent 操作

## 6. 时间线操作应用

### 6.1 操作应用函数

前端接收工具结果后，将操作指令应用到时间线状态：

```
伪代码:

function applyOperationToTimeline(operation):
    switch operation.type:
        case "add_clip":
            track = findTrack(operation.clip.trackId)
            track.items.push(createTimelineItem(operation.clip, operation.material))
            updateTotalDuration()

        case "trim_clip":
            clip = findClipInTimeline(operation.clipId)
            clip.clipStart = operation.clipStart
            clip.clipEnd = operation.clipEnd
            clip.duration = operation.duration

        case "delete_clip":
            track = findTrack(operation.trackId)
            track.items = track.items.filter(item => item.id !== operation.clipId)
            updateTotalDuration()

        case "move_clip":
            // 如果跨轨道移动
            if operation.fromTrackId !== operation.toTrackId:
                fromTrack = findTrack(operation.fromTrackId)
                toTrack = findTrack(operation.toTrackId)
                clip = removeClipFromTrack(fromTrack, operation.clipId)
                clip.startTime = operation.newStartTime
                toTrack.items.push(clip)
            else:
                clip = findClipInTimeline(operation.clipId)
                clip.startTime = operation.newStartTime

        case "resize_clip":
            clip = findClipInTimeline(operation.clipId)
            clip.duration = operation.newDuration

    // 推送到历史栈（用于时间线自己的 undo/redo）
    pushToHistory()
```

### 6.2 时间线状态同步

由于工具在服务端"计算"但操作在前端"应用"，需要确保一致性：

- 工具执行时使用的 timelineState 是请求时的快照
- 每个工具操作应用后，更新本地 timelineState
- 如果 Agent 在一次回复中调用多个工具，操作按顺序应用
- 后续工具看到的是前面工具操作后的状态（通过 context 中的 timelineState 实时更新）

## 7. 操作动画

### 7.1 动画类型

| 操作 | 动画效果 |
|------|----------|
| add_clip | 新片段从上方滑入，绿色边框闪烁 2 次 |
| trim_clip | 被裁剪的片段边缘闪烁，平滑缩放到新尺寸 |
| delete_clip | 片段淡出消失 |
| move_clip | 片段平滑滑动到新位置 |
| resize_clip | 片段平滑拉伸/压缩到新宽度 |

### 7.2 动画实现方式

- 使用 CSS transition 和 animation
- 动画持续时间 300-500ms
- 通过给 TimelineItem 组件添加临时 CSS 类触发动画
- 动画完成后移除 CSS 类

```
伪代码:

function showToolCompleteAnimation(toolName, result):
    switch toolName:
        case "add_to_track":
            clipElement = document.querySelector(`[data-clip-id="${result.clip.id}"]`)
            clipElement.classList.add("agent-clip-added")
            setTimeout(() => clipElement.classList.remove("agent-clip-added"), 600)

        case "delete_clip":
            clipElement = document.querySelector(`[data-clip-id="${result.deletedClipId}"]`)
            clipElement.classList.add("agent-clip-deleting")
            // 动画完成后实际删除
            setTimeout(() => applyDeleteOperation(), 400)

        // ... 其他动画
```

## 8. Agent 执行期间的 UI 锁定

### 8.1 锁定范围

Agent 执行期间（从用户发送消息到 `agent_end` 事件）：

- 时间线手动编辑操作被禁用（拖拽、右键菜单、快捷键）
- 输入框显示"Agent is working..."，禁用发送按钮
- Agent Toggle 开关禁用（不允许在执行中途切换）

### 8.2 锁定实现

```
伪代码:

// 在 VideoEditingInterface 或 TimelinePanel 中
{agentIsExecuting && (
    <div class="timeline-lock-overlay">
        // 半透明遮罩，防止鼠标操作
    </div>
)}

// ChatInput 中
<input
    disabled={agentIsExecuting}
    placeholder={agentIsExecuting ? "Agent is working..." : "Tell the agent what to edit..."}
/>
```

## 9. ChatMessage 类型扩展

在 `src/types/index.ts` 中扩展 `ChatMessage` 接口：

```
伪代码:

interface ChatMessage {
    // ... 现有字段

    // Agent 模式新增字段
    isAgentMessage?: boolean           // 是否为 Agent 消息
    agentToolCalls?: AgentToolCall[]    // 工具调用记录
    timelineSnapshot?: TimelineState   // 操作前的时间线快照
    pendingOperations?: TimelineOperation[]  // 已执行的操作列表
    isUndone?: boolean                 // 是否已撤销
}

interface AgentToolCall {
    id: string
    name: string
    params: Record<string, any>
    status: 'executing' | 'completed' | 'error'
    result?: any
}

type TimelineOperation =
    | { type: "add_clip", clip: any, material: any }
    | { type: "trim_clip", clipId: string, clipStart: number, clipEnd: number, duration: number }
    | { type: "delete_clip", clipId: string, trackId: string }
    | { type: "move_clip", clipId: string, fromTrackId: string, toTrackId: string, newStartTime: number }
    | { type: "resize_clip", clipId: string, newDuration: number }
```
