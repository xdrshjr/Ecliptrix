# 批量视频解析 - 缩略图模式

## 概述
本文档描述了批量视频解析的缩略图模式（快速解析）的实现细节。该模式允许使用视频的缩略图进行快速AI解析，而不需要下载和拆帧视频文件。

## 功能特点

### 快速解析模式
- 直接使用视频的缩略图进行AI解析
- 处理速度快，资源消耗低
- 每个视频只分析1帧（缩略图）
- 适合快速预览或对精度要求不高的场景

### 专业解析模式
- 按指定时间间隔提取多帧进行深度AI分析
- 分析精度高，效果更佳
- 用户可以自定义帧间隔（1-30秒）
- 适合专业制作或对效果要求较高的场景

## 实现细节

### 前端流程

1. **用户选择快速解析模式**
   - 用户点击批量解析按钮
   - 选择"快速解析"模式
   - 系统检查每个视频是否有缩略图

2. **缩略图处理**
   - 如果缩略图是 blob URL：转换为 File 对象并上传
   - 如果缩略图是普通 URL：直接传递 URL

3. **请求发送**
   ```typescript
   // 参数
   {
     video_url: string,          // 视频文件路径
     use_thumbnail: true,        // 使用缩略图模式
     thumbnail_url: string,      // 缩略图URL或留空（如果上传了文件）
     frame_interval: number      // 忽略（快速模式下不使用）
   }
   
   // FormData（当视频是blob URL时）
   formData.append('video', videoFile);
   formData.append('use_thumbnail', 'true');
   formData.append('thumbnail', thumbnailFile);  // 如果缩略图是blob URL
   formData.append('thumbnail_url', thumbnailUrl); // 或普通URL
   ```

### Next.js API 路由

位置：`src/app/api/video/analyze/route.ts`

#### 处理流程

1. **接收请求**
   - 读取 `use_thumbnail` 参数
   - 读取 `thumbnail_url` 或 `thumbnail` 文件

2. **缩略图文件处理**
   ```typescript
   if (thumbnailFile && useThumbnail === 'true') {
     // 保存缩略图到临时文件
     const thumbnailBytes = await thumbnailFile.arrayBuffer();
     const thumbnailBuffer = Buffer.from(thumbnailBytes);
     const thumbnailFileName = `thumbnail_${timestamp}_${randomStr}.jpg`;
     tempThumbnailPath = join(tmpdir(), thumbnailFileName);
     await writeFile(tempThumbnailPath, thumbnailBuffer);
     
     // 验证文件是否成功创建
     const fs = require('fs');
     if (!fs.existsSync(tempThumbnailPath)) {
       throw new Error('Failed to save thumbnail file');
     }
     const stats = fs.statSync(tempThumbnailPath);
     console.log('Thumbnail file verified:', { path: tempThumbnailPath, size: stats.size });
     
     // 使用临时文件路径
     finalThumbnailUrl = tempThumbnailPath;
   }
   ```

3. **转发到 Python 后端**
   ```typescript
   const requestBody = {
     video_url: tempFilePath,
     use_thumbnail: useThumbnail === 'true',
     thumbnail_url: finalThumbnailUrl || undefined,
     frame_interval: frameInterval ? parseInt(frameInterval) : undefined
   };
   ```

4. **清理临时文件**
   - ✅ 清理视频临时文件（已上传，可以删除）
   - ❌ **不要**清理缩略图临时文件！
   - 缩略图文件由 Python 后端在处理完成后清理
   - **重要**：由于 Python 后端使用队列系统，响应会立即返回，但实际处理是异步的
   - 如果在 Next.js API 中删除缩略图，Python 后端处理时会找不到文件

### Python 后端

位置：`backend-services/basic-service/app/routers/video_router.py`

#### 处理逻辑

1. **接收参数**
   ```python
   class VideoAnalysisRequest(BaseModel):
       video_url: str
       frame_interval: Optional[int] = None
       custom_prompt: Optional[str] = None
       use_thumbnail: bool = False
       thumbnail_url: Optional[str] = None
   ```

2. **快速模式处理**
   - 当 `use_thumbnail=True` 时
   - 不进行视频拆帧
   - 直接使用 `thumbnail_url` 指向的图片
   - 调用 VLM 分析该图片

3. **缩略图处理**（`download_thumbnail` 方法）
   处理顺序：
   - **base64 data URL**（`data:` 开头）：解码并保存到临时文件
   - **HTTP/HTTPS URL**：下载并保存到临时文件
   - **本地文件路径**：检查文件是否存在
     - 存在：直接返回路径
     - 不存在：抛出 `FileNotFoundError`

4. **日志记录**
   ```
   Analysis mode: thumbnail-only (quick mode)
   Thumbnail URL: [path]
   Thumbnail is already a local file: [path]
   ```

## 数据流程图

