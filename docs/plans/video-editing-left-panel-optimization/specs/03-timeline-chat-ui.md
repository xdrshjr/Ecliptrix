# Spec 03: 时间轴式对话 UI 重构

## 目标

将左侧面板的对话展示从传统聊天气泡重构为垂直时间轴+节点卡片的交互形态，清晰展示对话进程和 Agent 执行进度，支持展开/收起详情、单操作撤销/重做、状态动画。

## 现状分析

### 当前 UI 结构

```
VideoChatWindow
├── 消息列表（scrollable）
│   ├── MessageBubble（用户/AI普通消息）
│   └── AgentMessageBubble
│       ├── Markdown 内容
│       ├── AgentToolCallCard[] （工具调用列表）
│       └── 撤销按钮
├── Agent 模式切换
└── 输入区域
```

**问题:**
1. Agent 消息和普通消息视觉上没有明确区分，用户难以追踪执行进度
2. 工具调用列表是简单的堆叠，缺少时序关系和进度感
3. 撤销是整个消息级别的（恢复时间轴快照），不支持单个操作粒度
4. 没有"正在分析..."、"正在执行..."、"已完成"等明确阶段指示
5. 消息之间没有时间线的视觉连接

## 设计方案

### 新组件结构

```
TimelineChatPanel (替代 VideoChatWindow 的消息列表区域)
├── TimelineConnector（垂直连接线）
├── TimelineNode[] （节点列表）
│   ├── UserMessageNode（用户消息节点）
│   ├── AgentThinkingNode（AI思考/分析中节点）
│   ├── AgentExecutionNode（AI执行操作节点）
│   │   ├── ExecutionHeader（操作概要+状态）
│   │   ├── ToolStepList（可展开的工具步骤列表）
│   │   │   └── ToolStep（单个工具执行步骤）
│   │   └── ExecutionFooter（结果摘要+操作按钮）
│   └── AgentResponseNode（AI文本回复节点）
├── StreamingIndicator（流式传输指示器）
└── 输入区域（复用现有）
```

### 时间轴布局

```
┌─────────────────────────────────────┐
│  ● 14:23  用户                       │
│  │  "帮我把第一个视频裁剪前5秒，      │
│  │   然后添加一段背景音乐"            │
│  │                                   │
│  ◐ 14:23  AI 分析中...               │ ← AgentThinkingNode
│  │  正在理解您的编辑需求               │
│  │                                   │
│  ◉ 14:23  执行操作 (2/3)             │ ← AgentExecutionNode
│  │  ┌─────────────────────────┐      │
│  │  │ ✅ 获取时间轴状态        │      │ ← ToolStep (completed)
│  │  │    3条轨道, 5个片段      │      │
│  │  ├─────────────────────────┤      │
│  │  │ ✅ 裁剪片段             │      │ ← ToolStep (completed)
│  │  │    video-1: 0s→5s 已裁剪 │      │
│  │  ├─────────────────────────┤      │
│  │  │ ⏳ 搜索背景音乐...       │      │ ← ToolStep (executing)
│  │  │    ████████░░ 80%        │      │
│  │  └─────────────────────────┘      │
│  │                                   │
│  ● 14:24  AI 完成                    │ ← AgentResponseNode
│  │  "已完成裁剪并添加了背景音乐。     │
│  │   [撤销全部] [撤销裁剪] [撤销音乐]"│
│  │                                   │
│  ● 14:25  用户                       │
│  │  "音乐声音太大了，调小一点"        │
│  │                                   │
└─────────────────────────────────────┘
```

### 节点类型详细设计

#### 1. UserMessageNode

```
● {时间}  用户
│  {消息内容}
```

- 圆形实心节点（●），位于时间线左侧
- 显示时间戳
- 消息内容支持多行文本

#### 2. AgentThinkingNode

```
◐ {时间}  AI 分析中...
│  {thinking内容或占位文本}
```

- 半圆动画节点（◐），旋转动画表示进行中
- 显示 Agent 的初始文本输出（如"正在分析您的需求..."）
- streaming 完成后消失或合并到 ExecutionNode

#### 3. AgentExecutionNode

```
◉ {时间}  执行操作 ({已完成}/{总数})
│  ┌──────────────────────┐
│  │ {ToolStep 1}          │
│  │ {ToolStep 2}          │
│  │ ...                   │
│  └──────────────────────┘
```

- 同心圆节点（◉），执行中有脉冲动画
- Header 显示进度计数
- 内部是可展开/收起的 ToolStep 列表
- 默认展开正在执行的步骤，收起已完成的

**ToolStep 子组件:**

```
{状态图标} {工具显示名}             {耗时}
   {参数/结果摘要（一行）}
   ▼ 展开详情（可选）
     ├── 输入参数
     └── 执行结果
```

状态图标:
- ⏳ executing — 旋转加载图标
- ✅ completed — 绿色对勾
- ❌ error — 红色叉号 + 错误信息
- ↩️ undone — 灰色回退图标

#### 4. AgentResponseNode

```
● {时间}  AI
│  {响应文本，Markdown渲染}
│  [操作按钮区域]
```

