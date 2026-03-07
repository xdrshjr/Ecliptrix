# 03 - 视频编辑界面改造

## 概述

视频编辑是 Ecliptrix 最大的功能模块，涉及 30+ 组件文件，约 612 处硬编码颜色。改造策略：逐文件替换硬编码颜色为语义化 Tailwind 类名和 CSS 变量，同时更新 `video-editing.css` 中的自定义样式。

## 涉及文件

### 核心布局文件
| 文件 | 硬编码颜色数 |
|------|-------------|
| `src/styles/video-editing.css` | 大量（独立 CSS 文件） |
| `src/components/video/VideoEditingInterface.tsx` | 5 |
| `src/components/video/ScriptPanel.tsx` | 36 |

### Timeline 组件
| 文件 | 硬编码颜色数 |
|------|-------------|
| `timeline/TimelinePanel.tsx` | 1 |
| `timeline/TimelineItem.tsx` | 13 |
| `timeline/TimelineRuler.tsx` | 16 |
| `timeline/TimelineToolbar.tsx` | 8 |
| `timeline/Track.tsx` | 20 |
| `timeline/TrackContainer.tsx` | 17 |
| `timeline/VolumeSlider.tsx` | 5 |
| `timeline/SentenceSegmentBar.tsx` | 5 |

### 功能面板和 Modal
| 文件 | 硬编码颜色数 |
|------|-------------|
| `components/MaterialsPanel/MaterialsPanel.tsx` | 66 |
| `components/ConvertToScriptModal/ConvertToScriptModal.tsx` | 54 |
| `components/AiVideoModal/AiVideoModal.tsx` | 46 |
| `components/SubtitleEditModal/SubtitleEditModal.tsx` | 46 |
| `components/AudioSearchModal/AudioSearchModal.tsx` | 39 |
| `components/ContentPolishModal/ContentPolishModal.tsx` | 35 |
| `components/MyMaterialsModal/MyMaterialsModal.tsx` | 31 |
| `components/ImageSearchModal/ImageSearchModal.tsx` | 30 |
| `components/AiImageModal/AiImageModal.tsx` | 26 |
| `components/AIMixingModeSelectionModal/AIMixingModeSelectionModal.tsx` | 25 |
| `components/BatchAnalysisModeSelectionModal/BatchAnalysisModeSelectionModal.tsx` | 25 |
| `components/AIVideoScriptTab/AIVideoScriptTab.tsx` | 15 |
| `components/AIVideoScriptTab/ImagePickerSlot.tsx` | 12 |
| `components/MediaPreviewModal/MediaPreviewModal.tsx` | 11 |
| `components/AIMixingProgressModal/AIMixingProgressModal.tsx` | 6 |
| `components/AudioSearchModal/AudioPlayer.tsx` | 6 |
| `components/CreativeBrainstormingModal/CreativeBrainstormingModal.tsx` | 5 |
| `components/AIAssistantPanel/AIAssistantPanel.tsx` | 4 |
| `components/DocumentPanel/DocumentPanel.tsx` | 1 |
| `components/VideoCacheIndicator.tsx` | 3 |

## 详细设计

### 1. video-editing.css 改造

`video-editing.css` 包含大量布局和视觉样式。改造原则：

**布局类（保留不变）：**
- `.video-editing-left-sidebar` 的 width/height/flex
- `.video-editing-right-area` 的 width/height/flex
- `.video-editing-upper-panels` 的 height 百分比
- `.video-editing-timeline-section` 的 height 百分比
- 各面板的 width 百分比

**视觉类（需改造）：**

