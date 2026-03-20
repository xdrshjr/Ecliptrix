# Spec 03: 前端脚本面板模式切换

## 目标

在 AIVideoScriptTab 中增加模式切换器，根据选中模式动态显示不同的图片槽，并将模式信息正确传递给生成 Hook。

## 类型定义改动

### AIVideoScriptSegment 扩展

```pseudo
interface AIVideoScriptSegment:
    id: string
    title: string
    scriptText: string

    # 新增：生成模式
    generationMode: "description" | "keyframe"   # 默认 "description"

    # 模式A（描述生成）— 已有字段
    characterImageUrl?: string
    characterImageName?: string
    sceneImageUrl?: string
    sceneImageName?: string

    # 模式B（关键帧生成）— 新增
    firstFrameUrl?: string
    firstFrameName?: string
    lastFrameUrl?: string
    lastFrameName?: string

    # 生成状态（不变）
    generationStatus?: "idle" | "generating" | "succeeded" | "failed"
    generationProgress?: number
    arkTaskId?: string
    generatedVideoUrl?: string
    ...其余字段不变
```

## UI 改动

### 模式切换器

- 位置：每个片段卡片的标题行下方，图片槽上方
- 样式：两个并排按钮（类似 SegmentedControl）
  - 「描述生成」— 默认激活
  - 「关键帧生成」
- 使用 Tailwind 样式：激活态高亮，非激活态灰色
- 切换时触发 `onUpdateSegment` 更新 `generationMode`

### 模式A 图片槽（描述生成）

- 显示条件：`generationMode === "description"`
- 内容：**保持现有的** 角色形象 + 场景形象 两个 ImagePickerSlot
- 行为不变

### 模式B 图片槽（关键帧生成）

- 显示条件：`generationMode === "keyframe"`
- 内容：
  - **首帧图片** ImagePickerSlot — 标签带 `*必填` 标记
  - **尾帧图片** ImagePickerSlot — 标签带 `(可选)` 标记
- 复用现有 ImagePickerSlot 组件，只改 label 和字段绑定

### 切换行为

- 切换模式时**不清空**另一模式的图片数据（用户可能来回切换）
- 生成时只读取当前模式对应的图片字段

## Hook 改动

### useAIVideoScriptGeneration

```pseudo
function generateVideo(segmentId):
    segment = getSegment(segmentId)

    if segment.generationMode === "keyframe":
        validate: segment.firstFrameUrl 必须存在
        if not segment.firstFrameUrl:
            show error toast "请先上传首帧图片"
            return

        call createArkVideoTask({
            prompt: segment.scriptText,
            mode: "keyframe",
            first_frame_url: segment.firstFrameUrl,
            last_frame_url: segment.lastFrameUrl,  # 可能为 undefined
            duration: ...,
        })
    else:
        # 现有逻辑不变
        images = collect(segment.characterImageUrl, segment.sceneImageUrl)
        call createArkVideoTask({
            prompt: segment.scriptText,
            mode: "description",
            image_urls: images,
            duration: ...,
        })
```

## 组件树

```
AIVideoScriptTab
├── SegmentCard (per segment)
│   ├── TitleRow
│   ├── ModeSwitch  ← 新增
│   │   ├── Button "描述生成"
│   │   └── Button "关键帧生成"
│   ├── [mode=description] ImagePickerSlot × 2 (角色/场景)
│   ├── [mode=keyframe] ImagePickerSlot × 2 (首帧/尾帧)
│   ├── ScriptTextarea
│   ├── GenerateButton
│   └── StatusBar
```

## 影响文件

| 文件 | 改动 |
|------|------|
| `src/components/video/components/AIVideoScriptTab/AIVideoScriptTab.tsx` | 增加模式切换器 UI，条件渲染图片槽 |
| `src/components/video/hooks/useAIVideoScriptGeneration.ts` | 根据模式构建不同的 API 请求参数 |
| `src/types/index.ts` 或 AIVideoScriptTab 内定义 | 扩展 `AIVideoScriptSegment` 类型 |
| `src/lib/api/arkVideo.ts` | 请求参数增加 mode / first_frame_url / last_frame_url |

## 交互细节

- 生成按钮：模式B 且无首帧时 disabled + tooltip 提示
- 切换模式时如果正在生成中，禁止切换（或提示用户）
- 新创建的 segment 默认 `generationMode: "description"`
