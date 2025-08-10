# Supabase音频上传API文档

## 概述

Supabase音频上传API提供了将音频文件上传到Supabase存储桶的功能。该API集成到TTS（文本转语音）服务中，在音频文件生成后自动上传到云存储，并返回可直接访问的公共URL。

**重要更新**：修复了音频URL访问失败的问题，现在返回的Supabase公共URL可以正常访问和下载。

## 功能特性

- **自动上传**: TTS服务在生成音频文件后自动上传到Supabase
- **文件管理**: 支持音频文件的上传、删除和访问URL获取
- **路径规范**: 按照环境、日期、任务ID等维度组织文件路径
- **错误处理**: 完善的错误处理和日志记录
- **健康检查**: 提供服务状态检查接口
- **URL访问修复**: 修复了get_public_url()的使用方式，确保返回的URL可正常访问

## API端点

### 1. 上传音频文件到Supabase

**POST** `/api/supabase/upload-audio`

将本地音频文件上传到Supabase存储桶。

#### 请求参数

```json
{
  "audio_file_path": "string",      // 必需：本地音频文件路径
  "segment_id": "string",           // 可选：段落ID
  "task_id": "string",              // 可选：任务ID
  "voice_type": "string",           // 可选：音色类型
  "custom_filename": "string"       // 可选：自定义文件名
}
```

#### 请求示例

```json
{
  "audio_file_path": "/path/to/audio/tts_20241201_120000_abc123.mp3",
  "segment_id": "segment_001",
  "task_id": "task_video_editing_001",
  "voice_type": "zh_female_wanqudashu_moon_bigtts",
  "custom_filename": "segment_001_audio.mp3"
}
```

#### 成功响应

```json
{
  "success": true,
  "message": "音频文件上传成功",
  "audio_url": "https://hlqvzgwmbejiviaekdns.supabase.co/storage/v1/object/public/articraft-dev/development/audio/generated/2024/12/01/task_video_editing_001/segment_001_segment_001_audio.mp3",
  "file_path": "development/audio/generated/2024/12/01/task_video_editing_001/segment_001_segment_001_audio.mp3",
  "file_size": 245760,
  "duration": 15.5,
  "segment_id": "segment_001",
  "task_id": "task_video_editing_001",
  "upload_time": "2024-12-01T12:00:00.123456"
}
```

#### 错误响应

```json
{
  "success": false,
  "message": "音频文件不存在: /path/to/audio/file.mp3",
  "error_code": "UPLOAD_FAILED"
}
```

### 2. 上传任意文件到Supabase

**POST** `/api/supabase/upload-file`

上传任意文件到Supabase存储桶（支持表单上传）。

#### 请求参数（Form Data）

- `file`: 要上传的文件（必需）
- `bucket_path`: 存储桶中的目标路径（可选）
- `task_id`: 任务ID（可选）
- `segment_id`: 段落ID（可选）

#### 成功响应

```json
{
  "success": true,
  "message": "文件上传成功",
  "file_url": "https://hlqvzgwmbejiviaekdns.supabase.co/storage/v1/object/public/articraft-dev/development/audio/2024/12/01/uploaded_file.mp3",
  "file_path": "development/audio/2024/12/01/uploaded_file.mp3",
  "file_size": 102400,
  "upload_time": "2024-12-01T12:00:00.123456",
  "metadata": {
    "original_filename": "original_file.mp3",
    "content_type": "audio/mpeg",
    "task_id": "task_001",
    "segment_id": "segment_001"
  }
}
```

### 3. Supabase服务健康检查

**GET** `/api/supabase/health`

检查Supabase服务的连接状态和可用性。

#### 成功响应

```json
{
  "service": "Supabase",
  "status": "healthy",
  "bucket": "articraft-dev",
  "environment": "development",
  "message": "Supabase服务运行正常"
}
```

#### 错误响应

```json
{
  "service": "Supabase",
  "status": "unhealthy",
  "message": "连接测试失败: Connection timeout"
}
```

## TTS服务集成

### 自动上传机制

TTS服务在生成音频文件后会自动尝试上传到Supabase：

1. **音频生成**: TTS服务生成音频文件到本地
2. **自动上传**: 调用Supabase服务上传音频文件
3. **URL返回**: 优先返回Supabase URL，如果上传失败则返回本地URL
4. **日志记录**: 详细记录上传过程和结果

