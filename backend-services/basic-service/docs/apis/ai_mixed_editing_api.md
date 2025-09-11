# AI Mixed Editing API

## 概述
AI混剪接口，基于提供的素材自动生成视频剪辑方案。通过优化的两阶段处理流程：
1. **简化生成阶段**: LLM生成简化的剪辑配置JSON（包含视频ID、剪辑时间、音频ID及排列信息）
2. **格式转换阶段**: 将简化配置解析转换为完整的时间轴JSON格式

**架构说明**: 此接口由Python FastAPI后端实现，通过Next.js代理层提供服务。新的两阶段处理方式显著提升了生成速度和稳定性。

**性能优化**: 
- LLM生成时间减少约60-70%（从生成完整JSON改为简化JSON）
- 减少了Token消耗，降低API调用成本
- 提高了JSON解析成功率和一致性

## 端点
`POST /api/ai-mixed-editing` (通过Next.js代理到Python后端)

## 请求格式

### Headers
```
Content-Type: application/json
```

### Body Parameters
| 参数名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| taskId | string | 是 | 任务唯一标识符 |
| materials | array | 是 | 素材列表，包含视频、音频、图片等素材信息 |

#### Materials 数组元素结构
| 字段名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| id | string | 是 | 素材唯一标识符 |
| name | string | 是 | 素材名称 |
| type | string | 是 | 素材类型 (video, audio, image) |
| format | string | 是 | 文件格式 (mp4, mp3, jpg等) |
| size | number | 是 | 文件大小（字节） |
| duration | number | 否 | 时长（秒），视频和音频素材需要 |
| width | number | 否 | 宽度（像素），视频和图片素材需要 |
| height | number | 否 | 高度（像素），视频和图片素材需要 |
| url | string | 是 | 素材URL |
| thumbnailUrl | string | 否 | 缩略图URL |
| description | string | 否 | 素材描述 |
| tags | array | 否 | 素材标签 |
| metadata | object | 否 | 额外元数据 |
| createdAt | string | 是 | 创建时间戳 |

### 示例请求
```json
{
  "taskId": "task_123456",
  "materials": [
    {
      "id": "video_001",
      "name": "产品介绍视频.mp4",
      "type": "video",
      "format": "mp4",
      "size": 15728640,
      "duration": 30.5,
      "width": 1920,
      "height": 1080,
      "url": "https://example.com/video_001.mp4",
      "thumbnailUrl": "https://example.com/video_001_thumb.jpg",
      "description": "产品功能演示视频",
      "tags": ["产品", "演示"],
      "createdAt": "2025-09-10T06:37:49.340Z"
    },
    {
      "id": "audio_001",
      "name": "背景音乐.mp3",
      "type": "audio",
      "format": "mp3",
      "size": 2048000,
      "duration": 60.0,
      "url": "https://example.com/audio_001.mp3",
      "description": "轻松的背景音乐",
      "tags": ["背景音乐", "轻松"],
      "createdAt": "2025-09-10T06:38:05.932Z"
    }
  ]
}
```

## 响应格式

### 成功响应
- **状态码**: 200 OK
- **Content-Type**: application/json

```json
{
  "success": true,
  "message": "AI mixed editing completed successfully",
  "timelineData": {
    "metadata": {
      "exported_at": "2025-09-10T06:42:07.211Z",
      "version": "1.0.0",
      "task_id": "task_123456",
      "total_duration": 90.5,
      "track_count": 5,
      "item_count": 8
    },
    "timeline": {
      "currentTime": 0,
      "totalDuration": 90.5,
      "zoomLevel": 1,
      "selectedItems": [],
      "playbackRate": 1,
      "isPlaying": false,
      "snapToGrid": true,
      "gridSize": 0.5,
      "scrollLeft": 0
    },
    "tracks": [
      {
        "id": "video-track-1",
        "name": "Video Track",
        "type": "video",
        "height": 80,
        "isLocked": false,
        "isMuted": false,
        "isVisible": true,
        "volume": 100,
        "order": 0,
        "items": [
          {
            "id": "item-video-001",
            "name": "产品介绍视频.mp4",
            "type": "video",
            "startTime": 0,
            "duration": 30.5,
            "trackId": "video-track-1",
            "color": "#3b82f6",
            "materialId": "video_001",
            "volume": 1,
            "opacity": 1,
            "clipStart": 0,
            "clipEnd": 30.5,
            "originalDuration": 30.5,
            "originalMaterialType": "video"
          }
        ]
      }
    ],
    "materials": [
      {
        "id": "video_001",
        "name": "产品介绍视频.mp4",
        "type": "video",
        "format": "mp4",
        "size": 15728640,
        "duration": 30.5,
        "width": 1920,
        "height": 1080,
        "url": "https://example.com/video_001.mp4",
        "thumbnailUrl": "https://example.com/video_001_thumb.jpg",
        "createdAt": "2025-09-10T06:37:49.340Z",
        "description": "产品功能演示视频",
        "tags": ["产品", "演示"]
      }
    ]
  },
  "taskId": "task_123456"
}
```