```pseudo
硬编码颜色替换:
  #ffffff → var(--card)
  #f8fafc → var(--muted)
  #e5e7eb → var(--border)
  #f1f5f9 → var(--muted)
  #f3f4f6 → var(--accent)
  #374151 → var(--foreground)
  #6b7280 → var(--muted-foreground)
  #111827 → var(--foreground)
  #3b82f6 → var(--primary)
  #2563eb → var(--primary) with hover state
  #ef4444 → var(--destructive)
  #10b981 → 保留（功能性成功色）
  rgba(0,0,0,...) 低透明度 → var(--border) 或 var(--accent)

去除的视觉效果:
  .script-segment hover 的 translateY(-1px) → 改为仅背景色变化
  .script-sentence hover 的 #f8fafc → var(--accent)

面板头部统一:
  .markdown-panel-header: background-color → var(--card), border-bottom → var(--border)
  .script-panel-header: 同上
```

### 2. 面板组件通用改造模式

所有面板组件（DocumentPanel、MaterialsPanel、AIAssistantPanel 等）遵循统一模式：

```pseudo
面板容器:
  背景: bg-card
  边框: border-r border-border 或 border-l border-border（取决于位置）

面板头部:
  背景: bg-card（与面板一致，用 border-b 分割）
  文字: text-foreground (标题), text-muted-foreground (副标题)
  高度: 保持不变
  下边框: border-b border-border

操作按钮:
  图标: text-muted-foreground hover:text-foreground
  背景: hover:bg-accent
  圆角: rounded-md (6px)

标签页（Tab）:
  未选中: text-muted-foreground hover:text-foreground
  选中: text-primary border-b-2 border-primary
  背景: 无
```

### 3. Modal 通用改造模式

所有 Modal 组件遵循统一模式：

```pseudo
遮罩层:
  背景: bg-black/60

弹窗容器:
  背景: bg-card
  边框: border border-border
  圆角: rounded-md (6px)
  阴影: shadow-lg（全局已重定义为极轻）
  去除: backdrop-filter

Modal 头部:
  标题: text-foreground font-semibold text-sm
  关闭按钮: text-muted-foreground hover:text-foreground hover:bg-accent rounded-md
  下边框: border-b border-border

Modal 内容区:
  文字: text-foreground (主), text-muted-foreground (辅)
  背景: bg-card
  内边距: p-3（紧凑）

Modal 底部（如有）:
  上边框: border-t border-border
  按钮对齐: flex justify-end gap-2
  主按钮: bg-primary text-primary-foreground
  取消按钮: bg-secondary text-secondary-foreground
```

### 4. Timeline 组件改造

Timeline 区域当前使用较多硬编码颜色和自定义渐变。

```pseudo
Timeline 容器:
  背景: bg-muted
  上边框: border-t border-border

时间标尺 (TimelineRuler):
  背景: bg-card
  刻度线: stroke: var(--border)
  文字: fill: var(--muted-foreground), font-size: 11px
  播放头: fill: var(--primary)

轨道 (Track):
  背景: bg-card
  hover: bg-accent
  选中: border-l-2 border-primary
  分割线: border-b border-border

轨道项 (TimelineItem):
  背景: bg-secondary
  选中: ring-1 ring-primary
  文字: text-foreground text-xs
  缩略图区域: bg-muted

轨道容器 (TrackContainer):
  背景: bg-card
  分割线: border-border

工具栏 (TimelineToolbar):
  背景: bg-card
  边框: border-b border-border
  按钮: text-muted-foreground hover:text-foreground hover:bg-accent
  活跃按钮: text-primary bg-primary/10

音量滑块 (VolumeSlider):
  轨道: bg-muted
  滑块: bg-primary
  文字: text-muted-foreground text-xs
```

### 5. 搜索/浏览类 Modal 特殊处理

VideoSearchModal、AudioSearchModal、ImageSearchModal 共享类似的搜索+网格布局：

```pseudo
搜索输入框:
  bg-input border border-border text-foreground
  placeholder: text-muted-foreground
  focus: border-primary ring-1 ring-primary

结果网格:
  卡片背景: bg-muted
  hover: bg-accent
  圆角: rounded-md

分页/加载更多:
  按钮: text-primary hover:bg-primary/10

空状态:
  图标: text-muted-foreground
  文字: text-muted-foreground
```

