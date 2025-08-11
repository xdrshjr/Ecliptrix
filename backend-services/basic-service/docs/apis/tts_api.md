# Text-to-Speech (TTS) API Documentation

## Overview

The TTS API provides text-to-speech conversion services using the Volcano TTS engine. It supports multiple voice types, speed control, and generates high-quality MP3 audio files. The service automatically detects audio duration using ffmpeg for accurate timing information.

## Key Features

- **Accurate Duration Detection**: Uses ffmpeg to get precise audio duration instead of estimation
- **Fallback Mechanism**: Falls back to text-based estimation if ffmpeg is unavailable
- **Multiple Voice Types**: Supports various Chinese and English voices
- **Speed Control**: Adjustable speech speed from 0.5x to 2.0x
- **Detailed Logging**: Comprehensive logging for debugging and monitoring

## Base URL

```
/api/tts
```

## Authentication

The API uses environment variables for authentication with the Volcano TTS service:
- `VOLCANO_TTS_APPID`: Application ID
- `VOLCANO_TTS_ACCESS_TOKEN`: Access Token
- `VOLCANO_TTS_SECRET_KEY`: Secret Key (reserved for future use)

## Endpoints

### 1. Convert Text to Speech

**POST** `/tts/convert`

Converts text to speech and returns an audio file URL.

#### Request Body

```json
{
  "text": "这是一段需要转换为语音的文本内容。",
  "voice_type": "zh_female_wanqudashu_moon_bigtts",
  "speed_ratio": 1.0,
  "segment_id": "segment_001",
  "task_id": "task_123"
}
```

#### Parameters

| Parameter | Type | Required | Description | Default |
|-----------|------|----------|-------------|---------|
| text | string | Yes | Text to convert (max 5000 characters) | - |
| voice_type | string | No | Voice type identifier | zh_female_wanqudashu_moon_bigtts |
| speed_ratio | float | No | Speech speed ratio (0.5-2.0) | 1.0 |
| segment_id | string | No | Script segment ID for reference | null |
| task_id | string | No | Task ID for reference | null |

#### Response (Success)

```json
{
  "success": true,
  "message": "语音转换成功",
  "data": {
    "audio_url": "/api/audio/generated/tts_segment_001_20240115_143022_a1b2c3d4.mp3",
    "file_name": "tts_segment_001_20240115_143022_a1b2c3d4.mp3",
    "file_size": 248576,
    "duration": 15.5,
    "duration_method": "ffmpeg",
    "voice_type": "zh_female_wanqudashu_moon_bigtts",
    "text_length": 45,
    "speed_ratio": 1.0,
    "request_id": "req_67890",
    "created_at": "2024-01-15T14:30:22.123456",
    "segment_id": "segment_001",
    "task_id": "task_123",
    "mock_mode": false
  }
}
```

#### Response (Error)

```json
{
  "success": false,
  "message": "语音转换失败: 文本内容为空",
  "error_code": "EMPTY_TEXT",
  "details": {
    "segment_id": "segment_001",
    "task_id": "task_123",
    "voice_type": "zh_female_wanqudashu_moon_bigtts"
  }
}
```

#### Response Data Fields

| Field | Type | Description |
|-------|------|-------------|
| audio_url | string | URL to access the generated audio file |
| file_name | string | Name of the generated audio file |
| file_size | integer | Size of the audio file in bytes |
| duration | float | **Actual audio duration in seconds** (detected using ffmpeg) |
| duration_method | string | Method used to determine duration: "ffmpeg" or "estimated" |
| voice_type | string | Voice type used for synthesis |
| text_length | integer | Length of the input text in characters |
| speed_ratio | float | Speech speed ratio used |
| request_id | string | Unique identifier for this request |
| created_at | string | ISO timestamp when the audio was created |
| segment_id | string | Script segment ID (if provided) |
| task_id | string | Task ID (if provided) |
| mock_mode | boolean | Whether the service is running in mock mode |

#### Status Codes

- `200 OK`: Conversion successful
- `400 Bad Request`: Invalid input parameters
- `500 Internal Server Error`: Configuration error or service failure

#### Duration Detection

The service uses a two-tier approach for audio duration detection:

1. **Primary Method (ffmpeg)**: Uses ffprobe to get the exact duration from the generated audio file
2. **Fallback Method (estimation)**: Uses text length × 0.15 seconds per character / speed_ratio if ffmpeg is unavailable

The `duration_method` field indicates which method was used:
- `"ffmpeg"`: Precise duration obtained from the audio file
- `"estimated"`: Fallback estimation based on text length

### 2. Get Available Voice Types

**GET** `/tts/voice-types`

Returns a list of all available voice types with their descriptions.

#### Response