## 处理流程详解

### 第一阶段：简化JSON生成
LLM根据素材信息生成简化的剪辑配置，包含：
```json
{
  "total_duration": 90.5,
  "video_segments": [
    {
      "material_id": "video_001",
      "start_time": 0,
      "duration": 30.5,
      "clip_start": 0.0,
      "clip_end": 30.5
    }
  ],
  "audio_segments": [
    {
      "material_id": "audio_001",
      "start_time": 0,
      "duration": 55.5,
      "track": "audio-track-1",
      "volume": 200,
      "clip_start": 0.0,
      "clip_end": 55.5
    }
  ],
  "image_segments": [
    {
      "material_id": "image_001",
      "start_time": 55.5,
      "duration": 5.0
    }
  ]
}
```

### 第二阶段：格式转换
系统将简化配置解析为完整的时间轴格式，包括：
- 完整的轨道结构（视频轨道、图片轨道、音频轨道）
- 详细的时间轴元数据
- 完整的素材信息映射
- 时间轴状态配置

## 日志记录

### 请求阶段日志
```
[INFO] AI mixed editing request - Task ID: {task_id}, Materials: {count}
[INFO] Step 1: Generating simplified timeline with LLM for task: {task_id}
[INFO] Step 2: Converting simplified timeline to full format for task: {task_id}
```

### LLM生成阶段日志
```
[INFO] LLM simplified timeline generation completed successfully - Task ID: {task_id}
Extra: {total_duration, video_segments, audio_segments, image_segments}
```

### 解析转换阶段日志
```
[INFO] Timeline parsing completed successfully - Task ID: {task_id}
Extra: {tracks_count, materials_count, total_duration}
```

## 调试功能

### DEBUG模式配置
在 `.env` 文件中设置 `DEBUG=true` 可启用详细的调试日志输出：

```bash
DEBUG=true  # 设置为true时，会打印LLM API的详细请求体和返回值用于调试
```

### 调试日志输出
当 `DEBUG=true` 时，系统会在控制台打印以下调试信息：

#### 1. 路由层请求体
```
=== DEBUG: AI Mixed Editing Router Request ===
Task ID: task_123456
Materials count: 3
Request Body:
{
  "taskId": "task_123456",
  "materials": [...]
}
```

#### 2. LLM API请求体
```
=== DEBUG: LLM API Request for task task_123456 ===
URL: https://api.example.com/chat/completions
Headers: Content-Type: application/json, Authorization: Bearer sk-1234...abcd
Request Body:
{
  "model": "claude-sonnet-4-20250514",
  "messages": [...],
  "temperature": 0.2,
  "max_tokens": 8000
}
```

#### 3. LLM API响应体
```
=== DEBUG: LLM API Response for task task_123456 ===
Status Code: 200
Response Body:
{
  "choices": [
    {
      "message": {
        "content": "{\n  \"total_duration\": 90.5,\n  \"video_segments\": [...]\n}"
      }
    }
  ]
}
```

#### 4. 解析后的简化时间轴
```
=== DEBUG: Parsed Simplified Timeline for task task_123456 ===
{
  "total_duration": 90.5,
  "video_segments": [...],
  "audio_segments": [...],
  "image_segments": [...]
}
```

#### 5. 最终时间轴数据
```
=== DEBUG: Final Timeline Data for task task_123456 ===
{
  "metadata": {...},
  "timeline": {...},
  "tracks": [...],
  "materials": [...]
}
```

#### 6. 路由层响应体
```
=== DEBUG: AI Mixed Editing Router Response ===
Success: true
Task ID: task_123456
Message: AI mixed editing completed successfully
Response Body:
{
  "success": true,
  "timelineData": "[TIMELINE_DATA_SUMMARY] {...}"
}
```

