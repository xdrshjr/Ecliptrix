# Bug Diagnosis: ark-video-missing-oss-upload

**Date:** 2026-02-27
**Mode:** 全自动 (Fully automatic)
**Status:** Fixed

## Problem Description

Materials Management 中的 AI 视频，生成好的视频没有走 OSS 的流程，导致其预览和缩略图显示都有问题。

## Root Cause

`backend-services/basic-service/app/services/ark_video_service.py:87-193`

`_download_and_cache()` 函数在下载 Ark AI 生成的视频到本地后，直接构造了本地 URL（`/api/storage/files/video/ark/{today_str}/...`）并存入缓存，**完全跳过了 OSS 上传流程**。

**说明：**
- `storage_service.upload_video_file()` 上传文件后会调用 `oss_client.upload_file()` 推送到 OSS，返回 CDN URL
- `_download_and_cache()` 只写本地磁盘，视频 URL 和缩略图 URL 均为后端本地路径
- OSS 启用时，常规上传的素材走 CDN URL，但 Ark AI 视频走本地 URL，行为不一致
- 本地 URL 通过后端 `/api/storage/files/` 提供服务，可能存在 CORS 问题导致 canvas 截帧失败，且不支持 CDN 加速

## Fix Applied

**Files modified:**
- `backend-services/basic-service/app/services/ark_video_service.py` - 添加 OSS 上传逻辑

**Changes:**
1. 顶部 import `get_oss_client` from `app.services.oss_client`
2. 在视频下载完成后，调用 `oss_client.upload_file()` 上传视频到 OSS，失败则降级用本地 URL
3. 在 ffmpeg 缩略图生成完成后，调用 `oss_client.upload_file()` 上传缩略图到 OSS，失败则降级用本地 URL
4. 最终 result dict 使用 `final_video_url`（OSS URL 或本地 URL）和更新后的 `thumbnail_url`

## Verification

未运行测试（无 Ark 相关测试文件）。修改逻辑与 `storage_service.upload_video_file()` 中的 OSS 上传模式一致，且有完整的异常处理和 fallback。

## Notes

- OSS 未启用时（`OSS_ENABLED=false`），`get_oss_client()` 返回 None，逻辑完全不变，不影响现有行为
- 已有视频（server restart 后跳过下载的情况）如果本地文件存在也会走 OSS 上传，这是期望行为（幂等上传）
