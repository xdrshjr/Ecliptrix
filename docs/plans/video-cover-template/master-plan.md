# Master Plan — Video Cover Template Feature

> **Topic:** `video-cover-template`
> **Mode:** Discovery Only（仅产出规划文档，不进入开发阶段）
> **Status:** 草稿（待评审与用户确认）

## 1. Overview

为视频编辑界面新增"封面"功能，类似剪映/CapCut。用户在视频组合预览面板（`VideoPlayerPanel`）的宽高比按钮组右侧点击"封面"按钮，打开一个左右布局的弹窗：左侧选择模板并编辑文字样式，右侧实时预览，预览下方有一个"抓帧滑块"让用户从已合成的视频素材中拖拽选取作为封面背景的帧。最终用户可一键导出 PNG 封面图（独立可下载，**不**嵌入导出视频）。

封面配置（模板、文字、抽帧时刻、上传图引用等）持久化到后端的新表 `project_covers`；最近一次渲染的 PNG 也作为缓存上传到后端 `STORAGE_ROOT`，下次打开项目可秒开预览。

## 2. Goals

| 编号 | 目标 | 验收标准 |
|----|------|---------|
| G1 | 在 `VideoPlayerPanel` 信息行新增"封面"入口 | 宽高比按钮组与封面按钮同行，宽度比 80 : 20；按钮带图标 + 文字"封面" |
| G2 | 弹窗采用左右布局 | 90vw × 85vh；左 40% 模板/编辑器、右 60% 预览/抓帧 |
| G3 | 4 个内置模板（标题型/教学型/点击型/极简型） | 模板包含文字图层 + 矢量装饰；左侧网格中可点击切换 |
| G4 | 双击预览中的文字可改内容 + 字体/字号/颜色/对齐 | 双击进入编辑态；同时弹出轻量文本工具栏；失焦或 Esc 退出 |
| G5 | 右下抽帧滑块覆盖"所有视频素材首尾相连"的虚拟时间轴 | 跳过空白与纯音频段；拖动只能落在有视频画面的位置；当前帧由 `extractVideoThumbnail.ts` 实时返回 |
| G6 | 支持本地图片上传作为封面背景（替代抽帧） | "源切换"控件：抽帧 ↔ 上传；切换时清掉对方状态 |
| G7 | 一键下载 PNG 封面 | 输出分辨率匹配播放器面板当前选中宽高比的 1080p（如 1920×1080、1080×1920、1080×1080） |
| G8 | 配置 + PNG 缓存持久化到后端 | 新表 `project_covers` 存配置；PNG URL 复用 `video_projects.cover_url` 已有字段 |
| G9 | 弹窗适配项目主题（深色/浅色） | CSS 变量驱动；与现有 modal/Dialog 视觉一致 |

## 3. Non-Goals（首版不做，但架构需为其留口）

- **不嵌入导出视频**：封面只生成独立 PNG，不作为视频首帧合并到 mp4 输出（架构层面预留 `cover_render_metadata` 字段，将来若做嵌入可复用）。
- **不做** AI 生成封面背景图（已有 `AiImageModal` 但不接入第一版）。
- **不做** 拖拽/旋转文字位置（仅在文字图层的预设位置内修改样式）。
- **不做** 多封面历史 / 封面版本管理。
- **不做** 自定义宽高比；封面始终复用播放器面板当前选中的宽高比。
- **不做** 后端动态模板（4 个模板第一版前端硬编码）。
- **不做** 滤镜 / 蒙版 / 前景装饰图等额外图层。
- **不做** 模板上传 / 用户自创模板。

## 4. Scope

### 4.1 In-Scope

- 新增按钮 + 修改 `VideoPlayerPanel.tsx` 的宽高比行布局
- 新组件目录：`src/components/video/components/VideoCoverModal/`
- 新 BFF 路由：`src/app/api/video-cover/[projectId]/route.ts`、`.../png-cache/route.ts`
- 新 API 客户端：`src/lib/api/videoCover.ts`
- 后端新表 `project_covers`、Alembic 迁移、ORM/Pydantic 模型、router、service
- 复用 `extractVideoThumbnail.ts`、`storage` 上传链路、`useVideoEditingState` 持久化钩子
- i18n key 增量（中/英）
- 单元测试 + 关键交互测试（模板切换、双击编辑、抽帧、下载）

### 4.2 Out-of-Scope

见 Non-Goals。

## 5. Architecture

### 5.1 模块结构图

