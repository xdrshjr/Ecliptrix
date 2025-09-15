# Video Understanding Script API

## 概述
视频理解生成脚本接口，基于视频内容分析结果自动生成对应的脚本内容。通过LLM深度理解视频内容，结合用户提供的参考文本，生成结构化的脚本段落。

**架构说明**: 此接口由Python FastAPI后端实现，通过Next.js代理层提供服务。采用视频分析+LLM生成的两阶段处理流程：
1. **视频分析阶段**: 获取或分析视频内容，提取视觉元素、音频元素和关键主题
2. **脚本生成阶段**: LLM基于视频分析结果和参考文本生成结构化脚本内容

**核心特性**: 
- 支持多个视频的批量脚本生成
- **支持一个脚本段落关联多个视频** - 可以进行视频对比、综合分析等
- 可配置的分析深度和生成参数
- 多语言支持（中文、英文、混合）
- 结构化的脚本输出，包含标题、句子、关键词等
- 与视频内容的精确关联关系
- **完整的视频信息传递** - 保留原始视频的URL、缩略图等完整信息
- 前端支持视频播放和切换功能

**视频分析集成**: 
- 自动检测视频是否已通过 `/api/video/analyze` 接口解析
- 将视频帧分析数据传递给LLM，提升脚本生成的准确性
- 帧描述自动截断至200字符，优化LLM处理效率
- 支持存储和检索历史分析数据

## 端点
`POST /api/video-understanding-script` (通过Next.js代理到Python后端)

## 请求格式

### Headers
```
Content-Type: application/json
```

### Body Parameters
| 参数名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| taskId | string | 是 | 任务唯一标识符 |
| selectedVideos | array | 是 | 选中的视频列表，最少1个 |
| referenceText | string | 否 | 参考文本，用于脚本生成的上下文 |
| parameters | object | 是 | 脚本生成参数配置 |

#### selectedVideos 数组元素结构
| 字段名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| id | string | 是 | 视频唯一标识符 |
| name | string | 是 | 视频名称 |
| type | string | 是 | 视频类型 (通常为 "video") |
| url | string | 否 | 视频URL |
| thumbnailUrl | string | 否 | 视频缩略图URL |
| duration | number | 否 | 视频时长（秒） |

#### parameters 对象结构
| 字段名 | 类型 | 必需 | 描述 | 默认值 | 取值范围 |
|-------|------|------|------|--------|----------|
| language | string | 否 | 生成脚本的语言 | "chinese" | "chinese", "english", "mixed" |
| segmentCount | number | 否 | 生成的脚本段落数量 | 5 | 1-20 |
| analysisDepth | string | 否 | 分析深度 | "detailed" | "basic", "detailed", "comprehensive" |
| includeVisualElements | boolean | 否 | 是否包含视觉元素分析 | true | true, false |
| includeAudioAnalysis | boolean | 否 | 是否包含音频元素分析 | true | true, false |

### 请求示例
```json
{
  "taskId": "task_123456789",
  "selectedVideos": [
    {
      "id": "video_001",
      "name": "产品介绍视频",
      "type": "video",
      "url": "https://example.com/video1.mp4",
      "thumbnailUrl": "https://example.com/thumb1.jpg",
      "duration": 30.5
    },
    {
      "id": "video_002", 
      "name": "用户体验展示",
      "type": "video",
      "duration": 25.0
    }
  ],
  "referenceText": "请重点突出产品的创新性和用户体验，语言要简洁明了，适合营销推广使用。",
  "parameters": {
    "language": "chinese",
    "segmentCount": 3,
    "analysisDepth": "detailed",
    "includeVisualElements": true,
    "includeAudioAnalysis": true
  }
}
```

## 响应格式

### 成功响应 (200 OK)
```json
{
  "success": true,
  "message": "Video understanding script generated successfully",
  "segments": [
    {
      "id": "script-segment-task_123456789-abc123",
      "title": "产品创新展示",
      "sentences": [
        {
          "id": "script-segment-task_123456789-abc123-sentence-1",
          "text": "这个产品展示视频突出了创新的设计理念和独特的用户体验。"
        },
        {
          "id": "script-segment-task_123456789-abc123-sentence-2", 
          "text": "通过精美的画面构图和流畅的演示过程，完美诠释了产品的核心价值。"
        }
      ],
      "duration": 55.5,
      "videos": [
        {
          "id": "video_001",
          "name": "产品介绍视频",
          "type": "video",
          "duration": 30.5
        },
        {
          "id": "video_002",
          "name": "用户体验展示",
          "type": "video", 
          "duration": 25.0
        }
      ],
      "keywords": ["产品创新", "设计理念", "用户体验", "核心价值"]
    }
  ],
  "metadata": {
    "processedVideoCount": 2,
    "generatedSegmentCount": 3,
    "totalEstimatedDuration": 55.5,
    "analysisDepth": "detailed",
    "language": "chinese",
    "includeVisualElements": true,
    "includeAudioAnalysis": true,
    "referenceTextLength": 45,
    "generatedAt": "2024-01-01T12:00:00.000Z",
    "videoAnalysisResultsCount": 2
  },
  "taskId": "task_123456789"
}
```

