# TODO 04: Agent 执行引擎重构

**对应 Spec:** `specs/04-agent-execution-engine.md`

## Dependencies

- `depends_on: [01, 02]` — 需要新的系统提示结构和 SSEStreamManager
- `blocks: [05]` — 交互增强依赖执行引擎暴露的状态
- `parallel_group: B` — 可与 TODO 03 并行（但都依赖 A 组完成）

**依赖说明:** 执行引擎使用 SSEStreamManager（TODO 02）处理流，使用新的 buildSystemPrompt（TODO 01）构建请求。TODO 03 和 04 可以并行开发，因为 03 只需要 04 的接口定义（TypeScript 接口），不需要完整实现。

## Tasks

- [ ] 4.1 创建 `AgentEventRouter` 类 (`src/lib/video-editing-agent/AgentEventRouter.ts`)
  - 接收 SSE 事件，路由到对应处理方法
  - 事件类型: text_delta, tool_call, tool_result, error, stream_end
  - 调用 AgentStateManager 更新状态
  - 调用 OperationApplier 应用时间轴操作

- [ ] 4.2 创建 `AgentStateManager` 类 (`src/lib/video-editing-agent/AgentStateManager.ts`)
  - 维护 `AgentExecutionState` 实例
  - 实现 `appendText()`, `addToolCall()`, `updateToolStatus()`, `setError()`, `finalize()`
  - 使用 requestAnimationFrame 批量通知订阅者
  - 实现 `toMessageUpdate()` — 转换为 ChatMessage 格式用于持久化

- [ ] 4.3 创建 `OperationApplier` 类 (`src/lib/video-editing-agent/OperationApplier.ts`)
  - 实现 `apply()` — 应用操作 + 保存局部快照
  - 实现 `undoOperation()` — 撤销单个操作
  - 实现 `undoAll()` — 撤销所有操作（等同于恢复完整快照）
  - 实现 `captureAffectedState()` — 提取操作影响的片段状态

- [ ] 4.4 创建 `useAgentExecution` hook (`src/components/video/hooks/useAgentExecution.ts`)
  - 组装 SSEStreamManager + AgentEventRouter + AgentStateManager + OperationApplier
  - 暴露接口: sendAgentMessage, cancelExecution, undoAll, undoSingle
  - 管理 agentMode, agentIsExecuting 状态
  - 组件卸载时清理（cancel + 清除计时器）

- [ ] 4.5 重构 `VideoEditingInterface.tsx` — 提取 Agent 逻辑
  - 删除 `handleSendAgentMessage()` 函数（~250行）
  - 删除 `handleAgentUndo()` 函数（~25行）
  - 删除相关 useState（agentMode, agentIsExecuting）
  - 替换为 `useAgentExecution()` hook 调用
  - 更新 VideoChatWindow props 传递

- [ ] 4.6 处理 conversation 切换
  - 切换对话时：取消当前执行、清理状态
  - 确保新对话的 Agent 状态正确初始化

- [ ] 4.7 处理 stale streaming 清理
  - 迁移现有的 mount 时检查 stale isStreaming 逻辑到 hook 中
  - 确保页面刷新/重新加载后不会卡在 generating 状态

- [ ] 4.8 集成测试
  - 端到端测试：发送消息 → 流式接收 → 工具执行 → 操作应用 → 完成
  - 撤销测试：单操作撤销 + 全部撤销
  - 取消测试：执行中取消
  - 切换对话测试：执行中切换到另一个对话
  - 错误恢复测试：模拟工具失败后的 Agent 自动重试