```
┌─────────────────────────────────────────────────────────────────────┐
│ VideoEditingInterface (page-level)                                  │
│  ├─ openCoverModal: boolean (state)                                 │
│  ├─ project { id, aspectRatio, materials, timelineItems }           │
│  └─ <VideoPlayerPanel />                                            │
│       └─ aspect-ratio-row  ──── flex                                │
│            ├─ aspect-ratio-group (flex: 4)   ◀── 80%                │
│            └─ <CoverButton /> (flex: 1)      ◀── 20%                │
│                                                                     │
│  └─ <VideoCoverModal isOpen=...>                                    │
│       ├─ Left 40%                                                   │
│       │   ├─ <TemplatePicker />                                     │
│       │   └─ <TextStyleToolbar />  (active when text selected)      │
│       └─ Right 60%                                                  │
│           ├─ <CoverPreview /> (上方, 自适应宽高比)                   │
│           │   └─ <EditableTextLayer /> (双击编辑)                    │
│           └─ <FrameScrubber /> (下方)                                │
│               ├─ source toggle: 抽帧 / 上传                          │
│               └─ <ImageUploadInput /> (alt mode)                    │
│                                                                     │
│  Hooks                                                              │
│   ├─ useFrameExtraction     ─── 包装 extractVideoThumbnail.ts       │
│   ├─ useCoverRender         ─── DOM → canvas → PNG (1080p)          │
│   └─ useCoverPersistence    ─── BFF GET/PUT 配置；POST PNG 缓存      │
└─────────────────────────────────────────────────────────────────────┘
                            │ (HTTP)
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Next.js API Routes (BFF)                                            │
│  /api/video-cover/[projectId]                                       │
│    GET  → 取配置                                                     │
│    PUT  → 保存配置                                                   │
│  /api/video-cover/[projectId]/png-cache                             │
│    POST → 上传 PNG（multipart），写回 video_projects.cover_url       │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ FastAPI Backend                                                     │
│  app/routers/video_cover.py                                         │
│  app/services/video_cover_service.py                                │
│  app/models/db_models.py: ProjectCover (new)                        │
│  alembic/versions/<timestamp>_add_project_covers.py                 │
│                                                                     │
│  Storage: STORAGE_ROOT/static/uploads/projects/<id>/cover.png       │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 数据流（关键路径）

**A. 打开弹窗**
```
1. 用户点击"封面"按钮
2. VideoEditingInterface.setOpenCoverModal(true)
3. VideoCoverModal mounts:
   - useCoverPersistence.load(projectId)  → GET /api/video-cover/<id>
   - 若返回配置 → 还原 templateId / texts / frameTime / uploadedImageRef
   - 若无 → applyDefault: 模板 1 + frameTime=0
4. CoverPreview 触发首次渲染
   - useFrameExtraction.extract(virtualTime=0) → JPEG dataURL
```

**B. 抽帧**
```
1. 用户拖动 FrameScrubber
2. mapVirtualTimeToClip(virtualTime, materials) → { clipMaterial, clipLocalTime }
3. extractVideoFrameAt(clipMaterial.url, clipLocalTime) → JPEG dataURL
   （新增的扩展函数，参考现有 `extractVideoThumbnail.ts` 实现，
   接受目标 currentTime 参数。原 `extractVideoThumbnail()` 仅支持
   固定时间点，无法满足抽帧需求，需新增 `extractVideoFrameAt(url, time)`。）
4. CoverPreview 切换背景 layer
5. （拖动结束 200ms debounce）useCoverPersistence.save(...)
```

**C. 切换/编辑模板**
```
1. 点击模板缩略图 → applyTemplate(templateId)
   - 重置 textLayers 为模板默认值（保留用户上次输入的文字内容？见 5.5 决策）
2. 双击文字 → setEditingLayerId(id)
   - 弹出 TextStyleToolbar
3. Enter / blur / Esc → 提交编辑
4. debounce 后 save 到后端
```

**D. 下载封面**
```
1. 用户点击"下载封面"
2. useCoverRender.toPng(aspectRatio) → 1080p PNG Blob
3. 浏览器 createObjectURL + <a download>
4. 同时上传到后端缓存：
   POST /api/video-cover/<id>/png-cache (multipart)
   → 后端写文件、回写 video_projects.cover_url
