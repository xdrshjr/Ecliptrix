# Video Editing Chat API

## 概述

视频编辑聊天 API 为 Video Editing 任务提供 AI 对话功能。用户可以通过聊天界面与 AI 助手交流，获取视频编辑、脚本优化、创意建议等专业指导。

## API 端点

```
POST /api/video-editing-chat
```

## 功能特性

- 🎬 **专业的视频编辑指导**：AI 助手专门针对视频编辑场景进行优化
- 💬 **流式响应**：实时流式传输 AI 回复，提供流畅的对话体验
- 📝 **系统提示优化**：内置视频编辑专业系统提示，确保回复质量
- 🔄 **上下文管理**：支持多轮对话，保持上下文连贯性
- 📊 **详细日志**：完整的请求响应日志，便于调试和监控

## AI 助手能力

视频编辑 AI 助手可以帮助用户完成以下任务：

1. **脚本编写与优化**：帮助用户创作和改进视频脚本
2. **创意建议**：提供视频创意、拍摄角度、剪辑手法等建议
3. **技术指导**：解答视频剪辑、特效、转场等技术问题
4. **素材推荐**：根据脚本内容推荐合适的视频素材、音乐、图片等
5. **时间轴规划**：帮助用户规划视频时间轴和节奏
6. **文案润色**：优化视频文案、字幕、标题等文本内容

## 请求格式

### Headers

```
Content-Type: application/json
```

### Body Parameters

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `taskId` | string | 是 | 视频编辑任务的唯一标识符 |
| `messages` | ChatMessage[] | 是 | 对话消息数组，包含用户和助手的历史消息 |

### ChatMessage 类型

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}
```

### 请求示例

```json
{
  "taskId": "video-task-123",
  "messages": [
    {
      "id": "msg-1",
      "role": "user",
      "content": "我想制作一个关于旅行的短视频，能给我一些脚本创意吗？",
      "timestamp": "2024-01-01T10:00:00Z"
    }
  ]
}
```

## 响应格式

### 流式响应 (Server-Sent Events)

API 使用 Server-Sent Events (SSE) 进行流式响应。

### Headers

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### SSE 数据格式

每个数据块的格式：

```
data: {"content": "部分响应内容"}

```

流式传输结束标记：

```
data: [DONE]

```

### 响应示例

```
data: {"content": "很高兴"}

data: {"content": "帮助你"}

data: {"content": "创作"}

data: {"content": "旅行"}

data: {"content": "短视频"}

data: [DONE]

```

## 错误处理

### 错误响应格式

```json
{
  "error": "错误描述",
  "details": "详细错误信息（可选）"
}
```

### 常见错误码

| 状态码 | 错误描述 | 解决方案 |
|--------|----------|----------|
| 400 | Messages array is required | 确保请求包含有效的 messages 数组 |
| 401 | Unauthorized | 检查 API key 配置是否正确 |
| 500 | Internal server error | 查看服务器日志，检查 LLM API 配置 |
| 502/503 | LLM API error | LLM 服务不可用，稍后重试 |

## 环境变量配置

API 需要以下环境变量：

```bash
# LLM API 配置（必填）
LLM_API_URL=https://api.openai.com/v1
LLM_API_KEY=your-api-key-here
LLM_MODEL=gpt-3.5-turbo

# 或使用 OpenAI 兼容配置
OPENAI_API_URL=https://api.openai.com/v1
OPENAI_API_KEY=your-api-key-here
```

## 使用示例

### 前端调用示例

```typescript
async function sendVideoEditingMessage(taskId: string, messages: ChatMessage[]) {
  const response = await fetch('/api/video-editing-chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      taskId,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No reader available');
  }

  let accumulatedContent = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = new TextDecoder().decode(value);
    const lines = chunk.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          break;
        }
        
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) {
            accumulatedContent += parsed.content;
            // 更新 UI 显示流式内容
            console.log('Current content:', accumulatedContent);
          }
        } catch (e) {
          console.error('Error parsing SSE data:', e);
        }
      }
    }
  }

  return accumulatedContent;
}
```

### cURL 调用示例

```bash
curl -X POST http://localhost:3000/api/video-editing-chat \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "video-task-123",
    "messages": [
      {
        "id": "msg-1",
        "role": "user",
        "content": "如何为旅行视频选择合适的背景音乐？",
        "timestamp": "2024-01-01T10:00:00Z"
      }
    ]
  }'
```

## 日志记录

API 提供详细的日志记录，便于调试和监控：

### 请求日志

```
[Video Editing Chat API] 2024-01-01T10:00:00.000Z - 收到视频编辑聊天请求
[Video Editing Chat API] Task ID: video-task-123
[Video Editing Chat API] Model: gpt-3.5-turbo
[Video Editing Chat API] Messages count: 1
[Video Editing Chat API] Last message role: user
[Video Editing Chat API] Last message preview: 如何为旅行视频选择合适的背景音乐？
```

### 响应日志

```
[Video Editing Chat API] Task video-task-123 - 调用 LLM API: https://api.openai.com/v1/chat/completions
[Video Editing Chat API] Task video-task-123 - 流式传输完成，总计 45 个数据块
[Video Editing Chat API] 2024-01-01T10:00:05.000Z - Task video-task-123 响应成功完成
```

### 错误日志

```
[Video Editing Chat API] Task video-task-123 - LLM API 错误: 503 - Service Unavailable
[Video Editing Chat API] 2024-01-01T10:00:05.000Z - Task video-task-123 响应失败: LLM API error: 503
```

## 性能优化建议

1. **消息历史管理**：建议保留最近 20-30 条消息，避免上下文过长影响性能
2. **错误重试**：实现指数退避重试策略，处理临时网络错误
3. **超时控制**：设置合理的请求超时时间（建议 30-60 秒）
4. **流式渲染**：利用流式响应实时更新 UI，提升用户体验

## 最佳实践

1. **系统提示**：API 已内置专业的视频编辑系统提示，无需在客户端添加
2. **上下文管理**：合理管理对话历史，保持上下文连贯性
3. **错误处理**：实现完善的错误处理和用户提示
4. **日志监控**：利用详细的日志进行问题排查和性能监控
5. **用户体验**：使用流式响应提供实时反馈，改善交互体验

## 相关文档

- [AI Chat Interface API](./ai-chat-interface.md) - 通用 AI 聊天接口文档
- [Video Editing Interface](./video-editing-interface.md) - 视频编辑界面完整文档

## 更新日志

### 2024-10-31
- 🎉 初始版本发布
- ✨ 支持视频编辑专业对话
- 🚀 流式响应实现
- 📝 详细日志记录
- 🎨 Apple 风格聊天界面

