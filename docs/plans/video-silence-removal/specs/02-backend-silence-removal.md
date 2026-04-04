# Spec 02: 后端视频处理服务 + API

## 1. 概述

实现后端视频静音段移除功能：接收用户确认的静音段列表和处理参数，异步执行 FFmpeg 裁切拼接，生成新视频文件，提供进度查询接口。处理完成后替换原视频素材。

## 2. 数据模型

### SilenceRemoveRequest

```
{
  video_url: string              # 原始视频文件 URL
  segments_to_remove: [          # 用户确认要移除的静音段列表
    {
      id: string                 # 段落 ID（与 detect 返回的 ID 对应）
      start: float               # 起始时间（秒）- 可能被用户拖拽调整过
      end: float                 # 结束时间（秒）- 可能被用户拖拽调整过
    }
  ]
  preserved_gap: float           # 保留的间隔时长（秒），默认 0.2
  fade_duration: float           # 音频淡入淡出时长（秒），默认 0.05（50ms，避免爆音）
}
```

### SilenceRemoveAccepted

继承 `BaseResponse`（来自 `app/models/base_models.py`），`success`、`message`、`timestamp` 由基类提供：

```
{
  success: bool                  # 继承自 BaseResponse
  message: string                # 继承自 BaseResponse
  timestamp: datetime            # 继承自 BaseResponse
  data: {
    task_id: string              # 异步任务 ID
  }
}
```

### SilenceProgressResponse

继承 `BaseResponse`（来自 `app/models/base_models.py`）：

```
{
  success: bool                  # 继承自 BaseResponse
  message: string                # 继承自 BaseResponse
  timestamp: datetime            # 继承自 BaseResponse
  data: {
    task_id: string
    status: string               # "pending" | "processing" | "completed" | "failed"
    progress: float              # 进度百分比 0-100
    stage_message: string        # 当前处理阶段描述
    result: {                    # status=completed 时存在
      video_url: string          # 处理后的视频 URL
      original_duration: float   # 原视频时长
      new_duration: float        # 新视频时长
      removed_count: int         # 移除的静音段数量
      time_saved: float          # 节省的时间（秒）
    } | null
    error: string | null         # status=failed 时的错误信息
  }
}
```

## 3. API 端点

### POST /api/silence/remove

**请求流程：**

```
1. 校验请求参数
   - video_url 不为空，文件存在
   - segments_to_remove 不为空
   - 每个 segment 的 start < end
   - segments 之间无重叠
   - preserved_gap 范围 [0, 1.0] 秒
   - fade_duration 范围 [0, 0.5] 秒
2. 生成 task_id (uuid)
3. 在内存任务字典中注册任务（status=pending, progress=0）
4. 启动异步任务（asyncio.create_task）
5. 立即返回 SilenceRemoveAccepted { task_id }
```

### GET /api/silence/status/{task_id}

**请求流程：**

```
1. 从任务字典查找 task_id
2. 不存在 → 返回 404 TASK_NOT_FOUND
3. 存在 → 返回 SilenceProgressResponse
4. status=completed 时，result 字段包含处理后视频信息
```

## 4. 异步处理流程

```
异步任务执行流程（在 asyncio.create_task 中运行）：

阶段 1: 准备（progress 0-10%）
  - 将 segments_to_remove 按 start 排序
  - 按第 5 节的算法计算保留段列表（keep_segments）
    - 每个静音段中心保留 preserved_gap 长度的间隔
    - 语音内容段 + 保留间隔段交替排列
    - 首段从 0 开始，末段到视频结尾
  - 验证保留段有效（过滤零长度或负长度段）
  - 若过滤后无有效保留段 → 返回 NO_KEEP_SEGMENTS 错误

阶段 2: 裁切保留段（progress 10-70%）
  - 对每个保留段，使用 FFmpeg 裁切出临时片段
  - 优先使用精确模式（重编码），确保裁切点精确到帧：
    ffmpeg -i {input} -ss {start} -to {end} -c:v libx264 -c:a aac -avoid_negative_ts make_zero {temp_segment}
  - 注意：-c copy 无法保证帧级精度（裁切点受限于关键帧间隔），对静音移除场景精度不足，因此默认使用重编码
  - 如视频较短且保留段较少可考虑 -c copy 加速，但需在文档中注明精度折损
  - 每完成一个片段更新 progress

阶段 3: 拼接 + 音频过渡（progress 70-95%）
  - 生成 concat 文件列表（filelist.txt，每行格式：file 'path/to/segment_N.mp4'）
  - 因阶段 2 已重编码为统一格式，可使用 -c copy 拼接：
    ffmpeg -f concat -safe 0 -i {filelist} -c copy {output_temp}
  - 如需音频淡入淡出（fade_duration > 0），对拼接后文件添加过渡处理：
    - 计算每个拼接点在输出文件中的时间位置（依次累加各保留段的时长）
    - 使用 afade 滤镜在每个拼接点前后添加淡出/淡入：
      ffmpeg -i {output_temp} -af "afade=t=out:st={pos-fade}:d={fade},afade=t=in:st={pos}:d={fade},..." -c:v copy -c:a aac {output}
    - 注意：多个拼接点需组合多个 afade 滤镜（用逗号分隔）
    - 如 fade_duration=0 则跳过此步，直接使用拼接输出作为最终文件
  - 输出到 static/video/silence_removed/{uuid}.mp4

阶段 4: 完成（progress 95-100%）
  - 获取新视频的 duration、文件大小
  - 清理临时片段文件
  - 清理 detect 阶段产生的音频文件
  - 更新任务状态为 completed，填充 result

异常处理：
  - 任何阶段失败 → status=failed, error=错误详情
  - 清理已生成的临时文件
```

