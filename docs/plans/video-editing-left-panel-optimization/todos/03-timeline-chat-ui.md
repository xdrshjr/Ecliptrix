# TODO 03: 时间轴式对话 UI 重构

**对应 Spec:** `specs/03-timeline-chat-ui.md`

## Dependencies

- `depends_on: [01, 02]` — 需要新的上下文结构和 SSE 流管理器的事件类型定义
- `blocks: [05]` — 交互增强基于时间轴 UI 组件
- `parallel_group: B`

**依赖说明:** 时间轴 UI 需要消费 SSEStreamManager 的事件类型（TODO 02）来渲染执行状态，也需要理解渐进式上下文（TODO 01）产生的新工具调用模式（Agent 可能先调用 get_timeline 再操作）。

## Tasks

- [ ] 3.1 创建 `TimelineConnector` 组件 (`TimelineConnector.tsx`)
  - 垂直连接线，使用 CSS border-left
  - 支持 active 状态（执行中区间高亮）
  - 支持 undone 状态（灰色虚线）
  - 暗色模式适配

- [ ] 3.2 创建 `TimelineNode` 基础组件 (`TimelineNode.tsx`)
  - 通用节点布局：图标 + 时间戳 + 内容区
  - 节点图标根据类型渲染（●/◐/◉/✅/❌）
  - 连接线定位（图标与连接线对齐）

- [ ] 3.3 实现 `UserMessageNode` 变体
  - 实心圆图标
  - 显示时间戳和消息文本
  - 支持多行文本

- [ ] 3.4 实现 `AgentThinkingNode` 变体
  - 旋转半圆图标（CSS animation）
  - 显示 streaming 中的思考文本
  - streaming 结束后合并到 ExecutionNode 或 ResponseNode

- [ ] 3.5 实现 `AgentExecutionNode` 变体
  - 同心圆图标（执行中脉冲动画）
  - Header: "执行操作 (M/N)" 进度计数
  - 内部嵌入 ToolStep 列表
  - 完成后可收起

- [ ] 3.6 创建 `ToolStep` 组件 (`ToolStep.tsx`)
  - 显示：状态图标 + 工具名 + 耗时 + 一行摘要
  - 可展开：完整参数 + 完整结果
  - 状态：executing / completed / error / undone
  - 展开箭头旋转动画

- [ ] 3.7 实现 `AgentResponseNode` 变体
  - 实心圆图标
  - Markdown 内容渲染（复用现有 Markdown 渲染）
  - 底部操作按钮：撤销全部 + 单操作撤销下拉

- [ ] 3.8 实现消息到节点的映射逻辑 (`mapMessageToNodes`)
  - 将 ChatMessage 拆分为对应的 TimelineNode 类型
  - 处理 streaming 状态的实时映射
  - 处理 Agent 消息的多阶段（thinking → execution → response）

- [ ] 3.9 创建 `TimelineChatPanel` 主组件 (`TimelineChatPanel.tsx`)
  - 组合 TimelineConnector + TimelineNode 列表
  - 自动滚动逻辑（复用现有 shouldAutoScroll 逻辑）
  - 手动滚动时暂停自动滚动

- [ ] 3.10 重构 `VideoChatWindow` 集成 TimelineChatPanel
  - 用 TimelineChatPanel 替换现有的消息列表渲染
  - 保留输入区域和 Agent 模式切换
  - 传递 executionState、onUndo、onUndoSingle 等 props

- [ ] 3.11 实现单操作撤销数据结构
  - 工具执行前保存受影响片段的局部快照
  - OperationApplier 中记录 preOperationSnapshot
  - 撤销时恢复局部快照

- [ ] 3.12 移除旧组件
  - 确认 AgentMessageBubble 的所有功能已迁移到 TimelineNode
  - 确认 AgentToolCallCard 的所有功能已迁移到 ToolStep
  - 删除旧文件或标记为 deprecated
