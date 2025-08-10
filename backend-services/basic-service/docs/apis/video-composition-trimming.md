# Video Composition with Trimming Support

## 概述

视频合成服务支持时间轴裁剪功能，允许用户在时间轴上对视频素材进行裁剪，然后在合成播放时只播放裁剪后的部分。

## API 端点

### POST /video/compose

合成视频，支持视频、音频和字幕轨道的裁剪。

#### 请求模型

```json
{
  "task_id": "string",
  "video_items": [
    {
      "id": "string",
      "name": "string", 
      "url": "string",
      "start_time": 0.0,
      "duration": 10.0,
      "track_id": "string",
      "volume": 1.0,
      "opacity": 1.0,
      "clip_start": 2.0,
      "clip_end": 8.0
    }
  ],
  "audio_items": [
    {
      "id": "string",
      "name": "string",
      "url": "string", 
      "start_time": 0.0,
      "duration": 10.0,
      "track_id": "string",
      "volume": 1.0,
      "clip_start": 1.0,
      "clip_end": 9.0
    }
  ],
  "subtitle_items": [],
  "total_duration": 20.0,
  "output_resolution": {
    "width": 1920,
    "height": 1080
  },
  "output_fps": 30
}
```

#### 裁剪参数说明

##### VideoCompositionItem 裁剪参数

- `clip_start` (float, 可选): 原始视频文件中的开始时间（秒）
  - 默认值: 0.0
  - 范围: >= 0
  - 说明: 指定从原始视频的哪个时间点开始播放

- `clip_end` (float, 必需): 原始视频文件中的结束时间（秒）  
  - 范围: > clip_start
  - 说明: 指定在原始视频的哪个时间点结束播放

- `duration` (float, 必需): 在时间轴上的持续时间（秒）
  - 范围: > 0
  - 说明: 该视频片段在最终合成中的持续时间
  - 注意: duration 可能与 (clip_end - clip_start) 不同，表示时间拉伸或压缩

##### AudioCompositionItem 裁剪参数

- `clip_start` (float, 可选): 原始音频文件中的开始时间（秒）
- `clip_end` (float, 必需): 原始音频文件中的结束时间（秒）
- 参数含义与视频相同

#### 裁剪逻辑示例

##### 示例 1: 基本裁剪

原始视频: 20秒
用户裁剪: 从第5秒到第15秒 (10秒)
时间轴位置: 从0秒开始，持续10秒

```json
{
  "id": "video_1",
  "url": "https://example.com/video.mp4",
  "start_time": 0.0,
  "duration": 10.0,
  "clip_start": 5.0,
  "clip_end": 15.0
}
```

结果: 播放原始视频的5-15秒部分，在合成视频的0-10秒位置

##### 示例 2: 时间拉伸裁剪

原始视频: 20秒
用户裁剪: 从第2秒到第8秒 (6秒原始内容)
时间轴持续时间: 12秒 (2倍拉伸)

```json
{
  "id": "video_2", 
  "url": "https://example.com/video2.mp4",
  "start_time": 10.0,
  "duration": 12.0,
  "clip_start": 2.0,
  "clip_end": 8.0
}
```

结果: 播放原始视频的2-8秒部分，拉伸到12秒，在合成视频的10-22秒位置

##### 示例 3: 连续多个裁剪片段

```json
{
  "video_items": [
    {
      "id": "segment_1",
      "url": "https://example.com/long_video.mp4",
      "start_time": 0.0,
      "duration": 5.0,
      "clip_start": 10.0,
      "clip_end": 15.0
    },
    {
      "id": "segment_2", 
      "url": "https://example.com/long_video.mp4",
      "start_time": 5.0,
      "duration": 8.0,
      "clip_start": 30.0,
      "clip_end": 38.0
    }
  ]
}
```

结果: 
- 0-5秒: 播放原始视频的10-15秒部分
- 5-13秒: 播放原始视频的30-38秒部分

## 前端集成

### 时间轴数据映射

