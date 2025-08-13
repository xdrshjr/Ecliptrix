# 音频转字幕功能使用指南

## 功能概述

本项目新增了音频转字幕功能，基于火山引擎的语音识别API，能够将音频文件转换为字幕文本和SRT字幕文件。

## 功能特性

- ✅ 支持多种音频格式（MP3、WAV、M4A等）
- ✅ 支持中文和英文语音识别
- ✅ 自动生成SRT格式字幕文件
- ✅ 支持文件上传和本地文件处理
- ✅ 详细的日志记录和错误处理
- ✅ 完整的API文档和测试用例

## 快速开始

### 1. 环境配置

确保在 `.env` 文件中配置了火山引擎API信息：

```env
# 火山引擎语音识别配置
VOLCANO_TTS_APPID=4269953601
VOLCANO_TTS_ACCESS_TOKEN=***REMOVED***
VOLCANO_TTS_SECRET_KEY=***REMOVED***
```

### 2. 启动服务

```bash
cd backend-services/basic-service
python run.py
```

服务启动后，可以访问：
- API文档：http://localhost:8000/docs
- 健康检查：http://localhost:8000/api/audio/health

### 3. 运行测试

#### 简单测试（推荐）

```bash
# 在 backend-services/basic-service 目录下运行
python test_audio_transcription_simple.py
```

#### 完整测试

```bash
# 在 backend-services/basic-service/tests 目录下运行
python test_audio_transcription.py
```

## API 使用示例

### 1. 健康检查

```bash
curl -X GET "http://localhost:8000/api/audio/health"
```

### 2. 本地文件转字幕（测试用）

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

### 3. 文件上传转字幕

```bash
curl -X POST "http://localhost:8000/api/audio/transcribe" \
  -F "file=@your_audio.mp3" \
  -F "language=zh-CN" \
  -F "use_itn=true" \
  -F "use_punc=false" \
  -F "max_lines=2" \
  -F "words_per_line=15" \
  -F "generate_srt_file=true"
```

## Python 客户端示例

```python
import requests

def transcribe_audio(file_path):
    """音频转字幕示例"""
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
        result = response.json()
        
        if result['success']:
            print(f"转换成功！")
            print(f"字幕数量: {len(result['subtitles'])}")
            print(f"SRT文件: {result['srt_file_url']}")
            
            # 显示字幕内容
            for i, subtitle in enumerate(result['subtitles'][:3], 1):
                start = subtitle['start_time'] / 1000
                end = subtitle['end_time'] / 1000
                text = subtitle['text']
                print(f"{i}. [{start:.1f}s-{end:.1f}s] {text}")
        else:
            print(f"转换失败: {result['error']}")

# 使用示例
transcribe_audio('your_audio.mp3')
```

## 文件结构

```
backend-services/basic-service/
├── app/
│   ├── models/
│   │   └── audio_models.py          # 音频转字幕数据模型
│   ├── services/
│   │   └── audio_transcription_service.py  # 音频转字幕服务
│   ├── routers/
│   │   └── audio_router.py          # 音频转字幕路由
│   └── main.py                      # 主应用（已更新）
├── tests/
│   └── test_audio_transcription.py  # 测试文件
├── docs/apis/
│   └── audio_transcription_api.md   # API文档
├── datas/audio/
│   └── audio-01.mp3                 # 测试音频文件
├── static/audio/subtitles/          # 生成的字幕文件目录
└── test_audio_transcription_simple.py  # 简单测试脚本
```

## 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| language | string | zh-CN | 语言代码（zh-CN中文，en-US英文） |
| use_itn | boolean | true | 是否使用逆文本规范化（数字、时间标准化） |
| use_punc | boolean | false | 是否添加标点符号 |
| max_lines | integer | 2 | 每个字幕段最大行数 |
| words_per_line | integer | 15 | 每行最大字数 |
| generate_srt_file | boolean | true | 是否生成SRT字幕文件 |

## 响应格式

### 成功响应

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
    }
  ],
  "srt_content": "1\n00:00:00,000 --> 00:00:02,000\n这是第一句话\n\n",
  "srt_file_path": "static/audio/subtitles/audio_1703123456.srt",
  "srt_file_url": "/static/audio/subtitles/audio_1703123456.srt",
  "processing_time": 15.5,
  "audio_duration": 30.2,
  "created_at": "2023-12-01T12:00:00"
}
```

### 错误响应

```json
{
  "success": false,
  "error": "不支持的文件类型，请上传音频文件",
  "error_code": "INVALID_FILE_TYPE",
  "details": null,
  "created_at": "2023-12-01T12:00:00"
}
```

## 常见错误及解决方案

### 1. 服务初始化失败

**错误**: `火山引擎API配置不完整`

**解决方案**: 检查 `.env` 文件中的火山引擎API配置是否正确

### 2. 模块导入错误

**错误**: `ModuleNotFoundError: No module named 'app'`

**解决方案**: 
- 使用 `test_audio_transcription_simple.py` 进行测试
- 或者在项目根目录下运行测试

### 3. 音频文件不存在

**错误**: `文件不存在: datas/audio/audio-01.mp3`

**解决方案**: 确保测试音频文件存在，或使用自己的音频文件

### 4. 网络连接问题

**错误**: `请求超时` 或 `连接失败`

**解决方案**: 
- 检查网络连接
- 确认火山引擎API可访问
- 尝试较小的音频文件

## 性能优化建议

1. **音频质量**: 使用清晰、噪音较少的音频文件
2. **文件大小**: 建议单个文件不超过100MB
3. **并发处理**: 服务支持多个请求并发处理
4. **缓存机制**: 相同音频文件会复用处理结果

## 日志查看

查看详细日志信息：

```bash
tail -f logs/app.log
```

## 技术架构

- **框架**: FastAPI
- **语音识别**: 火山引擎 API
- **数据验证**: Pydantic
- **日志记录**: Python logging
- **文件处理**: 临时文件自动清理
- **错误处理**: 分层错误处理机制

## 更新记录

### v1.0.0 (2023-12-01)
- ✅ 实现音频转字幕基础功能
- ✅ 支持文件上传和本地文件处理
- ✅ 生成SRT格式字幕文件
- ✅ 完整的错误处理和日志记录
- ✅ 详细的API文档和测试用例
- ✅ 健康检查和服务监控

## 联系支持

如有问题，请查看：
1. API文档：`docs/apis/audio_transcription_api.md`
2. 测试用例：`tests/test_audio_transcription.py`
3. 日志文件：`logs/app.log` 