### 注意事项
- 调试日志会包含敏感信息（API密钥会被部分掩码显示）
- 长内容会被截断以提高可读性
- 生产环境建议设置 `DEBUG=false` 以避免性能影响和日志过多

### 错误响应
- **状态码**: 400 Bad Request
```json
{
  "error": "Materials list is required and must not be empty",
  "taskId": "task_123456"
}
```

- **状态码**: 500 Internal Server Error
```json
{
  "error": "Failed to generate mixed editing timeline",
  "details": "Video Cut LLM API not responding",
  "taskId": "task_123456"
}
```

## 错误代码

### 状态码说明
| 状态码 | 说明 | 常见原因 |
|-------|------|---------|
| 400 | 请求参数错误 | 缺少必需参数、素材列表为空 |
| 500 | 内部服务器错误 | Video Cut LLM API配置错误、服务不可用 |
| 503 | 服务暂时不可用 | Video Cut LLM服务繁忙或超时 |

## 技术实现

### 架构流程
1. **前端请求** → Next.js API路由 (`/api/ai-mixed-editing`)
2. **代理转发** → Python FastAPI后端 (`/api/ai-mixed-editing`)
3. **素材分析** → Python后端分析素材信息并格式化
4. **Video Cut LLM调用** → 调用配置的Video Cut LLM API生成时间轴JSON
5. **JSON解析** → 验证和解析LLM返回的JSON数据
6. **响应返回** → 通过代理层返回到前端

### 配置要求
Python后端需要配置以下环境变量：
```env
VIDEO_CUT_LLM_API_KEY=***REMOVED***
VIDEO_CUT_LLM_API_URL=https://club.claudecode.site
VIDEO_CUT_LLM_MODEL=claude-sonnet-4-20250514
```

Next.js需要配置后端服务地址：
```env
BACKEND_SERVICE_URL=http://localhost:8000
```

### AI混剪逻辑
1. **素材分组**: 按类型分组（视频、音频、图片）
2. **时间轴规划**: 
   - 视频素材按顺序排列在video-track-1
   - 图片素材转换为视频片段，排列在image-track-1
   - 语音音频优先排列在audio-track-1
   - 背景音乐排列在audio-track-2，音量调低
   - 自动生成字幕轨道
3. **时长计算**: 自动计算总时长和各素材的时间安排
4. **JSON生成**: 生成符合时间轴导入格式的完整JSON

### 性能特性
- **智能分析**: 基于素材描述和标签进行智能分析
- **自动排列**: 自动安排素材在时间轴上的位置
- **格式验证**: 严格验证生成的JSON格式
- **错误处理**: 完整的错误处理和日志记录
- **配置集中**: LLM配置统一在Python后端管理

### 错误处理建议
1. **400错误**: 检查素材列表的完整性和格式
2. **500错误**: 向用户显示友好错误信息，建议稍后重试
3. **503错误**: 实现指数退避重试机制

## 使用示例

### JavaScript/TypeScript 示例
```typescript
async function performAIMixedEditing(taskId: string, materials: MaterialItem[]) {
  try {
    const response = await fetch('/api/ai-mixed-editing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        taskId: taskId,
        materials: materials,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.success && result.timelineData) {
      console.log('AI混剪成功，时间轴数据:', result.timelineData);
      
      // 使用时间轴导入API填充时间轴
      const importResponse = await fetch('/api/timeline-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId: taskId,
          fileContent: JSON.stringify(result.timelineData),
          fileName: `ai-mixed-editing-${Date.now()}.json`,
          mergeMode: 'replace',
          preserveIds: false
        }),
      });

      if (importResponse.ok) {
        const importResult = await importResponse.json();
        if (importResult.success && importResult.importedData) {
          // 处理导入完成，更新UI状态
          handleImportComplete(importResult.importedData.materials, importResult.importedData.timelineState);
          console.log('时间轴填充成功，UI已更新');
        }
      }
    }
  } catch (error) {
    console.error('AI混剪失败:', error);
    throw error;
  }
}
```

### 使用注意事项
1. **素材要求**: 确保素材列表包含足够的信息（名称、描述、标签）
2. **网络超时**: LLM生成可能需要较长时间，建议设置合理的超时时间
3. **结果验证**: 建议在使用生成的时间轴前进行基本验证
4. **错误处理**: 实现完善的错误处理和用户反馈机制

## 相关接口
- [时间轴导入API](./timeline_import_api.md) - 用于将生成的JSON填充到时间轴
- [视频编辑聊天API](./video-editing-chat.md) - 用于视频编辑相关的AI对话