# 04 - 工作流界面 + 聊天界面改造

## 概述

工作流模块有 20 个组件文件共 471 处硬编码颜色，聊天模块 8 个文件共 140 处。两者共享类似的面板布局模式。

## 涉及文件

### 工作流组件（按硬编码数量排序）
| 文件 | 硬编码数 |
|------|---------|
| `ToArrayConfigPanel.tsx` | 65 |
| `WorkflowCanvas.tsx` | 44 |
| `AIVideoGenerateConfigPanel.tsx` | 43 |
| `WorkflowEditModal.tsx` | 29 |
| `ResultsCombineConfigPanel.tsx` | 28 |
| `ChatLLMConfigPanel.tsx` | 26 |
| `WorkflowInterface.tsx` | 26 |
| `WorkflowChatInterface.tsx` | 26 |
| `WorkflowLogPanel.tsx` | 25 |
| `NodeExecutionCard.tsx` | 23 |
| `VideoExportConfigPanel.tsx` | 22 |
| `PexelsVideoSearchConfigPanel.tsx` | 20 |
| `WorkflowSidebar.tsx` | 19 |
| `StartNodeConfigPanel.tsx` | 19 |
| `NodeTestPanel.tsx` | 15 |
| `nodes/BaseWorkflowNode.tsx` | 13 |
| `nodes/ChatLLMNode.tsx` | 9 |
| `FormatSelector.tsx` | 9 |
| `ExecutionProcessPanel.tsx` | 9 |
| `nodes/EndNode.tsx` | 1 |

### 聊天组件
| 文件 | 硬编码数 |
|------|---------|
| `ChatTypeSelectionModal.tsx` | 50 |
| `WorkflowSelectionModal.tsx` | 21 |
| `ChatWindow.tsx` | 20 |
| `ConversationList.tsx` | 15 |
| `MarkdownRenderer.tsx` | 12 |
| `WorkflowExecutionMessage.tsx` | 11 |
| `MessageBubble.tsx` | 10 |
| `ChatInterface.tsx` | 1 |

## 详细设计

### 1. WorkflowInterface 主布局

```pseudo
整体容器:
  背景: bg-background
  布局保持不变（左侧边栏 + 画布 + 右侧面板）

左侧边栏 (WorkflowSidebar):
  背景: bg-card
  右边框: border-r border-border
  节点拖拽项:
    背景: bg-muted hover:bg-accent
    文字: text-foreground
    图标: text-muted-foreground
    圆角: rounded-md
  分类标题: text-muted-foreground text-xs font-medium uppercase

画布区域 (WorkflowCanvas):
  背景: bg-background (深色模式下 #1E1E1E)
  网格点: stroke: var(--border) 或略深色
  ReactFlow 覆写:
    .react-flow__background: 继承 bg-background
    .react-flow__edge: stroke: var(--border)
    .react-flow__edge.selected: stroke: var(--primary)
    .react-flow__handle: bg-muted-foreground border-border
    .react-flow__handle.connected: bg-primary
    .react-flow__minimap: bg-card border border-border rounded-md

右侧面板区域:
  背景: bg-card
  左边框: border-l border-border
```

### 2. 工作流节点 (BaseWorkflowNode)

```pseudo
节点容器:
  背景: bg-card
  边框: border border-border
  圆角: rounded-md
  阴影: 无（去除 shadow）
  选中: border-primary ring-1 ring-primary/30
  hover: border-foreground/20

节点头部:
  背景: bg-muted
  文字: text-foreground text-xs font-medium
  图标: text-muted-foreground
  下边框: border-b border-border

节点内容:
  内边距: p-2
  文字: text-muted-foreground text-xs

Handle（连接点）:
  背景: bg-muted-foreground
  border: 2px solid var(--card)
  hover: bg-primary
```

### 3. 配置面板通用模式

ChatLLMConfigPanel、PexelsVideoSearchConfigPanel 等所有配置面板遵循统一模式：

```pseudo
面板容器:
  背景: bg-card
  最大宽度: 保持不变

表单标签:
  text-muted-foreground text-xs font-medium

输入框:
  bg-input border border-border text-foreground text-xs
  圆角: rounded-md
  focus: border-primary

Select 下拉:
  与输入框一致

Textarea:
  与输入框一致，高度保持

数值输入 / Slider:
  轨道: bg-muted
  滑块/活跃: bg-primary
  标签: text-muted-foreground text-xs

分割线: border-t border-border

操作按钮:
  主按钮: bg-primary text-primary-foreground text-xs
  次要: bg-secondary text-secondary-foreground text-xs
  危险: bg-destructive text-destructive-foreground text-xs
```

