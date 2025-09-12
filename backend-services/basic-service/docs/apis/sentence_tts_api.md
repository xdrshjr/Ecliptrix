# 句子级批量语音转换 API

## 概述

句子级批量语音转换 API 提供了对多个句子进行并发语音转换并自动拼接的功能。与传统的段落级转换不同，该 API 可以同时处理一个段落中的多个句子，提供更精确的时间信息，并返回拼接后的完整音频。

## 核心特性

- **并发处理**: 支持多个句子同时进行语音转换，大幅提升转换效率
- **音频拼接**: 自动将多个句子的音频按顺序拼接成完整音频
- **精确时间信息**: 返回每个句子在拼接音频中的精确开始和结束时间
- **错误处理**: 支持部分句子转换失败的情况，仍能生成可用的拼接音频
- **灵活配置**: 支持自定义并发线程数和语音参数

## API 端点

### POST /api/tts/convert-sentences

句子级批量语音转换接口

#### 请求参数

| 参数名 | 类型 | 必填 | 描述 |
|--------|------|------|------|
| segment_id | string | 是 | 段落标识符，用于分组句子 |
| sentences | array | 是 | 句子列表，每个句子包含 sentence_id、text 和 order |
| voice_type | string | 是 | 语音类型标识符 |
| speed_ratio | float | 否 | 语速比例，默认 1.0，范围 0.1-3.0 |
| task_id | string | 否 | 任务标识符，用于日志追踪 |
| concurrent_threads | int | 否 | 并发线程数，默认 3，范围 1-10 |

#### 句子对象结构

| 参数名 | 类型 | 必填 | 描述 |
|--------|------|------|------|
| sentence_id | string | 是 | 句子唯一标识符 |
| text | string | 是 | 句子文本内容，最大长度 2000 字符 |
| order | int | 是 | 句子在段落中的顺序，从 0 开始 |

#### 请求示例

```json
{
  "segment_id": "segment-1",
  "sentences": [
    {
      "sentence_id": "sentence-1",
      "text": "大家好，欢迎来到今天的视频教程。",
      "order": 0
    },
    {
      "sentence_id": "sentence-2",
      "text": "今天我们要学习如何使用这个强大的视频编辑工具。",
      "order": 1
    },
    {
      "sentence_id": "sentence-3",
      "text": "首先，让我们了解一下基本的操作界面。",
      "order": 2
    }
  ],
  "voice_type": "zh_male_shaonianzixin_moon_bigtts",
  "speed_ratio": 1.0,
  "task_id": "task_123",
  "concurrent_threads": 3
}
```

#### 响应参数

| 参数名 | 类型 | 描述 |
|--------|------|------|
| success | boolean | 整体转换是否成功 |
| message | string | 响应消息 |
| segment_id | string | 段落标识符 |
| total_sentences | int | 总句子数 |
| successful_sentences | int | 成功转换的句子数 |
| failed_sentences | int | 转换失败的句子数 |
| total_processing_time | float | 总处理时间（秒） |
| concatenated_audio_url | string | 拼接后的音频文件 URL |
| total_duration | float | 拼接音频的总时长（秒） |
| concatenated_file_size | int | 拼接音频文件大小（字节） |
| sentence_results | array | 每个句子的详细转换结果 |

#### 句子结果对象结构

| 参数名 | 类型 | 描述 |
|--------|------|------|
| sentence_id | string | 句子标识符 |
| order | int | 句子顺序 |
| success | boolean | 该句子转换是否成功 |
| audio_url | string | 单个句子的音频文件 URL（如果成功） |
| duration | float | 单个句子的音频时长（秒） |
| file_size | int | 单个句子的音频文件大小（字节） |
| start_time | float | 在拼接音频中的开始时间（秒） |
| end_time | float | 在拼接音频中的结束时间（秒） |
| error | string | 错误信息（如果失败） |
| processing_time | float | 该句子的处理时间（秒） |

#### 成功响应示例

```json
{
  "success": true,
  "message": "句子级语音转换完成，成功 3/3 个句子",
  "segment_id": "segment-1",
  "total_sentences": 3,
  "successful_sentences": 3,
  "failed_sentences": 0,
  "total_processing_time": 18.5,
  "concatenated_audio_url": "/api/audio/generated/segment-1_concatenated_1672531200_abc123.mp3",
  "total_duration": 15.8,
  "concatenated_file_size": 253440,
  "sentence_results": [
    {
      "sentence_id": "sentence-1",
      "order": 0,
      "success": true,
      "audio_url": "/api/audio/generated/sentence-1_1672531200_def456.mp3",
      "duration": 4.2,
      "file_size": 67584,
      "start_time": 0.0,
      "end_time": 4.2,
      "processing_time": 5.8
    },
    {
      "sentence_id": "sentence-2",
      "order": 1,
      "success": true,
      "audio_url": "/api/audio/generated/sentence-2_1672531200_ghi789.mp3",
      "duration": 6.8,
      "file_size": 108928,
      "start_time": 4.2,
      "end_time": 11.0,
      "processing_time": 7.2
    },
    {
      "sentence_id": "sentence-3",
      "order": 2,
      "success": true,
      "audio_url": "/api/audio/generated/sentence-3_1672531200_jkl012.mp3",
      "duration": 4.8,
      "file_size": 76928,
      "start_time": 11.0,
      "end_time": 15.8,
      "processing_time": 6.1
    }
  ]
}
```

