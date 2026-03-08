# TODO 03: 前端集成

> 对应 Spec: `specs/03-frontend-integration.md`

## 类型扩展

- [ ] 在 `src/types/index.ts` 中扩展 `ChatMessage` 接口
  - [ ] 添加 `isAgentMessage?: boolean`
  - [ ] 添加 `agentToolCalls?: AgentToolCall[]`
  - [ ] 添加 `timelineSnapshot?: TimelineState`
  - [ ] 添加 `pendingOperations?: TimelineOperation[]`
  - [ ] 添加 `isUndone?: boolean`
- [ ] 定义 `AgentToolCall` 接口
- [ ] 定义 `TimelineOperation` 联合类型

## Agent Toggle 开关

- [ ] 在 ChatWindow 组件中添加 Agent Toggle UI
  - [ ] 使用滑动开关组件 + "Agent" 标签
  - [ ] 仅在视频编辑任务中显示
  - [ ] 默认开启状态
- [ ] 添加 `agentMode` 状态管理
- [ ] 将 agentMode 持久化到任务的 uiState 中
- [ ] 根据 agentMode 切换输入框占位符文字

## Agent 消息发送

- [ ] 实现 `sendAgentMessage(userMessage)` 函数
  - [ ] 发送前保存时间线快照（深拷贝）
  - [ ] 创建 Agent 回复占位消息
  - [ ] 发起 SSE 请求到 `/api/video-editing-agent/chat`
  - [ ] 传递 messages、timelineState、materials

## SSE 流处理

- [ ] 实现 SSE 流解析函数
- [ ] 处理 `text_delta` 事件 — 追加流式文字
- [ ] 处理 `tool_call` 事件 — 添加工具调用卡片
- [ ] 处理 `tool_result` 事件 — 更新工具状态 + 应用操作
- [ ] 处理 `agent_end` 事件 — 完成消息
- [ ] 处理 `error` 事件 — 显示错误信息

## Agent 消息渲染

- [ ] 创建 `AgentToolCallCard` 组件
  - [ ] 显示工具名称、参数、执行状态图标
  - [ ] 支持 executing/completed/error 三种状态
  - [ ] 参数和结果可折叠
- [ ] 创建 `AgentMessageBubble` 组件（或扩展 MessageBubble）
  - [ ] 渲染流式文字内容
  - [ ] 渲染工具调用卡片列表
  - [ ] 渲染撤销按钮

## 时间线操作应用

- [ ] 实现 `applyOperationToTimeline(operation)` 函数
  - [ ] 处理 add_clip 操作
  - [ ] 处理 trim_clip 操作
  - [ ] 处理 delete_clip 操作
  - [ ] 处理 move_clip 操作
  - [ ] 处理 resize_clip 操作
- [ ] 每次操作后推送到历史栈

## 撤销机制

- [ ] 实现 `handleUndo(agentMessage)` 函数
  - [ ] 从消息的 timelineSnapshot 恢复时间线状态
  - [ ] 标记消息为已撤销
  - [ ] 更新 UI 显示"已撤销"状态
- [ ] 撤销按钮显示操作数量

## 操作动画

- [ ] 为 TimelineItem 添加 `data-clip-id` 属性
- [ ] 实现 add_clip 动画（滑入 + 绿色边框闪烁）
- [ ] 实现 delete_clip 动画（淡出消失）
- [ ] 实现 move_clip 动画（平滑滑动）
- [ ] 实现 trim_clip 动画（边缘闪烁 + 缩放）
- [ ] 实现 resize_clip 动画（平滑拉伸/压缩）
- [ ] 编写对应 CSS 动画类

## UI 锁定

- [ ] 实现 `agentIsExecuting` 状态
- [ ] Agent 执行期间禁用时间线手动编辑
- [ ] Agent 执行期间禁用发送按钮和输入框
- [ ] Agent 执行期间禁用 Toggle 开关