```json
{
  "success": true,
  "message": "获取音色列表成功",
  "data": {
    "zh_male_shaonianzixin_moon_bigtts": {
      "id": "zh_male_shaonianzixin_moon_bigtts",
      "name": "少年梓辛/Brayan (男声)",
      "language": "zh-CN",
      "gender": "male",
      "description": "少年梓辛，清澈的男性声音，适合年轻化内容",
      "category": "通用场景"
    },
    "zh_female_linjianvhai_moon_bigtts": {
      "id": "zh_female_linjianvhai_moon_bigtts",
      "name": "邻家女孩 (女声)",
      "language": "zh-CN",
      "gender": "female",
      "description": "邻家女孩，亲切自然的女性声音",
      "category": "通用场景"
    },
    "zh_female_daimengchuanmei_moon_bigtts": {
      "id": "zh_female_daimengchuanmei_moon_bigtts",
      "name": "呆萌川妹 (女声)",
      "language": "zh-CN",
      "gender": "female",
      "description": "呆萌川妹，四川方言的可爱女性声音",
      "category": "趣味方言"
    },
    "zh_female_meilinvyou_moon_bigtts": {
      "id": "zh_female_meilinvyou_moon_bigtts",
      "name": "魅力女友 (女声)",
      "language": "zh-CN",
      "gender": "female",
      "description": "魅力女友，充满魅力的女性声音",
      "category": "角色扮演"
    }
  }
}
```

### 3. Health Check

**GET** `/tts/health`

Checks the TTS service configuration and availability.

#### Response (Healthy)

```json
{
  "service": "TTS",
  "status": "healthy",
  "config_valid": true,
  "available_voice_types": 60,
  "message": "TTS服务运行正常"
}
```

#### Response (Unhealthy)

```json
{
  "service": "TTS",
  "status": "unhealthy",
  "config_valid": false,
  "message": "TTS配置不完整：请检查VOLCANO_TTS_APPID和VOLCANO_TTS_ACCESS_TOKEN环境变量"
}
```

## Voice Configuration

The TTS service now reads voice types from a configuration file (`config/batch_tts_config.yaml`) instead of hardcoding them. This allows for easy updates and management of available voices.

### Configuration Structure

```yaml
voice_types:
  volcano:
    name: '语音合成引擎专业版'
    voices:
      - value: 'zh_male_shaonianzixin_moon_bigtts'
        label: '少年梓辛/Brayan (男声)'
        category: '通用场景'
        gender: 'male'
        language: 'zh-CN'
        description: '少年梓辛，清澈的男性声音，适合年轻化内容'
```

## Available Voice Categories

The voice types are organized into the following categories:

### 通用场景 (General Scenarios)
General-purpose voices suitable for various content types including educational, explanatory, and narrative content.

### 趣味方言 (Regional Dialects)
Voices with regional characteristics and dialect features, adding cultural flavor to content.

### 角色扮演 (Role Playing)
Character voices for storytelling, gaming, and entertainment content.

### 播报解说 (Broadcasting & Commentary)
Professional voices optimized for news broadcasting, commentary, and formal presentations.

### 有声阅读 (Audio Reading)
Voices specifically designed for audiobook narration and literary content reading.

## Available Voice Types

| Voice ID | Name | Language | Gender | Category | Description |
|----------|------|----------|---------|----------|-------------|
| zh_male_shaonianzixin_moon_bigtts | 少年梓辛/Brayan (男声) | zh-CN | male | 通用场景 | 少年梓辛，清澈的男性声音，适合年轻化内容 |
| zh_female_linjianvhai_moon_bigtts | 邻家女孩 (女声) | zh-CN | female | 通用场景 | 邻家女孩，亲切自然的女性声音 |
| zh_male_yuanboxiaoshu_moon_bigtts | 渊博小叔 (男声) | zh-CN | male | 通用场景 | 渊博小叔，知识渊博的男性声音 |
| zh_female_daimengchuanmei_moon_bigtts | 呆萌川妹 (女声) | zh-CN | female | 趣味方言 | 呆萌川妹，四川方言的可爱女性声音 |
| zh_male_guozhoudege_moon_bigtts | 广州德哥 (男声) | zh-CN | male | 趣味方言 | 广州德哥，粤语特色的男性声音 |
| zh_female_meilinvyou_moon_bigtts | 魅力女友 (女声) | zh-CN | female | 角色扮演 | 魅力女友，充满魅力的女性声音 |
| zh_male_shenyeboke_moon_bigtts | 深夜播客 (男声) | zh-CN | male | 角色扮演 | 深夜播客，深沉磁性的男性声音 |
| en_female_anna_mars_bigtts | Anna (女声) | en-US | female | 播报解说 | Anna，专业的英语女性播报声音 |
| zh_male_ruyaqingnian_mars_bigtts | 儒雅青年 (男声) | zh-CN | male | 有声阅读 | 儒雅青年，适合阅读的儒雅男性声音 |

*Note: The complete list contains over 60 voice types across all categories. See the configuration file for the full list.*

## Error Codes