前端 `TimelineItem` 到后端 `VideoCompositionItem` 的映射:

```typescript
// 前端 TimelineItem
interface TimelineItem {
  clipStart?: number;      // -> clip_start
  clipEnd?: number;        // -> clip_end  
  originalDuration?: number; // 用于验证裁剪范围
  startTime: number;       // -> start_time
  duration: number;        // -> duration
}

// 后端 VideoCompositionItem  
interface VideoCompositionItem {
  clip_start: float;       // 从 clipStart 映射
  clip_end: float;         // 从 clipEnd 映射
  start_time: float;       // 从 startTime 映射
  duration: float;         // 从 duration 映射
}
```

### 播放逻辑

组合播放时的时间计算:

1. **确定当前播放序列**: 根据时间轴当前时间确定应该播放哪个视频片段
2. **计算视频内时间**: 将时间轴时间映射到原始视频文件中的时间
3. **应用裁剪范围**: 确保播放时间在 clip_start 和 clip_end 之间
4. **自动切换**: 当播放时间达到 clip_end 时自动切换到下一个片段

时间映射公式:
```
actual_video_time = clip_start + (timeline_relative_time * clip_duration / timeline_duration)

其中:
- clip_duration = clip_end - clip_start
- timeline_relative_time = 当前时间轴时间 - 片段开始时间
- timeline_duration = 片段在时间轴上的持续时间
```

## 日志记录

系统会详细记录裁剪相关的操作:

### 前端日志

- 时间轴状态变化时的裁剪信息提取
- 视频序列生成时的裁剪参数
- 播放时的时间映射计算
- 自动切换片段的触发

### 后端日志

- 视频合成请求中的裁剪参数验证
- FFmpeg 处理时的裁剪命令
- 合成进度和结果

## 错误处理

### 常见错误情况

1. **裁剪范围超出原始视频长度**
   - 错误: clip_end > 原始视频时长
   - 处理: 自动调整 clip_end 为视频最大时长

2. **裁剪开始时间大于结束时间**
   - 错误: clip_start >= clip_end
   - 处理: 返回验证错误

3. **时间轴持续时间为零或负数**
   - 错误: duration <= 0
   - 处理: 返回验证错误

### 错误响应示例

```json
{
  "success": false,
  "message": "视频合成失败",
  "error": "Invalid clip range: clip_start (15.0) >= clip_end (10.0) for video item 'segment_1'",
  "composition_id": null
}
```

## 性能考虑

1. **裁剪不会重新编码**: 使用 FFmpeg 的流拷贝功能，避免重新编码
2. **并行处理**: 多个视频片段可以并行下载和处理
3. **缓存优化**: 相同源文件的不同裁剪片段可以共享下载缓存

## 测试用例

### 基本裁剪测试
```bash
curl -X POST "http://localhost:8000/video/compose" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "test_trim_001",
    "video_items": [{
      "id": "test_video",
      "name": "测试裁剪视频",
      "url": "https://example.com/test_video.mp4",
      "start_time": 0.0,
      "duration": 5.0,
      "track_id": "video-track-1",
      "clip_start": 2.0,
      "clip_end": 7.0
    }],
    "total_duration": 5.0
  }'
```

### 多片段裁剪测试
```bash
curl -X POST "http://localhost:8000/video/compose" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "test_trim_002", 
    "video_items": [
      {
        "id": "segment_1",
        "name": "片段1",
        "url": "https://example.com/video.mp4",
        "start_time": 0.0,
        "duration": 3.0,
        "track_id": "video-track-1",
        "clip_start": 5.0,
        "clip_end": 8.0
      },
      {
        "id": "segment_2",
        "name": "片段2", 
        "url": "https://example.com/video.mp4",
        "start_time": 3.0,
        "duration": 4.0,
        "track_id": "video-track-1",
        "clip_start": 15.0,
        "clip_end": 19.0
      }
    ],
    "total_duration": 7.0
  }'
``` 