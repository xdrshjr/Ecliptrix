# 时间轴字幕提取 API 文档

## 概述

时间轴字幕提取API提供了批量将时间轴上的音频项目转换为字幕的功能。该API可以同时处理多个音频文件，自动调整字幕时间戳以匹配时间轴位置，并返回结构化的字幕数据供前端使用。

## 基础信息

- **基础URL**: `/api/audio`
- **认证方式**: 无需认证（内部服务）
- **支持格式**: MP3, WAV, M4A等常见音频格式
- **最大文件大小**: 100MB per file
- **支持语言**: 中文(zh-CN), 英文(en-US)等

## API 接口

### 批量音频转字幕

**接口地址**: `POST /api/audio/batch-transcribe`

**描述**: 批量将时间轴上的音频项目转换为字幕，支持多个音频文件同时处理

**请求方式**: `application/json`

**请求参数**:

```json
{
  "audio_items": [
    {
      "id": "string",              // 音频项目ID
      "name": "string",            // 音频项目名称
      "url": "string",             // 音频文件URL（支持本地路径和远程URL）
      "start_time": 0.0,           // 在时间轴上的开始时间（秒）
      "duration": 10.0,            // 在时间轴上的持续时间（秒）
      "track_id": "string",        // 所属轨道ID
      "clip_start": 0.0,           // 原始音频中的开始时间（秒，可选）
      "clip_end": 10.0             // 原始音频中的结束时间（秒，可选）
    }
  ],
  "language": "zh-CN",             // 语言代码（可选，默认中文）
  "use_itn": true,                 // 是否使用逆文本规范化（可选，默认true）
  "use_punc": false,               // 是否使用标点符号（可选，默认false）
  "max_lines": 2,                  // 最大行数（可选，默认2）
  "words_per_line": 15,            // 每行最大字数（可选，默认15）
  "generate_srt_file": true        // 是否生成SRT字幕文件（可选，默认true）
}
```

**请求示例**:

```bash
curl -X POST "http://localhost:8000/api/audio/batch-transcribe" \
  -H "Content-Type: application/json" \
  -d '{
    "audio_items": [
      {
        "id": "audio_001",
        "name": "背景音乐",
        "url": "/api/audio/generated/background_music.mp3",
        "start_time": 0.0,
        "duration": 30.0,
        "track_id": "audio-track-1",
        "clip_start": 0.0,
        "clip_end": 30.0
      },
      {
        "id": "audio_002", 
        "name": "旁白音频",
        "url": "/api/audio/generated/narration.mp3",
        "start_time": 5.0,
        "duration": 20.0,
        "track_id": "audio-track-2",
        "clip_start": 0.0,
        "clip_end": 20.0
      }
    ],
    "language": "zh-CN",
    "use_itn": true,
    "use_punc": false,
    "max_lines": 2,
    "words_per_line": 15,
    "generate_srt_file": true
  }'
```

**成功响应**:

```json
{
  "success": true,
  "message": "批量音频转录完成，成功处理2个项目",
  "total_items": 2,
  "successful_items": 2,
  "failed_items": 0,
  "transcriptions": [
    {
      "audio_item_id": "audio_001",
      "audio_item_name": "背景音乐",
      "track_id": "audio-track-1",
      "start_time": 0.0,
      "duration": 30.0,
      "success": true,
      "subtitles": [
        {
          "start_time": 1000,      // 毫秒时间戳（已调整为时间轴位置）
          "end_time": 3500,
          "text": "这是第一段字幕内容"
        },
        {
          "start_time": 4000,
          "end_time": 7200,
          "text": "这是第二段字幕内容"
        }
      ],
      "srt_content": "1\n00:00:01,000 --> 00:00:03,500\n这是第一段字幕内容\n\n2\n00:00:04,000 --> 00:00:07,200\n这是第二段字幕内容\n\n",
      "processing_time": 15.2,
      "audio_duration": 30.0,
      "error_message": null
    },
    {
      "audio_item_id": "audio_002",
      "audio_item_name": "旁白音频", 
      "track_id": "audio-track-2",
      "start_time": 5.0,
      "duration": 20.0,
      "success": true,
      "subtitles": [
        {
          "start_time": 6000,      // 毫秒时间戳（5秒 + 1秒 = 6秒）
          "end_time": 9500,
          "text": "旁白内容第一段"
        }
      ],
      "srt_content": "1\n00:00:06,000 --> 00:00:09,500\n旁白内容第一段\n\n",
      "processing_time": 12.8,
      "audio_duration": 20.0,
      "error_message": null
    }
  ],
  "total_processing_time": 28.0,
  "created_at": "2024-01-15T10:30:45.123456"
}
```

