# TODO 02: SSE 流处理与错误恢复引擎

**对应 Spec:** `specs/02-sse-stream-and-error-recovery.md`

## Dependencies

- `depends_on: []` — 无前置依赖，可最先开始
- `blocks: [04]` — Agent 执行引擎使用 SSEStreamManager 作为核心组件
- `parallel_group: A` — 可与 TODO 01 并行

**依赖说明:** SSEStreamManager 是 Agent 执行引擎（TODO 04）的基础设施。TODO 04 中的 useAgentExecution hook 直接创建和管理 SSEStreamManager 实例。

## Tasks

- [ ] 2.1 创建 `SSEStreamManager` 类 (`src/lib/video-editing-agent/SSEStreamManager.ts`)
  - 实现 `start()` — 发起 fetch + 启动 ReadableStream 读取循环
  - 实现 `cancel()` — AbortController.abort() + 清理
  - 实现 `parseSSEBuffer()` — 正确处理 SSE 规范（data: 前缀、空行分隔、[DONE] 信号）
  - 使用 TextDecoder 处理 UTF-8 字节流

- [ ] 2.2 实现心跳检测机制
  - 每次收到数据时重置心跳计时器
  - 心跳超时（默认30s）触发 `handleDisconnect('heartbeat_timeout')`
  - 清理函数中清除心跳计时器

- [ ] 2.3 实现总超时机制
  - start() 时启动总计时器（默认120s）
  - 超时触发 cancel + onError 回调
  - 清理函数中清除总计时器

- [ ] 2.4 创建错误分类体系 (`src/lib/video-editing-agent/errorRecovery.ts`)
  - 定义 `StreamErrorType` 枚举
  - 定义 `StreamError` 接口
  - 实现 `classifyError()` 函数：根据错误对象和上下文判断错误类型

- [ ] 2.5 实现自动重试逻辑
  - `attemptRetry()` — 检查重试次数、错误可恢复性
  - 指数退避：1s → 2s（最多2次）
  - 重试时调用 `onRetry` 回调通知 UI
  - 重试请求携带已完成操作的上下文（避免重复执行）

- [ ] 2.6 创建 `useAgentExecutionState` hook (`src/components/video/hooks/useAgentExecutionState.ts`)
  - 管理 `AgentExecutionState` 状态
  - 暴露 `startExecution`, `cancelExecution`, `retryExecution` 方法
  - 状态变化时通知消费组件

- [ ] 2.7 添加事件 ID 支持到 API route
  - 修改 `src/app/api/video-editing-agent/chat/route.ts`
  - 每个 SSE 事件添加递增 ID（`id: {n}`）
  - 重连时客户端可以通过 Last-Event-ID 指示已接收的最后事件
  - 服务端从指定 ID 之后继续发送（或通知已完成）

- [ ] 2.8 集成测试
  - 测试正常流程：完整的 SSE 事件序列
  - 测试网络中断场景：模拟 fetch 失败后的重连
  - 测试心跳超时场景：SSE 流长时间无数据
  - 测试取消场景：执行中用户取消
  - 测试解析错误：畸形 SSE 数据的容错
