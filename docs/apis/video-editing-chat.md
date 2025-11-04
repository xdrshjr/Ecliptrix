# Video Editing Chat API

## 概述

视频编辑聊天 API 提供一个基于 AI 的对话式助手，帮助用户进行视频编辑相关的工作，包括脚本编写、创意建议、技术指导等。该 API 使用服务器发送事件（SSE）实现流式响应，确保实时的对话体验。

## 端点

```
POST /api/video-editing-chat
```

## 请求格式

### Headers
```
Content-Type: application/json
```

### Body
```json
{
  "taskId": "string",      // 任务ID，用于日志跟踪
  "messages": [            // 聊天消息历史数组
    {
      "id": "string",
      "role": "user" | "assistant",
      "content": "string",
      "timestamp": "ISO8601 datetime"
    }
  ]
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
      "content": "帮我优化这个视频脚本：一个关于旅行的短视频",
      "timestamp": "2025-11-01T10:00:00Z"
    }
  ]
}
```

## 响应格式

### 流式响应 (Server-Sent Events)

该 API 使用 SSE 格式返回流式响应，每个数据块格式如下：

```
data: {"content": "响应文本片段"}

data: [DONE]
```

### Response Headers
```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
X-Content-Type-Options: nosniff
```

### 流式响应示例
```
: stream-start

data: {"content":"我"}

data: {"content":"来"}

data: {"content":"帮"}

data: {"content":"你"}

data: [DONE]
```

## 客户端实现

### JavaScript/TypeScript 示例

```typescript
const response = await fetch('/api/video-editing-chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    taskId: taskId,
    messages: conversationMessages,
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
          // 更新 UI 显示
          updateMessageDisplay(accumulatedContent);
        }
      } catch (e) {
        console.error('Error parsing SSE data:', e);
      }
    }
  }
}
```

## AI 助手功能

视频编辑 AI 助手提供以下功能：

1. **脚本编写与优化**：帮助用户创作和改进视频脚本
2. **创意建议**：提供视频创意、拍摄角度、剪辑手法等建议
3. **技术指导**：解答视频剪辑、特效、转场等技术问题
4. **素材推荐**：根据脚本内容推荐合适的视频素材、音乐、图片等
5. **时间轴规划**：帮助用户规划视频时间轴和节奏
6. **文案润色**：优化视频文案、字幕、标题等文本内容

## 错误处理

### 错误响应格式
```json
{
  "error": "错误描述",
  "details": "详细错误信息"
}
```

### 常见错误

| 状态码 | 错误描述 | 解决方案 |
|--------|---------|---------|
| 400 | Messages array is required | 确保请求包含有效的 messages 数组 |
| 500 | API key not configured | 检查环境变量 LLM_API_KEY 或 OPENAI_API_KEY |
| 500 | LLM API error | 检查 LLM API 服务状态和配置 |

## 环境变量配置

```bash
# LLM API 配置（必需）
LLM_API_URL=https://api.openai.com/v1  # 或其他兼容 OpenAI 的 API 地址
LLM_API_KEY=your-api-key                 # API 密钥
LLM_MODEL=gpt-3.5-turbo                  # 使用的模型

# 或者使用 OpenAI 配置（兼容）
OPENAI_API_URL=https://api.openai.com/v1
OPENAI_API_KEY=your-api-key
```

## 生产环境部署注意事项

### 流式传输问题排查

如果在生产环境中流式传输不工作（等待完整响应后才显示），可能的原因和解决方案：

#### 1. Nginx 反向代理缓冲

**问题**：Nginx 默认会缓冲响应，导致 SSE 无法实时传输

**解决方案**：在 Nginx 配置中添加以下设置

```nginx
location /api/video-editing-chat {
    proxy_pass http://your-backend;
    
    # 禁用代理缓冲（关键）
    proxy_buffering off;
    
    # 支持 SSE
    proxy_set_header Connection '';
    proxy_http_version 1.1;
    chunked_transfer_encoding on;
    
    # 禁用缓存
    proxy_cache off;
    proxy_no_cache 1;
    proxy_cache_bypass 1;
    
    # 超时设置
    proxy_read_timeout 300s;
    proxy_connect_timeout 75s;
}
```

