# Spec 04: Agent 执行引擎重构

## 目标

将 Agent 消息处理逻辑从 VideoEditingInterface 巨型组件中提取为独立的执行引擎，实现关注点分离：流处理 → 事件路由 → 状态更新 → UI 渲染各司其职。

## 现状分析

### 当前代码组织

**文件:** `src/components/video/VideoEditingInterface.tsx`

该文件 3000+ 行，其中 Agent 相关逻辑集中在：
- lines 168-169: `agentMode` / `agentIsExecuting` 状态定义
- lines 2366-2389: `handleAgentUndo()` — Agent 撤销处理
- lines 2392-2638: `handleSendAgentMessage()` — Agent 消息发送+SSE处理+状态更新
- lines 2641-2645: `handleSendMessage()` — 路由到 agent 或 chat

**问题:**
1. 所有逻辑在一个组件中，难以复用和测试
2. Agent 状态分散在多个 `useState` 中，没有统一管理
3. SSE 事件处理中直接操作 content 状态（conversations、timelineState），耦合度极高
4. 错误处理、重试、取消逻辑无处安放
5. 新增功能（如单操作撤销）需要在已经很复杂的函数中插入代码

### 当前数据流

```
用户输入 → handleSendMessage()
  → handleSendAgentMessage()
    → 保存 timelineSnapshot
    → setAgentIsExecuting(true)
    → 创建占位消息
    → fetch SSE
    → 循环读取 stream
      → 更新 accumulatedContent（文本）
      → 更新 toolCalls（工具状态）
      → 应用 operations（时间轴变更）
    → 清理 streaming 状态
    → setAgentIsExecuting(false)
```

## 设计方案

### 架构拆分

```
VideoEditingInterface (UI 壳)
  ↓ 调用
useAgentExecution (hook — 执行引擎入口)
  ├── SSEStreamManager (连接管理+解析 — Spec 02)
  ├── AgentEventRouter (事件分类+路由)
  ├── AgentStateManager (统一状态管理)
  └── OperationApplier (时间轴操作应用)
```

### useAgentExecution Hook

统一的 Agent 执行管理 hook，封装所有执行相关逻辑。

```typescript
// 伪代码 — hook 接口
interface UseAgentExecutionParams {
  // 对话状态（读写）
  conversations: ConversationMap;
  setConversations: (updater) => void;
  activeConversationId: string;

  // 时间轴状态（读写）
  timelineState: TimelineState;
  setTimelineState: (state: TimelineState) => void;

  // 素材列表（只读）
  materials: Material[];

  // 外部回调
  onTimelineUpdate?: (updateId: string) => void;
  onNotification?: (type: string, message: string) => void;
}

interface UseAgentExecutionReturn {
  // 状态
  executionState: AgentExecutionState;
  agentMode: boolean;
  agentIsExecuting: boolean;

  // 操作
  setAgentMode: (mode: boolean) => void;
  sendAgentMessage: (text: string) => Promise<void>;
  cancelExecution: () => void;
  undoAllOperations: (messageId: string) => void;
  undoSingleOperation: (messageId: string, toolCallId: string) => void;
}

function useAgentExecution(params: UseAgentExecutionParams): UseAgentExecutionReturn;
```

### AgentEventRouter

接收 SSEStreamManager 解析出的事件，路由到对应的处理逻辑。

```typescript
// 伪代码
class AgentEventRouter {
  private stateManager: AgentStateManager;
  private operationApplier: OperationApplier;

  handleEvent(event: AgentSSEEvent): void {
    switch (event.type) {
      case 'text_delta':
        this.stateManager.appendText(event.content);
        break;

      case 'tool_call':
        this.stateManager.addToolCall({
          id: event.toolCallId,
          toolName: event.toolName,
          params: event.params,
          status: 'executing',
        });
        break;

      case 'tool_result':
        this.stateManager.updateToolStatus(event.toolCallId,
          event.result?.error ? 'error' : 'completed',
          event.result
        );
        if (event.operation) {
          this.operationApplier.apply(event.operation);
        }
        break;

      case 'error':
        this.stateManager.setError(event.message);
        break;

      case 'stream_end':
        this.stateManager.finalize();
        break;
    }
  }
}
```

### AgentStateManager

统一管理 Agent 执行过程中的所有状态变更，批量通知 UI 更新。

```typescript
// 伪代码
class AgentStateManager {
  private state: AgentExecutionState;
  private messageId: string;
  private listeners: Set<(state: AgentExecutionState) => void>;

  // 状态操作
  appendText(content: string): void;
  addToolCall(toolCall: ToolCallRecord): void;
  updateToolStatus(id: string, status: string, result: unknown): void;
  setError(message: string): void;
  finalize(): void;

  // 状态查询
  getState(): AgentExecutionState;

  // 订阅
  subscribe(listener: (state: AgentExecutionState) => void): () => void;

  // 转换为消息更新（用于持久化到 conversations）
  toMessageUpdate(): Partial<ChatMessage>;
}
```

**状态到消息的同步:**