```

### 5.3 抽帧的虚拟时间轴

> 解决"所有视频素材首尾相连，跳过空档与纯音频段"。

`mapVirtualTimeToClip` 算法（伪代码）：

```
function buildVirtualSegments(timelineItems):
    # 仅保留有"画面"的素材：mediaType in {'video','image'}（image 也可作为封面背景候选；
    # 第一版可仅取 'video'，详见 spec 04 决策）；过滤掉纯音频与 audio-only 轨。
    videoItems = filter timelineItems where mediaType == 'video'
    sort by startTime
    cumulative = 0
    segments = []
    for item in videoItems:
        duration = item.endTime - item.startTime   # 时间轴上的"显示时长"
        segments.push({
            virtualStart: cumulative,
            virtualEnd: cumulative + duration,
            material: item.material,
            clipOffset: item.materialStart   # 该 clip 在源素材内部的起始时间
        })
        cumulative += duration
    return { segments, totalVirtualDuration: cumulative }

function mapVirtualTimeToClip(virtualTime, segments):
    seg = segments.find s where s.virtualStart <= virtualTime < s.virtualEnd
    if !seg: return null  # 滑块限定不会越界
    localTime = (virtualTime - seg.virtualStart) + seg.clipOffset
    return { material: seg.material, localTime }
```

抽帧滑块的 `max` 即 `totalVirtualDuration`；空档（无视频素材的时段）和纯音频轨完全不参与。

### 5.4 渲染管线（DOM → PNG）

| 阶段 | 实现 | 备注 |
|----|------|-----|
| 预览 | React DOM（绝对定位的图片层 + 文字层 + SVG 装饰） | 双击编辑直接走 contenteditable |
| 导出 | `html-to-image` (推荐) 或自研 canvas 绘制 | `html-to-image` 体积小（~9 KB），与项目已有 React 体系兼容；不引入 puppeteer |
| 分辨率 | 1080 短边按宽高比换算 | 16:9 → 1920×1080；9:16 → 1080×1920；1:1 → 1080×1080；4:3 → 1440×1080；21:9 → 2520×1080 |
| 字体 | 仅使用 web-safe + 项目已加载字体 | 自定义字体需在 `<head>` 预加载，否则 PNG 字体回退 |

### 5.5 关键设计决策

| ID | 决策 | 理由 |
|----|------|------|
| D1 | 封面只导出 PNG，不嵌入视频 | 范围 #1 答；后端零集成 |
| D2 | 在 `extractVideoThumbnail.ts` 中新增可指定时间的 `extractVideoFrameAt(url, time)` 函数；复用其 `proxiedVideoUrl()` 跨域代理 | 已有的 `extractVideoThumbnail()` seek 时间硬编码、且画布缩放到 320 宽，不能直接用于全分辨率抽帧；新增同模块函数最小侵入 |
| D3 | 4 个模板前端硬编码 | 减少首版后端开销；后续可移到后端 |
| D4 | 模板含矢量装饰（SVG/CSS）而非位图 | 任意分辨率清晰；可主题化色彩 |
| D5 | 新表 `project_covers` 而非扩展 `video_projects` | 后续多封面/历史/版本扩展不会让主表臃肿 |
| D6 | PNG URL 复用 `video_projects.cover_url` 已有字段 | 该列已存在（行 188），项目卡片可直接显示 |
| D7 | 抽帧用"虚拟时间轴" | 用户体感更自然，避免空档拖到黑屏 |
| D8 | 切换模板时**保留用户已输入的文字内容**，仅替换字体/位置/装饰 | 参考剪映行为；避免误清除工作 |
| D9 | 上传图与抽帧互斥，切换时清空对方 | 简化数据模型；避免歧义 |
| D10 | 主题用项目现有 CSS 变量；不写硬编码色 | 与全站一致；维护成本低 |
| D11 | 双击编辑用 contenteditable + 受控 React state | 比独立富文本编辑器轻；样式由文字工具栏受控 |
| D12 | 保存采用 debounce（默认 600 ms） | 减少后端 PUT 压力；与现有 `useTimelineState` 一致 |

## 6. Data Models

### 6.1 后端 ORM（新增）

```python
# app/models/db_models.py
class ProjectCover(Base):
    __tablename__ = "project_covers"

    id = Column(UUID, primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID, ForeignKey("video_projects.id", ondelete="CASCADE"),
                        unique=True, nullable=False, index=True)
    user_id = Column(String(36), nullable=False, index=True)
    template_id = Column(String(50), nullable=False)            # 'title' | 'tutorial' | 'click' | 'minimal'
    cover_config = Column(JSON, nullable=False)                  # 见 6.3
    image_source = Column(String(20), nullable=False)            # 'frame' | 'upload'
    frame_virtual_time_ms = Column(Integer, nullable=True)       # image_source == 'frame'
    uploaded_image_url = Column(String(1000), nullable=True)     # image_source == 'upload'
    aspect_ratio = Column(String(20), nullable=False)            # '16:9' | '9:16' | etc.
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now())

    __table_args__ = (
        Index("ix_project_covers_user_updated", "user_id", "updated_at"),
    )
