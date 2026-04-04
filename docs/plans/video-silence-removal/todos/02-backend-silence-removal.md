# TODO 02: 后端视频处理服务

**对应 Spec:** `specs/02-backend-silence-removal.md`

## Dependencies

- `depends_on: [01]` — 需要 TODO 01 的模型文件和服务基础
- `blocks: [04]` — 前端集成需要 remove 和 status API 就绪
- `parallel_group: B` — 必须在 TODO 01 完成后执行

## Tasks

- [ ] 在 `app/models/silence_removal_models.py` 中补充模型
  - [ ] 定义 `SilenceRemoveRequest`（video_url, segments_to_remove, preserved_gap, fade_duration）
  - [ ] 定义 `SilenceRemoveAccepted`（继承 BaseResponse，data 含 task_id）
  - [ ] 定义 `SilenceProgressResponse`（继承 BaseResponse，data 含 status, progress, stage_message, result, error）
  - [ ] 定义 `SilenceRemoveResult` 子模型（video_url, original_duration, new_duration, removed_count, time_saved）
  - [ ] 定义 `SegmentToRemove` 子模型（id, start, end）

- [ ] 在 `app/services/silence_removal_service.py` 中实现处理功能
  - [ ] 任务字典 `Dict[str, TaskInfo]` 管理异步任务
  - [ ] 实现 `remove_silence(request)` 方法（创建异步任务，返回 task_id）
  - [ ] 实现 `get_progress(task_id)` 方法
  - [ ] 实现保留间隔计算算法（Spec 02 第 5 节，中心保留策略）
  - [ ] 阶段 1：准备（排序 segments，计算 keep_segments，校验有效性）
  - [ ] 阶段 2：FFmpeg 裁切每个保留段（重编码模式 `-c:v libx264 -c:a aac`）
  - [ ] 阶段 3：FFmpeg concat 拼接 + 可选 afade 音频过渡
  - [ ] 阶段 4：获取新视频信息 + 清理临时文件 + 更新任务状态
  - [ ] 进度更新：每个阶段按比例更新 progress（0-10%, 10-70%, 70-95%, 95-100%）
  - [ ] 异常处理：任何阶段失败 → status=failed + 清理临时文件
  - [ ] 并发控制：QueueManager 限制 max_concurrent=2
  - [ ] 确保目录存在：`temp/silence_removal/`, `static/video/silence_removed/`
  - [ ] 任务过期清理：超过 1 小时的已完成/失败任务自动清理

- [ ] 在 `app/routers/silence_removal_router.py` 中补充端点
  - [ ] 实现 `POST /remove` 端点（参数校验 + 创建异步任务 + 返回 task_id）
  - [ ] 实现 `GET /status/{task_id}` 端点
  - [ ] 错误处理：TASK_NOT_FOUND, VIDEO_NOT_FOUND, NO_KEEP_SEGMENTS, INVALID_SEGMENTS, FFMPEG_CUT_ERROR, FFMPEG_CONCAT_ERROR, QUEUE_FULL

- [ ] 创建 Next.js 代理路由
  - [ ] `src/app/api/silence/remove/route.ts` → POST 代理
  - [ ] `src/app/api/silence/status/[taskId]/route.ts` → GET 代理
