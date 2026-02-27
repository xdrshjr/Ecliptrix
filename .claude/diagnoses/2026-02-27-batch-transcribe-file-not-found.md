# Bug Diagnosis: batch-transcribe-file-not-found

**Date:** 2026-02-27
**Mode:** Fully automatic
**Status:** Fixed

## Problem Description

批量音频转录请求失败，错误信息：
```
本地音频文件不存在: audio/generated/segment-1_concatenated_1772129961_f31785b9.mp3
```

## Root Cause

**文件：** `backend-services/basic-service/app/services/audio_transcription_service.py:408`

`transcribe_audio_urls` 方法中，将 `/api/` 前缀的本地音频 URL 转换为实际文件路径时，逻辑有误：

```python
# 错误（修复前）
temp_file_path = audio_url.replace('/api/', '')
# /api/audio/generated/file.mp3 → audio/generated/file.mp3  ❌（路径不存在）

# 正确（修复后）
temp_file_path = audio_url.replace('/api/', 'static/', 1)
# /api/audio/generated/file.mp3 → static/audio/generated/file.mp3  ✅
```

**原因：** TTS 音频文件存储在 `static/audio/generated/` 目录，通过 FastAPI 静态文件挂载暴露为 `/api/audio/generated/` 路径。代码直接删除 `/api/` 前缀得到 `audio/generated/...`，但实际路径需要 `static/` 前缀。

## Fix Applied

**修改文件：**
- `backend-services/basic-service/app/services/audio_transcription_service.py:408`

**变更内容：**
将 `audio_url.replace('/api/', '')` 改为 `audio_url.replace('/api/', 'static/', 1)`

## Verification

参考 `video_composition_service.py:1351-1354` 的正确实现，该服务中 `/api/audio/generated/` → `static/audio/generated/` 的映射方式与此修复一致。

## Notes

- 静态文件挂载路径定义见 `app/main.py:368`：`app.mount("/api/audio/generated", StaticFiles(directory="static/audio/generated"))`
- 同类问题可能存在于其他使用 `/api/` URL 做本地路径转换的地方，建议全局检查