AgentStateManager 内部维护实时执行状态，但需要定期同步到 conversations 状态中（用于持久化和 UI 渲染）。使用 requestAnimationFrame 批量更新，避免每个 SSE 事件都触发 React 重渲染：

```typescript
// 伪代码
private scheduleFlush(): void {
  if (this.flushScheduled) return;
  this.flushScheduled = true;
  requestAnimationFrame(() => {
    this.flushScheduled = false;
    const update = this.toMessageUpdate();
    this.notifyListeners(update);
  });
}
```

### OperationApplier

封装时间轴操作的应用逻辑，支持操作记录（用于撤销）。

```typescript
// 伪代码
class OperationApplier {
  private operations: Array<{
    operation: TimelineOperation;
    preSnapshot: Partial<TimelineState>;  // 操作前快照（受影响部分）
  }>;

  apply(operation: TimelineOperation): void {
    // 1. 保存受影响片段的当前状态
    const preSnapshot = this.captureAffectedState(operation);

    // 2. 应用操作到时间轴
    this.applyToTimeline(operation);

    // 3. 记录操作和快照
    this.operations.push({ operation, preSnapshot });
  }

  // 撤销单个操作（最后一个匹配的）
  undoOperation(toolCallId: string): boolean;

  // 撤销所有操作
  undoAll(): void;

  // 获取操作历史（用于 UI 显示撤销按钮）
  getOperations(): ReadonlyArray<{...}>;
}
```

### 提取后的 VideoEditingInterface

提取后，VideoEditingInterface 中的 Agent 相关代码减少为：

```typescript
// 伪代码 — 提取后
function VideoEditingInterface() {
  // ... 其他状态 ...

  const agent = useAgentExecution({
    conversations,
    setConversations,
    activeConversationId,
    timelineState: currentTimelineState,
    setTimelineState: setCurrentTimelineState,
    materials: content.materials,
    onTimelineUpdate: (id) => setExternalTimelineUpdateId(id),
    onNotification: showNotification,
  });

  // 在 JSX 中
  return (
    <VideoChatWindow
      agentMode={agent.agentMode}
      onAgentModeChange={agent.setAgentMode}
      agentIsExecuting={agent.agentIsExecuting}
      executionState={agent.executionState}
      onSendMessage={agent.agentMode ? agent.sendAgentMessage : handleSendChatMessage}
      onAgentUndo={agent.undoAllOperations}
      onAgentUndoSingle={agent.undoSingleOperation}
      onAgentCancel={agent.cancelExecution}
    />
  );
}
```

### 与 Spec 02 (SSEStreamManager) 的集成

```
useAgentExecution
  → 创建 SSEStreamManager 实例
  → 配置事件处理:
      onEvent → AgentEventRouter.handleEvent()
      onError → 错误恢复逻辑
      onComplete → AgentStateManager.finalize()
      onRetry → 更新执行状态为 'retrying'
  → 启动流
  → 返回控制接口 (cancel, retry)
```

### 与 Spec 03 (时间轴UI) 的集成

TimelineChatPanel 消费 `executionState` 来渲染节点：

```typescript
// 伪代码
function TimelineChatPanel({ executionState, messages, ... }) {
  const nodes = useMemo(() => {
    const messageNodes = messages.flatMap(mapMessageToNodes);

    // 如果正在执行，添加实时执行节点
    if (executionState.status === 'executing') {
      messageNodes.push({
        type: 'execution',
        toolCalls: executionState.completedTools.concat(
          executionState.currentTool ? [executionState.currentTool] : []
        ),
        pendingText: executionState.pendingMessage,
        isActive: true,
      });
    }

    return messageNodes;
  }, [messages, executionState]);

  return <TimelineNodeList nodes={nodes} />;
}
```

## 涉及文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/components/video/hooks/useAgentExecution.ts` | **新建** | Agent 执行管理 hook |
| `src/lib/video-editing-agent/AgentEventRouter.ts` | **新建** | 事件路由器 |
| `src/lib/video-editing-agent/AgentStateManager.ts` | **新建** | 执行状态管理器 |
| `src/lib/video-editing-agent/OperationApplier.ts` | **新建** | 时间轴操作应用+撤销 |
| `src/components/video/VideoEditingInterface.tsx` | **重构** | 提取 ~300 行代码到 hook |

## 验收标准

1. VideoEditingInterface 中的 Agent 相关代码减少到 < 50 行（仅 hook 调用+props 传递）
2. Agent 功能完全不变：发送消息、流式响应、工具执行、时间轴操作、撤销
3. 新增取消执行能力
4. 新增单操作撤销能力
5. SSE 事件处理不直接操作 React 状态，而是通过 StateManager 批量更新
6. 各模块可独立单元测试

## 边界情况

- **组件卸载时流仍在**: hook 的 cleanup 函数中调用 cancel()
- **快速连续发送**: 禁止在执行中发送新消息（agentIsExecuting 锁）
- **状态同步竞争**: requestAnimationFrame 批量更新避免中间状态闪烁
- **conversation 切换**: 切换对话时取消当前执行
