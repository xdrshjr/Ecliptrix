# Video Editing Chat - 工作流执行集成

## 概述

本文档描述了Video Editing任务左侧聊天面板的工作流执行功能集成。当用户向AI助手提问时，如果系统检测到需要调用工作流，界面会展示工作流调用的进度状态和最终回复内容，显示效果与"AI Chat"中调用工作流的效果一致。

## 功能特性

### 1. 意图检测
- 使用Fast LLM（快速语言模型）分析用户消息
- 判断是否需要调用工作流
- 显示意图检测过程和结果

### 2. 工作流执行
- 在客户端使用`WorkflowExecutor`执行工作流
- 实时显示工作流节点执行状态
- 展示工作流执行进度和日志

### 3. 结果展示
- 如果需要执行工作流：显示工作流执行进度和最终结果
- 如果不需要执行工作流：直接返回基础LLM答案

## API端点

### `/api/video-editing-chat`

**方法**: POST

**请求体**:
```json
{
  "taskId": "string",
  "messages": [
    {
      "id": "string",
      "role": "user|assistant",
      "content": "string",
      "timestamp": "Date"
    }
  ],
  "workflowConfigs": [
    {
      "workflowId": "string",
      "workflowName": "string",
      "enabled": true,
      "toolDescription": "string"
    }
  ]
}
```

**响应**: Server-Sent Events (SSE) 流式响应

**响应类型**:

1. **工作流意图信息** (`type: 'workflow_intention'`)
```json
{
  "type": "workflow_intention",
  "intention": {
    "should_call_workflow": true,
    "workflow_name": "string",
    "confidence": 0.95,
    "reasoning": "string"
  }
}
```

2. **普通聊天内容** (`content`)
```json
{
  "content": "string"
}
```

3. **完成信号**
```
data: [DONE]
```

## 前端实现

### 1. 消息类型扩展

在`ChatMessage`类型中添加了`workflowExecution`字段：

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  workflowExecution?: {
    workflowId: string;
    workflowName: string;
    executionState?: WorkflowExecutionState;
  };
  metadata?: {
    type?: 'intent_detection' | 'intent_result';
    status?: string;
    intention?: any;
  };
}
```

### 2. 工作流配置管理

工作流配置包含完整的节点和连接信息：

```typescript
interface WorkflowConfig {
  workflowId: string;
  workflowName: string;
  enabled: boolean;
  toolDescription: string;
  nodes?: WorkflowNode[];
  connections?: WorkflowConnection[];
}
```

### 3. 消息显示组件

使用与AI Chat相同的组件显示工作流执行消息：

- `MessageBubble`: 检测消息类型并选择合适的显示方式
- `WorkflowExecutionMessage`: 显示工作流执行进度和结果
- `ExecutionProcessPanel`: 显示节点执行详情

## 工作流执行流程

### 1. 用户发送消息
```
用户输入 → 创建用户消息 → 发送到API
```

### 2. 意图检测（如果有启用的工作流）
```
显示"正在分析意图"状态
↓
调用意图检测API
↓
显示意图检测结果
```

### 3. 工作流执行（如果需要）
```
查找匹配的工作流配置
↓
创建WorkflowExecutor实例
↓
执行工作流（实时更新状态）
↓
显示执行进度和日志
↓
显示最终结果
```

### 4. 普通LLM响应（如果不需要工作流）
```
流式接收LLM响应
↓
实时更新消息内容
↓
完成响应
```

## 日志记录

### 前端日志

```typescript
console.log('[VideoEditingInterface] 需要执行工作流:', {
  workflowName: string,
  confidence: number,
  reasoning: string
});

console.log('[VideoEditingInterface] 找到工作流配置，开始执行', {
  workflowId: string,
  nodesCount: number,
  connectionsCount: number
});

console.log('[VideoEditingInterface] 工作流执行状态更新:', {
  isRunning: boolean,
  currentNodeId: string | null,
  logsCount: number
});