### 错误响应
#### 400 Bad Request - 请求参数错误
```json
{
  "error": "At least one video must be selected",
  "details": "selectedVideos array cannot be empty",
  "taskId": "task_123456789"
}
```

#### 500 Internal Server Error - 服务器错误
```json
{
  "error": "Script generation failed",
  "details": "LLM API error: timeout",
  "taskId": "task_123456789"
}
```

## 响应字段说明

### segments 数组元素结构
| 字段名 | 类型 | 描述 |
|-------|------|------|
| id | string | 脚本段落唯一标识符 |
| title | string | 段落标题 |
| sentences | array | 句子列表 |
| duration | number | 估计时长（秒），多个视频时为总时长 |
| videos | array | 关联的视频列表，**支持多个视频** |
| keywords | array | 相关关键词列表 |

### sentences 数组元素结构
| 字段名 | 类型 | 描述 |
|-------|------|------|
| id | string | 句子唯一标识符 |
| text | string | 句子文本内容 |

### metadata 对象字段
| 字段名 | 类型 | 描述 |
|-------|------|------|
| processedVideoCount | number | 处理的视频数量 |
| generatedSegmentCount | number | 生成的脚本段落数量 |
| totalEstimatedDuration | number | 总估计时长（秒） |
| analysisDepth | string | 使用的分析深度 |
| language | string | 生成的语言类型 |
| includeVisualElements | boolean | 是否包含视觉元素分析 |
| includeAudioAnalysis | boolean | 是否包含音频元素分析 |
| referenceTextLength | number | 参考文本长度 |
| generatedAt | string | 生成时间（ISO格式） |
| videoAnalysisResultsCount | number | 视频分析结果数量 |

## 使用示例

### 基础使用
```javascript
// 前端调用示例
const response = await fetch('/api/video-understanding-script', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    taskId: 'task_' + Date.now(),
    selectedVideos: [
      {
        id: 'video_001',
        name: '演示视频',
        type: 'video',
        duration: 30
      }
    ],
    referenceText: '请生成专业的产品介绍脚本',
    parameters: {
      language: 'chinese',
      segmentCount: 3,
      analysisDepth: 'detailed'
    }
  })
});

const result = await response.json();
if (result.success) {
  console.log('生成的脚本段落:', result.segments);
} else {
  console.error('生成失败:', result.error);
}
```

### 高级配置
```javascript
// 多语言混合生成
const advancedRequest = {
  taskId: 'advanced_task_001',
  selectedVideos: videoList,
  referenceText: '结合中英文表达，突出国际化特色',
  parameters: {
    language: 'mixed',
    segmentCount: 5,
    analysisDepth: 'comprehensive',
    includeVisualElements: true,
    includeAudioAnalysis: true
  }
};
```

## 性能特性

**处理时间**: 
- 基础分析: 5-10秒
- 详细分析: 10-20秒  
- 全面分析: 15-30秒

**并发支持**: 支持多任务并发处理

**缓存机制**: 
- 视频分析结果缓存，避免重复分析
- LLM响应智能缓存，提升响应速度

## 错误处理

| 错误类型 | HTTP状态码 | 错误代码 | 描述 |
|---------|-----------|---------|------|
| 参数验证失败 | 400 | VALIDATION_ERROR | 请求参数不符合要求 |
| 视频未选择 | 400 | NO_VIDEOS_SELECTED | selectedVideos数组为空 |
| 段落数量超限 | 400 | INVALID_SEGMENT_COUNT | segmentCount不在1-20范围内 |
| 服务配置错误 | 500 | SERVICE_CONFIG_ERROR | LLM服务未正确配置 |
| 脚本生成失败 | 500 | SCRIPT_GENERATION_FAILED | LLM调用或解析失败 |
| 内部服务错误 | 500 | INTERNAL_ERROR | 其他服务器内部错误 |

## 日志记录

接口提供详细的日志记录，包括：
- 请求参数记录（DEBUG模式下完整记录）
- 视频分析过程日志
- LLM调用请求和响应日志
- 脚本解析和生成过程日志
- 错误详情和堆栈跟踪

## 注意事项

1. **视频分析依赖**: 建议先通过 `/api/video/analyze` 接口分析视频，以获得更准确的脚本内容
2. **参考文本长度**: 建议参考文本长度控制在500字符以内，过长可能影响生成效果
3. **段落数量限制**: 每次请求最多生成20个脚本段落
4. **多视频关联**: 
   - 每个脚本段落可以关联1个或多个视频
   - 系统会智能分析内容，自动决定视频关联关系
   - 前端支持视频播放和上一个/下一个视频切换
   - 多个视频的时长会累加作为段落总时长
5. **语言一致性**: 混合语言模式下，系统会根据内容自动选择合适的语言
6. **关键词提取**: 系统自动从生成内容中提取相关关键词，每个段落最多5个关键词 