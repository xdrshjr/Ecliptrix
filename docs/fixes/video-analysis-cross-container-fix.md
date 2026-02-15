# 视频分析跨容器文件传输问题修复

## 问题描述

在服务器部署环境中，视频分析功能报错，提示找不到缩略图文件：

```
ERROR - Local thumbnail file does not exist: /tmp/thumbnail_1762706682323_aht9tfbyph.jpg
ERROR - Found 0 thumbnail files in directory: []
```

**本地环境**：正常工作 ✅
**服务器环境**：失败 ❌

## 根本原因

在服务器部署环境中：
1. **前端（Next.js）** 和 **后端（Python）** 运行在不同的容器/环境中
2. 它们的文件系统是**隔离的**，各自有独立的 `/tmp` 目录
3. 前端将文件保存到 `/tmp/xxx` 并将路径发送给后端
4. 后端访问 `/tmp/xxx` 时找不到文件，因为这是后端容器的 `/tmp`，不是前端容器的

### 为什么本地能工作？

本地开发环境中，前端和后端通常运行在同一台机器上，共享同一个文件系统，所以可以通过文件路径传递文件。

## 解决方案

### 1. 缩略图处理 - Base64 编码

**修改前**：
```typescript
// 前端保存缩略图到本地文件
await writeFile(tempThumbnailPath, thumbnailBuffer);
// 发送文件路径给后端
thumbnail_url: tempThumbnailPath  // ❌ 后端访问不到
```

**修改后**：
```typescript
// 将缩略图转换为 base64 编码
const thumbnailBase64 = thumbnailBuffer.toString('base64');
const mimeType = thumbnailFile.type || 'image/jpeg';
finalThumbnailUrl = `data:${mimeType};base64,${thumbnailBase64}`;
// 发送 base64 数据给后端
thumbnail_url: finalThumbnailUrl  // ✅ 后端可以解析
```

**优势**：
- ✅ 缩略图文件通常较小（100-200KB），适合 base64 编码
- ✅ 后端已经支持 base64 格式（data URI）的图片处理
- ✅ 不需要文件系统共享

### 2. 视频处理 - 上传到 Supabase

**修改前**：
```typescript
// 前端保存视频到本地文件
await writeFile(tempFilePath, buffer);
// 发送文件路径给后端
video_url: tempFilePath  // ❌ 后端访问不到
```

**修改后**：
```typescript
// 先将视频上传到 Supabase（云存储）
const uploadResponse = await fetch(`${BACKEND_URL}/api/supabase/upload-video`, {
  method: 'POST',
  body: uploadFormData,
});
const videoUrl = uploadResult.video_url;
// 发送 Supabase URL 给后端
video_url: videoUrl  // ✅ 后端可以从 URL 下载
```

**优势**：
- ✅ 视频文件通常较大，不适合 base64 编码
- ✅ 使用云存储 URL，前后端都可以访问
- ✅ 后端已有从 URL 下载视频的功能

## 修改文件

### `src/app/api/video/analyze/route.ts`

**主要变更**：

1. **移除本地文件系统操作**
   ```typescript
   // 删除
   import { writeFile, unlink } from 'fs/promises';
   import { join } from 'path';
   import { tmpdir } from 'os';
   ```

2. **视频上传到 Supabase**
   ```typescript
   const uploadFormData = new FormData();
   uploadFormData.append('file', file);
   uploadFormData.append('task_id', `video_analysis_${Date.now()}`);
   uploadFormData.append('generate_thumbnail', 'false');
   
   const uploadResponse = await fetch(`${BACKEND_URL}/api/supabase/upload-video`, {
     method: 'POST',
     body: uploadFormData,
   });
   
   const videoUrl = uploadResult.video_url;
   ```

3. **缩略图转换为 Base64**
   ```typescript
   const thumbnailBytes = await thumbnailFile.arrayBuffer();
   const thumbnailBuffer = Buffer.from(thumbnailBytes);
   const thumbnailBase64 = thumbnailBuffer.toString('base64');
   const mimeType = thumbnailFile.type || 'image/jpeg';
   const finalThumbnailUrl = `data:${mimeType};base64,${thumbnailBase64}`;
   ```

4. **移除临时文件清理代码**
   - 不再需要清理本地临时文件
   - 视频在 Supabase，缩略图是 base64 数据

## 后端兼容性

后端代码**无需修改**，已经支持：

1. **Base64 缩略图处理** (`video_analysis_service.py`)
   ```python
   if thumbnail_url.startswith('data:'):
       # 解析 base64 数据
       header, encoded = thumbnail_url.split(',', 1)
       image_data = base64.b64decode(encoded)
       # 保存为临时文件供 OpenCV 使用
       with open(thumbnail_path, "wb") as f:
           f.write(image_data)
   ```

2. **从 URL 下载视频** (`video_analysis_service.py`)
   ```python
   async def download_video_if_needed(self, video_url: str):
       if os.path.exists(video_url):
           return video_url  # 本地文件
       # 从 URL 下载
       response = requests.get(video_url, stream=True)
       # 保存到临时文件
   ```

3. **自动清理临时文件**
   ```python
   if self.config['temp_files']['auto_cleanup']:
       if thumbnail_path and os.path.exists(thumbnail_path):
           os.remove(thumbnail_path)
       if video_path and os.path.exists(video_path):
           os.remove(video_path)
   ```

## 测试验证

部署后应验证：

1. ✅ 缩略图 base64 编码和解码正常
2. ✅ 视频上传到 Supabase 成功
3. ✅ 后端从 Supabase URL 下载视频成功
4. ✅ 视频分析完整流程正常
5. ✅ 临时文件自动清理

## 性能影响

### 正面影响
- 🚀 文件传输更可靠（通过 HTTP 而非文件系统）
- 🚀 视频存储在 Supabase，便于后续访问和管理
- 🚀 不依赖共享文件系统，部署更灵活

### 性能考虑
- ⚠️ 视频需要先上传到 Supabase，增加额外的网络传输时间
- ⚠️ 但这是必要的，因为在容器化环境中没有其他可靠的文件共享方式
- ✅ 缩略图 base64 编码开销很小（<1ms），可以忽略

## 架构建议

### 当前方案（推荐用于生产环境）
```
用户浏览器 → Next.js API → Supabase (上传视频)
                          ↓
                     Python 后端 ← Supabase URL
                          ↓
                     视频分析结果
```

### 本地开发环境
- 仍然可以使用原有的文件路径方式（通过 JSON 请求）
- 或者使用新的 Supabase 方式（推荐，保持一致）

## 相关文档

- 视频分析 API: `docs/apis/video_analysis_api.md`
- 缩略图模式: `docs/apis/video-batch-analysis-thumbnail-mode.md`
- Supabase 上传: `backend-services/basic-service/docs/apis/supabase_upload_api.md`

## 日期

2025-11-09