console.log('[VideoEditingInterface] 工作流执行完成', {
  finalResultLength: number
});
```

### 后端日志

```python
print(f"[Video Editing Chat API] Task {taskId} - 检测到 {len(enabledWorkflows)} 个启用的工作流")
print(f"[Video Editing Chat API] Task {taskId} - Fast LLM意图检测成功")
print(f"[Video Editing Chat API] Task {taskId} - 发送工作流意图信息")
```

## 错误处理

### 1. 工作流未找到
```typescript
// 如果找不到匹配的工作流配置，使用普通LLM响应
console.warn('[VideoEditingInterface] 未找到工作流配置或缺少节点/连接信息');
// 继续显示LLM响应
```

### 2. 工作流执行失败
```typescript
// 捕获执行错误，显示错误消息
console.error('[VideoEditingInterface] 工作流执行失败:', error);
// 在消息中显示错误信息
```

### 3. API调用失败
```typescript
// 捕获API错误，提示用户
console.error('[VideoEditingInterface] 聊天消息发送失败:', error);
showError(`聊天失败: ${error.message}`);
```

## 配置工作流

### 1. 打开工作流配置弹窗
点击Video Editing聊天面板上方的"查看工作流"按钮（闪电图标）

### 2. 选择和启用工作流
- 左侧面板：显示所有可用的工作流列表
- 右侧面板：配置选中工作流的描述信息
- 切换开关：启用/禁用工作流

### 3. 编辑工作流描述
工作流描述用于帮助AI助手了解何时调用该工作流：
```
描述此工作流的功能，让 AI 助手了解何时调用它
```

### 4. 保存配置
点击"保存"按钮保存配置，配置会：
- 存储在内存中（当前会话）
- 保存到后端（持久化）
- 在Video Editing聊天中生效

## 示例场景

### 场景1: 需要执行工作流

**用户输入**: "帮我搜索一些关于旅行的视频"

**系统响应**:
1. 显示"正在分析意图"（蓝色动画）
2. 显示"将调用工作流: Pexels视频搜索"（绿色标签，90%置信度）
3. 显示工作流执行进度：
   - Start节点：已完成
   - Pexels搜索节点：执行中
   - 结果组合节点：待执行
   - End节点：待执行
4. 显示最终结果和导出按钮

### 场景2: 不需要执行工作流

**用户输入**: "如何让视频更有吸引力？"

**系统响应**:
1. 显示"正在分析意图"（蓝色动画）
2. 显示"普通对话 · 这是一般性咨询问题"（灰色标签）
3. 流式显示LLM回答

## 技术细节

### 工作流执行器

使用`WorkflowExecutor`类执行工作流：

```typescript
const executor = new WorkflowExecutor(
  nodes,              // 工作流节点
  connections,        // 节点连接
  stateCallback,      // 状态更新回调
  userInput           // 用户输入
);

await executor.execute();
```

### 状态更新回调

```typescript
(newState: WorkflowExecutionState) => {
  // 更新工作流执行状态
  workflowExecutionState = { ...newState };
  
  // 提取最终结果
  if (!newState.isRunning && newState.endTime) {
    // 从日志中提取结果
  }
  
  // 更新UI消息
  updateConversationMessages(conversationId, updatedMessages);
}
```

### 执行状态结构

```typescript
interface WorkflowExecutionState {
  isRunning: boolean;
  currentNodeId: string | null;
  nodeStates: Record<string, WorkflowNodeExecutionState>;
  logs: WorkflowExecutionLog[];
  startTime?: Date;
  endTime?: Date;
}
```

## 最佳实践

### 1. 工作流描述编写
- 清晰描述工作流的功能
- 说明适用的场景
- 包含关键词以便AI识别

示例：
```
搜索Pexels视频库中的视频素材。当用户需要查找特定主题的视频时调用此工作流。
支持多关键词搜索，可以指定视频时长和方向。
```

### 2. 日志记录
- 记录关键操作和状态变化
- 包含时间戳和上下文信息
- 使用统一的日志格式

### 3. 错误处理
- 捕获所有可能的错误
- 提供友好的错误提示
- 保持界面响应

### 4. 性能优化
- 使用流式响应减少延迟
- 实时更新UI状态
- 避免不必要的状态更新

## 相关文档

- [Workflow API](./workflow-api.md) - 工作流API详细说明
- [Video Editing Chat](./video-editing-chat.md) - 视频编辑聊天基础功能
- [AI Chat Interface](./ai-chat-interface.md) - AI聊天界面参考实现
- [Intent Detection API](./intent-detection.md) - 意图检测API

## 更新日志

### 2024-11-05
- 添加工作流执行集成功能
- 实现意图检测和工作流调用
- 支持与AI Chat相同的工作流执行效果
- 添加详细的日志记录
- 完善错误处理机制

