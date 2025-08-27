# AI Image Generation API Documentation

## Overview

本文档描述了前端与ComfyUI API服务之间的AI图片生成API接口。这些接口通过Next.js API路由层进行调用，用于AI图片生成功能。

## API Endpoints

### 1. Generate Image

**POST /api/ai-image-generation/generate**

提交AI图片生成请求。

#### Request Body

```json
{
  "positive_prompt": "A beautiful landscape with mountains and rivers, digital art style",
  "negative_prompt": "low quality, blurry, distorted",
  "width": 1024,
  "height": 1024,
  "steps": 20,
  "seed": null,
  "cfg": 1.0,
  "guidance": 3.5,
  "checkpoint": "flux1-dev-fp8.safetensors"
}
```

#### Parameters

- `positive_prompt` (string, required): 正向提示词，描述想要生成的图片内容
  - 最小长度: 1 字符
  - 最大长度: 5000 字符
- `negative_prompt` (string, optional): 反向提示词，描述不希望出现的内容
  - 默认值: "low quality, blurry, distorted"
  - 最大长度: 2000 字符
- `width` (integer, optional): 图片宽度
  - 范围: 64-2048
  - 必须是8的倍数
  - 默认值: 1024
- `height` (integer, optional): 图片高度
  - 范围: 64-2048
  - 必须是8的倍数
  - 默认值: 1024
- `steps` (integer, optional): 采样步数
  - 范围: 1-100
  - 默认值: 20
- `seed` (integer, optional): 随机种子，用于可重现的生成
  - 默认值: null (随机)
- `cfg` (float, optional): CFG scale
  - 范围: 0.1-20.0
  - 默认值: 1.0
- `guidance` (float, optional): 引导强度
  - 范围: 0.1-20.0
  - 默认值: 3.5
- `checkpoint` (string, optional): 模型检查点
  - 默认值: "flux1-dev-fp8.safetensors"

#### Response

**成功响应 (200 OK):**

```json
{
  "prompt_id": "12345678-abcd-efgh-ijkl-123456789012",
  "status": "pending",
  "message": "Image generation started",
  "estimated_time": 30
}
```

**错误响应:**

- `400 Bad Request`: 参数验证失败
- `500 Internal Server Error`: 服务内部错误
- `503 Service Unavailable`: ComfyUI服务不可用

### 2. Get Generation Status

**GET /api/ai-image-generation/status/{promptId}**

查询AI图片生成状态。

#### Path Parameters

- `promptId` (string, required): 生成任务的唯一标识符

#### Response

**成功响应 (200 OK):**

```json
{
  "prompt_id": "12345678-abcd-efgh-ijkl-123456789012",
  "status": "completed",
  "progress": 100,
  "images": ["image_001.png", "image_002.png"],
  "created_at": "2024-01-01T12:00:00Z",
  "completed_at": "2024-01-01T12:01:30Z"
}
```

#### Status Values

- `pending`: 任务在队列中等待处理
- `running`: 任务正在生成中
- `completed`: 任务已完成
- `failed`: 任务失败

**失败响应 (status: "failed"):**

```json
{
  "prompt_id": "12345678-abcd-efgh-ijkl-123456789012",
  "status": "failed",
  "error_message": "Generation failed due to insufficient memory",
  "created_at": "2024-01-01T12:00:00Z"
}
```

### 3. Download Image

**GET /api/ai-image-generation/download/{filename}**

下载生成的图片文件。

#### Path Parameters

- `filename` (string, required): 图片文件名

#### Response

**成功响应 (200 OK):**

返回图片的二进制数据，Content-Type为图片类型（通常是image/png）。

**Headers:**

- `Content-Type`: image/png (或相应的图片类型)
- `Content-Disposition`: attachment; filename="image_001.png"
- `Cache-Control`: public, max-age=31536000

**错误响应:**

- `400 Bad Request`: 文件名无效或包含非法字符
- `404 Not Found`: 文件不存在
- `500 Internal Server Error`: 下载失败

## Error Handling

所有错误响应都包含以下格式：

```json
{
  "error": "Error type",
  "message": "Detailed error description"
}
```

### Common Error Codes

- `400 Bad Request`: 请求参数无效
- `404 Not Found`: 资源不存在
- `500 Internal Server Error`: 服务器内部错误
- `503 Service Unavailable`: ComfyUI服务不可用

## Usage Example

### JavaScript/TypeScript

```typescript
// 提交生成请求
const generateResponse = await fetch('/api/ai-image-generation/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    positive_prompt: 'A beautiful sunset over the ocean',
    negative_prompt: 'low quality, blurry',
    width: 1024,
    height: 1024,
    steps: 30
  })
});

const { prompt_id } = await generateResponse.json();

// 轮询状态
const checkStatus = async () => {
  const statusResponse = await fetch(`/api/ai-image-generation/status/${prompt_id}`);
  const status = await statusResponse.json();
  
  if (status.status === 'completed') {
    // 下载图片
    for (const filename of status.images) {
      const imageResponse = await fetch(`/api/ai-image-generation/download/${filename}`);
      const blob = await imageResponse.blob();
      const url = URL.createObjectURL(blob);
      // 使用图片URL
    }
  } else if (status.status === 'failed') {
    console.error('Generation failed:', status.error_message);
  } else {
    // 继续轮询
    setTimeout(checkStatus, 3000);
  }
};

checkStatus();
```

## Environment Variables

为了正确使用这些API，需要设置以下环境变量：

- `COMFY_API_SERVICE_URL`: ComfyUI API服务的基础URL（默认: http://localhost:8001）

## Rate Limiting

目前没有实施速率限制，但建议：

- 不要同时提交过多的生成请求
- 状态轮询间隔不要小于3秒
- 合理设置超时时间

## Security Considerations

- 所有文件名都经过安全验证，防止路径遍历攻击
- 参数都经过严格验证，防止注入攻击
- 图片下载时设置了适当的缓存策略 