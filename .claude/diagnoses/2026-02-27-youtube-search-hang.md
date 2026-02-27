# Bug Diagnosis: youtube-search-hang

**Date:** 2026-02-27 15:23
**Mode:** Fully automatic
**Status:** Fixed

## Problem Description

搜索 YouTube 视频时请求卡住不动，日志在收到请求后停止，无响应无报错。

## Root Cause

**文件：** `backend-services/basic-service/app/routers/youtube_router.py:48`

`async def` FastAPI 路由直接**同步**调用 `youtube_service.search_videos(request)`（以及 `get_video_info`、`download_video`），而这些方法内部使用 `yt_dlp.YoutubeDL.extract_info()` 进行阻塞网络 I/O。

在 `async def` 中直接调用同步阻塞函数会**冻结整个 asyncio 事件循环**，导致：
- 所有后续请求（包括 auth validate-session）也全部卡住
- 没有错误输出，表现为无限等待

次要问题：`search_videos` 的 `ydl_opts` 没有 `socket_timeout`，网络超时时会无限阻塞。

## Fix Applied

**修改文件：**
- `app/routers/youtube_router.py:50` - search：同步调用改为 `await asyncio.to_thread(...)`
- `app/routers/youtube_router.py:111` - info：同步调用改为 `await asyncio.to_thread(...)`
- `app/routers/youtube_router.py:171` - download：同步调用改为 `await asyncio.to_thread(...)`
- `app/services/youtube_service.py:257` - search ydl_opts 加 `socket_timeout: 30`

**变更模式：**
```python
# 修复前
result = youtube_service.search_videos(request)

# 修复后
result = await asyncio.to_thread(youtube_service.search_videos, request)
```

## Verification

- `/download-and-upload` 端点本身已是 `await youtube_service.download_and_upload_video(request)`（async 方法），无需修改

## Notes

- `asyncio.to_thread()` 需要 Python 3.9+，项目使用 Python 3.10，兼容
- 修复后同步 yt-dlp 操作会在线程池中运行，不再阻塞事件循环