### 4. WorkflowLogPanel

```pseudo
容器:
  背景: bg-card
  上边框: border-t border-border

日志条目:
  背景: 交替 bg-card / bg-muted
  时间戳: text-muted-foreground text-xs font-mono
  内容: text-foreground text-xs
  错误: text-destructive
  成功: text-green-500（保留功能色）
  警告: text-yellow-500（保留功能色）

清空按钮:
  text-muted-foreground hover:text-foreground
```

### 5. WorkflowChatInterface

```pseudo
容器:
  背景: bg-card

消息区域:
  背景: bg-background（略深于面板）

输入区域:
  背景: bg-card
  上边框: border-t border-border
  输入框: bg-input border border-border
  发送按钮: bg-primary text-primary-foreground
```

### 6. ChatInterface 主布局

```pseudo
整体容器:
  背景: bg-background
  布局保持不变（左侧会话列表 + 右侧聊天窗口）

ConversationList (左侧):
  背景: bg-card
  右边框: border-r border-border
  会话项:
    背景: hover:bg-accent
    选中: bg-primary/10 border-l-2 border-primary
    标题: text-foreground text-sm
    摘要: text-muted-foreground text-xs
    时间: text-muted-foreground text-xs
  新建按钮: bg-primary text-primary-foreground

ChatWindow (右侧):
  背景: bg-background
  消息区域: 滚动容器

MessageBubble:
  用户消息:
    背景: bg-primary
    文字: text-primary-foreground
    圆角: rounded-md
  AI 消息:
    背景: bg-card
    文字: text-foreground
    边框: border border-border
    圆角: rounded-md

输入区域:
  背景: bg-card
  上边框: border-t border-border
  输入框: bg-input border border-border rounded-md
  发送按钮: bg-primary text-primary-foreground rounded-md
```

### 7. ChatTypeSelectionModal (50 处硬编码)

```pseudo
卡片网格:
  卡片: bg-card border border-border rounded-md
  hover: bg-accent border-foreground/20
  选中: border-primary bg-primary/5
  图标: text-muted-foreground
  标题: text-foreground text-sm font-medium
  描述: text-muted-foreground text-xs
```

### 8. MarkdownRenderer

```pseudo
代码块:
  背景: bg-muted
  边框: border border-border rounded-md
  文字: text-foreground font-mono text-xs

行内代码:
  背景: bg-muted
  文字: text-foreground
  padding: px-1 py-0.5 rounded

链接: text-primary hover:underline

表格:
  边框: border-border
  表头: bg-muted text-foreground
  单元格: text-foreground

引用块:
  左边框: border-l-2 border-primary
  背景: bg-muted/50
  文字: text-muted-foreground
```

### 9. WorkflowEditModal

```pseudo
与通用 Modal 模式一致（见 Spec 03）
输入框: bg-input border border-border
标签: text-muted-foreground
```

## 改造策略

### 执行顺序

1. **WorkflowInterface + WorkflowCanvas** — 主布局框架
2. **BaseWorkflowNode + 各节点** — 节点视觉
3. **WorkflowSidebar** — 侧边栏
4. **各 ConfigPanel** — 按字母顺序
5. **WorkflowLogPanel + WorkflowChatInterface** — 辅助面板
6. **ChatInterface + ChatWindow** — 聊天主布局
7. **MessageBubble + MarkdownRenderer** — 消息渲染
8. **ConversationList** — 会话列表
9. **ChatTypeSelectionModal + WorkflowSelectionModal** — Modal

### ReactFlow 自定义样式

需要在 globals.css 或独立 CSS 文件中添加 ReactFlow 覆写：

```pseudo
.react-flow__background {
  background-color: var(--background) !important;
}

.react-flow__edge-path {
  stroke: var(--border) !important;
  stroke-width: 1.5px;
}

.react-flow__edge.selected .react-flow__edge-path {
  stroke: var(--primary) !important;
  stroke-width: 2px;
}

.react-flow__controls {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: none;
}

.react-flow__controls-button {
  background: var(--card);
  border-bottom: 1px solid var(--border);
  color: var(--muted-foreground);
}

.react-flow__controls-button:hover {
  background: var(--accent);
  color: var(--foreground);
}
```

## 注意事项

- ReactFlow 内部样式需要 `!important` 覆写
- 节点类型颜色编码（如不同类型节点的头部颜色标识）可保留，但降低饱和度
- 工作流执行状态的颜色（运行中=蓝、完成=绿、错误=红）保留功能色
- ChatTypeSelectionModal 硬编码最多（50 处），需特别注意逐一替换
