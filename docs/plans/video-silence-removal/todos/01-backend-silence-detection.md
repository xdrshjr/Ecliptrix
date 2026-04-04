# TODO 01: 后端静音检测服务

**对应 Spec:** `specs/01-backend-silence-detection.md`

## Dependencies

- `depends_on: []` — 无前置依赖，可首先实现
- `blocks: [02, 03, 04]` — 检测 API 是所有后续功能的基础
- `parallel_group: A` — 可与 TODO 03 的弹窗骨架部分并行

## Tasks

- [ ] 创建 `app/models/silence_removal_models.py`
  - [ ] 定义 `SilenceDetectRequest` 模型（video_url, noise_threshold, min_silence_duration）
  - [ ] 定义 `SilenceDetectResponse` 模型（继承 BaseResponse，data 含 audio_url, silence_segments, 统计信息）
  - [ ] 定义 `SilenceSegment` 子模型（id, start, end, duration）

- [ ] 创建 `app/services/silence_removal_service.py`
  - [ ] 实现 `detect_silence(video_url, noise_threshold, min_silence_duration)` 方法
  - [ ] URL 到本地路径解析（去除 URL 前缀，拼接 STORAGE_ROOT）
  - [ ] ffprobe 获取视频时长，校验 ≤ 1800 秒
  - [ ] 检查视频是否有音频轨道
  - [ ] FFmpeg 提取音频：`ffmpeg -i {input} -vn -ac 1 -ar 44100 -b:a 64k -f mp3 {output}`
  - [ ] 输出到 `static/audio/silence_detect/{uuid}.mp3`
  - [ ] FFmpeg silencedetect：`ffmpeg -i {audio} -af silencedetect=noise={threshold}dB:d={min_duration} -f null -`
  - [ ] 解析 stderr：正则匹配 silence_start / silence_end / silence_duration
  - [ ] 处理边界情况：视频开头静音、视频结尾静音（只有 start 没有 end）
  - [ ] 为每个静音段生成 uuid
  - [ ] 计算统计信息（总静音时长、占比）
  - [ ] 确保 `static/audio/silence_detect/` 目录存在

- [ ] 创建 `app/routers/silence_removal_router.py`
  - [ ] 定义 router（prefix="/silence"）
  - [ ] 实现 `POST /detect` 端点
  - [ ] 参数校验（noise_threshold [-60, -10]，min_silence_duration [0.1, 5.0]）
  - [ ] 使用 `@with_simple_queue` 控制并发
  - [ ] 错误处理：VIDEO_NOT_FOUND, NO_AUDIO_TRACK, VIDEO_TOO_LONG, FFMPEG_ERROR, INVALID_PARAMS
  - [ ] 日志记录

- [ ] 在 `app/main.py` 注册路由
  - [ ] 导入 silence_removal_router
  - [ ] `app.include_router(silence_removal_router, prefix="/api")`

- [ ] 创建 Next.js 代理路由 `src/app/api/silence/detect/route.ts`
  - [ ] POST 代理到 `${BACKEND_URL}/api/silence/detect`
  - [ ] 参考 watermark-removal 路由模式