```

### 6.2 复用字段

`video_projects.cover_url`（已存在）保存最近一次渲染的 PNG 的 URL。

### 6.3 `cover_config` JSON Schema

```jsonc
{
  "version": 1,
  "textLayers": [
    {
      "key": "title",          // 模板内置 key, 不可改
      "text": "我的视频标题",   // 用户编辑
      "fontFamily": "Inter",
      "fontSize": 72,           // 基于 1080p 画布的像素值
      "color": "#ffffff",
      "fontWeight": 700,
      "italic": false,
      "underline": false,
      "align": "center"        // 'left' | 'center' | 'right'
    },
    { "key": "subtitle", "text": "副标题…", … }
  ],
  "decorations": [               // 模板自带，用户不可改色（首版）
    { "type": "rect", "x": 0.05, "y": 0.85, "w": 0.3, "h": 0.04, "fill": "#ff5500" }
  ]
}
```

> 坐标采用归一化（0-1）。

### 6.4 前端类型

```ts
// src/components/video/components/VideoCoverModal/types.ts
export type CoverTemplateId = 'title' | 'tutorial' | 'click' | 'minimal';
export type ImageSource = 'frame' | 'upload';
export type CoverAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '21:9';

export interface CoverTextLayer {
  key: string;
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
}

export interface CoverDecoration {
  type: 'rect' | 'line' | 'badge';
  x: number; y: number; w: number; h: number;
  fill?: string;
  stroke?: string;
}

export interface CoverConfig {
  version: 1;
  textLayers: CoverTextLayer[];
  decorations: CoverDecoration[];
}

export interface CoverState {
  templateId: CoverTemplateId;
  config: CoverConfig;
  imageSource: ImageSource;
  frameVirtualTimeMs: number | null;
  uploadedImageUrl: string | null;
  aspectRatio: CoverAspectRatio;
}

export interface CoverTemplateDefinition {
  id: CoverTemplateId;
  label: string;          // i18n key
  thumbnail: string;      // SVG 字符串或图标
  defaultConfig: CoverConfig;
}
```

## 7. API Surface

### 7.1 BFF（Next.js）

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/api/video-cover/[projectId]` | 读取封面配置 |
| PUT | `/api/video-cover/[projectId]` | 保存封面配置 |
| POST | `/api/video-cover/[projectId]/png-cache` | 上传 PNG 缓存（multipart） |

每条都是后端代理（读 `BACKEND_URL`），与项目现有约定一致。

### 7.2 后端（FastAPI）

| Method | Path | Body / Response |
|--------|------|----------------|
| GET | `/api/video-cover/{project_id}` | → `CoverState \| null` |
| PUT | `/api/video-cover/{project_id}` | `CoverState` → `CoverState` |
| POST | `/api/video-cover/{project_id}/png-cache` | `multipart: file` → `{ url }`，并写回 `video_projects.cover_url` |
| DELETE | `/api/video-cover/{project_id}` | 清除配置（可选；若不做就先不暴露） |

权限：所有路由要求登录用户拥有该 project（沿用 `video_project_router.py` 的鉴权方式）。

## 8. UI / UX 细则

### 8.1 按钮位置（aspect-ratio-row 改造）

当前布局（`VideoPlayerPanel.tsx:2300-2342`）：

```
<div class="video-info-panel">
  <div class="aspect-ratio-row">
    <div class="aspect-ratio-group"> 宽高比 [16:9] [9:16] ... </div>
  </div>
</div>
```

改造后：

```
<div class="video-info-panel">
  <div class="aspect-ratio-row">
    <div class="aspect-ratio-group" style="flex: 4">  ◀── 80%
      宽高比 [16:9] [9:16] ...
    </div>
    <CoverButton style="flex: 1" />                   ◀── 20%
  </div>
</div>
```

`CoverButton` 视觉与 `aspect-ratio-btn` 风格一致（同一边距、字号）；图标使用 `lucide-react` 的 `Image` 或 `Frame` 图标 + 文字"封面" / "Cover"。

### 8.2 弹窗结构

