# Video Composition Duration Fix

## 概述

本文档描述了视频合成服务中关于时长计算的修复，解决了最终合成视频时长不正确和出现额外空白片段的问题。

## 问题描述

### 原问题
1. 点击"导出视频"按钮时，前端传入了 `clip_start` 和 `clip_end` 参数
2. 后端正确剪切了每个视频片段
3. 但最终合成的视频总时长不正确，应该是剪切后视频片段的总时长，而不是原始时长
4. 最终合成的视频除了剪切后的内容外，还额外包含了一些空白时间（无视频无音频）

### 根本原因
1. **前端时长计算错误**：前端使用 `timelineState.totalDuration` 计算总时长，这是基于原始时间轴时长，而不是剪切后的实际时长
2. **后端音频处理错误**：后端使用前端提供的错误 `total_duration` 进行音频处理，导致音频时长超出实际视频时长或产生空白片段

## 修复方案

### 1. 前端修复 (useVideoExport.ts)

#### 修复前
```typescript
// 使用原始时间轴总时长（错误）
total_duration: timelineState.totalDuration,

// 剪切参数传递但未用于时长计算
clip_start: item.clipStart || 0,
clip_end: item.clipEnd || (item.originalDuration || item.duration)
```

#### 修复后
```typescript
// 计算实际剪切后的总时长
let actualTotalDuration = 0;
timelineState.tracks.forEach(track => {
  track.items.forEach(item => {
    if (item.type === 'video') {
      const clipStart = item.clipStart || 0;
      const clipEnd = item.clipEnd || (item.originalDuration || item.duration);
      const clippedDuration = clipEnd - clipStart;
      actualTotalDuration += clippedDuration;
    }
  });
});

// 使用实际剪切后的总时长
total_duration: actualTotalDuration,
```

### 2. 后端修复 (video_composition_service.py)

#### 修复前
```python
# 直接使用前端提供的错误时长
def _process_audio_tracks(self, request: VideoCompositionRequest, temp_dir: str, ffmpeg_path: str):
    # 使用 request.total_duration（错误）
    '-t', str(request.total_duration)
```

#### 修复后
```python
# 后端重新计算实际时长并用于音频处理
def _compose_video_sync(self, composition_id: str, request: VideoCompositionRequest):
    # 计算实际剪切后的总时长
    actual_total_duration = 0
    for video_item in request.video_items:
        clip_start = video_item.clip_start if hasattr(video_item, 'clip_start') else 0.0
        clip_end = video_item.clip_end if hasattr(video_item, 'clip_end') else video_item.duration
        clipped_duration = clip_end - clip_start
        actual_total_duration += clipped_duration
    
    # 使用实际时长进行音频处理
    processed_audio_path = self._process_audio_tracks(request, temp_dir, ffmpeg_path, actual_total_duration)

def _process_audio_tracks(self, request: VideoCompositionRequest, temp_dir: str, ffmpeg_path: str, actual_total_duration: float):
    # 使用 actual_total_duration（正确）
    '-t', str(actual_total_duration)
```

## API 接口变更

### POST /api/video-compose

#### 请求参数
```json
{
  "task_id": "string",
  "video_items": [
    {
      "id": "string",
      "name": "string",
      "url": "string",
      "start_time": 0.0,
      "duration": 10.0,          // 时间轴上的持续时间（用于定位）
      "track_id": "string",
      "volume": 1.0,
      "opacity": 1.0,
      "clip_start": 2.0,         // 原始视频中的开始时间
      "clip_end": 8.0,           // 原始视频中的结束时间
      "clipped_duration": 6.0    // 新增：剪切后的实际时长 (clip_end - clip_start)
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
      "clip_start": 1.0,         // 音频剪切开始时间
      "clip_end": 9.0            // 音频剪切结束时间
    }
  ],
  "subtitle_items": [],
  "total_duration": 20.0,        // 现在是所有剪切后视频片段的总时长
  "output_resolution": {
    "width": 1920,
    "height": 1080
  },
  "output_fps": 30
}
```

#### 时长计算逻辑

1. **前端计算**：
   ```
   actualTotalDuration = sum(clip_end - clip_start for each video_item)
   ```

2. **后端验证和重新计算**：
   ```
   actual_total_duration = sum(clip_end - clip_start for each video_item)
   ```

3. **音频处理时长**：使用 `actual_total_duration` 而不是 `request.total_duration`

## 日志改进

### 前端日志
```typescript
console.log(`[useVideoExport] 实际总时长计算完成`, {
  originalTotalDuration: timelineState.totalDuration,
  actualTotalDuration: actualTotalDuration,
  durationDifference: actualTotalDuration - timelineState.totalDuration,
  videoItemsCount: videoItems.length,
  taskId
});
```

### 后端日志
```python
logger.info(f"Duration calculation summary: "
           f"frontend_total={request.total_duration}s, "
           f"actual_clipped_total={actual_total_duration}s, "
           f"difference={actual_total_duration - request.total_duration}s")

logger.info(f"裁剪统计: {trimmed_video_count}/{len(request.video_items)} 视频片段被裁剪, "
           f"{trimmed_audio_count}/{len(request.audio_items)} 音频片段被裁剪, "
           f"将使用实际裁剪总时长: {actual_total_duration}s")
```

## 测试验证

### 验证要点
1. **时长一致性**：最终视频时长 = 所有剪切后视频片段时长之和
2. **无空白片段**：最终视频不应包含额外的空白时间
3. **音频同步**：音频时长应与视频时长完全匹配
4. **剪切准确性**：每个视频片段应准确按照 `clip_start` 和 `clip_end` 剪切

### 测试场景
1. 单个视频片段，有剪切
2. 多个视频片段，部分有剪切
3. 包含音频轨道的视频合成
4. 不同宽高比的视频合成

## 影响范围

### 修改文件
1. `src/components/video/hooks/useVideoExport.ts` - 前端时长计算修复
2. `backend-services/basic-service/app/services/video_composition_service.py` - 后端时长处理修复

### 兼容性
- 向后兼容：旧的请求格式仍然支持，但会被重新计算
- API 接口：无破坏性变更，仅优化内部逻辑

## 注意事项

1. **性能影响**：后端会重新计算时长，但计算量很小，性能影响可忽略
2. **精度问题**：时长计算使用浮点数，可能存在微小误差（通常 < 0.1秒）
3. **错误处理**：如果剪切参数无效（clip_start >= clip_end），会使用原始时长
4. **音频处理**：音频剪切逻辑已同步更新，支持精确的音频片段剪切 