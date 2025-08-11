# TTS (Text-to-Speech) API

## 概述
文本转语音API，提供单个文本转换、批量转换、语音类型获取等功能。支持多种音色和语速调节，适用于视频编辑中的语音合成需求。

## 端点列表

### 1. 单个文本转语音
`POST /api/tts/convert`

### 2. 批量文本转语音
`POST /api/tts/batch-convert`

### 3. 获取可用语音类型
`GET /api/tts/voice-types`

### 4. 音频文件下载
`GET /api/audio/generated/{filename}`

### 5. TTS服务健康检查
`GET /api/tts/health`

---

## 1. 单个文本转语音

### 端点
`POST /api/tts/convert`

### 请求格式

#### Headers
```
Content-Type: application/json
```

#### Body Parameters
| 参数名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| text | string | 是 | 要转换的文本内容 |
| voice_type | string | 是 | 语音类型/音色 |
| speed_ratio | number | 是 | 语速比例 (0.1-3.0) |
| segment_id | string | 否 | 片段唯一标识符 |
| task_id | string | 否 | 任务唯一标识符 |

#### 示例请求
```json
{
  "text": "欢迎使用我们的视频编辑工具",
  "voice_type": "zh-CN-XiaoxiaoNeural",
  "speed_ratio": 1.0,
  "segment_id": "segment_001",
  "task_id": "task_123456"
}
```

### 响应格式

#### 成功响应
- **状态码**: 200 OK
- **Content-Type**: application/json

```json
{
  "success": true,
  "message": "Text converted to speech successfully",
  "data": {
    "audio_url": "http://localhost:8000/api/audio/generated/audio_20240110_143022_zh-CN-XiaoxiaoNeural.mp3",
    "duration": 2.5,
    "file_size": 45678,
    "voice_type": "zh-CN-XiaoxiaoNeural",
    "text_length": 12,
    "request_id": "req_abc123def456",
    "file_name": "audio_20240110_143022_zh-CN-XiaoxiaoNeural.mp3",
    "file_path": "/app/static/audio/generated/audio_20240110_143022_zh-CN-XiaoxiaoNeural.mp3",
    "speed_ratio": 1.0,
    "segment_id": "segment_001",
    "task_id": "task_123456",
    "mock_mode": false,
    "duration_method": "ffmpeg",
    "created_at": "2024-01-10T14:30:22Z"
  }
}
```

#### 错误响应
- **状态码**: 400 Bad Request
```json
{
  "success": false,
  "message": "Text content is required",
  "data": null
}
```

- **状态码**: 500 Internal Server Error
```json
{
  "success": false,
  "message": "TTS service temporarily unavailable",
  "data": null
}
```

---

## 2. 批量文本转语音

### 端点
`POST /api/tts/batch-convert`

### 请求格式

#### Body Parameters
| 参数名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| segments | array | 是 | 要转换的文本片段数组 |
| voice_type | string | 是 | 语音类型/音色 |
| speed_ratio | number | 是 | 语速比例 (0.1-3.0) |
| task_id | string | 否 | 任务唯一标识符 |
| concurrent_threads | number | 否 | 并发线程数 (默认3) |

#### segments 数组元素格式
| 参数名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| segment_id | string | 是 | 片段唯一标识符 |
| text | string | 是 | 文本内容 |
| title | string | 否 | 片段标题 |

#### 示例请求
```json
{
  "segments": [
    {
      "segment_id": "seg_001",
      "text": "这是第一个片段的内容",
      "title": "开场白"
    },
    {
      "segment_id": "seg_002", 
      "text": "这是第二个片段的内容",
      "title": "主要内容"
    }
  ],
  "voice_type": "zh-CN-XiaoxiaoNeural",
  "speed_ratio": 1.0,
  "task_id": "task_123456",
  "concurrent_threads": 3
}
```

### 响应格式

#### 成功响应
```json
{
  "success": true,
  "message": "Batch conversion completed",
  "data": {
    "results": [
      {
        "segment_id": "seg_001",
        "success": true,
        "audio_url": "http://localhost:8000/api/audio/generated/audio_seg_001.mp3",
        "duration": 2.1,
        "file_size": 34567,
        "message": "Conversion successful"
      },
      {
        "segment_id": "seg_002",
        "success": true,
        "audio_url": "http://localhost:8000/api/audio/generated/audio_seg_002.mp3", 
        "duration": 3.2,
        "file_size": 52341,
        "message": "Conversion successful"
      }
    ],
    "total_segments": 2,
    "successful_segments": 2,
    "failed_segments": 0,
    "processing_time": 5.4
  }
}
```

