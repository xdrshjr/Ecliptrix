# Video Editing Chat API

## 概述
视频编辑AI助手聊天接口，提供基于当前项目内容的智能对话功能。支持流式响应，实时返回AI生成的内容建议和编辑指导。

## 端点
`POST /api/video-editing-chat`

## 请求格式

### Headers
```
Content-Type: application/json
```

### Body Parameters
| 参数名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| message | string | 是 | 用户输入的消息内容 |
| currentContent | string | 是 | 当前项目的Markdown内容 |
| taskId | string | 是 | 任务唯一标识符 |

### 示例请求
```json
{
  "message": "如何优化这个视频项目的结构？",
  "currentContent": "# 我的视频项目\n\n这是一个关于产品介绍的视频...",
  "taskId": "task_123456"
}
```

## 响应格式

### 成功响应
- **状态码**: 200 OK
- **Content-Type**: text/plain; charset=utf-8
- **响应体**: 服务端推送事件(SSE)流

#### SSE 数据格式
```
data: {"content": "根据您的项目内容，我建议..."}

data: {"content": "首先，您可以考虑..."}

data: [DONE]
```

### 错误响应
- **状态码**: 400 Bad Request
```json
{
  "error": "Invalid request parameters",
  "details": "message cannot be empty"
}
```

- **状态码**: 500 Internal Server Error
```json
{
  "error": "AI service temporarily unavailable",
  "message": "请稍后重试"
}
```

### 示例响应
```
data: {"content": "根据您的项目内容，我建议从以下几个方面来优化视频结构：\n\n"}

data: {"content": "1. **内容层次化**：将主要内容分解为清晰的章节\n"}

data: {"content": "2. **视觉引导**：使用转场效果增强观看体验\n"}

data: [DONE]
```

## 错误代码

### 状态码说明
| 状态码 | 说明 | 常见原因 |
|-------|------|---------|
| 400 | 请求参数错误 | 缺少必需参数或参数格式不正确 |
| 429 | 请求过于频繁 | 超出API调用频率限制 |
| 500 | 服务器内部错误 | AI服务异常或系统故障 |

### 错误处理建议
1. **400错误**: 检查请求参数的完整性和格式
2. **429错误**: 实现指数退避重试机制
3. **500错误**: 向用户显示友好错误信息，建议稍后重试

## 使用示例

### JavaScript/TypeScript 示例
```typescript
async function sendChatMessage(message: string, currentContent: string, taskId: string) {
  const response = await fetch('/api/video-editing-chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: message.trim(),
      currentContent: currentContent,
      taskId: taskId,
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
          console.log('Stream completed');
          return accumulatedContent;
        }
        
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) {
            accumulatedContent += parsed.content;
            // 处理流式内容更新
            onContentUpdate(accumulatedContent);
          }
        } catch (e) {
          console.error('Failed to parse SSE data:', e);
        }
      }
    }
  }
}
```

### cURL 示例
```bash
curl -X POST http://localhost:3000/api/video-editing-chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "请帮我优化视频脚本",
    "currentContent": "# 产品介绍视频\n\n我们的产品具有以下特点...",
    "taskId": "task_123456"
  }' \
  --no-buffer
```

## 测试

### 单元测试示例
```typescript
describe('Video Editing Chat API', () => {
  test('should return streaming response for valid request', async () => {
    const mockRequest = {
      message: 'Test message',
      currentContent: 'Test content',
      taskId: 'test_task'
    };

    const response = await fetch('/api/video-editing-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockRequest)
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    
    // 验证流式响应
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
  });

  test('should return 400 for empty message', async () => {
    const mockRequest = {
      message: '',
      currentContent: 'Test content',
      taskId: 'test_task'
    };

    const response = await fetch('/api/video-editing-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockRequest)
    });

    expect(response.status).toBe(400);
  });
});
```

### 集成测试示例
```typescript
describe('Video Editing Chat Integration', () => {
  test('should process complete conversation flow', async () => {
    const aiService = createAIService('test_task');
    
    const stream = await aiService.sendMessage({
      message: 'Test question',
      currentContent: 'Test content',
      taskId: 'test_task'
    });

    let responseContent = '';
    let completed = false;

    await aiService.processStreamResponse(
      stream,
      (content) => { responseContent += content; },
      () => { completed = true; },
      (error) => { throw error; }
    );

    expect(completed).toBe(true);
    expect(responseContent.length).toBeGreaterThan(0);
  });
});
```

## 性能指标

### 响应时间
- **首字节时间(TTFB)**: < 500ms
- **流式响应延迟**: < 100ms per chunk
- **完整响应时间**: 根据内容长度，通常 2-10 秒

### 并发处理
- **最大并发连接**: 100
- **每用户速率限制**: 10 requests/minute

## 更新日志

### v1.0.0 (2024-01-15)
- 初始版本发布
- 支持基础AI对话功能
- 实现流式响应机制

### v1.1.0 (2024-01-20)
- 添加上下文感知功能
- 优化响应速度
- 增强错误处理机制

### v1.2.0 (当前版本)
- 重构为服务层架构
- 添加详细日志记录
- 改进参数验证和错误处理 