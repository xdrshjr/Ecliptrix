# Audio Search API

## 概述

音频搜索API提供基于Freesound API的在线音频文件搜索功能，支持按关键词、时长、音频类型和排序方式等条件搜索高质量的音频文件。

## 基础信息

- **基础URL**: `/api/audio`
- **认证方式**: 无需认证（后端使用Freesound API Key）
- **支持格式**: JSON

## 端点

### 1. 搜索音频文件

搜索在线音频文件，支持多种过滤条件和排序方式。

**端点**: `POST /api/audio/search`

#### 请求参数

```json
{
  "query": "ambient music",
  "max_audios": 20,
  "duration_min": 5.0,
  "duration_max": 60.0,
  "audio_type": "music",
  "sort_by": "downloads"
}
```

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 搜索关键词，1-200字符 |
| `max_audios` | integer | 否 | 最大返回数量，默认20，范围1-50 |
| `duration_min` | float | 否 | 最小时长（秒），必须≥0 |
| `duration_max` | float | 否 | 最大时长（秒），必须>duration_min |
| `audio_type` | string | 否 | 音频类型，默认"all"，可选值：all, music, sound-effect, speech, ambient, nature |
| `sort_by` | string | 否 | 排序方式，默认"score"，可选值：score, downloads, rating, duration_desc, duration_asc, created_desc, created_asc |

#### 排序方式说明

- `score`: 按相关度排序（默认）
- `downloads`: 按下载量排序（热度）
- `rating`: 按评分排序
- `duration_desc`: 按时长降序排序（长到短）
- `duration_asc`: 按时长升序排序（短到长）
- `created_desc`: 按创建时间降序排序（最新）
- `created_asc`: 按创建时间升序排序（最早）

#### 响应格式

**成功响应** (200):
```json
{
  "success": true,
  "message": "Found 15 audio files",
  "audios": [
    {
      "id": 12345,
      "name": "Ambient Forest Sounds",
      "description": "Peaceful forest ambience with birds chirping",
      "username": "naturelover",
      "duration": 45.2,
      "download_url": "https://freesound.org/data/previews/123/12345_456789-hq.mp3",
      "preview_url": "https://freesound.org/data/previews/123/12345_456789-lq.mp3",
      "waveform_url": "https://freesound.org/data/displays/123/12345_456789_wave_M.png",
      "license": "CC0",
      "tags": ["ambient", "nature", "forest", "birds"],
      "filesize": 1024000,
      "type": "mp3",
      "channels": 2,
      "bitrate": 128,
      "samplerate": 44100
    }
  ],
  "total_found": 150,
  "query": "ambient music"
}
```

**错误响应** (400):
```json
{
  "success": false,
  "message": "Invalid sort_by parameter",
  "audios": [],
  "total_found": 0,
  "query": "ambient music"
}
```

#### 使用示例

##### 1. 按热度搜索音乐

```bash
curl -X POST "http://localhost:8001/api/audio/search" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "electronic music",
    "audio_type": "music",
    "sort_by": "downloads",
    "max_audios": 10
  }'
```

##### 2. 按评分搜索短音效

```bash
curl -X POST "http://localhost:8001/api/audio/search" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "click sound",
    "audio_type": "sound-effect",
    "sort_by": "rating",
    "duration_max": 5.0,
    "max_audios": 20
  }'
```

## 错误处理

API返回的常见错误：

- **400 Bad Request**: 
  - 搜索查询为空
  - 参数验证失败
  - 无效的排序方式
  - 时长范围无效
- **500 Internal Server Error**: 
  - Freesound API调用失败
  - 内部服务器错误

## 注意事项

1. **API限制**: 基于Freesound API，受其速率限制影响
2. **文件格式**: 支持多种音频格式，主要为MP3和WAV
3. **许可证**: 返回的音频文件包含许可证信息，使用前请注意许可证要求
4. **预览**: 提供预览URL用于播放测试，下载URL用于获取完整文件
5. **热度排序**: 使用`sort_by: "downloads"`可获得最受欢迎的音频文件 