## 5. 保留间隔的计算逻辑

```
输入：
  - 原始视频时长 T
  - 排序后的静音段列表 S = [{start, end}, ...]
  - 保留间隔 gap（秒）

策略：对每个静音段，在其中心位置保留 gap 长度的间隔（维持语句间的自然停顿），
移除其余部分。如果静音段本身短于 gap，则保留整个静音段（不移除）。

计算保留段（即最终输出视频中按顺序保留的片段）：

keep_segments = []
prev_end = 0

for each segment in S:
    # 计算静音段中心保留的间隔边界
    silence_center = (segment.start + segment.end) / 2
    gap_start = max(segment.start, silence_center - gap/2)
    gap_end = min(segment.end, silence_center + gap/2)
    
    # 保留段 A：前一段语音内容（从上一个切点到当前静音段的保留间隔起点）
    speech_start = prev_end
    speech_end = gap_start
    
    if speech_end > speech_start:
        keep_segments.append({start: speech_start, end: speech_end})
    
    # 保留段 B：静音段中心的间隔（维持自然停顿节奏）
    if gap_end > gap_start:
        keep_segments.append({start: gap_start, end: gap_end})
    
    prev_end = gap_end

# 最后一段：末尾语音内容
if T > prev_end:
    keep_segments.append({start: prev_end, end: T})
```

**边界情况：**
- 静音段时长 ≤ gap → `gap_start = segment.start`，`gap_end = segment.end`，整个静音段被保留，等效于不移除
- 相邻静音段紧密相连 → 两段之间的语音段（保留段 A）可能长度为 0，跳过即可
- 首段静音段从 0 开始 → `speech_start = speech_end = 0`，跳过保留段 A，仅保留间隔段 B
- 视频末尾是静音段 → 末尾语音段长度可能为 0，跳过即可

## 6. 任务管理

- 使用内存字典 `Dict[str, TaskInfo]` 存储任务状态（与项目中 ark video 等异步任务模式一致）
- 任务自动过期：超过 1 小时的已完成/失败任务自动清理
- 并发限制：使用 `QueueManager` 限制同时处理的视频数（建议 max_concurrent=2）
- 进度更新：通过闭包或共享对象在异步任务中实时更新 progress

## 7. 文件存储与清理

- 临时裁切片段：`temp/silence_removal/{task_id}/segment_{n}.mp4`
- 最终输出视频：`static/video/silence_removed/{uuid}.mp4`
- 目录需在服务初始化时确保存在
- 清理策略：
  - 处理完成后立即删除临时片段
  - detect 阶段的音频文件在 remove 完成后删除
  - 失败任务的临时文件在异常处理中清理

## 8. Next.js API 代理路由

**文件 1：** `src/app/api/silence/remove/route.ts`
- POST → `${BACKEND_URL}/api/silence/remove`

**文件 2：** `src/app/api/silence/status/[taskId]/route.ts`
- GET → `${BACKEND_URL}/api/silence/status/${taskId}`

遵循项目现有代理路由模式。

## 9. 错误处理

所有错误响应使用 `ErrorResponse` 模型（来自 `app/models/base_models.py`），包含 `success=False`、`message`、`error_code`、`error_details` 字段。

| 场景 | HTTP 状态码 | 错误码 | 消息 |
|------|-------------|--------|------|
| 任务不存在 | 404 | TASK_NOT_FOUND | 任务不存在或已过期 |
| 视频文件不存在 | 404 | VIDEO_NOT_FOUND | 视频文件不存在 |
| 无有效保留段 | 400 | NO_KEEP_SEGMENTS | 移除所有静音段后没有有效的视频片段 |
| 段落参数非法 | 422 | INVALID_SEGMENTS | segment 的 start ≥ end 或段落之间存在重叠 |
| FFmpeg 裁切失败 | 500 | FFMPEG_CUT_ERROR | FFmpeg 裁切失败: {detail} |
| FFmpeg 拼接失败 | 500 | FFMPEG_CONCAT_ERROR | FFmpeg 拼接失败: {detail} |
| 并发限制 | 429 | QUEUE_FULL | 处理队列已满，请稍后再试 |
