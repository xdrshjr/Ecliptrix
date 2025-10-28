# AI Chat 工作流执行修复文档

## 概述

本文档描述了对 AI Chat 任务中工作流执行功能的修复。修复前，AI Chat 中使用工作流时只返回占位符响应，无法执行真实的工作流。修复后，AI Chat 中的工作流调用与 Workflows 任务中的逻辑保持一致，能够正确执行工作流并返回实际结果。

## 问题描述

### 修复前的问题

1. **AI Chat 工作流调用使用模拟数据**
   - `/api/chat/workflow` 端点使用硬编码的模拟节点数据
   - 返回占位符响应而非实际工作流执行结果
   - 示例输出：
     ```
     Start Node
     Processed: 蔡徐坤是谁

     Processing
     Processed: 蔡徐坤是谁

     End Node
     Processed: 蔡徐坤是谁

     最终结果
     Workflow processed your input: "蔡徐坤是谁"

     This is a placeholder response. In production, this would contain the actual workflow execution result.
     ```

2. **与 Workflows 任务执行逻辑不一致**
   - Workflows 任务使用 `WorkflowExecutor` 类真正执行工作流
   - AI Chat 任务使用模拟逻辑，两者不一致
   - 导致用户体验混乱

## 解决方案

### 1. 创建服务端工作流执行器

创建了 `ServerWorkflowExecutor` 类 (`src/lib/workflow/ServerWorkflowExecutor.ts`)，这是 `WorkflowExecutor` 的服务端版本：

**主要特性：**
- 适配服务端环境（Node.js）
- 支持所有节点类型：Start, Text Input, Chat LLM, Pexels Video Search, Tavily Search, Volcano TTS, To Array, End
- 通过回调机制实时反馈执行状态
- 完整的错误处理和日志记录

**关键接口：**
```typescript
interface ServerExecutionCallback {
  onNodeUpdate: (nodeId: string, nodeName: string, status: 'executing' | 'completed' | 'error', output?: any, error?: string) => void;
  onLog: (level: 'info' | 'success' | 'warning' | 'error', message: string, nodeId?: string, nodeName?: string, details?: any) => void;
  onComplete: (finalOutput: any) => void;
  onError: (error: Error) => void;
}
```

### 2. 修改 API 端点

修改了 `/api/chat/workflow` 端点 (`src/app/api/chat/workflow/route.ts`)：

**主要改进：**
- 接收完整的工作流数据（nodes 和 connections）
- 使用 `ServerWorkflowExecutor` 真正执行工作流
- 通过 Server-Sent Events (SSE) 流式返回执行状态
- 支持实时节点执行更新和日志

**请求参数：**
```typescript
{
  workflowId: string;          // 工作流ID
  userInput: string;           // 用户输入
  messages: ChatMessage[];     // 聊天历史
  nodes: WorkflowNode[];       // 工作流节点数据
  connections: WorkflowConnection[]; // 工作流连接数据
}
```

**响应格式（SSE）：**

1. **状态更新：**
```json
{
  "type": "status",
  "status": "loading",
  "message": "Initializing workflow execution..."
}
```

2. **执行开始：**
```json
{
  "type": "execution_start",
  "workflowId": "workflow-123",
  "timestamp": "2025-10-28T10:00:00.000Z"
}
```

3. **节点更新：**
```json
{
  "type": "node_update",
  "nodeId": "node-1",
  "nodeName": "Start Node",
  "status": "executing|completed|error",
  "output": {...},
  "error": "error message",
  "startTime": "2025-10-28T10:00:00.000Z",
  "endTime": "2025-10-28T10:00:01.000Z"
}
```

4. **日志：**
```json
{
  "type": "log",
  "level": "info|success|warning|error",
  "message": "Log message",
  "nodeId": "node-1",
  "nodeName": "Node Name",
  "details": {...},
  "timestamp": "2025-10-28T10:00:00.000Z"
}
```

5. **最终结果：**
```json
{
  "type": "final_result",
  "content": "Final workflow output",
  "timestamp": "2025-10-28T10:00:05.000Z"
}
```

6. **完成信号：**
```
data: [DONE]
```

### 3. 修改前端数据结构

**扩展 Conversation 类型** (`src/types/index.ts`)：
```typescript
export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  chatType?: 'chatbot' | 'workflow' | 'agent';
  workflowId?: string;
  workflowName?: string;
  workflowNodes?: WorkflowNode[];        // 新增：工作流节点数据
  workflowConnections?: WorkflowConnection[]; // 新增：工作流连接数据
}
```

### 4. 修改前端组件

**ChatInterface.tsx 修改：**

1. **handleCreateConversation** - 接收并存储工作流数据：
```typescript
const handleCreateConversation = useCallback((
  chatType: 'chatbot' | 'workflow' | 'agent',
  workflowId?: string,
  workflowName?: string,
  workflowNodes?: any[],      // 新增
  workflowConnections?: any[] // 新增
) => {
  // 创建包含完整工作流数据的对话
  const newConversation: Conversation = {
    // ...
    workflowNodes,
    workflowConnections,
  };
}, []);
```

