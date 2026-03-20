# Bug Diagnosis: ark-video-blank-thumbnail

**Date:** 2026-02-27
**Mode:** Fully automatic
**Status:** Fixed

## Problem Description

Materials Management 中，AI 生成视频的卡片缩略图显示为空白（一片空白），而不是视频截帧图。

## Root Cause

**文件：** `src/components/video/hooks/useMaterialManagement.ts`，`extractVideoThumbnail()` 函数

`onseeked` 事件监听器注册时机错误，以及 `preload='metadata'` 的使用导致双重问题：

1. **`onseeked` 提前触发（主因）**
   `onseeked` 在 `video.src` 设置时就已经注册。部分浏览器（尤其是 Chromium 系）会在 `onloadedmetadata` 触发之前，对 `currentTime = 0` 的初始位置提前触发一次 `onseeked`。此时 `video.videoWidth = 0`、`video.videoHeight = 0`（元数据尚未加载），`ctx.drawImage()` 画出透明帧，JPEG 不支持透明通道 → 透明 canvas 转为**白色 JPEG**。Promise 在此提前 resolve，后续真正 seek 完成的 `onseeked` 被忽略。

2. **`preload='metadata'` 无法保证帧数据可用（次因）**
   即使 `onloadedmetadata` 正常触发后再 seek 到 1 秒，`preload='metadata'` 只加载了视频元数据，并未缓冲实际帧数据。部分浏览器的 seek 会在帧数据未解码时就触发 `onseeked`，同样导致空白帧被捕获。

## Fix Applied

**Files modified:**
- `src/components/video/hooks/useMaterialManagement.ts` — 重写 `extractVideoThumbnail()`

**Changes:**
- 将 `onseeked` 监听器移入 `onloadedmetadata` 内部注册，确保只响应我们主动发起的 seek，而非浏览器的初始 seek
- 将 `preload='metadata'` 改为 `preload='auto'`，确保视频帧数据被缓冲，seek 后能得到真实帧
- 添加维度检查：若 `videoWidth/videoHeight` 为 0，直接返回 null（跳过空白帧）
- 引入 `resolved` 标志位防止 Promise 多次 resolve（`onseeked`、`onerror`、`setTimeout` 三路竞争）
- 将 `video.src = videoUrl` 移至所有事件监听器注册之后（避免事件注册竞争）
- 执行一次后立即清除 `video.onseeked = null`，防止二次触发

## Verification

重新生成一个 AI 视频，生成完成后检查素材面板中的缩略图是否正确显示视频截帧而非空白。

## Notes

此 bug 仅影响通过 canvas 客户端提取缩略图的 ARK AI 生成视频（`status.thumbnail_url` 为 null 时触发）。对于已有服务端 `thumbnail_url` 的视频（上传视频、之前版本缓存的 ARK 视频）不受影响。