### TTS响应格式变化

集成Supabase后，TTS接口的响应中增加了以下字段：

```json
{
  "audio_url": "https://supabase-url/path/to/audio.mp3",  // 优先使用Supabase URL
  "supabase_upload": true,                               // 是否成功上传到Supabase
  "supabase_url": "https://supabase-url/path/to/audio.mp3",  // Supabase URL
  // ... 其他原有字段
}
```

## 文件路径规范

### 音频文件路径结构

```
{environment}/{folder}/{date}/{task_id}/{segment_id}_{filename}
```

示例：
```
development/audio/generated/2024/12/01/task_video_editing_001/segment_001_tts_20241201_120000_abc123.mp3
```

### 路径组成说明

- `environment`: 环境标识（development/production）
- `folder`: 文件类型文件夹（audio/generated）
- `date`: 上传日期（YYYY/MM/DD）
- `task_id`: 任务ID（可选）
- `segment_id`: 段落ID（可选，会添加到文件名前缀）
- `filename`: 原始文件名

## 配置要求

### 环境变量

需要在`.env`文件中配置以下变量：

```env
# Supabase配置
SUPABASE_URL=https://hlqvzgwmbejiviaekdns.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_BUCKET=articraft-dev
ENVIRONMENT=development
```

### 依赖包

```
supabase==2.3.4
mutagen==1.47.0
```

## 错误处理

### 常见错误类型

1. **UPLOAD_FAILED**: 上传失败
2. **INTERNAL_ERROR**: 内部错误
3. **FILE_NOT_FOUND**: 文件不存在
4. **CONFIG_ERROR**: 配置错误

### 错误响应格式

```json
{
  "success": false,
  "message": "具体错误信息",
  "error_code": "ERROR_CODE",
  "details": {
    "additional": "error details"
  }
}
```

## 日志记录

### 日志级别和内容

- **INFO**: 正常操作记录（上传开始、成功等）
- **WARNING**: 警告信息（上传失败但有备选方案）
- **ERROR**: 错误信息（严重错误）

### 关键日志示例

```
[INFO] 开始上传音频文件到Supabase: {"audio_file": "/path/to/file.mp3", "segment_id": "segment_001"}
[INFO] 音频文件上传到Supabase成功: {"supabase_url": "https://...", "file_size": 245760}
[WARNING] 音频文件上传到Supabase失败，使用本地URL: {"error": "Connection timeout"}
```

## 安全考虑

1. **访问控制**: 使用Supabase的匿名密钥，确保适当的访问权限
2. **文件验证**: 上传前验证文件存在性和大小
3. **错误处理**: 避免在错误响应中泄露敏感信息
4. **临时文件清理**: 及时清理临时文件

## 性能优化

1. **异步上传**: 不阻塞TTS主流程
2. **重试机制**: 上传失败时的重试逻辑
3. **连接池**: 复用HTTP连接
4. **文件压缩**: 可选的文件压缩

## 使用示例

### Python客户端示例

```python
import requests

# 上传音频文件
response = requests.post(
    "http://localhost:8000/api/supabase/upload-audio",
    json={
        "audio_file_path": "/path/to/audio.mp3",
        "segment_id": "segment_001",
        "task_id": "task_001",
        "voice_type": "zh_female_wanqudashu_moon_bigtts"
    }
)

if response.status_code == 200:
    result = response.json()
    print(f"上传成功: {result['audio_url']}")
else:
    print(f"上传失败: {response.text}")
```

### JavaScript客户端示例

```javascript
// 上传音频文件
const response = await fetch('/api/supabase/upload-audio', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    audio_file_path: '/path/to/audio.mp3',
    segment_id: 'segment_001',
    task_id: 'task_001',
    voice_type: 'zh_female_wanqudashu_moon_bigtts'
  })
});

const result = await response.json();
if (result.success) {
  console.log('上传成功:', result.audio_url);
} else {
  console.error('上传失败:', result.message);
}
```

## 版本历史

### v1.0.0 (2024-12-01)
- 初始版本
- 支持音频文件上传到Supabase
- 集成到TTS服务中
- 提供健康检查接口
- 完整的错误处理和日志记录 