# 用户意图检测 API

## 概述

用户意图检测 API 用于分析用户消息，判断是否需要调用特定的工作流。该 API 使用快速 LLM（qwen-max-latest）进行意图分析，为视频编辑聊天功能提供智能工作流调用能力。

## API 端点

### 检测用户意图

**端点**: `POST /api/intent-detection/detect`

**描述**: 分析用户消息并判断是否需要调用任何启用的工作流

#### 请求参数

```json
{
  "user_message": "string",           // 必需：用户的问题或消息
  "enabled_workflows": [              // 必需：当前启用的工作流列表
    {
      "workflow_id": "string",        // 工作流ID
      "workflow_name": "string",      // 工作流名称
      "tool_description": "string",   // 工作流功能描述
      "enabled": true                 // 是否启用
    }
  ],
  "conversation_history": [           // 可选：对话历史（最多使用最近5条）
    {
      "role": "user" | "assistant",
      "content": "string"
    }
  ]
}
```

#### 响应格式

**成功响应** (200 OK):

```json
{
  "success": true,
  "message": "Intent detection completed successfully",
  "data": {
    "should_call_workflow": true,        // 是否需要调用工作流
    "workflow_id": "workflow-123",       // 建议调用的工作流ID（如果需要）
    "workflow_name": "视频剪辑工作流",    // 建议调用的工作流名称（如果需要）
    "reasoning": "用户请求与视频剪辑工作流的功能匹配", // 判断理由
    "confidence": 0.95                   // 置信度 (0-1)
  },
  "error": null
}
```

**失败响应** (500 Internal Server Error):

```json
{
  "success": false,
  "message": "Intent detection failed",
  "data": null,
  "error": "Error message details"
}
```

## 配置

### 环境变量

在 `backend-services/basic-service/.env` 文件中配置以下变量：

```env
# Fast LLM Configuration (for intent detection)
FAST_LLM_API_KEY=<redacted>
FAST_LLM_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
FAST_LLM_MODEL=qwen-max-latest
```

## 工作流程

1. **接收请求**: API 接收用户消息和启用的工作流列表
2. **构建提示词**: 根据可用工作流构建系统提示词
3. **调用 Fast LLM**: 使用 qwen-max-latest 模型分析用户意图
4. **解析响应**: 提取 LLM 返回的结构化 JSON 响应
5. **返回结果**: 返回意图检测结果，包括是否需要调用工作流

## 判断原则

LLM 根据以下原则进行判断：

- **完全匹配** (置信度 > 0.8): 用户需求明确匹配某个工作流功能
- **部分匹配** (置信度 0.5-0.8): 用户需求与工作流功能相关但不完全匹配
- **不匹配** (置信度 < 0.5): 用户只是普通聊天或询问，不需要工作流

## 使用示例

### 示例 1: 需要调用工作流

**请求**:
```json
{
  "user_message": "帮我生成一个视频剪辑",
  "enabled_workflows": [
    {
      "workflow_id": "video-editing-001",
      "workflow_name": "智能视频剪辑",
      "tool_description": "自动分析视频内容并生成精彩片段剪辑",
      "enabled": true
    }
  ]
}
```

**响应**:
```json
{
  "success": true,
  "message": "Intent detection completed successfully",
  "data": {
    "should_call_workflow": true,
    "workflow_id": "video-editing-001",
    "workflow_name": "智能视频剪辑",
    "reasoning": "用户明确要求生成视频剪辑，与智能视频剪辑工作流功能完全匹配",
    "confidence": 0.98
  }
}
```

### 示例 2: 不需要调用工作流

**请求**:
```json
{
  "user_message": "今天天气怎么样？",
  "enabled_workflows": [
    {
      "workflow_id": "video-editing-001",
      "workflow_name": "智能视频剪辑",
      "tool_description": "自动分析视频内容并生成精彩片段剪辑",
      "enabled": true
    }
  ]
}
```

**响应**:
```json
{
  "success": true,
  "message": "Intent detection completed successfully",
  "data": {
    "should_call_workflow": false,
    "workflow_id": null,
    "workflow_name": null,
    "reasoning": "用户询问天气信息，与任何可用工作流都不相关，应进行普通聊天回复",
    "confidence": 0.95
  }
}
```

## 前端集成

### Next.js API 路由

前端通过 Next.js API 代理调用后端服务：

**端点**: `POST /api/intent-detection`

**使用示例**:

```typescript
const response = await fetch('/api/intent-detection', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    user_message: message,
    enabled_workflows: enabledWorkflows,
    conversation_history: history
  }),
});

const data = await response.json();

if (data.success && data.data?.should_call_workflow) {
  // 需要调用工作流
  console.log(`调用工作流: ${data.data.workflow_name}`);
} else {
  // 普通聊天响应
  console.log('继续普通聊天');
}
```

## 错误处理

### 常见错误

| 错误代码 | 描述 | 解决方案 |
|---------|------|---------|
| 400 | 缺少必需参数 | 检查 `user_message` 和 `enabled_workflows` 是否提供 |
| 500 | LLM API 调用失败 | 检查 FAST_LLM_API_KEY 和 API_URL 配置 |
| 500 | JSON 解析失败 | LLM 返回格式错误，通常会自动重试 |

## 性能考虑

- **响应时间**: 通常 500-2000ms（取决于 LLM API 响应速度）
- **并发限制**: 根据 LLM API 的并发限制
- **缓存策略**: 当前不支持缓存，每次请求都会调用 LLM

## 日志记录

服务会详细记录以下信息：

- 请求参数（用户消息长度、工作流数量）
- LLM API 调用详情
- 意图检测结果
- 错误和异常信息

日志级别：
- INFO: 正常流程
- WARNING: LLM API 调用失败但继续执行
- ERROR: 服务异常

## 安全考虑

- API 密钥通过环境变量配置，不暴露在代码中
- 对话历史仅保留最近 5 条消息，避免泄露过多上下文
- 不记录用户消息的完整内容到日志（仅记录长度）

## 未来改进

1. **缓存机制**: 为相似问题缓存意图检测结果
2. **多模型支持**: 支持切换不同的 LLM 模型
3. **自定义规则**: 允许用户自定义意图检测规则
4. **性能优化**: 批量检测多个用户消息
5. **A/B 测试**: 比较不同提示词的效果

