# Bug Diagnosis: materials-upload-not-displaying

**Date:** 2026-02-27
**Mode:** Fully automatic
**Status:** Fixed

## Problem Description

素材管理(Materials Management)中，点击上传按钮，上传的素材没有正确显示在素材列表中。迁移离开Supabase后出现此问题。

## Root Cause

`useMaterialManagement.ts:uploadSingleFile` 上传文件到后端成功后，会再次尝试从浏览器端 `fetch(result.video_url)` / `fetch(result.file_url)` 下载文件创建 blob URL。

后端 `storage_service._get_file_url()` 返回相对路径 `/api/storage/files/{path}`。
浏览器端的 `fetch("/api/storage/files/...")` 请求发往 Next.js（端口3000），但 Next.js **没有这条路由**，返回 404。

下载失败 → `uploadSingleFile` 抛出异常 → 返回 `null` → `processQueue` 将占位符素材从列表中移除。

**关键代码位置:**
- `src/components/video/hooks/useMaterialManagement.ts` - `uploadSingleFile` 函数（视频第287行，非视频第381行）
- `backend-services/basic-service/app/services/storage_service.py:68` - `_get_file_url()` 返回相对URL

## Fix Applied

**Files modified:**
- `src/app/api/storage/files/[...path]/route.ts` - 新建：Next.js代理路由，将 `/api/storage/files/` 请求转发到后端
- `src/components/video/hooks/useMaterialManagement.ts` - 移除下载+blob URL步骤，直接使用服务器URL

**Changes:**
1. 新增 Next.js 静态文件代理路由，支持 Range 请求头（视频拖拽定位）
2. 移除视频上传后"下载blob→localVideoManager→创建blob URL"的流程
3. 移除非视频文件"下载blob→URL.createObjectURL"的流程
4. 直接使用后端返回的服务器URL（`result.video_url` / `result.file_url`）
5. 移除不再使用的 `localVideoManager` 导入

## Verification

代码修改符合预期逻辑。需要手动测试上传图片、音频、视频各类型素材，验证在素材列表中正确显示。

## Notes

- 旧的 blob URL 方案存在额外问题：blob URL 是临时的，页面刷新后丢失。新方案使用持久服务器 URL，刷新后仍可访问。
- `useMaterialManagement_new.ts` 是未使用的草稿文件，未修改（逻辑相同但无 user ID，其 `_new` 的 `uploadSingleFile` 也存在同样问题）。
