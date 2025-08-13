# 音频转字幕 API 文档

## 概述

音频转字幕API提供了将音频文件转换为字幕文本的功能，支持多种语言和格式选项。该API基于火山引擎的语音识别服务，能够准确识别音频中的语音内容并生成对应的字幕文件。

## 基础信息

- **基础URL**: `/api/audio`
- **认证方式**: 无需认证（内部服务）
- **支持格式**: MP3, WAV, M4A等常见音频格式
- **最大文件大小**: 100MB
- **支持语言**: 中文(zh-CN), 英文(en-US)等

## API 接口

### 1. 音频文件上传转字幕

**接口地址**: `POST /api/audio/transcribe`

**描述**: 上传音频文件并转换为字幕

**请求方式**: `multipart/form-data`

**请求参数**:

| 参数名 | 类型 | 必填 | 默认值 | 描述 |
|--------|------|------|--------|------|
| file | File | 是 | - | 音频文件（支持MP3、WAV等格式） |
| language | string | 否 | zh-CN | 语言代码 |
| use_itn | boolean | 否 | true | 是否使用逆文本规范化 |
| use_punc | boolean | 否 | false | 是否使用标点符号 |
| max_lines | integer | 否 | 2 | 最大行数 |
| words_per_line | integer | 否 | 15 | 每行最大字数 |
| generate_srt_file | boolean | 否 | true | 是否生成SRT字幕文件 |

**请求示例**:

```bash
curl -X POST "http://localhost:8000/api/audio/transcribe" \
  -F "file=@audio.mp3" \
  -F "language=zh-CN" \
  -F "use_itn=true" \
  -F "use_punc=false" \
  -F "max_lines=2" \
  -F "words_per_line=15" \
  -F "generate_srt_file=true"
```

**成功响应**:

```json
{
  "success": true,
  "message": "音频转字幕成功",
  "job_id": "job_12345678",
  "subtitles": [
    {
      "start_time": 0,
      "end_time": 2000,
      "text": "这是第一句话"
    },
    {
      "start_time": 2500,
      "end_time": 5000,
      "text": "这是第二句话"
    }
  ],
  "srt_content": "1\n00:00:00,000 --> 00:00:02,000\n这是第一句话\n\n2\n00:00:02,500 --> 00:00:05,000\n这是第二句话\n\n",
  "srt_file_path": "static/audio/subtitles/audio_1703123456.srt",
  "srt_file_url": "/static/audio/subtitles/audio_1703123456.srt",
  "processing_time": 15.5,
  "audio_duration": 30.2,
  "created_at": "2023-12-01T12:00:00"
}
```

**错误响应**:

```json
{
  "success": false,
  "error": "不支持的文件类型，请上传音频文件",
  "error_code": "INVALID_FILE_TYPE",
  "details": null,
  "created_at": "2023-12-01T12:00:00"
}
```

### 2. 本地音频文件转字幕

**接口地址**: `POST /api/audio/transcribe-local`

**描述**: 处理服务器本地的音频文件转换为字幕（主要用于测试）

**请求方式**: `application/json` + `form-data`

**请求参数**:

JSON部分：
```json
{
  "language": "zh-CN",
  "use_itn": true,
  "use_punc": false,
  "max_lines": 2,
  "words_per_line": 15,
  "generate_srt_file": true
}
```

Form部分：
| 参数名 | 类型 | 必填 | 描述 |
|--------|------|------|------|
| file_path | string | 是 | 服务器本地音频文件路径 |

**请求示例**:

```bash
curl -X POST "http://localhost:8000/api/audio/transcribe-local" \
  -H "Content-Type: application/json" \
  -d '{
    "language": "zh-CN",
    "use_itn": true,
    "use_punc": false,
    "max_lines": 2,
    "words_per_line": 15,
    "generate_srt_file": true
  }' \
  -F "file_path=datas/audio/audio-01.mp3"
```

**响应格式**: 与上传接口相同

### 3. 健康检查

**接口地址**: `GET /api/audio/health`

**描述**: 检查音频转字幕服务的健康状态

**请求示例**:

```bash
curl -X GET "http://localhost:8000/api/audio/health"
```

**响应示例**:

```json
{
  "service": "audio_transcription",
  "status": "healthy",
  "timestamp": "2023-12-01T12:00:00",
  "config": {
    "appid_configured": true,
    "access_token_configured": true,
    "secret_key_configured": true,
    "base_url": "https://openspeech.bytedance.com/api/v1/vc"
  }
}
```

## 数据模型

### SubtitleItem

字幕项目模型：

```json
{
  "start_time": 0,      // 开始时间（毫秒）
  "end_time": 2000,     // 结束时间（毫秒）
  "text": "字幕文本内容"  // 字幕文本
}
```

### AudioTranscriptionResponse

成功响应模型：

