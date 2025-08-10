# 批量文本转语音 API 文档

## 概述

批量文本转语音 API 提供了同时处理多个文本段落的语音转换功能，支持并发处理以提高转换效率。

## 基本信息

- **接口路径**: `/api/tts/convert-batch`
- **请求方法**: `POST`
- **内容类型**: `application/json`
- **认证方式**: 无需认证

## 请求参数

### 请求体 (JSON)

```json
{
  "segments": [
    {
      "segment_id": "string",
      "text": "string",
      "title": "string (可选)"
    }
  ],
  "voice_type": "string",
  "speed_ratio": 1.0,
  "task_id": "string (可选)",
  "concurrent_threads": 3
}
```

### 参数说明

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| segments | array | 是 | - | 文本段落列表，最多50个 |
| segments[].segment_id | string | 是 | - | 段落唯一标识符 |
| segments[].text | string | 是 | - | 要转换的文本内容，最长5000字符 |
| segments[].title | string | 否 | - | 段落标题，用于标识 |
| voice_type | string | 否 | zh_female_wanqudashu_moon_bigtts | 音色类型 |
| speed_ratio | number | 否 | 1.0 | 语速比例 (0.5-2.0) |
| task_id | string | 否 | - | 任务ID，用于日志追踪 |
| concurrent_threads | integer | 否 | 3 | 并发线程数 (1-10) |

### 可用音色类型

- `zh_female_wanqudashu_moon_bigtts` - 温柔女声
- `zh_female_sweet` - 甜美女声
- `zh_female_gentle` - 温和女声
- `zh_male_warm` - 温暖男声
- `zh_male_powerful` - 有力男声
- `zh_male_steady` - 稳重男声
- `en_female_natural` - 自然英语女声
- `en_male_natural` - 自然英语男声

## 响应格式

### 成功响应

```json
{
  "success": true,
  "message": "批量语音转换完成，成功 2/2 个段落",
  "total_segments": 2,
  "successful_segments": 2,
  "failed_segments": 0,
  "total_processing_time": 12.5,
  "results": [
    {
      "segment_id": "segment-1",
      "success": true,
      "audio_url": "/api/audio/generated/tts_segment-1_20240101_abc123.mp3",
      "duration": 5.2,
      "file_size": 83456,
      "error": null,
      "processing_time": 6.1
    },
    {
      "segment_id": "segment-2",
      "success": true,
      "audio_url": "/api/audio/generated/tts_segment-2_20240101_def456.mp3",
      "duration": 7.8,
      "file_size": 124928,
      "error": null,
      "processing_time": 6.4
    }
  ]
}
```

### 部分失败响应

```json
{
  "success": false,
  "message": "批量语音转换完成，成功 1/2 个段落",
  "total_segments": 2,
  "successful_segments": 1,
  "failed_segments": 1,
  "total_processing_time": 15.3,
  "results": [
    {
      "segment_id": "segment-1",
      "success": true,
      "audio_url": "/api/audio/generated/tts_segment-1_20240101_abc123.mp3",
      "duration": 5.2,
      "file_size": 83456,
      "error": null,
      "processing_time": 6.1
    },
    {
      "segment_id": "segment-2",
      "success": false,
      "audio_url": null,
      "duration": null,
      "file_size": null,
      "error": "文本内容过长",
      "processing_time": 9.2
    }
  ]
}
```

### 响应字段说明

| 字段名 | 类型 | 说明 |
|--------|------|------|
| success | boolean | 整体处理是否成功（所有段落都成功才为true） |
| message | string | 响应消息 |
| total_segments | integer | 总段落数 |
| successful_segments | integer | 成功处理的段落数 |
| failed_segments | integer | 失败的段落数 |
| total_processing_time | number | 总处理时间（秒） |
| results | array | 各段落处理结果 |
| results[].segment_id | string | 段落ID |
| results[].success | boolean | 该段落是否成功 |
| results[].audio_url | string | 音频文件URL（成功时） |
| results[].duration | number | 音频时长（秒，成功时） |
| results[].file_size | integer | 文件大小（字节，成功时） |
| results[].error | string | 错误信息（失败时） |
| results[].processing_time | number | 该段落处理时间（秒） |

## 错误处理

### 请求验证错误 (400)

```json
{
  "detail": [
    {
      "loc": ["body", "segments"],
      "msg": "ensure this value has at least 1 items",
      "type": "value_error.list.min_items"
    }
  ]
}
```

### 服务器错误 (500)

```json
{
  "success": false,
  "message": "批量语音转换失败: 内部服务器错误",
  "total_segments": 2,
  "successful_segments": 0,
  "failed_segments": 2,
  "total_processing_time": 0.0,
  "results": []
}
```

## 使用限制

- 单次请求最多处理50个段落
- 单个段落文本最长5000字符
- 总文本长度不超过100,000字符
- 并发线程数限制在1-10之间
- 单个请求超时时间：30秒
- 整个批量处理超时时间：300秒（5分钟）

## 配置参数

批量TTS的行为可以通过 `config/batch_tts_config.yaml` 文件进行配置：

```yaml
batch_tts:
  concurrent_threads: 3        # 默认并发线程数
  max_concurrent_threads: 10   # 最大并发线程数
  request_timeout: 30          # 单个请求超时时间（秒）
  batch_timeout: 300           # 批量处理超时时间（秒）
  
  limits:
    max_segments_per_batch: 50         # 单次最大段落数
    max_text_length_per_segment: 5000  # 单段落最大文本长度
    max_total_text_length: 100000      # 总文本最大长度
```

## 请求示例

### cURL 示例

```bash
curl -X POST "http://localhost:8000/api/tts/convert-batch" \
  -H "Content-Type: application/json" \
  -d '{
    "segments": [
      {
        "segment_id": "segment-1",
        "text": "大家好，欢迎来到今天的视频教程。",
        "title": "开场介绍"
      },
      {
        "segment_id": "segment-2",
        "text": "今天我们要学习如何使用这个强大的视频编辑工具。",
        "title": "功能演示"
      }
    ],
    "voice_type": "zh_female_wanqudashu_moon_bigtts",
    "speed_ratio": 1.0,
    "task_id": "task_123",
    "concurrent_threads": 3
  }'
```

### JavaScript 示例

```javascript
const response = await fetch('/api/tts/convert-batch', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    segments: [
      {
        segment_id: 'segment-1',
        text: '大家好，欢迎来到今天的视频教程。',
        title: '开场介绍'
      },
      {
        segment_id: 'segment-2', 
        text: '今天我们要学习如何使用这个强大的视频编辑工具。',
        title: '功能演示'
      }
    ],
    voice_type: 'zh_female_wanqudashu_moon_bigtts',
    speed_ratio: 1.0,
    task_id: 'task_123',
    concurrent_threads: 3
  })
});

const result = await response.json();
console.log('批量转换结果:', result);
```

## 性能考虑

1. **并发优化**: 合理设置 `concurrent_threads` 参数，过多线程可能导致资源竞争
2. **文本长度**: 较短的文本段落处理更快，建议合理分割长文本
3. **错误处理**: 部分段落失败不会影响其他段落的处理
4. **超时设置**: 根据文本长度和网络条件调整超时参数

## 日志和监控

所有批量TTS请求都会记录详细日志，包括：

- 请求参数和处理时间
- 每个段落的处理状态
- 错误信息和性能指标
- 成功率统计

日志可用于性能监控和问题排查。 