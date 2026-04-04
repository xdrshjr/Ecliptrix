# Spec 01: 后端静音检测服务 + API

## 1. 概述

实现后端静音检测功能：接收视频文件路径，提取音频轨道为低码率 MP3（供前端 wavesurfer.js 加载），使用 FFmpeg silencedetect 检测静音段，返回静音段列表和音频 URL。

## 2. 数据模型

### SilenceDetectRequest

```
{
  video_url: string          # 视频文件的 URL（服务端路径或 OSS URL）
  noise_threshold: float     # 静音阈值，单位 dB，默认 -30
  min_silence_duration: float # 最小静音时长，单位秒，默认 0.5
}
```

### SilenceDetectResponse

继承 `BaseResponse`（来自 `app/models/base_models.py`），`success`、`message`、`timestamp` 由基类提供，`data` 字段承载检测结果：

```
{
  success: bool               # 继承自 BaseResponse
  message: string             # 继承自 BaseResponse
  timestamp: datetime         # 继承自 BaseResponse
  data: {
    audio_url: string          # 提取的音频文件 URL（低码率 MP3，供 wavesurfer.js 使用）
    audio_duration: float      # 音频总时长（秒）
    silence_segments: [        # 检测到的静音段列表
      {
        id: string             # 段落唯一标识（uuid）
        start: float           # 起始时间（秒）
        end: float             # 结束时间（秒）
        duration: float        # 时长（秒）
      }
    ]
    total_silence_duration: float  # 静音总时长
    silence_percentage: float      # 静音占比百分比
  }
}
```

## 3. API 端点

### POST /api/silence/detect

**Router:** `silence_removal_router.py`，prefix="/silence"，挂载 prefix="/api"

**请求流程：**

```
1. 校验请求参数
   - video_url 不为空
   - 将 video_url 解析为本地文件路径（去除 URL 前缀，拼接 STORAGE_ROOT），确认文件存在且可访问
   - noise_threshold 范围 [-60, -10] dB
   - min_silence_duration 范围 [0.1, 5.0] 秒
2. 校验视频时长 ≤ 30 分钟（1800 秒）
   - 使用 ffprobe 获取 duration
3. 提取音频轨道
   - FFmpeg 命令：ffmpeg -i {input} -vn -ac 1 -ar 44100 -b:a 64k -f mp3 {output}
   - 输出到 static/audio/silence_detect/{uuid}.mp3
   - 单声道 44100Hz 64kbps，兼顾体积和 wavesurfer 渲染质量
4. 检测静音段
   - FFmpeg 命令：ffmpeg -i {audio} -af silencedetect=noise={threshold}dB:d={min_duration} -f null -
   - 解析 stderr 输出中的 silence_start / silence_end / silence_duration
5. 为每个静音段生成 uuid 标识
6. 计算统计信息（总静音时长、占比）
7. 构造 SilenceDetectResponse 返回
```

**错误处理：**

所有错误响应使用 `ErrorResponse` 模型（来自 `app/models/base_models.py`），包含 `success=False`、`message`、`error_code`、`error_details` 字段。

| 场景 | HTTP 状态码 | 错误码 | 消息 |
|------|-------------|--------|------|
| 视频文件不存在 | 404 | VIDEO_NOT_FOUND | 视频文件不存在 |
| 视频无音频轨道 | 400 | NO_AUDIO_TRACK | 视频没有音频轨道 |
| 视频超过30分钟 | 400 | VIDEO_TOO_LONG | 视频时长超过30分钟限制 |
| FFmpeg 执行失败 | 500 | FFMPEG_ERROR | FFmpeg 处理失败: {detail} |
| 参数不合法 | 422 | INVALID_PARAMS | 参数超出有效范围 |

## 4. FFmpeg silencedetect 解析

FFmpeg silencedetect 的 stderr 输出格式：

```
[silencedetect @ 0x...] silence_start: 1.234
[silencedetect @ 0x...] silence_end: 2.567 | silence_duration: 1.333
[silencedetect @ 0x...] silence_start: 5.678
[silencedetect @ 0x...] silence_end: 6.789 | silence_duration: 1.111
```

**解析伪代码：**

```
使用正则匹配：
  silence_start_pattern = r"silence_start:\s*([\d.]+)"
  silence_end_pattern   = r"silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)"

遍历 stderr 逐行匹配：
  遇到 silence_start → 记录 start
  遇到 silence_end → 与当前 start 配对，生成 SilenceSegment
  
边界处理：
  - 视频开头就是静音：silence_start: 0.0
  - 视频结尾是静音：只有 silence_start 没有 silence_end，用步骤 2 中 ffprobe 获取的 audio_duration 作为 end
```

## 5. 文件存储

- 提取的音频文件存放：`static/audio/silence_detect/{uuid}.mp3`
- 目录需在服务初始化时确保存在（`os.makedirs`）
- 临时文件清理：检测完成后，音频文件保留至处理完成或超时（由 Spec 02 的处理流程负责清理）

## 6. 接口行为约束

- 同步请求：detect API 同步执行并返回结果（检测耗时较短，30 分钟视频的 silencedetect 通常 < 10 秒）
- 并发限制：使用项目已有的 `@with_simple_queue` 装饰器（参考 `video_router.py`）控制并发，避免同时处理过多检测任务
- 日志记录：记录每次检测的视频路径、参数、检测到的静音段数量、耗时

## 7. Next.js API 代理路由

**文件：** `src/app/api/silence/detect/route.ts`

**行为：**
- 读取 `process.env.BACKEND_URL`
- 将 POST 请求体原样转发到 `${BACKEND_URL}/api/silence/detect`
- 返回后端响应
- 遵循项目现有的代理路由模式（参考 `src/app/api/video/watermark-removal/route.ts`）
