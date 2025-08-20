# Video AI Match API

## 概述

视频AI匹配API用于根据脚本文本内容，从已完成AI解析的视频素材中智能匹配最相关的视频。该API使用阿里云通义千问大语言模型来分析脚本内容与视频分析结果的相关性，并返回匹配度评分和匹配原因。

## 基本信息

- **端点**: `/api/video-ai-match`
- **方法**: `POST`
- **内容类型**: `application/json`

## 请求参数

### 请求体

```json
{
  "scriptText": "string",
  "videoAnalysisResults": [
    {
      "videoUrl": "string",
      "videoName": "string", 
      "materialId": "string",
      "frameAnalyses": [
        {
          "frame_number": "number",
          "timestamp": "number",
          "analysis": "string"
        }
      ],
      "videoDuration": "number",
      "totalFrames": "number"
    }
  ],
  "taskId": "string",
  "segmentDuration": "number"
}
```

### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `scriptText` | string | 是 | 脚本段落文本内容 |
| `videoAnalysisResults` | array | 是 | 视频AI解析结果数组 |
| `taskId` | string | 是 | 任务ID，用于日志追踪 |
| `segmentDuration` | number | 否 | 段落语音时长（秒），用于时长匹配 |

#### videoAnalysisResults 数组元素说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `videoUrl` | string | 视频URL地址 |
| `videoName` | string | 视频名称 |
| `materialId` | string | 素材ID |
| `frameAnalyses` | array | 帧分析结果数组 |
| `videoDuration` | number | 视频时长(秒) |
| `totalFrames` | number | 总帧数 |

#### frameAnalyses 数组元素说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `frame_number` | number | 帧编号 |
| `timestamp` | number | 时间戳(秒) |
| `analysis` | string | 帧内容AI分析结果 |

## 响应格式

### 成功响应

```json
{
  "success": true,
  "message": "Found 2 matching videos",
  "matches": [
    {
      "materialId": "video_123",
      "videoUrl": "https://example.com/video1.mp4",
      "videoName": "示例视频1",
      "matchScore": 0.85,
      "matchReason": "视频内容与脚本描述的场景高度匹配，包含相似的主题和情感表达"
    }
  ],
  "totalAnalyzed": 5,
  "processingTime": 1250.5
}
```

### 错误响应

```json
{
  "success": false,
  "message": "Script text is required",
  "matches": [],
  "totalAnalyzed": 0,
  "processingTime": 0
}
```

### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 请求是否成功 |
| `message` | string | 响应消息 |
| `matches` | array | 匹配结果数组 |
| `totalAnalyzed` | number | 分析的视频总数 |
| `processingTime` | number | 处理时间(毫秒) |

#### matches 数组元素说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `materialId` | string | 匹配的视频素材ID |
| `videoUrl` | string | 视频URL |
| `videoName` | string | 视频名称 |
| `matchScore` | number | 匹配评分(0.5-1.0) |
| `matchReason` | string | 匹配原因说明 |

## 匹配评分标准

- **0.9-1.0**: 完美匹配，内容高度相关且时长合适
- **0.7-0.89**: 很好匹配，内容相关性强，时长基本合适  
- **0.5-0.69**: 一般匹配，有一定相关性，时长可接受
- **0.3-0.49**: 较弱匹配，相关性较低或时长不太合适
- **0.0-0.29**: 不匹配，基本无关或时长差异过大

## 时长匹配机制

当提供 `segmentDuration` 参数时，AI将考虑以下时长匹配要求：

1. **优先选择时长接近的视频组合**
2. **理想时长范围**: 目标时长的80%-120%
3. **多视频组合**: 可选择多个视频片段以达到合适总时长
4. **时长影响评分**: 时长匹配度会显著影响最终评分
5. **匹配说明**: 返回结果中会包含时长匹配的详细说明

> 注意：API只返回评分在0.5以上的匹配结果，并按评分从高到低排序，优先考虑时长匹配度。

## 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误 |
| 500 | 服务器内部错误 |

## 使用示例

### 请求示例

```bash
curl -X POST /api/video-ai-match \
  -H "Content-Type: application/json" \
  -d '{
    "scriptText": "一个阳光明媚的早晨，小鸟在枝头歌唱，微风轻抚过绿叶",
    "segmentDuration": 8.5,
    "videoAnalysisResults": [
      {
        "videoUrl": "https://example.com/nature.mp4",
        "videoName": "自然风光",
        "materialId": "video_001",
        "frameAnalyses": [
          {
            "frame_number": 1,
            "timestamp": 0.5,
            "analysis": "画面显示绿色的树叶在微风中摇摆"
          },
          {
            "frame_number": 2, 
            "timestamp": 1.0,
            "analysis": "小鸟站在树枝上，阳光透过叶子洒下"
          }
        ],
        "videoDuration": 10.5,
        "totalFrames": 21
      }
    ],
    "taskId": "task_123"
  }'
```

### 响应示例

```json
{
  "success": true,
  "message": "Found 1 matching videos",
  "matches": [
    {
      "materialId": "video_001",
      "videoUrl": "https://example.com/nature.mp4", 
      "videoName": "自然风光",
      "matchScore": 0.92,
      "matchReason": "视频完美匹配脚本描述：包含阳光、树叶、小鸟等关键元素，营造出宁静美好的自然氛围。时长10.5秒接近目标8.5秒，在理想范围内(6.8-10.2秒)"
    }
  ],
  "totalAnalyzed": 1,
  "processingTime": 1180.2
}
```

## 健康检查

### 端点

- **URL**: `/api/video-ai-match`
- **方法**: `GET`

### 响应

```json
{
  "status": "healthy",
  "service": "video-ai-match", 
  "timestamp": "2024-01-15T10:30:00.000Z",
  "config": {
    "apiUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "model": "qwen-max-latest",
    "hasApiKey": true
  }
}
```

## 注意事项

1. **API密钥配置**: 需要正确配置阿里云通义千问API密钥环境变量
   - `AI_VIDEO_MATCH_LLM_API_URL`: 阿里云API地址
   - `AI_VIDEO_MATCH_LLM_API_KEY`: 阿里云API密钥
   - `AI_VIDEO_MATCH_LLM_MODEL`: 使用的模型名称
2. **请求大小限制**: 视频分析结果数据量较大，注意请求体大小限制
3. **处理时间**: LLM分析需要一定时间，建议设置合适的超时时间
4. **匹配质量**: 匹配质量依赖于视频AI解析结果的准确性和详细程度
5. **评分阈值**: 只返回评分≥0.5的匹配结果，确保匹配质量
6. **JSON格式**: API强制要求LLM返回标准JSON格式，确保解析成功

## 错误处理

常见错误及解决方案：

1. **"Script text is required"**: 检查scriptText参数是否为空
2. **"Video analysis results are required"**: 检查videoAnalysisResults数组是否为空
3. **"Task ID is required"**: 检查taskId参数是否提供
4. **"AI Video Match LLM API key is not configured"**: 检查阿里云API环境变量配置
5. **"Failed to parse AI Video Match LLM response"**: LLM返回格式异常，可能需要重试 