```
┌─ Modal: 90vw × 85vh ─────────────────────────────────────┐
│ Header: 标题 "封面设置" / 关闭按钮                       │
├──────────────────────────┬────────────────────────────────┤
│ Left 40%                 │ Right 60%                     │
│                          │                                │
│ 模板 (2x2 grid)           │ Preview (aspect-ratio applied) │
│  ┌──┐ ┌──┐               │ ┌──────────────────────┐       │
│  │  │ │  │               │ │  [背景帧/上传图]      │       │
│  └──┘ └──┘               │ │  [文字图层 双击]      │       │
│  ┌──┐ ┌──┐               │ │  [装饰图层]           │       │
│  │  │ │  │               │ └──────────────────────┘       │
│  └──┘ └──┘               │                                │
│                          │ Source: ◉ 抽帧  ○ 上传         │
│ TextStyleToolbar         │                                │
│  字体 [▾] 字号 [─●─]     │ FrameScrubber:                │
│  色彩 ■ 对齐 ◀●▶ B I U   │ [────●────────────] 03:24     │
│                          │                                │
│ Footer: [取消] [下载封面]                                  │
└──────────────────────────┴────────────────────────────────┘
```

### 8.3 关键交互

| 交互 | 行为 |
|----|------|
| 单击模板缩略图 | 切换 `templateId`；保留用户已输入的文字内容（按 `key` 映射）；其他样式重置为新模板默认 |
| 双击预览中的文字 | 进入 contenteditable；TextStyleToolbar 高亮，绑定该图层 |
| Esc / 失焦 | 提交编辑；退出 contenteditable |
| 拖动 FrameScrubber | 抽帧 200ms debounce；松开后立刻发后端持久化 |
| 切换源（抽帧 → 上传） | 清空 `frameVirtualTimeMs`；显示上传输入区 |
| 切换源（上传 → 抽帧） | 清空 `uploadedImageUrl`；恢复滑块 |
| 关闭弹窗 | 若有未保存改动，flush 一次后端 PUT |
| "下载封面" | 1080p PNG 下载 + 后台上传缓存 |

### 8.4 主题适配

- 弹窗背景、文字、控件颜色均通过现有 CSS 变量（如 `--background`, `--foreground`, `--border`）。
- 模板预览背景**始终**为最终的封面颜色（不受主题影响）；预览容器用浅色 checker 棋盘表示透明区，无论主题如何。
- 文本工具栏样式与现有 shadcn/ui Dialog 风格一致。

### 8.5 i18n

新增 key（中/英），位置：`src/lib/i18n.ts`：

```
videoCoverModal: {
  title, button, templates: { title, tutorial, click, minimal },
  source: { frame, upload }, scrubber: { tooltip, atTime },
  textTools: { font, size, color, align, bold, italic, underline },
  actions: { cancel, download }, errors: { extractFailed, saveFailed, uploadFailed }
}
```

## 9. Dependencies

### 9.1 已有可复用

- `src/components/video/utils/extractVideoThumbnail.ts` — 客户端抽帧（**当前签名仅 `(videoUrl)`，固定 seek 到 0 或 1 秒；本功能需在同文件中新增 `extractVideoFrameAt(videoUrl, timeSec, opts?)` 重载**，复用其中的 `proxiedVideoUrl()` 跨域代理逻辑、video/canvas 流水线，但允许传入任意 currentTime 并返回**全分辨率**帧（取消 320 缩放上限）；返回值统一为 JPEG dataURL）
- `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` — 宿主组件
- `src/lib/i18n.ts` — 国际化注册中心
- `src/components/ui/ConfirmationDialog.tsx` 等现有 UI 组件 — 参考其样式约定。**注意**：项目目前没有通用的 shadcn `dialog.tsx`，需要为本功能在 `VideoCoverModal/` 目录内自建一个简单的 modal 容器（参考 `ConfirmationDialog.tsx` 的实现模式：fixed overlay + 居中卡片 + Esc 关闭 + 点击遮罩关闭），与项目现有 modal 视觉一致即可
- `BACKEND_URL` 环境变量 + Next.js BFF 模式
- 后端 `STORAGE_ROOT`、`/api/storage/files` 静态挂载
- `video_projects.cover_url`（已有列）

### 9.2 新增第三方包

| 包 | 用途 | 体积 | 备选 |
|---|------|------|-----|
| `html-to-image` | DOM → PNG 渲染 | ~9 KB gz | 自研 canvas（成本更高） |

不引入 puppeteer 或后端渲染管线（首版 PNG 全在浏览器生成）。

## 10. Risks & Mitigations