2. **handleSendMessage** - 发送工作流数据到 API：
```typescript
const requestBody = useWorkflow ? {
  messages: messagesWithUser,
  workflowId: activeConversation.workflowId,
  userInput: message,
  nodes: activeConversation.workflowNodes || [],       // 新增
  connections: activeConversation.workflowConnections || [], // 新增
} : {
  messages: messagesWithUser,
};
```

**ChatTypeSelectionModal.tsx 修改：**

更新工作流选择回调以传递完整的工作流数据：
```typescript
const handleSelectWorkflow = (workflow: WorkflowRecord) => {
  onSelectWorkflow(
    workflow.workflow_id, 
    workflow.workflow_name,
    workflow.nodes || [],      // 新增
    workflow.connections || [] // 新增
  );
};
```

## 使用流程

### 1. 创建工作流对话

1. 用户点击 "New Chat" 按钮
2. 选择 "Workflow" 类型
3. 从列表中选择一个工作流
4. 系统创建新对话，包含完整的工作流数据（nodes 和 connections）

### 2. 执行工作流

1. 用户在对话中输入消息
2. 前端将用户输入、工作流nodes和connections发送到 `/api/chat/workflow`
3. 服务端创建 `ServerWorkflowExecutor` 实例
4. 服务端执行工作流，实时通过 SSE 返回执行状态
5. 前端接收并显示：
   - 节点执行进度
   - 执行日志
   - 最终结果

### 3. 显示结果

前端已有的 `WorkflowExecutionMessage` 组件会显示：
- 工作流执行过程（可折叠）
- 每个节点的状态（executing/completed/error）
- 节点执行时间
- 节点输出
- 最终结果

## 技术细节

### 节点执行顺序

工作流执行器使用广度优先搜索（BFS）从 Start 节点遍历到 End 节点：

1. 找到 Start 节点
2. 从 Start 节点开始，通过连接找到下一个节点
3. 按顺序执行每个节点
4. 将前一个节点的输出传递给下一个节点
5. 到达 End 节点时完成执行

### 数据流转

```
用户输入 → Start 节点 → 中间节点(s) → End 节点 → 最终结果
```

每个节点的输出会作为下一个节点的输入，支持复杂的数据处理流程。

### 错误处理

- 节点执行失败时，立即停止工作流执行
- 通过 SSE 发送错误信息
- 前端显示错误状态和错误消息
- 详细的日志记录便于调试

### 性能考虑

- 使用 SSE 实现流式响应，用户可实时看到执行进度
- 避免长时间等待
- 支持中断执行（虽然当前实现中尚未暴露到前端）

## 日志记录

### 服务端日志

`ServerWorkflowExecutor` 和 API 端点都有详细的日志记录：

```typescript
console.log('[ServerWorkflowExecutor] Starting workflow execution');
console.log('[Workflow Chat API] Request received:', {
  workflowId,
  userInputLength: userInput?.length || 0,
  nodesCount: nodes.length,
  connectionsCount: connections.length,
});
```

### 前端日志

前端组件也有完整的日志记录：

```typescript
console.log('[ChatInterface] Sending message:', {
  chatType,
  useWorkflow,
  workflowId,
  workflowName,
  nodesCount,
  connectionsCount,
  messageLength,
});
```

## 测试建议

### 基本测试

1. **简单工作流**
   - Start → Text Input → End
   - 验证基本执行流程

2. **LLM 工作流**
   - Start → Chat LLM → End
   - 验证 LLM 调用和流式响应

3. **搜索工作流**
   - Start → Pexels/Tavily Search → End
   - 验证外部 API 调用

4. **复杂工作流**
   - Start → Chat LLM → To Array → End
   - 验证多节点数据传递

### 边界测试

1. **空工作流** - 验证错误处理
2. **无连接工作流** - 验证路径检测
3. **错误节点配置** - 验证配置验证
4. **网络错误** - 验证错误恢复

### 性能测试

1. **长时间执行** - 验证超时处理
2. **大量节点** - 验证性能
3. **并发执行** - 验证多用户场景

## 注意事项

1. **用户认证**
   - 当前实现中未强制要求用户认证
   - 生产环境应添加认证机制

2. **工作流数据验证**
   - 应验证 nodes 和 connections 的完整性
   - 防止恶意数据注入

3. **超时处理**
   - 长时间执行的工作流应设置超时
   - 避免服务器资源耗尽

4. **错误恢复**
   - 节点执行失败应有适当的错误提示
   - 考虑实现重试机制

## 文件清单

### 新增文件

- `src/lib/workflow/ServerWorkflowExecutor.ts` - 服务端工作流执行器

### 修改文件

- `src/app/api/chat/workflow/route.ts` - API 端点实现
- `src/types/index.ts` - 类型定义扩展
- `src/components/chat/ChatInterface.tsx` - 前端聊天界面
- `src/components/chat/ChatTypeSelectionModal.tsx` - 工作流选择模态框

## 总结

通过创建服务端工作流执行器并修改前后端数据流，成功实现了 AI Chat 任务中的真实工作流执行功能。现在，AI Chat 和 Workflows 任务使用相同的执行逻辑，保证了功能的一致性和可维护性。

用户现在可以在 AI Chat 中：
1. 选择任意已保存的工作流
2. 通过聊天方式输入数据
3. 实时查看工作流执行进度
4. 获得真实的工作流执行结果

这一修复大大提升了用户体验，使 AI Chat 成为使用工作流的便捷方式。