- 实心节点
- 显示 Agent 的最终文本总结
- 操作按钮区域：
  - "撤销全部" — 恢复到操作前的时间轴快照
  - 单个操作的撤销按钮（如"撤销裁剪"、"撤销添加音乐"）

### 消息到节点的映射

一条 Agent 消息（ChatMessage with isAgentMessage=true）会被拆分为多个时间轴节点：

```typescript
// 伪代码 — 映射逻辑
function mapMessageToNodes(message: ChatMessage): TimelineNode[] {
  const nodes: TimelineNode[] = [];

  if (message.isAgentMessage) {
    // 如果有streaming中的文本且还没有工具调用 → ThinkingNode
    if (message.isStreaming && !message.agentToolCalls?.length) {
      nodes.push({ type: 'thinking', content: message.content });
    }

    // 如果有工具调用 → ExecutionNode
    if (message.agentToolCalls?.length) {
      nodes.push({
        type: 'execution',
        toolCalls: message.agentToolCalls,
        isActive: message.isStreaming,
      });
    }

    // 如果不在streaming且有内容 → ResponseNode
    if (!message.isStreaming && message.content) {
      nodes.push({
        type: 'response',
        content: message.content,
        operations: message.pendingOperations,
        isUndone: message.isUndone,
      });
    }
  } else {
    // 普通消息 → UserMessageNode 或 AI 回复 Node
    nodes.push({
      type: message.role === 'user' ? 'user' : 'response',
      content: message.content,
    });
  }

  return nodes;
}
```

### 时间轴连接线

- 垂直线贯穿所有节点，使用 CSS 的 `border-left` 或 `::before` 伪元素
- 节点图标叠加在连接线上
- 最后一个节点的连接线延伸到底部（如果正在streaming）或截止
- 颜色: 默认中性灰，执行中区间使用主题色

### 展开/收起机制

- **ExecutionNode 默认行为:**
  - 正在执行时：展开所有步骤
  - 执行完成后：收起已完成步骤，只显示概要（"3个操作已完成"）
  - 用户可以点击展开查看详情

- **ToolStep 展开:**
  - 默认显示：图标 + 名称 + 一行摘要
  - 展开后显示：完整参数 + 完整结果

- **动画:** 展开/收起使用高度过渡动画（CSS transition 或 framer-motion AnimatePresence）

### 单操作撤销

当前只支持整个消息级别的撤销（恢复 timelineSnapshot）。需要增加单个工具操作的撤销：

```typescript
// 伪代码 — 增强的操作记录
interface ToolCallRecord {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  result: unknown;
  status: 'executing' | 'completed' | 'error' | 'undone';
  operation: TimelineOperation | null;
  // 新增：用于单操作撤销
  preOperationSnapshot?: Partial<TimelineState>;  // 该操作前的受影响片段状态
}
```

**单操作撤销流程:**
1. 每个工具执行前，保存受影响片段的局部快照（不是完整时间轴）
2. 撤销时，仅恢复该操作影响的片段状态
3. 如果后续操作依赖已撤销操作的结果，提示用户需要同时撤销

**限制:** 单操作撤销仅支持最近一轮 Agent 消息中的操作（与当前整体撤销一致的范围）

## 涉及文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/components/video/components/VideoChatWindow/TimelineChatPanel.tsx` | **新建** | 时间轴消息面板主组件 |
| `src/components/video/components/VideoChatWindow/TimelineNode.tsx` | **新建** | 各类型节点组件 |
| `src/components/video/components/VideoChatWindow/ToolStep.tsx` | **新建** | 工具执行步骤组件 |
| `src/components/video/components/VideoChatWindow/TimelineConnector.tsx` | **新建** | 时间轴连接线组件 |
| `src/components/video/components/VideoChatWindow/VideoChatWindow.tsx` | **重构** | 用 TimelineChatPanel 替换消息列表 |
| `src/components/video/components/VideoChatWindow/AgentMessageBubble.tsx` | **废弃** | 被 TimelineNode 组件替代 |
| `src/components/video/components/VideoChatWindow/AgentToolCallCard.tsx` | **废弃** | 被 ToolStep 组件替代 |

## 验收标准

1. 所有消息以垂直时间轴形式展示，节点间有连续的连接线
2. Agent 执行过程中，工具步骤实时更新显示
3. 已完成的 ExecutionNode 默认收起，点击可展开
4. 支持单个工具操作的撤销（不仅是整体撤销）
5. 节点状态切换有平滑的动画过渡
6. 自动滚动到最新节点（保持现有 auto-scroll 行为）
7. 暗色模式正确适配

## 边界情况

- **纯文本对话（非Agent模式）**: 仍然以时间轴形式展示，但只有 UserMessageNode 和 ResponseNode
- **空对话**: 显示欢迎提示/引导信息
- **超长工具结果**: ToolStep 展开后内容截断，提供"查看全部"
- **快速连续操作**: 多个工具步骤快速完成时的动画不应阻塞
- **消息被撤销后的显示**: 整个 ExecutionNode 显示为灰色/删除线样式
