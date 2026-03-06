# TODO 04 - 工作流界面 + 聊天界面改造

> 对应 Spec: `specs/04-workflow-chat.md`

## ReactFlow 样式覆写（globals.css 或独立文件）
- [x] 添加 `.react-flow__background` 背景覆写为 `var(--background)`
- [x] 添加 `.react-flow__edge-path` stroke 覆写为 `var(--border)`
- [x] 添加 `.react-flow__edge.selected` stroke 覆写为 `var(--primary)`
- [x] 添加 `.react-flow__controls` 样式覆写（bg-card, border, 无阴影）
- [x] 添加 `.react-flow__controls-button` 覆写（hover:bg-accent）
- [x] 添加 `.react-flow__handle` 样式覆写
- [x] 添加 `.react-flow__minimap` 样式覆写

## WorkflowInterface.tsx (26 处)
- [x] 替换容器背景为 `bg-background`
- [x] 替换面板分割边框为 `border-border`
- [x] 替换所有硬编码灰色类名

## WorkflowCanvas.tsx (44 处)
- [x] 替换画布背景颜色
- [x] 替换节点连线颜色
- [x] 替换选中态颜色
- [x] 替换网格/背景点颜色

## 工作流节点
- [x] `BaseWorkflowNode.tsx` — 13 处（节点容器、头部、handle 颜色）
- [x] `ChatLLMNode.tsx` — 9 处
- [x] `EndNode.tsx` — 1 处

## WorkflowSidebar.tsx (19 处)
- [x] 替换侧边栏背景为 `bg-card`
- [x] 替换边框为 `border-border`
- [x] 替换节点拖拽项样式
- [x] 替换分类标题颜色

## 配置面板（逐个处理）
- [x] `ToArrayConfigPanel.tsx` — 65 处
- [x] `AIVideoGenerateConfigPanel.tsx` — 43 处
- [x] `WorkflowEditModal.tsx` — 29 处
- [x] `ResultsCombineConfigPanel.tsx` — 28 处
- [x] `ChatLLMConfigPanel.tsx` — 26 处
- [x] `WorkflowLogPanel.tsx` — 25 处
- [x] `VideoExportConfigPanel.tsx` — 22 处
- [x] `PexelsVideoSearchConfigPanel.tsx` — 20 处
- [x] `StartNodeConfigPanel.tsx` — 19 处
- [x] `NodeTestPanel.tsx` — 15 处
- [x] `NodeExecutionCard.tsx` — 23 处
- [x] `FormatSelector.tsx` — 9 处
- [x] `ExecutionProcessPanel.tsx` — 9 处
- [x] `VolcanoTTSConfigPanel.tsx` — (additional)
- [x] `TavilySearchConfigPanel.tsx` — (additional)
- [x] `TextInputConfigPanel.tsx` — (additional)

## WorkflowChatInterface.tsx (26 处)
- [x] 替换容器、消息区、输入区颜色
- [x] 替换发送按钮为 `bg-primary`

## 聊天模块
- [x] `ChatTypeSelectionModal.tsx` — 50 处（卡片网格、选中态）
- [x] `WorkflowSelectionModal.tsx` — 21 处
- [x] `ChatWindow.tsx` — 20 处（消息区、输入区）
- [x] `ConversationList.tsx` — 15 处（会话列表、选中态）
- [x] `MarkdownRenderer.tsx` — 12 处（代码块、引用、表格）
- [x] `WorkflowExecutionMessage.tsx` — 11 处
- [x] `MessageBubble.tsx` — 10 处（用户/AI 消息背景）
- [x] `ChatInterface.tsx` — 1 处

## 额外节点文件（补充）
- [x] `AIVideoGenerateNode.tsx`
- [x] `PexelsVideoSearchNode.tsx`
- [x] `StartNode.tsx`
- [x] `ResultsCombineNode.tsx`
- [x] `ToArrayNode.tsx`
- [x] `TextInputNode.tsx`
- [x] `TavilySearchNode.tsx`
- [x] `VolcanoTTSNode.tsx`
- [x] `VideoExportNode.tsx`

## 验证
- [x] TypeScript 编译通过（无新增错误）
- [x] 零残留硬编码灰色类名（workflow + chat）
- [x] 零残留 shadow-2xl/xl、backdrop-blur
- [ ] 工作流画布拖拽、连线、缩放正常（需手动测试）
- [ ] 节点选中、编辑、删除正常（需手动测试）
- [ ] 所有配置面板表单交互正常（需手动测试）
- [ ] 工作流执行日志显示正常（需手动测试）
- [ ] 聊天消息发送和渲染正常（需手动测试）
- [ ] Markdown 渲染（代码块、表格、链接）正常（需手动测试）
- [ ] 会话列表切换正常（需手动测试）
- [ ] 深色/亮色模式切换后均显示正常（需手动测试）