```
用户选择快速解析
    ↓
前端：BatchAnalysisModeSelectionModal
    ↓
前端：handleBatchAnalysisConfirm(mode: 'quick')
    ↓
前端：handleVideoAnalysis(material, undefined, true)
    ↓
前端：videoAnalysisService.analyzeVideo()
    ↓
    ├─ blob URL? → 转换为 File 上传
    └─ 普通 URL → JSON 请求
    ↓
Next.js API: /api/video/analyze
    ↓
    ├─ 保存视频到临时文件
    ├─ 保存缩略图到临时文件（如果是blob）
    └─ 转发到 Python 后端
    ↓
Python 后端: /api/video/analyze
    ↓
    ├─ use_thumbnail=True? 
    ├─ 读取缩略图文件
    ├─ 调用 VLM 分析
    └─ 返回结果
    ↓
Next.js API: 清理临时文件
    ↓
前端：显示解析结果
```

## 关键代码位置

### 前端
- **模式选择弹窗**: `src/components/video/components/BatchAnalysisModeSelectionModal/`
- **解析逻辑**: `src/components/video/VideoEditingInterface.tsx`
  - `handleBatchVideoAnalysis()` - 打开模式选择
  - `handleBatchAnalysisConfirm()` - 根据模式触发解析
  - `handleVideoAnalysis()` - 单个视频解析
- **服务层**: `src/components/video/services/videoAnalysisService.ts`
  - `analyzeVideo()` - 处理缩略图上传

### Next.js 中间层
- **API 路由**: `src/app/api/video/analyze/route.ts`
  - 处理文件上传
  - 处理缩略图文件
  - 清理临时文件

### Python 后端
- **路由**: `backend-services/basic-service/app/routers/video_router.py`
- **服务**: `backend-services/basic-service/app/services/video_analysis_service.py`
  - `analyze_video()` - 缩略图模式处理

## 日志示例

### 快速解析模式（成功）
```
[Video Analyze API] Processing file upload
[Video Analyze API] File received: {
  name: 'video_1762703145268_v1ahue01i5.mp4',
  type: 'video/mp4',
  size: 123456,
  useThumbnail: true,
  hasThumbnailUrl: true
}
[Video Analyze API] Processing thumbnail file: {
  name: 'thumbnail_1762703145268.jpg',
  type: 'image/jpeg',
  size: 12345
}
[Video Analyze API] Thumbnail saved to temp: C:\Users\...\thumbnail_1762703145268_abc123.jpg
[Video Analyze API] Sending request to backend: {
  video_url: 'C:\Users\...\video_1762703145268_v1ahue01i5.mp4',
  frame_interval: 5,
  use_thumbnail: true,
  has_thumbnail_url: true
}
Analysis mode: thumbnail-only (quick mode)
Thumbnail URL: C:\Users\...\thumbnail_1762703145268_abc123.jpg
Thumbnail is already a local file: C:\Users\...\thumbnail_1762703145268_abc123.jpg
Quick mode: Using thumbnail for analysis
Successfully downloaded thumbnail for quick analysis
Using thumbnail as single frame for VLM analysis
```

## 错误处理

### 缩略图不存在
```typescript
if (!material.thumbnailUrl) {
  console.warn('视频没有缩略图，跳过快速解析');
  // 可以降级到专业模式或提示用户
}
```

### 缩略图文件保存失败
Next.js API会验证文件是否成功保存：
```typescript
if (!fs.existsSync(tempThumbnailPath)) {
  throw new Error('Failed to save thumbnail file');
}
```

### 缩略图文件不存在（Python后端）
Python后端会明确报错：
```python
if not os.path.exists(thumbnail_url):
    raise FileNotFoundError(f"Local thumbnail file does not exist: {thumbnail_url}")
```

### 错误日志示例
```
[Video Analyze API] Failed to verify thumbnail file: Error: ENOENT
Local thumbnail file does not exist: /tmp/thumbnail_xxx.jpg
```

## 性能对比

| 模式 | 处理时间 | 资源消耗 | 精度 |
|-----|---------|---------|------|
| 快速解析 | ~4秒 | 低 | 中 |
| 专业解析 | ~15-30秒 | 高 | 高 |

## 注意事项

1. **缩略图质量**：确保缩略图清晰可见，能代表视频内容
2. **blob URL 处理**：前端会自动处理 blob URL，无需手动转换
3. **临时文件清理**：
   - ✅ 视频文件：Next.js API 清理
   - ✅ 缩略图文件：**Python 后端清理**（不要在 Next.js API 中删除）
   - 原因：Python 后端使用队列系统，响应立即返回，实际处理是异步的
4. **错误降级**：如果快速模式失败，可以考虑降级到专业模式
5. **队列处理时序**：
   - Next.js API → Python 后端 API（立即返回200）→ 队列系统异步处理
   - 临时文件必须在整个异步处理完成前保持存在

## 后续优化

1. **智能模式选择**：根据视频时长自动推荐模式
2. **缩略图质量检测**：检测缩略图是否适合分析
3. **并行处理**：优化多个缩略图的并行上传
4. **缓存机制**：缓存已分析的缩略图结果