**错误响应**:

```json
{
  "success": false,
  "error": "请求中没有音频项目",
  "error_code": "NO_AUDIO_ITEMS",
  "details": {
    "audio_items_count": 0
  },
  "created_at": "2024-01-15T10:30:45.123456"
}
```

## 响应字段说明

### BatchAudioTranscriptionResponse

| 字段名 | 类型 | 描述 |
|--------|------|------|
| success | boolean | 整体请求是否成功 |
| message | string | 响应消息 |
| total_items | integer | 总音频项目数 |
| successful_items | integer | 成功转录的项目数 |
| failed_items | integer | 失败的项目数 |
| transcriptions | array | 转录结果列表 |
| total_processing_time | float | 总处理时间（秒） |
| created_at | string | 创建时间（ISO格式） |

### AudioItemTranscription

| 字段名 | 类型 | 描述 |
|--------|------|------|
| audio_item_id | string | 音频项目ID |
| audio_item_name | string | 音频项目名称 |
| track_id | string | 所属轨道ID |
| start_time | float | 在时间轴上的开始时间（秒） |
| duration | float | 在时间轴上的持续时间（秒） |
| success | boolean | 转录是否成功 |
| subtitles | array | 字幕列表 |
| srt_content | string | SRT格式字幕内容 |
| processing_time | float | 处理时间（秒） |
| audio_duration | float | 音频时长（秒） |
| error_message | string | 错误信息（如果失败） |

### SubtitleItem

| 字段名 | 类型 | 描述 |
|--------|------|------|
| start_time | integer | 开始时间（毫秒，已调整为时间轴位置） |
| end_time | integer | 结束时间（毫秒，已调整为时间轴位置） |
| text | string | 字幕文本内容 |

## 特殊功能

### 时间戳自动调整

API会自动将转录得到的字幕时间戳调整为时间轴上的绝对位置：

- 原始字幕时间戳：相对于音频文件开始的时间
- 调整后时间戳：原始时间戳 + 音频项目在时间轴上的开始时间

例如：
- 音频项目在时间轴上的开始时间：5.0秒
- 原始字幕开始时间：1.0秒
- 调整后字幕开始时间：6.0秒（5.0 + 1.0）

### 音频文件支持

- **本地文件**: 支持以 `/api/` 或 `static/` 开头的本地路径
- **远程文件**: 支持HTTP/HTTPS远程URL
- **文件格式**: MP3, WAV, M4A等常见音频格式
- **文件大小**: 单个文件最大100MB

### 错误处理

- 单个音频项目转录失败不会影响其他项目的处理
- 每个转录结果都包含独立的成功/失败状态
- 详细的错误信息帮助定位问题

## 使用场景

1. **视频编辑**: 为时间轴上的所有音频轨道批量生成字幕
2. **内容制作**: 快速为多段音频内容生成字幕文件
3. **字幕同步**: 确保字幕时间戳与时间轴位置精确对应

## 性能考虑

- 批量处理可以显著提高效率，避免多次网络请求
- 处理时间取决于音频文件大小和数量
- 建议单次请求不超过10个音频文件以确保响应时间
- 大文件处理可能需要较长时间，请适当设置超时时间

## 错误代码

| 错误代码 | 描述 |
|----------|------|
| NO_AUDIO_ITEMS | 请求中没有音频项目 |
| BATCH_TRANSCRIPTION_FAILED | 批量转录处理失败 |
| INVALID_AUDIO_ITEM | 音频项目格式无效 |
| FILE_NOT_FOUND | 音频文件不存在 |
| TRANSCRIPTION_SERVICE_ERROR | 转录服务错误 | 