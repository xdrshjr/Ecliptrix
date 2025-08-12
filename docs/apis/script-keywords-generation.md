# 脚本关键词生成 API

## 概述

脚本关键词生成 API 用于为视频脚本段落生成 2-3 个相关的搜索关键词，这些关键词可用于自动填充视频搜索框，帮助用户快速找到匹配的视频素材。

## 基础信息

- **端点**: `POST /api/script-keywords-generation`
- **功能**: 基于脚本段落内容生成视频搜索关键词
- **认证**: 无需认证
- **调用方式**: 多线程并发调用（参考 content-polish 接口）

## 请求格式

### 请求方法
```
POST /api/script-keywords-generation
```

### 请求头
```
Content-Type: application/json
```

### 请求体
```json
{
  "segmentTitle": "string",     // 必需：脚本段落标题
  "segmentContent": "string",   // 必需：脚本段落内容（所有句子拼接）
  "taskId": "string"           // 必需：任务ID，用于日志记录
}
```

### 参数说明

| 参数名 | 类型 | 必需 | 描述 |
|--------|------|------|------|
| segmentTitle | string | 是 | 脚本段落的标题 |
| segmentContent | string | 是 | 脚本段落的完整内容，由所有句子拼接而成 |
| taskId | string | 是 | 任务标识符，用于日志记录和追踪 |

### 请求示例
```json
{
  "segmentTitle": "产品介绍开场",
  "segmentContent": "欢迎来到我们的产品介绍。今天我们将为您展示一款革命性的智能办公软件，它将改变您的工作方式。",
  "taskId": "task-12345"
}
```

## 响应格式

### 成功响应
```json
{
  "success": true,
  "keywords": ["string"],      // 生成的关键词数组，2-3个
  "segmentTitle": "string",    // 原始段落标题
  "taskId": "string"          // 原始任务ID
}
```

### 成功响应示例
```json
{
  "success": true,
  "keywords": ["商务办公", "软件演示", "现代办公室"],
  "segmentTitle": "产品介绍开场",
  "taskId": "task-12345"
}
```

### 错误响应
```json
{
  "error": "string"  // 错误信息描述
}
```

## 错误码说明

| HTTP状态码 | 错误描述 |
|------------|----------|
| 400 | 请求参数无效（缺少必需参数或参数类型错误） |
| 500 | 服务器内部错误（LLM API调用失败或关键词解析失败） |

### 常见错误响应

#### 400 - 参数错误
```json
{
  "error": "Segment title string is required"
}
```

```json
{
  "error": "Segment content string is required"
}
```

```json
{
  "error": "Task ID is required"
}
```

#### 500 - 服务器错误
```json
{
  "error": "LLM API error: 500"
}
```

```json
{
  "error": "No valid keywords generated"
}
```

## 使用场景

### 1. 脚本生成后自动生成关键词
在视频脚本生成完成后，系统会自动为每个脚本段落调用此 API 生成关键词：

```typescript
// 并发为所有段落生成关键词
const keywordPromises = segments.map(async (segment) => {
  const response = await fetch('/api/script-keywords-generation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      segmentTitle: segment.title,
      segmentContent: segment.sentences.map(s => s.text).join(' '),
      taskId: taskId,
    }),
  });
  
  const result = await response.json();
  return result.success ? result.keywords : [];
});

const allKeywords = await Promise.all(keywordPromises);
```

### 2. 视频搜索关键词自动填充
当用户点击"搜索在线视频"按钮时，系统会自动将生成的关键词填入搜索框：

```typescript
// 在视频搜索模态框中自动填充关键词
const handleOpenVideoSearch = (segmentId: string) => {
  const segment = segments.find(s => s.id === segmentId);
  const keywords = segment?.keywords;
  
  // 传递关键词给视频搜索模态框
  videoSearch.openSearchModal(keywords);
};
```

## 技术实现

### LLM 提示词设计
API 使用精心设计的提示词来确保生成高质量的搜索关键词：

- 要求生成 2-3 个关键词
- 优先考虑具体的、可视化的概念
- 避免抽象概念和动词
- 适合用于视频搜索引擎

### 并发处理
支持多线程并发调用，可以同时为多个脚本段落生成关键词，提高处理效率。

### 错误处理
- 完善的参数验证
- LLM API 调用失败的优雅处理
- 详细的错误日志记录
- 失败时返回空关键词而不是中断流程

## 日志记录

API 提供详细的日志记录，包括：

- 请求参数记录
- LLM API 调用状态
- 关键词生成结果
- 错误信息和异常处理

### 日志示例
```
[Script Keywords Generation API] 请求开始 - 任务: task-12345
[Script Keywords Generation API] 片段标题: 产品介绍开场
[Script Keywords Generation API] 片段内容长度: 58 字符
[Script Keywords Generation API] 请求成功 - 任务: task-12345
[Script Keywords Generation API] 生成关键词数量: 3
[Script Keywords Generation API] 关键词列表: ["商务办公","软件演示","现代办公室"]
```

## 性能考虑

- **并发限制**: 建议同时调用数量不超过 10 个
- **超时设置**: 单个请求超时时间为 30 秒
- **重试机制**: 建议在调用失败时实现指数退避重试
- **缓存策略**: 可以考虑对相同内容的关键词进行缓存

## 版本信息

- **当前版本**: v1.0.0
- **最后更新**: 2024-12-19
- **兼容性**: 支持所有现代浏览器和 Node.js 环境 