#### 错误响应示例

```json
{
  "success": false,
  "message": "句子级语音转换失败: 句子数量超过限制：25 > 20",
  "segment_id": "segment-1",
  "total_sentences": 25,
  "successful_sentences": 0,
  "failed_sentences": 25,
  "total_processing_time": 0.1,
  "concatenated_audio_url": null,
  "total_duration": null,
  "concatenated_file_size": null,
  "sentence_results": []
}
```

## 使用限制

### 请求限制

- 最大句子数量：20 个/请求
- 单个句子最大文本长度：2000 字符
- 总文本长度限制：根据系统配置
- 并发线程数范围：1-10

### 性能特性

- **并发处理**: 支持多线程并发转换，显著提升处理速度
- **智能拼接**: 使用 pydub 或 ffmpeg 进行高质量音频拼接
- **精确计时**: 提供毫秒级精度的时间信息
- **错误恢复**: 部分句子失败不影响整体拼接结果

## 使用场景

### 1. 视频脚本配音

为视频脚本的每个段落生成配音，同时获得精确的句子时间信息用于字幕同步。

```javascript
const request = {
  segment_id: "intro-segment",
  sentences: scriptSegment.sentences.map((sentence, index) => ({
    sentence_id: sentence.id,
    text: sentence.text,
    order: index
  })),
  voice_type: "zh_female_tianmeixiaoyuan_moon_bigtts",
  speed_ratio: 1.1,
  task_id: "video_production_001"
};
```

### 2. 播客内容生成

为播客内容生成语音，利用句子级时间信息实现精确的章节标记。

### 3. 教学视频制作

为教学内容生成配音，每个句子的时间信息可用于生成精确的字幕文件。

## 技术实现

### 并发处理架构

```python
# 使用 ThreadPoolExecutor 实现并发处理
with ThreadPoolExecutor(max_workers=concurrent_threads) as executor:
    futures = {
        executor.submit(convert_sentence, sentence): sentence.sentence_id 
        for sentence in request.sentences
    }
    
    for future in as_completed(futures):
        result = future.result()
        results.append(result)
```

### 音频拼接流程

1. **并发转换**: 多个句子同时进行语音转换
2. **结果收集**: 收集所有转换结果并按顺序排序
3. **时间计算**: 计算每个句子在拼接音频中的时间位置
4. **音频拼接**: 使用 pydub 或 ffmpeg 进行音频拼接
5. **元数据生成**: 生成完整的时间信息和文件信息

### 错误处理策略

- **部分失败容忍**: 部分句子失败不影响整体拼接
- **顺序保证**: 即使并发处理，也保证拼接顺序正确
- **资源清理**: 自动清理临时文件和资源
- **详细日志**: 提供完整的处理日志用于调试

## 最佳实践

### 1. 句子分割建议

- 保持句子长度适中（建议 10-50 字符）
- 避免过长的句子影响转换质量
- 确保句子顺序正确设置

### 2. 并发配置优化

- 根据服务器性能调整并发线程数
- 避免设置过高的并发数导致资源竞争
- 监控处理时间和成功率进行调优

### 3. 错误处理

```javascript
try {
  const response = await convertSentencesToSpeech(request);
  
  if (response.success && response.concatenated_audio_url) {
    // 处理成功结果
    console.log(`成功转换 ${response.successful_sentences}/${response.total_sentences} 个句子`);
    
    // 使用时间信息
    response.sentence_results.forEach(result => {
      if (result.success) {
        console.log(`句子 ${result.sentence_id}: ${result.start_time}s - ${result.end_time}s`);
      }
    });
  } else {
    // 处理失败情况
    console.error('转换失败:', response.message);
  }
} catch (error) {
  console.error('请求失败:', error.message);
}
```

## 与其他 API 的关系

### 传统段落级 TTS API

- **段落级 API** (`/api/tts/convert`): 适用于简单的整段转换
- **句子级 API** (`/api/tts/convert-sentences`): 适用于需要精确时间信息的场景

### 批量段落 TTS API

- **批量段落 API** (`/api/tts/convert-batch`): 适用于多个段落的批量处理
- **句子级 API**: 适用于单个段落内的句子级精细控制

## 监控和日志

### 关键指标

- 并发处理效率
- 音频拼接成功率
- 平均处理时间
- 错误率分布

### 日志记录

系统会记录详细的处理日志，包括：

- 请求参数和验证结果
- 每个句子的处理状态
- 音频拼接过程
- 性能指标和错误信息

## 版本信息

- **当前版本**: v1.0.0
- **API 版本**: 2024-01
- **兼容性**: 向后兼容传统 TTS API

## 更新日志

### v1.0.0 (2024-01)

- 首次发布句子级批量语音转换功能
- 支持并发处理和音频拼接
- 提供精确的句子时间信息
- 集成错误恢复和资源管理机制