**验证**：检查响应头是否包含 `X-Accel-Buffering: no`

#### 2. Apache 反向代理缓冲

**问题**：Apache 也可能缓冲响应

**解决方案**：在 Apache 配置中添加

```apache
<Location /api/video-editing-chat>
    ProxyPass http://your-backend
    
    # 禁用输出缓冲
    SetEnv proxy-sendcl 0
    SetEnv proxy-sendchunked 1
</Location>
```

#### 3. CDN/负载均衡器缓冲

**问题**：CDN（如 Cloudflare、CloudFront）或负载均衡器可能缓冲响应

**解决方案**：
- Cloudflare：在 Workers 或 Page Rules 中禁用缓存
- CloudFront：配置缓存行为，设置最小 TTL 为 0
- 或者将流式 API 排除在 CDN 之外

#### 4. Vercel 部署

**Vercel 特别说明**：Vercel 对 SSE 有良好支持，但需注意：

- 免费计划有 10 秒函数执行限制
- Pro 计划有 60 秒函数执行限制
- 长时间流式传输可能需要 Vercel Pro 计划

#### 5. 浏览器开发者工具检查

使用浏览器开发者工具的 Network 标签检查：
1. 响应头是否包含 `Content-Type: text/event-stream`
2. 响应头是否包含 `X-Accel-Buffering: no`
3. 响应是否实时更新（看 Timeline）
4. 查看 Console 日志中的流式传输时间记录

## 日志记录

API 提供详细的日志记录用于调试和监控：

### 请求日志
```
[Video Editing Chat API] 2025-11-01T10:00:00.000Z - 收到视频编辑聊天请求
[Video Editing Chat API] Task ID: video-task-123
[Video Editing Chat API] Model: gpt-3.5-turbo
[Video Editing Chat API] Messages count: 3
```

### 流式传输日志
```
[Video Editing Chat API] Task video-task-123 - 开始初始化流式传输连接
[Video Editing Chat API] Task video-task-123 - 已发送流建立信号
[Video Editing Chat API] Task video-task-123 - 已发送第 1 个数据块 (间隔 120ms, 内容长度: 3)
[Video Editing Chat API] Task video-task-123 - 已发送第 10 个数据块 (间隔 95ms, 内容长度: 5)
[Video Editing Chat API] Task video-task-123 - 收到完成信号 [DONE]
[Video Editing Chat API] Task video-task-123 - 流式传输完成，总计 45 个数据块，耗时 5230ms，平均 116ms/块
```

### 性能监控

日志包含以下性能指标：
- **总数据块数**：完整响应包含的数据块数量
- **总耗时**：从开始到完成的总时间（ms）
- **平均延迟**：每个数据块的平均间隔时间（ms）
- **数据块间隔**：相邻数据块之间的时间间隔（ms）

这些指标可用于：
- 监控 LLM API 性能
- 诊断网络延迟问题
- 优化用户体验

## 安全考虑

1. **API 密钥管理**：确保 LLM_API_KEY 存储在环境变量中，不要硬编码
2. **请求验证**：生产环境应添加身份验证和授权机制
3. **速率限制**：考虑实现速率限制以防止滥用
4. **输入清理**：虽然 LLM 会处理输入，但应考虑添加输入验证
5. **CORS 配置**：当前允许所有来源（`*`），生产环境应限制为特定域名

## 性能优化建议

1. **连接复用**：对于多次请求，考虑使用 HTTP/2 或 keep-alive
2. **超时设置**：根据实际需求调整 LLM API 的超时设置
3. **错误重试**：实现智能重试机制处理临时网络错误
4. **缓存策略**：对于相同的问题，可以考虑缓存响应（注意时效性）

## 版本历史

### v1.1 - 2025-11-01
- 添加 `X-Accel-Buffering: no` 头部支持生产环境流式传输
- 添加流建立初始信号，防止代理缓冲
- 增强日志记录，包含性能指标和详细时间戳
- 优化错误处理和日志输出

### v1.0 - Initial Release
- 基础流式聊天功能
- SSE 格式支持
- 视频编辑助手系统提示
