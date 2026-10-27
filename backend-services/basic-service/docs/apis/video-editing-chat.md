# Video Editing Chat API

## 概述
视频编辑AI助手聊天接口，提供基于当前项目内容的智能对话功能。支持流式响应，实时返回AI生成的内容建议和编辑指导。

**架构说明**: 此接口现在由Python FastAPI后端实现，通过Next.js代理层提供服务。LLM调用在Python后端进行，确保更好的性能和配置管理。

**智能意图检测**: 集成Fast LLM进行用户意图快速分析：
- 使用Fast LLM (qwen-max-latest)快速检测用户意图
- 判断是否需要调用特定工作流处理请求
- 自动在工作流执行和普通对话之间智能切换
- 配置位置：`backend-services/basic-service/.env` 中的 `FAST_LLM_*` 环境变量

## 端点
`POST /api/video-editing-chat` (通过Next.js代理到Python后端)

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
  "details": "message cannot be empty",
  "taskId": "task_123456"
}
```

- **状态码**: 500 Internal Server Error
```json
{
  "error": "AI service temporarily unavailable",
  "details": "LLM API not properly configured",
  "taskId": "task_123456"
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
| 500 | 内部服务器错误 | LLM API配置错误或服务不可用 |

## 技术实现

### 架构流程
1. **前端请求** → Next.js API路由 (`/api/video-editing-chat`)
2. **代理转发** → Python FastAPI后端 (`/api/video-editing-chat`)
3. **LLM调用** → Python后端调用配置的LLM API
4. **流式响应** → 通过代理层实时转发到前端

### 配置要求
Python后端需要配置以下环境变量：
```env
# 主 LLM 配置（用于正常对话响应）
LLM_API_KEY=<redacted>
LLM_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=deepseek-v3

# Fast LLM 配置（用于快速意图检测）
FAST_LLM_API_KEY=<redacted>
FAST_LLM_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
FAST_LLM_MODEL=qwen-max-latest
```

Next.js需要配置后端服务地址：
```env
BACKEND_SERVICE_URL=http://localhost:8000
# 或
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

**重要**: 如果 `FAST_LLM_API_KEY` 未配置，意图检测功能将不可用，但不会影响基本聊天功能。系统会在日志中记录警告信息。

### 性能特性
- **流式传输**: 支持实时流式响应，提供更好的用户体验
- **错误处理**: 完整的错误处理和日志记录
- **代理架构**: 通过代理层分离前后端职责
- **配置集中**: LLM配置统一在Python后端管理

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
- **架构重构**: 从Next.js直接调用LLM改为Python FastAPI后端实现
- **性能优化**: LLM调用在Python后端进行，提升响应速度
- **配置管理**: 统一在Python后端管理LLM API配置
- **代理架构**: Next.js作为代理层，保持前端接口不变
- **日志增强**: 添加详细的请求/响应日志记录
- **错误处理**: 完善的错误处理和用户友好的错误信息 