### 6. ScriptPanel 改造

ScriptPanel 有 36 处硬编码颜色，是核心编辑面板：

```pseudo
脚本段落:
  背景: bg-card
  hover: bg-accent（不用 translateY）
  边框: border border-border rounded-md
  选中: border-primary bg-primary/5

句子行:
  背景: 透明
  hover: bg-accent
  文字: text-foreground
  时长标注: text-muted-foreground text-xs

TTS 状态指示:
  待生成: text-muted-foreground
  生成中: text-primary (动画)
  已完成: text-green-500 (保留功能色)
  失败: text-destructive

操作按钮栏:
  图标: text-muted-foreground hover:text-foreground
  工具提示: bg-popover text-popover-foreground border border-border
```

## 改造策略

### 执行顺序

1. **先改 video-editing.css** — 替换所有硬编码颜色为 CSS 变量
2. **再改面板组件** — DocumentPanel → MaterialsPanel → AIAssistantPanel → VideoPlayerPanel
3. **改 ScriptPanel** — 核心编辑面板
4. **改 Timeline 组件** — 按 TrackContainer → Track → TimelineItem → TimelineRuler → TimelineToolbar 顺序
5. **最后改 Modal** — 按硬编码数量从多到少

### 搜索替换规则

全局搜索以下模式并替换：

| 搜索模式 | 替换 |
|---------|------|
| `bg-white` | `bg-card` |
| `bg-gray-50` | `bg-muted` |
| `bg-gray-100` | `bg-muted` |
| `bg-gray-200` | `bg-accent` |
| `bg-gray-800` | `bg-card`（深色场景）|
| `bg-gray-900` | `bg-background` |
| `text-gray-900` | `text-foreground` |
| `text-gray-800` | `text-foreground` |
| `text-gray-700` | `text-foreground` |
| `text-gray-600` | `text-muted-foreground` |
| `text-gray-500` | `text-muted-foreground` |
| `text-gray-400` | `text-muted-foreground` |
| `text-gray-300` | `text-muted-foreground` |
| `border-gray-200` | `border-border` |
| `border-gray-300` | `border-border` |
| `border-gray-100` | `border-border` |
| `hover:bg-gray-50` | `hover:bg-accent` |
| `hover:bg-gray-100` | `hover:bg-accent` |
| `hover:bg-gray-200` | `hover:bg-accent` |
| `text-blue-500` | `text-primary` |
| `text-blue-600` | `text-primary` |
| `bg-blue-500` | `bg-primary` |
| `bg-blue-600` | `bg-primary` |
| `bg-blue-50` | `bg-primary/10` |
| `hover:bg-blue-600` | `hover:bg-primary/90` |
| `hover:bg-blue-700` | `hover:bg-primary/80` |
| `text-red-500` | `text-destructive` |
| `text-red-600` | `text-destructive` |
| `bg-red-50` | `bg-destructive/10` |
| `shadow-sm` | 移除 |
| `shadow-md` | 移除（除弹出层外） |
| `shadow-lg` | 保留（已全局重定义） |
| `backdrop-blur` 相关 | 移除 |
| `rounded-lg` | `rounded-md` |
| `rounded-xl` | `rounded-md` |
| `rounded-2xl` | `rounded-md` |

## 注意事项

- **功能色保留**：绿色（成功）、黄色（警告）、红色（错误）这类功能反馈色保留不变
- **渐变保留**：时间轴中的音频波形渐变等功能性渐变保留
- **视频播放器区域**：播放器容器背景用 `bg-black` 或 `bg-muted`，取决于是否有视频加载
- **Markdown 编辑器**：第三方 MD 编辑器组件内部样式需通过 CSS 覆写处理
- **拖拽相关**：DnD 相关的视觉反馈（拖拽高亮等）改为 `border-primary bg-primary/5`
