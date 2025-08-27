# Prompt Optimization API Documentation

## 概述

提示词优化API (`/api/prompt-optimization`) 是一个专用的API端点，用于优化AI图像生成的提示词。该API通过调用LLM服务，为用户提供的正向和反向提示词进行智能优化，以提高AI生成图像的质量和准确性。

## API端点

```
POST /api/prompt-optimization
```

## 功能特性

- **智能优化**: 使用LLM对提示词进行专业优化
- **双向优化**: 同时优化正向和反向提示词
- **质量提升**: 添加专业描述词以提升图像生成质量
- **错误处理**: 完善的错误处理和日志记录
- **回退机制**: 当API响应解析失败时提供回退优化

## 请求格式

### Headers
```
Content-Type: application/json
```

### Request Body
```json
{
  "positivePrompt": "string (必填)",
  "negativePrompt": "string (可选)"
}
```

#### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `positivePrompt` | string | 是 | 正向提示词，描述想要生成的图像内容 |
| `negativePrompt` | string | 否 | 反向提示词，描述不希望出现的内容，默认为空字符串 |

#### 请求示例
```json
{
  "positivePrompt": "A beautiful landscape with mountains and rivers",
  "negativePrompt": "blurry, low quality"
}
```

## 响应格式

### 成功响应
```json
{
  "success": true,
  "data": {
    "positivePrompt": "优化后的正向提示词",
    "negativePrompt": "优化后的反向提示词"
  },
  "warning": "可选的警告信息"
}
```

### 错误响应
```json
{
  "error": "错误信息",
  "details": "详细错误信息"
}
```

#### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 操作是否成功 |
| `data.positivePrompt` | string | 优化后的正向提示词 |
| `data.negativePrompt` | string | 优化后的反向提示词 |
| `warning` | string | 可选的警告信息，例如使用了回退优化 |
| `error` | string | 错误信息 |
| `details` | string | 详细错误信息 |

## 优化策略

### 正向提示词优化
- 保持用户原始意图
- 添加质量描述词（high quality, 4K, detailed, professional）
- 增加艺术风格描述
- 优化构图和光照描述
- 添加技术规格（digital art, photography style）

### 反向提示词优化
- 添加常见的负面质量词汇
- 包含解剖结构相关的负面词汇
- 添加构图相关的负面描述
- 确保覆盖常见的图像缺陷

### 优化示例

**原始输入:**
```json
{
  "positivePrompt": "cat",
  "negativePrompt": "ugly"
}
```

**优化结果:**
```json
{
  "positivePrompt": "a beautiful cat, high quality, detailed fur texture, professional photography, soft lighting, 4k resolution, portrait composition",
  "negativePrompt": "ugly, low quality, blurry, distorted, deformed, bad anatomy, poor composition, overexposed, underexposed"
}
```

## 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 请求参数错误（如缺少正向提示词） |
| 500 | 内部服务器错误 |

## 错误处理

### 常见错误类型

1. **参数验证错误** (400)
   ```json
   {
     "error": "Positive prompt is required"
   }
   ```

2. **LLM API错误** (对应LLM API状态码)
   ```json
   {
     "error": "LLM API error: 429"
   }
   ```

3. **内部服务器错误** (500)
   ```json
   {
     "error": "Internal server error",
     "details": "具体错误详情"
   }
   ```

## 环境配置

### 必需的环境变量

```env
# LLM API配置 (优先级高)
LLM_API_URL=https://your-llm-api-url/v1
LLM_API_KEY=your-llm-api-key
LLM_MODEL=gpt-3.5-turbo

# 或者使用 OpenAI 配置 (回退选项)
OPENAI_API_URL=https://api.openai.com/v1
OPENAI_API_KEY=your-openai-api-key
```

### 配置说明

- `LLM_API_URL`: LLM服务的API基础URL
- `LLM_API_KEY`: LLM服务的API密钥
- `LLM_MODEL`: 使用的模型名称，默认为 `gpt-3.5-turbo`

## 集成示例

### 前端调用示例 (TypeScript)

```typescript
interface OptimizePromptsRequest {
  positivePrompt: string;
  negativePrompt?: string;
}

interface OptimizedPrompts {
  positivePrompt: string;
  negativePrompt: string;
}

async function optimizePrompts(request: OptimizePromptsRequest): Promise<OptimizedPrompts> {
  const response = await fetch('/api/prompt-optimization', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  const result = await response.json();
  if (!result.success || !result.data) {
    throw new Error(result.error || '未知错误');
  }

  return result.data;
}

// 使用示例
try {
  const optimized = await optimizePrompts({
    positivePrompt: "beautiful sunset",
    negativePrompt: "dark"
  });
  
  console.log('Optimized positive:', optimized.positivePrompt);
  console.log('Optimized negative:', optimized.negativePrompt);
} catch (error) {
  console.error('Optimization failed:', error.message);
}
```

### cURL 示例

```bash
curl -X POST http://localhost:3000/api/prompt-optimization \
  -H "Content-Type: application/json" \
  -d '{
    "positivePrompt": "beautiful sunset",
    "negativePrompt": "dark"
  }'
```

## 性能考虑

### 响应时间
- 通常在 2-10 秒内完成
- 响应时间取决于LLM服务的性能
- 复杂提示词可能需要更长时间

### 使用限制
- 受LLM API的速率限制约束
- 单个请求的提示词长度建议不超过5000字符
- 建议实现客户端超时机制（建议15-30秒）

## 日志记录

### 日志级别
- **INFO**: 正常请求和响应
- **WARN**: 使用了回退优化等警告情况
- **ERROR**: 错误情况

### 日志内容
- 请求时间和参数统计
- 响应时间和结果统计
- 错误详情和堆栈信息
- 优化效果统计（字符数变化等）

### 日志示例
```
[Prompt Optimization API] 2024-08-27T10:30:00.000Z - Incoming prompt optimization request
[Prompt Optimization API] Model: gpt-3.5-turbo
[Prompt Optimization API] Positive prompt length: 25
[Prompt Optimization API] Negative prompt length: 4
[Prompt Optimization API] 2024-08-27T10:30:05.000Z - Optimization completed successfully
[Prompt Optimization API] Optimized positive prompt length: 156
[Prompt Optimization API] Optimized negative prompt length: 87
```

## 安全考虑

### 输入验证
- 验证提示词长度限制
- 过滤恶意内容
- 参数类型检查

### API安全
- 使用HTTPS传输
- API密钥安全存储
- 请求频率限制

## 故障排除

### 常见问题

1. **API密钥未配置**
   - 错误: "API key not configured"
   - 解决: 检查环境变量 `LLM_API_KEY` 或 `OPENAI_API_KEY`

2. **LLM服务不可用**
   - 错误: "LLM API error: 503"
   - 解决: 检查LLM服务状态和网络连接

3. **响应解析失败**
   - 行为: 自动使用回退优化
   - 日志: 包含解析错误详情

### 调试建议

1. 检查环境变量配置
2. 查看详细的错误日志
3. 测试LLM服务连接
4. 验证请求格式和参数

## 版本历史

- **v1.0.0** (2024-08-27): 初始版本，支持基础的提示词优化功能

## 相关文档

- [AI图像生成API文档](./ai_image_generation_api.md)
- [视频编辑聊天API文档](./video-editing-chat.md)
- [环境配置指南](../README.md)