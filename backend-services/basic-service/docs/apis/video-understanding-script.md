# 视频理解生成脚本 API

## 概述
该API接口用于基于视频内容分析生成对应的脚本内容。通过AI分析视频的视觉和音频元素，结合用户提供的参考文本，自动生成结构化的脚本段落。

## 接口信息
- **路径**: `/api/video-understanding-script`
- **方法**: `POST`
- **Content-Type**: `application/json`

## 请求参数

### 请求体结构
```json
{
  "selectedVideos": [
    {
      "id": "string",
      "name": "string",
      "type": "video",
      "url": "string (可选)",
      "thumbnailUrl": "string (可选)",
      "duration": "number (可选)"
    }
  ],
  "referenceText": "string",
  "parameters": {
    "language": "chinese | english | mixed",
    "segmentCount": "number (3-10)",
    "analysisDepth": "basic | detailed | comprehensive",
    "includeVisualElements": "boolean",
    "includeAudioAnalysis": "boolean"
  },
  "taskId": "string"
}
```

### 参数说明

#### selectedVideos (必需)
- **类型**: Array
- **描述**: 需要分析的视频列表
- **约束**: 至少包含一个视频

#### referenceText (可选)
- **类型**: String
- **描述**: 参考文本，用于指导脚本生成的方向和风格
- **最大长度**: 1000字符

#### parameters (必需)
- **language**: 生成脚本的语言
  - `chinese`: 纯中文
  - `english`: 纯英文
  - `mixed`: 中英混合
- **segmentCount**: 生成的脚本段落数量 (3-10)
- **analysisDepth**: 分析深度
  - `basic`: 基础分析，快速生成
  - `detailed`: 详细分析，平衡质量和速度
  - `comprehensive`: 全面分析，深度解析内容
- **includeVisualElements**: 是否包含视觉元素分析
- **includeAudioAnalysis**: 是否包含音频分析

#### taskId (必需)
- **类型**: String
- **描述**: 任务ID，用于日志追踪和错误定位

## 响应格式

### 成功响应 (200)
```json
{
  "success": true,
  "segments": [
    {
      "id": "string",
      "title": "string",
      "sentences": [
        {
          "id": "string",
          "text": "string"
        }
      ],
      "duration": "number",
      "videos": [
        {
          "id": "string",
          "name": "string",
          "type": "string",
          "url": "string",
          "thumbnailUrl": "string"
        }
      ],
      "keywords": ["string"]
    }
  ],
  "metadata": {
    "processedVideoCount": "number",
    "generatedSegmentCount": "number",
    "processingTimeMs": "number",
    "analysisDepth": "string",
    "language": "string"
  }
}
```

### 错误响应 (400/500)
```json
{
  "success": false,
  "error": "string"
}
```

## 使用示例

### 请求示例
```bash
curl -X POST /api/video-understanding-script \
  -H "Content-Type: application/json" \
  -d '{
    "selectedVideos": [
      {
        "id": "video_001",
        "name": "产品介绍视频.mp4",
        "type": "video",
        "duration": 120
      }
    ],
    "referenceText": "这是一个产品介绍视频，需要突出产品的核心功能和用户价值",
    "parameters": {
      "language": "chinese",
      "segmentCount": 5,
      "analysisDepth": "detailed",
      "includeVisualElements": true,
      "includeAudioAnalysis": true
    },
    "taskId": "task_12345"
  }'
```

### 响应示例
```json
{
  "success": true,
  "segments": [
    {
      "id": "video-understanding-1640995200000-0",
      "title": "产品介绍视频.mp4 - 精彩片段 1",
      "sentences": [
        {
          "id": "video-understanding-1640995200000-0-sentence-1",
          "text": "这个视频展现了创意表达，画面构图优美，色彩搭配和谐，配合清晰的语音表达，符合预期的创作理念。"
        },
        {
          "id": "video-understanding-1640995200000-0-sentence-2", 
          "text": "整体制作水准体现了专业性，特别是丰富的色彩层次的运用，恰当的背景音乐为整体效果加分不少。"
        }
      ],
      "duration": 20.5,
      "videos": [
        {
          "id": "video_001",
          "name": "产品介绍视频.mp4",
          "type": "video"
        }
      ],
      "keywords": ["创意表达", "视觉呈现", "内容传达", "视觉设计", "音频设计", "创意表达", "技术实现"]
    }
  ],
  "metadata": {
    "processedVideoCount": 1,
    "generatedSegmentCount": 5,
    "processingTimeMs": 3240,
    "analysisDepth": "detailed",
    "language": "chinese"
  }
}
```

## 错误码说明

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| 400 | 请求参数错误 | 检查请求参数格式和必需字段 |
| 400 | 未选择视频 | 确保 selectedVideos 数组不为空 |
| 400 | 参数配置不正确 | 检查 parameters 对象的字段类型和值范围 |
| 500 | 服务器内部错误 | 检查服务器日志，联系技术支持 |

## 性能说明

- **处理时间**: 根据视频数量和分析深度，通常在 3-10 秒之间
- **并发限制**: 建议单个任务同时最多处理 5 个视频
- **超时设置**: 接口超时时间为 30 秒

## 注意事项

1. **视频格式支持**: 目前支持常见的视频格式 (MP4, AVI, MOV 等)
2. **文件大小限制**: 单个视频文件建议不超过 500MB
3. **分析质量**: 视频质量越高，分析结果越准确
4. **参考文本**: 提供具体的参考文本可以显著提升生成脚本的相关性
5. **语言混合**: 选择混合语言时，系统会智能决定每个段落使用的语言

## 日志记录

接口会记录以下关键信息用于监控和调试：
- 请求开始和结束时间
- 处理的视频数量和参数配置
- 生成的脚本段落数量
- 处理耗时和错误信息
- 任务ID用于追踪整个处理流程 