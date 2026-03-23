# Spec 03: 搜索工具 (Search Tools)

## 1. 概述

为 Agent 添加三个外部素材搜索工具：`search_video`（Pexels 视频搜索）、`search_image`（Unsplash 图片搜索）、`search_audio`（Freesound 音频搜索）。搜索结果直接注入 materialStore，MaterialsPanel 自动更新展示。

## 2. 工具定义

### 2.1 search_video

```
Tool: search_video
Description: "搜索 Pexels 视频素材库。返回匹配的视频列表并自动添加到素材库。"
Parameters:
  - query: string (required) — 搜索关键词（支持英文，中文会自动翻译）
  - count: number (optional, default: 5, max: 15) — 返回数量
  - orientation: string (optional) — "landscape" | "portrait" | "square"
  - min_duration: number (optional) — 最小时长（秒）
  - max_duration: number (optional) — 最大时长（秒）
Returns:
  - success: boolean
  - materials: Array<{ id, name, type: "video", duration, width, height, thumbnailUrl, sourceUrl, source: "pexels" }>
  - total_found: number
  - message: string
```

**实现路径**：调用现有 Next.js API route `/api/video-search`，该路由代理到后端 `${BACKEND_URL}/api/video/search`。

### 2.2 search_image

```
Tool: search_image
Description: "搜索 Unsplash 图片素材库。返回匹配的图片列表并自动添加到素材库。"
Parameters:
  - query: string (required) — 搜索关键词
  - count: number (optional, default: 5, max: 15) — 返回数量
  - orientation: string (optional) — "landscape" | "portrait" | "squarish"
  - color: string (optional) — 主色调筛选
Returns:
  - success: boolean
  - materials: Array<{ id, name, type: "image", width, height, thumbnailUrl, sourceUrl, source: "unsplash" }>
  - total_found: number
  - message: string
```

**实现路径**：调用现有 `/api/image-search`。

### 2.3 search_audio

```
Tool: search_audio
Description: "搜索 Freesound 音频素材库。返回匹配的音频列表并自动添加到素材库。"
Parameters:
  - query: string (required) — 搜索关键词
  - count: number (optional, default: 5, max: 15) — 返回数量
  - min_duration: number (optional) — 最小时长（秒）
  - max_duration: number (optional) — 最大时长（秒）
Returns:
  - success: boolean
  - materials: Array<{ id, name, type: "audio", duration, format, thumbnailUrl, sourceUrl, source: "freesound" }>
  - total_found: number
  - message: string
```

**实现路径**：调用现有 `/api/audio-search`。

## 3. 搜索结果处理流程

```
Agent 调用 search_video({ query: "ocean waves", count: 5 })
    ↓
search_video handler:
    1. 发送 fetch 请求到 /api/video-search
    2. 解析响应，将每个结果转换为 MaterialItem 格式
    3. 调用 materialStore.addMaterials(items) 注入素材面板
    4. 返回结果摘要给 Agent（含 material IDs，以便后续 add_to_track）
    ↓
MaterialsPanel 通过 Zustand subscription 自动重渲染
    ↓
Agent 可继续调用 add_to_track({ materialId: "xxx" }) 将搜索到的素材添加到时间线
```

## 4. 搜索关键词翻译

现有系统已有 `/api/translate-search-query` 接口。搜索工具的 handler 中：
- 检测 query 是否包含中文字符
- 如果是中文，先调用翻译接口将 query 翻译为英文
- 使用翻译后的英文 query 进行搜索
- 在返回结果中包含实际使用的搜索关键词

## 5. MaterialItem 映射

搜索结果需要映射为 `MaterialItem` 格式以兼容现有素材管理系统：

```
Pexels Video → MaterialItem:
  id: `pexels-video-${pexelsVideoId}`
  name: 截取 query 作为名称
  type: "video"
  url: video_files[0].link (最佳质量)
  thumbnailUrl: image (Pexels 缩略图)
  duration: duration (秒)
  width: width
  height: height
  source: "pexels"
  sourceId: pexelsVideoId
```

类似映射适用于 Unsplash 图片和 Freesound 音频。

## 6. 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/lib/video-editing-agent/tools/searchVideo.ts` | 新建 | search_video 工具实现 |
| `src/lib/video-editing-agent/tools/searchImage.ts` | 新建 | search_image 工具实现 |
| `src/lib/video-editing-agent/tools/searchAudio.ts` | 新建 | search_audio 工具实现 |
| `src/lib/video-editing-agent/registry/categories.ts` | 修改 | 注册 search_tools 类别 |

## 7. 接口契约

### search tools → materialStore
```
materialStore.addMaterials(searchResults.map(toMaterialItem))
```

### search tools → Agent
```
{ success: true, materials: [...], total_found: N, message: "Found N videos for 'ocean waves'" }
```

## 8. 边界条件

- 搜索无结果 → 返回 `{ success: true, materials: [], total_found: 0, message: "No results found" }`
- API key 未配置 → 返回 `{ success: false, message: "Video search is not configured" }`
- 网络超时 → 返回 `{ success: false, message: "Search timed out" }`，设置 15s 超时
- 重复搜索 → 不去重，允许多次搜索结果共存于素材库（用户可手动删除）
