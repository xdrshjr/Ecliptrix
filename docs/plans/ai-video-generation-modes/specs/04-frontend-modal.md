# Spec 04: 素材弹窗模式切换

## 目标

在 AiVideoModal 中增加模式下拉选择，根据模式动态调整表单内容，与脚本面板保持一致的交互风格。

## UI 改动

### 模式选择器

- 位置：弹窗顶部，Prompt 输入框上方
- 样式：与脚本面板一致的 SegmentedControl（两个并排按钮）
  - 「描述生成」— 默认激活
  - 「关键帧生成」
- 切换时重置图片相关字段

### 模式A 表单（描述生成）

- Prompt 文本框（已有）
- **角色形象 URL** 输入框（替代原来的单一参考图输入）
- **场景形象 URL** 输入框（新增）
- 时长选择器（已有）
- 高级选项折叠区（已有：相机固定、水印、比例、分辨率）

### 模式B 表单（关键帧生成）

- Prompt 文本框
- **首帧图片 URL** 输入框 — 带 `*必填` 标记
- **尾帧图片 URL** 输入框 — 带 `(可选)` 标记
- 时长选择器
- 高级选项折叠区
  - 比例选择器 **隐藏或禁用**（关键帧模式自动 adaptive）
  - 其余选项保留

### 图片输入方式

- 两种模式的图片输入都使用文本输入框（输入 URL）
- 与现有 AiVideoModal 风格一致（当前就是 URL 输入）
- 输入后显示图片预览缩略图
- 支持清除按钮

## 状态管理

```pseudo
interface AiVideoModalState:
    mode: "description" | "keyframe"    # 新增
    prompt: string
    duration: 5 | 10
    cameraFixed: boolean
    watermark: boolean
    aspectRatio: string
    resolution: string

    # 模式A
    characterImageUrl: string           # 替代原 referenceImageUrl
    sceneImageUrl: string               # 新增

    # 模式B
    firstFrameUrl: string               # 新增
    lastFrameUrl: string                # 新增
```

## 提交逻辑

```pseudo
function handleGenerate():
    if mode === "keyframe":
        validate: firstFrameUrl 必须存在
        if not firstFrameUrl:
            show error "请输入首帧图片URL"
            return

        call createArkVideoTask({
            prompt,
            mode: "keyframe",
            first_frame_url: firstFrameUrl,
            last_frame_url: lastFrameUrl || undefined,
            duration,
            resolution,
            camera_fixed: cameraFixed,
            watermark,
        })
    else:
        images = [characterImageUrl, sceneImageUrl].filter(Boolean)
        call createArkVideoTask({
            prompt,
            mode: "description",
            image_urls: images,
            duration,
            aspect_ratio: aspectRatio,
            resolution,
            camera_fixed: cameraFixed,
            watermark,
        })
```

## 从素材面板触发

当用户从素材面板点击图片的「用于AI视频生成」时：
- 打开弹窗，自动设为关键帧模式
- 将图片 URL 填入首帧图片字段
- 用户可以手动切换模式或添加更多信息

## 组件结构

```
AiVideoModal
├── ModalHeader "AI 视频生成"
├── ModeSwitch ← 新增（与脚本面板一致的 SegmentedControl）
├── PromptTextarea
├── [mode=description]
│   ├── CharacterImageUrlInput
│   └── SceneImageUrlInput
├── [mode=keyframe]
│   ├── FirstFrameUrlInput *必填
│   └── LastFrameUrlInput (可选)
├── DurationSelector
├── AdvancedOptions (collapsible)
│   ├── CameraFixedToggle
│   ├── WatermarkToggle
│   ├── [mode=description] AspectRatioSelector
│   └── ResolutionSelector
└── GenerateButton
```

## 影响文件

| 文件 | 改动 |
|------|------|
| `src/components/video/components/AiVideoModal/AiVideoModal.tsx` | 主要改动：模式切换、表单动态化 |
| `src/lib/api/arkVideo.ts` | 与 Spec 03 共享改动 |

## 与脚本面板的一致性

| 交互元素 | 脚本面板 | 素材弹窗 |
|----------|---------|---------|
| 模式切换器 | SegmentedControl | 相同 SegmentedControl |
| 模式A 图片槽 | 角色 + 场景 ImagePickerSlot | 角色 + 场景 URL 输入 |
| 模式B 图片槽 | 首帧 + 尾帧 ImagePickerSlot | 首帧 + 尾帧 URL 输入 |
| 模式B 首帧必填标记 | `*必填` | `*必填` |
| 模式B 尾帧可选标记 | `(可选)` | `(可选)` |
| 默认模式 | 描述生成 | 描述生成 |

唯一差异是图片输入方式：脚本面板用 ImagePickerSlot（支持从素材库选），弹窗用 URL 输入框。这是合理的，因为弹窗场景更轻量。