```json
{
  "success": true,
  "message": "音频转字幕成功",
  "job_id": "任务ID",
  "subtitles": [SubtitleItem],
  "srt_content": "SRT格式字幕内容",
  "srt_file_path": "SRT文件路径",
  "srt_file_url": "SRT文件访问URL",
  "processing_time": 15.5,
  "audio_duration": 30.2,
  "created_at": "2023-12-01T12:00:00"
}
```

### AudioTranscriptionErrorResponse

错误响应模型：

```json
{
  "success": false,
  "error": "错误信息",
  "error_code": "错误代码",
  "details": {},
  "created_at": "2023-12-01T12:00:00"
}
```

## 错误代码

| 错误代码 | 描述 | 解决方案 |
|----------|------|----------|
| INVALID_FILE_TYPE | 不支持的文件类型 | 请上传音频文件（MP3、WAV等） |
| FILE_TOO_LARGE | 文件过大 | 请上传小于100MB的音频文件 |
| FILE_NOT_FOUND | 文件不存在 | 检查文件路径是否正确 |
| TRANSCRIPTION_FAILED | 转字幕失败 | 检查音频文件质量和网络连接 |
| INTERNAL_ERROR | 内部错误 | 联系技术支持 |

## 使用示例

### Python 示例

```python
import requests

# 上传音频文件转字幕
def transcribe_audio_file(file_path):
    url = "http://localhost:8000/api/audio/transcribe"
    
    with open(file_path, 'rb') as f:
        files = {'file': f}
        data = {
            'language': 'zh-CN',
            'use_itn': True,
            'use_punc': False,
            'max_lines': 2,
            'words_per_line': 15,
            'generate_srt_file': True
        }
        
        response = requests.post(url, files=files, data=data)
        return response.json()

# 使用示例
result = transcribe_audio_file('audio.mp3')
if result['success']:
    print(f"转换成功，共{len(result['subtitles'])}条字幕")
    print(f"SRT文件URL: {result['srt_file_url']}")
else:
    print(f"转换失败: {result['error']}")
```

### JavaScript 示例

```javascript
async function transcribeAudio(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('language', 'zh-CN');
    formData.append('use_itn', 'true');
    formData.append('use_punc', 'false');
    formData.append('max_lines', '2');
    formData.append('words_per_line', '15');
    formData.append('generate_srt_file', 'true');
    
    try {
        const response = await fetch('/api/audio/transcribe', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log(`转换成功，共${result.subtitles.length}条字幕`);
            console.log(`SRT文件URL: ${result.srt_file_url}`);
            return result;
        } else {
            console.error(`转换失败: ${result.error}`);
            return null;
        }
    } catch (error) {
        console.error('请求失败:', error);
        return null;
    }
}
```

## 配置说明

### 环境变量

在 `.env` 文件中配置火山引擎API信息：

```env
# 火山引擎语音识别配置
VOLCANO_TTS_APPID=your_app_id
VOLCANO_TTS_ACCESS_TOKEN=your_access_token
VOLCANO_TTS_SECRET_KEY=your_secret_key
```

### 参数说明

- **language**: 支持的语言代码
  - `zh-CN`: 中文（简体）
  - `en-US`: 英文（美国）
  - 其他语言请参考火山引擎文档

- **use_itn**: 逆文本规范化
  - `true`: 将数字、时间等转换为标准格式
  - `false`: 保持原始识别结果

- **use_punc**: 标点符号
  - `true`: 添加标点符号
  - `false`: 不添加标点符号

- **max_lines**: 每个字幕段的最大行数
- **words_per_line**: 每行的最大字数

## 性能指标

- **处理速度**: 通常为音频时长的1/3到1/2
- **准确率**: 中文普通话识别准确率 > 95%
- **支持时长**: 单个音频文件最长支持2小时
- **并发处理**: 支持多个音频文件同时处理

## 注意事项

1. **音频质量**: 音频质量越高，识别准确率越高
2. **网络连接**: 需要稳定的网络连接到火山引擎API
3. **文件格式**: 推荐使用WAV或MP3格式
4. **语音清晰度**: 背景噪音较少的音频识别效果更好
5. **API配额**: 注意火山引擎API的使用配额限制

## 故障排除

### 常见问题

1. **服务初始化失败**
   - 检查环境变量配置是否正确
   - 确认火山引擎API密钥有效

2. **音频上传失败**
   - 检查文件大小是否超过100MB
   - 确认文件格式是否支持

3. **转换超时**
   - 检查网络连接
   - 尝试较短的音频文件

4. **识别准确率低**
   - 提高音频质量
   - 减少背景噪音
   - 使用清晰的语音

### 日志查看

查看服务日志以获取详细错误信息：

```bash
tail -f logs/app.log
```

## 更新日志

### v1.0.0 (2023-12-01)
- 初始版本发布
- 支持音频文件上传转字幕
- 支持本地文件转字幕
- 支持SRT格式字幕文件生成
- 支持健康检查接口 