---

## 3. 获取可用语音类型

### 端点
`GET /api/tts/voice-types`

### 响应格式

#### 成功响应
```json
{
  "success": true,
  "message": "Voice types retrieved successfully",
  "data": {
    "zh-CN-XiaoxiaoNeural": {
      "name": "晓晓",
      "language": "zh-CN",
      "gender": "Female",
      "description": "温柔自然的女性声音"
    },
    "zh-CN-YunxiNeural": {
      "name": "云希",
      "language": "zh-CN", 
      "gender": "Male",
      "description": "清晰稳重的男性声音"
    }
  }
}
```

---

## 4. 音频文件下载

### 端点
`GET /api/audio/generated/{filename}`

### 路径参数
| 参数名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| filename | string | 是 | 音频文件名 |

### 响应格式

#### 成功响应
- **状态码**: 200 OK
- **Content-Type**: audio/mpeg (或对应的音频类型)
- **响应体**: 音频文件的二进制数据

#### 错误响应
- **状态码**: 404 Not Found
```json
{
  "success": false,
  "message": "Audio file not found"
}
```

---

## 5. TTS服务健康检查

### 端点
`GET /api/tts/health`

### 响应格式

#### 成功响应
```json
{
  "success": true,
  "status": "healthy",
  "message": "TTS service is running normally",
  "timestamp": "2024-01-10T14:30:22Z",
  "version": "1.0.0",
  "dependencies": {
    "tts_engine": "available",
    "file_system": "writable"
  }
}
```

#### 服务异常响应
```json
{
  "success": false,
  "status": "unhealthy",
  "message": "TTS engine unavailable",
  "timestamp": "2024-01-10T14:30:22Z"
}
```

---

## 错误代码

### 状态码说明
| 状态码 | 说明 | 常见原因 |
|-------|------|---------|
| 400 | 请求参数错误 | 缺少必需参数或参数格式不正确 |
| 404 | 资源不存在 | 音频文件不存在或路径错误 |
| 429 | 请求过于频繁 | 超出API调用频率限制 |
| 500 | 内部服务器错误 | TTS引擎故障或系统异常 |
| 503 | 服务不可用 | TTS服务临时不可用 |

### 常见错误消息
- `"Text content is required"` - 文本内容为空
- `"Voice type is required"` - 未指定语音类型
- `"Speed ratio must be between 0.1 and 3.0"` - 语速比例超出范围
- `"TTS service temporarily unavailable"` - TTS服务暂时不可用
- `"Audio file not found"` - 音频文件不存在

---

## 使用示例

### JavaScript/TypeScript 示例

```javascript
// 单个文本转语音
async function convertTextToSpeech(text, voiceType = 'zh-CN-XiaoxiaoNeural') {
  const response = await fetch('/api/tts/convert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: text,
      voice_type: voiceType,
      speed_ratio: 1.0,
      task_id: 'my_task_001'
    }),
  });
  
  return await response.json();
}

// 获取语音类型
async function getVoiceTypes() {
  const response = await fetch('/api/tts/voice-types');
  return await response.json();
}

// 批量转换
async function batchConvert(segments) {
  const response = await fetch('/api/tts/batch-convert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      segments: segments,
      voice_type: 'zh-CN-XiaoxiaoNeural',
      speed_ratio: 1.0,
      concurrent_threads: 3
    }),
  });
  
  return await response.json();
}
```

---

## 性能和限制

### 请求限制
- 单次文本长度: 最大10000字符
- 批量转换: 最大50个片段
- 并发线程数: 1-10个
- 语速比例: 0.1-3.0

### 文件格式
- 音频格式: MP3 (默认)
- 采样率: 16kHz/22kHz
- 比特率: 128kbps

### 缓存策略
- 音频文件缓存时间: 1小时
- 语音类型缓存: 24小时
- 健康检查缓存: 5分钟

---

## 更新日志

### v1.0.0 (2024-01-10)
- 初始版本发布
- 支持单个和批量文本转语音
- 支持多种中文语音类型
- 提供健康检查接口
- 完整的错误处理和日志记录 