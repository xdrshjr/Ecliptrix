# Spec 02: SSE 流处理与错误恢复引擎

## 目标

将当前内嵌在 VideoEditingInterface 中的 SSE 流解析逻辑提取为独立的 StreamManager，并建立完善的错误恢复机制，包括智能错误分析、自动重试、降级策略和用户升级。

## 现状分析

### 当前 SSE 处理

**文件:** `src/components/video/VideoEditingInterface.tsx` (lines 2392-2638)

当前 `handleSendAgentMessage()` 函数中的 SSE 处理：

```
fetch() → reader.read() 循环 → sseBuffer 拼接 → JSON.parse → switch(event.type)
```

**问题清单:**

1. **SSE 解析与业务逻辑耦合**: 流解析、事件路由、状态更新、UI反馈全部在一个 ~250 行的函数中
2. **buffer 处理脆弱**: 使用简单的字符串拼接 + split('\n') 解析 SSE，没有处理多行 data 字段
3. **无重连机制**: SSE 连接断开后没有重连逻辑，直接视为结束
4. **错误处理不分级**: 所有错误统一在 catch 块中处理，没有区分可恢复/不可恢复错误
5. **超时无进度**: `agentIsExecuting` 期间用户只看到输入框被禁用，没有进度提示
6. **generating 卡死**: 如果 SSE 流异常中断但 fetch 没有报错，`agentIsExecuting` 可能一直为 true
7. **无心跳检测**: 没有检测 SSE 流是否仍在活跃传输
8. **无取消能力**: 用户无法在 Agent 执行过程中主动取消

### 当前错误处理

```typescript
// 当前模式（简化）
try {
  const response = await fetch(url, options);
  // ... 处理流 ...
} catch (error) {
  // 统一处理：显示通知 + 清理streaming状态
  showNotification('error', '...');
} finally {
  setAgentIsExecuting(false);
  // 清理stale streaming消息
}
```

## 设计方案

### SSEStreamManager 类

独立的 SSE 流管理器，负责连接管理、数据解析、事件分发。

```typescript
// 伪代码 — 接口定义
interface SSEStreamManagerConfig {
  url: string;
  body: unknown;
  headers?: Record<string, string>;
  timeout?: number;           // 总超时，默认 120s
  heartbeatTimeout?: number;  // 心跳超时，默认 30s
  maxRetries?: number;        // 最大重试次数，默认 2
  onEvent: (event: AgentSSEEvent) => void;
  onError: (error: StreamError) => void;
  onComplete: () => void;
  onRetry?: (attempt: number, reason: string) => void;
}

class SSEStreamManager {
  private controller: AbortController;
  private heartbeatTimer: NodeJS.Timer | null;
  private totalTimer: NodeJS.Timer | null;
  private retryCount: number;
  private buffer: string;

  constructor(config: SSEStreamManagerConfig);

  // 启动流连接
  start(): Promise<void>;

  // 主动取消
  cancel(): void;

  // 内部方法
  private parseSSEBuffer(chunk: string): AgentSSEEvent[];
  private resetHeartbeat(): void;
  private handleDisconnect(reason: string): void;
  private attemptRetry(reason: string): Promise<boolean>;
}
```

#### SSE 解析改进

当前的 buffer 处理存在问题，新的解析器需要正确处理 SSE 规范：

```
// SSE 格式
data: {"type":"text_delta","content":"hello"}

data: {"type":"tool_call","toolCallId":"tc_1",...}

data: [DONE]
```

```typescript
// 伪代码 — 解析逻辑
parseSSEBuffer(chunk: string): AgentSSEEvent[] {
  this.buffer += chunk;
  const events: AgentSSEEvent[] = [];
  const lines = this.buffer.split('\n');

  // 保留最后一行（可能不完整）
  this.buffer = lines.pop() || '';

  let currentData = '';
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      currentData = line.slice(6);
    } else if (line === '' && currentData) {
      // 空行 = 事件边界
      if (currentData === '[DONE]') {
        events.push({ type: 'stream_end' });
      } else {
        try {
          events.push(JSON.parse(currentData));
        } catch {
          // 忽略解析失败的行，记录日志
          console.warn('SSE parse failed:', currentData);
        }
      }
      currentData = '';
    }
  }

  return events;
}
```

#### 心跳检测

```typescript
// 伪代码
resetHeartbeat(): void {
  if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
  this.heartbeatTimer = setTimeout(() => {
    // 超过 heartbeatTimeout 没有收到任何数据
    this.handleDisconnect('heartbeat_timeout');
  }, this.config.heartbeatTimeout);
}

// 每次收到数据时调用
onDataReceived(): void {
  this.resetHeartbeat();
}
```

#### 取消机制

```typescript
// 伪代码
cancel(): void {
  this.controller.abort();
  this.cleanup();
  this.config.onEvent({ type: 'cancelled' });
}
```

### 错误恢复引擎