| Risk | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 跨域视频 URL 抽帧时 canvas tainted，无法导出 PNG | 低 | 高 | 现有 `extractVideoThumbnail.ts` 已通过 `/api/video-proxy?url=...` 同源代理处理跨域视频，本功能复用同一代理路径即可；若代理失败则降级提示用户改用"上传图片" |
| `html-to-image` 在某些字体或外联图片上渲染失败 | 中 | 高 | 字体白名单（仅项目已加载字体）；上传的封面图先 fetch + dataURL 内联；写降级路径（返回截屏失败提示） |
| 抽帧时间长导致拖动卡顿 | 中 | 中 | 200ms debounce + 缓存最近 N 帧（LRU）；显示骨架占位 |
| 项目无视频素材时抽帧滑块不可用 | 高 | 低 | 检测 `videoItems.length===0` 时锁定滑块 + 自动切到"上传"模式 |
| 1080p 渲染在低端机内存吃紧 | 低 | 中 | 限制单次渲染并发；导出失败时降级 720p 重试一次 |
| 模板新增/编辑期间用户配置失效（schema 漂移） | 中 | 中 | `cover_config.version` 字段；服务端读取时按 version 兼容；目前只有 v1 |
| 主题切换瞬间文字工具栏闪烁 | 低 | 低 | 弹窗内 CSS 用变量；无 inline style 硬编码 |
| 后端新表迁移与生产数据冲突 | 低 | 高 | Alembic up/down 都要实现；先在生产做 dry-run；migration 单独 commit |
| 上传 PNG 缓存与项目并发保存竞态 | 中 | 低 | 后端使用 `INSERT ... ON CONFLICT (project_id) DO UPDATE`（即 upsert）；前端串行化保存请求 |
| 复用 `video_projects.cover_url` 与项目卡片冲突 | 低 | 中 | 验证当前项目卡片有没有占用此字段；若有则定语义优先级（用户手动设置 > 自动缓存） |

## 11. Spec Roadmap

下一阶段（Phase 2.3）将拆分为以下 spec 文件（数量稍后用户确认；以下是建议）：

- `01-button-and-modal-shell.md` — 按钮注入、弹窗容器、布局栅格、主题
- `02-template-system.md` — 4 个模板的数据模型、缩略图、默认配置、模板切换语义
- `03-preview-and-text-editing.md` — 预览渲染、双击编辑、文字工具栏
- `04-frame-scrubber-and-upload.md` — 虚拟时间轴、抽帧 hook、上传源、源切换
- `05-cover-render-and-download.md` — `html-to-image` 集成、分辨率换算、下载
- `06-backend-cover-persistence.md` — `project_covers` 表、router、service、Alembic
- `07-frontend-persistence-and-bff.md` — Next.js 路由、API client、useCoverPersistence、debounce 保存

每个 spec 内部含其专属的依赖说明、接口契约、伪代码、测试要点。

## 12. Open Questions

下列问题可在 spec 阶段或开发阶段再敲定，不影响主计划：

1. **i18n** 上线时是否需要同时支持英、日、其他语言？默认中英双语。
2. **下载文件名** 格式：`{projectName}-cover.png` 还是 `cover-{projectId}-{timestamp}.png`？
3. **下载时的版权水印** 是否需要？默认无。
4. **模板缩略图** 是 SVG 字符串内联还是预渲染 PNG？倾向 SVG。
5. **极小屏（<1280px）** 是否需要更紧凑布局？默认按比例缩放。
6. **测试覆盖率门槛** 是否新增项目级要求？默认沿用现状。

---

## Table of Contents → Spec Files

| File | 章节 | 状态 |
|------|------|------|
| `master-plan.md` | 总体方案（本文件） | 草稿 |
| `specs/01-button-and-modal-shell.md` | 按钮 & 弹窗壳 | 待写 |
| `specs/02-template-system.md` | 模板数据/切换 | 待写 |
| `specs/03-preview-and-text-editing.md` | 预览 & 双击编辑 | 待写 |
| `specs/04-frame-scrubber-and-upload.md` | 抽帧 & 上传 | 待写 |
| `specs/05-cover-render-and-download.md` | 渲染管线 & PNG 下载 | 待写 |
| `specs/06-backend-cover-persistence.md` | 后端表/Router/迁移 | 待写 |
| `specs/07-frontend-persistence-and-bff.md` | BFF 路由 & API client | 待写 |
| `task-orchestration.md` | 依赖图 / 执行阶段 | 待写 |