| Code | Description |
|------|-------------|
| EMPTY_TEXT | 文本内容为空 |
| TEXT_TOO_LONG | 文本内容过长（超过5000字符） |
| INVALID_VOICE_TYPE | 无效的音色类型 |
| INVALID_SPEED_RATIO | 无效的语速比例（必须在0.5-2.0之间） |
| CONFIG_ERROR | TTS服务配置错误 |
| CONVERSION_FAILED | 语音转换失败 |
| API_ERROR | 外部API调用失败 |

## Usage Examples

### cURL Examples

#### Convert Text to Speech

```bash
curl -X POST "http://localhost:8000/api/tts/convert" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "你好，这是一个测试文本。",
    "voice_type": "zh_female_wanqudashu_moon_bigtts",
    "speed_ratio": 1.0,
    "segment_id": "test_segment",
    "task_id": "test_task"
  }'
```

#### Get Voice Types

```bash
curl -X GET "http://localhost:8000/api/tts/voice-types"
```

#### Health Check

```bash
curl -X GET "http://localhost:8000/api/tts/health"
```

### JavaScript Examples

#### Convert Text to Speech

```javascript
const response = await fetch('/api/tts/convert', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text: '你好，这是一个测试文本。',
    voice_type: 'zh_female_wanqudashu_moon_bigtts',
    speed_ratio: 1.0,
    segment_id: 'test_segment',
    task_id: 'test_task'
  })
});

const result = await response.json();
if (result.success) {
  console.log('Audio URL:', result.data.audio_url);
} else {
  console.error('Conversion failed:', result.message);
}
```

#### Get Voice Types

```javascript
const response = await fetch('/api/tts/voice-types');
const voiceTypes = await response.json();
console.log('Available voices:', voiceTypes.data);
```

## Rate Limiting

Currently, there are no explicit rate limits on the TTS API, but the underlying Volcano TTS service may have its own limits. It's recommended to implement client-side throttling for production use.

## File Management

- Generated audio files are stored in `static/audio/generated/` directory
- Files are named with the pattern: `tts_[segment_id_]YYYYMMDD_HHMMSS_[random].mp3`
- Audio files are served via the `/api/audio/generated/` endpoint
- Consider implementing cleanup policies for old audio files in production

## 下载音频文件

### 端点
```
GET /api/tts/download/{file_name}
```

### 描述
下载指定的音频文件到客户端本地。支持直接下载TTS生成的音频文件。

### 路径参数
- `file_name` (string, required): 音频文件名（包含扩展名）
  - 示例：`tts_segment_001_20241201_120000_12345678.mp3`

### 响应

#### 成功响应 (200)
- **Content-Type**: `audio/mpeg`
- **Headers**:
  - `Content-Disposition`: `attachment; filename={file_name}`
  - `Cache-Control`: `no-cache, no-store, must-revalidate`
- **Body**: 音频文件的二进制流

#### 错误响应

**404 Not Found**
```json
{
  "detail": "音频文件不存在: filename.mp3"
}
```

**500 Internal Server Error**
```json
{
  "detail": "音频文件下载失败: error_message"
}
```

### 使用示例

#### JavaScript/Fetch
```javascript
// 下载音频文件
async function downloadAudioFile(fileName) {
  try {
    const response = await fetch(`/api/tts/download/${fileName}`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const blob = await response.blob();
    
    // 创建下载链接
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    
    console.log('音频文件下载成功:', fileName);
  } catch (error) {
    console.error('音频文件下载失败:', error);
  }
}

// 使用示例
downloadAudioFile('tts_segment_001_20241201_120000_12345678.mp3');
```

#### cURL
```bash
# 下载音频文件
curl -X GET "http://localhost:8000/api/tts/download/tts_segment_001_20241201_120000_12345678.mp3" \
     -H "accept: audio/mpeg" \
     -o "downloaded_audio.mp3"
```

### 注意事项
1. **文件存在性**: 只能下载已存在的音频文件
2. **文件完整性**: 系统会检查文件是否完整（非空）
3. **缓存控制**: 响应包含禁用缓存的头部，确保获取最新文件
4. **安全性**: 仅允许下载指定目录下的音频文件

## Best Practices

1. **Text Length**: Keep text under 1000 characters for optimal performance
2. **Error Handling**: Always check the `success` field in responses
3. **Caching**: Consider caching converted audio for repeated text content
4. **Voice Selection**: Choose appropriate voices based on content type and target audience
5. **Speed Control**: Use speed ratios between 0.8-1.2 for natural-sounding speech
6. **File Download**: Use the download endpoint to cache audio files locally for better performance

## Configuration

Ensure the following environment variables are set in your `.env` file:

```env
VOLCANO_TTS_APPID=your_app_id_here
VOLCANO_TTS_ACCESS_TOKEN=your_access_token_here
VOLCANO_TTS_SECRET_KEY=your_secret_key_here
``` 