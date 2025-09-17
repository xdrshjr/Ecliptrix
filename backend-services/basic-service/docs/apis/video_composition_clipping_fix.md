# Video Composition Clipping Fix

## 问题描述

在视频编辑任务中，使用"剪切素材"功能切片后的素材在添加到时间轴并导出视频时会出现500错误。

## 根本原因

1. **后端属性访问问题**: 使用 `hasattr()` 检查 Pydantic 模型的属性存在性不够安全
2. **切片素材数据结构不一致**: 前端切片素材的数据结构与后端期望的格式不匹配
3. **错误处理不足**: 缺乏对无效裁剪参数的验证和处理
4. **时间轴处理逻辑问题**: 切片素材被当作完整素材处理，导致裁剪参数错误

## 修复内容

### 1. 后端服务修复

#### 1.1 安全属性访问
将所有 `hasattr()` 调用替换为 `getattr()` 方式：

```python
# 修复前
clip_start = video_item.clip_start if hasattr(video_item, 'clip_start') else 0.0

# 修复后  
clip_start = getattr(video_item, 'clip_start', None) or 0.0
```

#### 1.2 参数验证增强
添加裁剪参数的有效性验证：

```python
# 验证裁剪参数的有效性
if clip_start < 0:
    logger.warning(f"Video {i+1}: Invalid clip_start {clip_start}, setting to 0.0")
    clip_start = 0.0
    
if clip_end <= clip_start:
    logger.warning(f"Video {i+1}: Invalid clip_end {clip_end} <= clip_start {clip_start}, using full duration")
    clip_end = video_item.duration

if clipped_duration <= 0:
    logger.error(f"Video {i+1}: Invalid clipped duration {clipped_duration}s")
    raise ValueError(f"Video item {video_item.id} has invalid clipping parameters")
```

#### 1.3 错误处理改进
增强状态检查路由的错误处理：

```python
# 使用安全的字典访问
safe_info = {
    "composition_id": composition_info.get("id", composition_id),
    "task_id": composition_info.get("task_id", "unknown"),
    "status": composition_info.get("status", "unknown"),
    "progress": composition_info.get("progress", 0.0),
    "start_time": composition_info.get("start_time", 0)
}
```

### 2. 前端修复

#### 2.1 切片素材元数据增强
为切片素材添加原始素材时长信息：

```typescript
metadata: {
  ...originalMaterial.metadata,
  isClip: true,
  originalMaterialId: originalMaterial.id,
  originalMaterialDuration: originalMaterial.duration, // 新增
  clipStartTime: clip.startTime,
  clipEndTime: clip.endTime,
  clipDuration: clip.duration,
  clipIndex: index + 1,
  totalClips: clips.length
}
```

#### 2.2 时间轴处理逻辑修复
区分切片素材和原始素材的处理：

```typescript
// 初始化剪辑属性：根据素材类型处理
clipStart: material.metadata?.isClip ? 0 : 0,
clipEnd: material.metadata?.isClip ? duration : duration,
originalDuration: material.metadata?.isClip 
  ? (material.metadata.originalMaterialDuration || duration) 
  : duration,
```

## 修复的文件列表

### 后端文件
- `backend-services/basic-service/app/services/video_composition_service.py`
- `backend-services/basic-service/app/routers/video_router.py`

### 前端文件  
- `src/components/video/VideoEditingInterface.tsx`
- `src/components/video/timeline/TimelinePanel.tsx`

## 测试验证

修复后应验证以下场景：
1. 切片素材正常添加到时间轴
2. 切片素材导出视频成功
3. 原始素材导出视频仍然正常
4. 混合切片和原始素材的导出
5. 错误情况下的日志记录清晰

## 预防措施

1. **统一属性访问**: 在所有 Pydantic 模型处理中使用 `getattr()` 而非 `hasattr()`
2. **参数验证**: 对所有用户输入的时间参数进行验证
3. **错误处理**: 在关键处理点添加详细的错误处理和日志
4. **数据一致性**: 确保前后端数据结构的一致性

## 相关API端点

- `POST /api/video/compose` - 视频合成
- `GET /api/video/compose/{composition_id}/status` - 合成状态查询
- `GET /api/video/compose/{composition_id}/download` - 合成结果下载 