# Audio Search API

## 概述

音频搜索API提供基于Freesound API的在线音频文件搜索功能，支持按关键词、时长等条件搜索高质量的音频文件。

## 基础信息

- **基础URL**: `/api/audio`
- **认证方式**: 无需认证（后端使用Freesound API Key）
- **支持格式**: JSON

## 端点

### 1. 搜索音频文件

搜索在线音频文件，支持多种过滤条件。

**端点**: `POST /api/audio/search`

#### 请求参数

```json
{
  "query": "ambient music",
  "max_audios": 20,
  "duration_min": 5.0,
  "duration_max": 60.0,
  "audio_type": "music"
}
```

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 搜索关键词，1-200字符 |
| `max_audios` | integer | 否 | 最大返回数量，默认20，范围1-50 |
| `duration_min` | float | 否 | 最小时长（秒），必须≥0 |
| `duration_max` | float | 否 | 最大时长（秒），必须>duration_min |
| `audio_type` | string | 否 | 音频类型，默认"all"，可选值：all, music, sound-effect, speech, ambient, nature |

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
  "message": "Search query cannot be empty",
  "audios": [],
  "total_found": 0,
  "query": ""
}
```

**错误响应** (500):
```json
{
  "success": false,
  "message": "Failed to fetch data from Freesound API",
  "audios": [],
  "total_found": 0,
  "query": "ambient music"
}
```

#### 音频信息字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | integer | Freesound音频ID |
| `name` | string | 音频名称/标题 |
| `description` | string | 音频描述 |
| `username` | string | 上传者用户名 |
| `duration` | float | 音频时长（秒） |
| `download_url` | string | 高质量下载URL |
| `preview_url` | string | 预览播放URL（低质量） |
| `waveform_url` | string | 波形图片URL（可选） |
| `license` | string | 许可证类型（如CC0、CC BY等） |
| `tags` | array | 音频标签列表 |
| `filesize` | integer | 文件大小（字节，可选） |
| `type` | string | 文件类型（如mp3、wav等，可选） |
| `channels` | integer | 声道数（可选） |
| `bitrate` | integer | 比特率（可选） |
| `samplerate` | integer | 采样率（可选） |

### 2. 健康检查

检查音频搜索服务状态。

**端点**: `GET /api/audio/health`

#### 响应格式

**成功响应** (200):
```json
{
  "status": "healthy",
  "message": "Audio search service is healthy",
  "api_key_configured": true,
  "service": "audio_search"
}
```

## 使用示例

### cURL 示例

```bash
# 基础搜索
curl -X POST "http://localhost:8000/api/audio/search" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "piano music",
    "max_audios": 10
  }'

# 带时长过滤的搜索
curl -X POST "http://localhost:8000/api/audio/search" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "nature sounds",
    "max_audios": 20,
    "duration_min": 10.0,
    "duration_max": 120.0,
    "audio_type": "nature"
  }'

# 健康检查
curl -X GET "http://localhost:8000/api/audio/health"
```

### Python 示例

```python
import requests

# 搜索音频
response = requests.post(
    "http://localhost:8000/api/audio/search",
    json={
        "query": "ambient music",
        "max_audios": 15,
        "duration_min": 30.0,
        "duration_max": 300.0,
        "audio_type": "ambient"
    }
)

if response.status_code == 200:
    data = response.json()
    if data["success"]:
        print(f"Found {len(data['audios'])} audio files")
        for audio in data["audios"]:
            print(f"- {audio['name']} ({audio['duration']}s) by {audio['username']}")
    else:
        print(f"Search failed: {data['message']}")
```

### JavaScript 示例

```javascript
// 搜索音频
const searchAudio = async (query, maxAudios = 20) => {
  try {
    const response = await fetch('/api/audio/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        max_audios: maxAudios,
        duration_min: 5.0,
        duration_max: 180.0,
        audio_type: 'music'
      }),
    });

    const data = await response.json();
    
    if (data.success) {
      console.log(`Found ${data.audios.length} audio files`);
      return data.audios;
    } else {
      console.error('Search failed:', data.message);
      return [];
    }
  } catch (error) {
    console.error('Search error:', error);
    return [];
  }
};

// 使用示例
searchAudio('relaxing music', 10).then(audios => {
  audios.forEach(audio => {
    console.log(`${audio.name} - ${audio.duration}s`);
  });
});
```

## 错误处理

### 常见错误码

| 状态码 | 错误类型 | 说明 |
|--------|----------|------|
| 400 | 请求参数错误 | 查询为空或参数格式错误 |
| 500 | 服务器错误 | Freesound API调用失败或内部错误 |

### 错误处理建议

1. **API密钥未配置**: 确保服务器端配置了有效的Freesound API密钥
2. **网络超时**: 实现重试机制，Freesound API调用可能因网络问题失败
3. **参数验证**: 客户端应验证参数范围，避免无效请求
4. **结果为空**: 搜索无结果时，`success`仍为`true`，但`audios`数组为空

## 配置要求

### 环境变量

服务器端需要配置以下环境变量：

```bash
# Freesound API密钥（必需）
FREESOUND_API_KEY=your_freesound_api_key_here
```

### 获取Freesound API密钥

1. 访问 [Freesound.org](https://freesound.org/)
2. 注册账户并登录
3. 访问 [API申请页面](https://freesound.org/apiv2/apply/)
4. 填写应用信息并申请API密钥
5. 将获得的API密钥配置到环境变量中

## 许可证说明

音频文件使用不同的Creative Commons许可证，包括：

- **CC0**: 公共域，可自由使用
- **CC BY**: 需要署名
- **CC BY-SA**: 需要署名，相同方式共享
- **CC BY-NC**: 需要署名，非商业用途

使用音频文件时请遵守相应的许可证要求。

## 音频类型说明

音频类型过滤器支持以下类型：

- **all**: 全部类型（默认）
- **music**: 音乐类音频（包含music, musical, song, melody等标签）
- **sound-effect**: 音效类音频（包含sound-effect, fx, effect, sfx等标签）
- **speech**: 语音类音频（包含speech, voice, vocal, talk等标签）
- **ambient**: 环境音类音频（包含ambient, atmosphere, drone, pad等标签）
- **nature**: 自然音类音频（包含nature, natural, outdoor, environment等标签）

## 限制说明

1. **请求频率**: 遵守Freesound API的频率限制
2. **文件大小**: 音频文件大小因质量而异，下载前请检查文件大小
3. **可用性**: 依赖Freesound服务的可用性，建议实现降级处理
4. **搜索结果**: 最多返回150个结果（Freesound API限制）
5. **音频类型过滤**: 基于Freesound的标签系统，可能不是100%准确 