#### 错误分类

```typescript
// 伪代码
enum StreamErrorType {
  NETWORK_DROP = 'network_drop',       // 网络断开
  HEARTBEAT_TIMEOUT = 'heartbeat_timeout', // 心跳超时
  TOTAL_TIMEOUT = 'total_timeout',     // 总超时
  PARSE_ERROR = 'parse_error',         // 数据解析错误
  SERVER_ERROR = 'server_error',       // 服务端返回错误
  TOOL_ERROR = 'tool_error',           // 工具执行失败
  CANCELLED = 'cancelled',             // 用户取消
}

interface StreamError {
  type: StreamErrorType;
  message: string;
  recoverable: boolean;
  context?: {
    lastEvent?: AgentSSEEvent;
    completedTools?: string[];
    pendingTools?: string[];
  };
}
```

#### 恢复策略矩阵

| 错误类型 | 可恢复 | 策略 | 用户感知 |
|----------|--------|------|----------|
| `NETWORK_DROP` | 是 | 自动重试(max 2次)，重连后继续 | 显示"重连中..."提示 |
| `HEARTBEAT_TIMEOUT` | 是 | 重新发起请求（带已完成操作上下文） | 显示"Agent响应超时，正在重试..." |
| `TOTAL_TIMEOUT` | 否 | 通知用户，建议简化请求 | 显示错误卡片+建议操作 |
| `PARSE_ERROR` | 部分 | 跳过错误行继续，连续3次则终止 | 不可见（自动跳过） |
| `SERVER_ERROR` | 视情况 | 分析错误码，4xx不重试，5xx重试 | 根据错误类型显示不同提示 |
| `TOOL_ERROR` | 是 | Agent自动分析并尝试修复 | 工具卡片显示错误+Agent分析 |
| `CANCELLED` | 否 | 清理状态，保留已完成操作 | 立即停止，显示取消确认 |

#### Agent 工具执行错误的智能恢复

当单个工具执行失败时，不终止整个 Agent 流程，而是将错误信息返回给 Agent，让 Agent 自行分析和调整：

```
工具执行失败
  ↓
tool_result 事件带 error 标志
  ↓
Agent 收到错误信息（这是 LLM API 原生支持的能力）
  ↓
Agent 分析错误原因，决定:
  a) 调整参数重试
  b) 换一种方式实现
  c) 告知用户无法完成
```

**这部分不需要前端额外实现**，因为 function calling 的错误返回机制是 API 原生支持的。前端需要做的是：
1. 正确显示工具的 error 状态（已有 AgentToolCallCard 的 error 状态）
2. 在 Agent 重试时显示新的工具调用卡片
3. 不因为单个工具 error 而终止整个流

### AgentExecutionState — 统一执行状态

```typescript
// 伪代码
interface AgentExecutionState {
  status: 'idle' | 'executing' | 'retrying' | 'error' | 'cancelled' | 'completed';
  startTime: number | null;
  elapsedTime: number;          // 已用时间（ms）
  retryCount: number;
  completedTools: ToolCallRecord[];
  currentTool: ToolCallRecord | null;
  pendingMessage: string;       // 已积累的文本内容
  error: StreamError | null;
}
```

```typescript
// 伪代码 — hook 接口
function useAgentExecutionState(): {
  state: AgentExecutionState;
  startExecution: (params: AgentRequestParams) => void;
  cancelExecution: () => void;
  retryExecution: () => void;
}
```

## 涉及文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/lib/video-editing-agent/SSEStreamManager.ts` | **新建** | SSE 流管理器 |
| `src/lib/video-editing-agent/errorRecovery.ts` | **新建** | 错误分类与恢复策略 |
| `src/components/video/hooks/useAgentExecutionState.ts` | **新建** | Agent 执行状态 hook |
| `src/components/video/VideoEditingInterface.tsx` | **重构** | 提取 SSE 处理逻辑到 StreamManager |
| `src/app/api/video-editing-agent/chat/route.ts` | **修改** | 添加事件ID支持（用于去重） |

## 验收标准

1. SSE 连接断开后能在 5 秒内自动重连（最多 2 次）
2. 心跳超时（30秒无数据）触发自动重连
3. 用户可以在 Agent 执行过程中点击取消按钮
4. 单个工具执行失败不终止整个 Agent 流程
5. `generating` 状态不会无限卡死（总超时 120s 兜底）
6. 重连后不会出现重复的工具执行或消息
7. 所有错误类型都有对应的用户友好提示

## 边界情况

- **重连时 Agent 已完成**: 重连请求返回空响应，正常处理为完成
- **取消时工具正在执行**: 工具可能已产生副作用（已修改时间轴），需要通过 undo 机制恢复
- **连续多次心跳超时**: 重试次数耗尽后升级为不可恢复错误，提示用户检查网络
- **SSE 流中途服务器关闭**: 视为 NETWORK_DROP，触发重连
