# Spec 07: 分镜工具 (Storyboard Tools)

## 1. 概述

为 Agent 添加分镜相关工具：`generate_storyboard`（AI 分镜生成）、`describe_storyboard`（为分镜生成描述）、`batch_storyboard_video`（分镜批量生成视频）、`compose_storyboard`（分镜组合为最终视频）。Agent 作为分镜面板控制器。

## 2. 工具定义

### 2.1 generate_storyboard

```
Tool: generate_storyboard
Description: "根据脚本或主题描述生成 AI 分镜。每个分镜包含场景描述、镜头指示、时长建议。结果直接显示在分镜面板。"
Parameters:
  - script: string (optional) — 视频脚本文本（不提供则使用脚本面板当前内容）
  - topic: string (optional) — 主题描述（当没有脚本时使用）
  - scene_count: number (optional) — 期望分镜数量
  - aspect_ratio: string (optional, default: "16:9") — "16:9" | "9:16" | "1:1"
Returns:
  - success: boolean
  - storyboard: { id, scenes: Array<{ scene_id, description, camera, duration, keywords }> }
  - message: string
```

**实现路径**：调用 `/api/storyboard/generate`。

### 2.2 describe_storyboard

```
Tool: describe_storyboard
Description: "为已有分镜的每个场景生成详细的图像/视频描述（用于 AI 图像或视频生成的 prompt）。"
Parameters:
  - storyboard_id: string (required) — 分镜 ID
  - style: string (optional) — 视觉风格描述
Returns:
  - success: boolean
  - descriptions: Array<{ scene_id, prompt: string }>
  - message: string
```

**实现路径**：调用 `/api/storyboard/describe`。

### 2.3 batch_storyboard_video

```
Tool: batch_storyboard_video
Description: "为分镜的每个场景批量生成 AI 视频。这是一个耗时操作，完成后视频自动添加到素材库。"
Parameters:
  - storyboard_id: string (required) — 分镜 ID
  - model: string (optional) — AI 视频模型
Returns:
  - success: boolean
  - taskId: string — 异步任务 ID
  - total_scenes: number
  - message: string — "分镜批量视频生成已启动，共 N 个场景"
```

**实现路径**：调用 `/api/storyboard/batch-video`。

### 2.4 compose_storyboard

```
Tool: compose_storyboard
Description: "将分镜的所有视频片段按顺序组合到时间线上，自动排列。"
Parameters:
  - storyboard_id: string (required) — 分镜 ID
  - include_transitions: boolean (optional, default: false) — 是否添加转场
Returns:
  - success: boolean
  - clips_added: number — 添加到时间线的片段数
  - total_duration: number — 组合后总时长
  - message: string
```

**实现路径**：调用 `/api/storyboard/compose` 或在前端通过多次 `add_to_track` 实现。

## 3. 分镜面板集成

```
generate_storyboard handler:
    1. storyboardStore.setStoryboards([])  // 清空
    2. POST /api/storyboard/generate { script, scene_count, aspect_ratio }
    3. 解析响应中的分镜数据
    4. storyboardStore.setStoryboards(scenes)
    5. storyboardStore.setActiveStoryboard(storyboard.id)
    6. 返回摘要给 Agent

batch_storyboard_video handler:
    1. POST /api/storyboard/batch-video { storyboard_id, model }
    2. asyncTaskStore.addTask({ taskId, type: "storyboard_video", metadata: { storyboard_id } })
    3. 返回 taskId
    ↓
    前端轮询完成后:
    - 每个场景的视频 → materialStore.addMaterial()
    - storyboardStore.updateStoryboard(scene_id, { videoUrl, videoMaterialId })
```

## 4. 分镜与脚本工具链

典型工作流（Agent 自动编排）：

```
用户: "帮我做一个关于太空探索的30秒短视频"
Agent:
  1. explore_tools({ category: "script_tools" })
  2. generate_video_script({ topic: "太空探索", duration_target: 30 })
  3. explore_tools({ category: "storyboard_tools" })
  4. generate_storyboard({ script: <from scriptStore> })
  5. describe_storyboard({ storyboard_id: "sb-001" })
  6. batch_storyboard_video({ storyboard_id: "sb-001" })
  7. [等待异步完成]
  8. compose_storyboard({ storyboard_id: "sb-001" })
  9. explore_tools({ category: "tts_tools" })
  10. batch_generate_tts({ segments: <from script> })
  11. [为每段TTS add_to_track]
```

## 5. 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/lib/video-editing-agent/tools/generateStoryboard.ts` | 新建 | 分镜生成工具 |
| `src/lib/video-editing-agent/tools/describeStoryboard.ts` | 新建 | 分镜描述工具 |
| `src/lib/video-editing-agent/tools/batchStoryboardVideo.ts` | 新建 | 分镜批量视频工具 |
| `src/lib/video-editing-agent/tools/composeStoryboard.ts` | 新建 | 分镜组合工具 |
| `src/lib/video-editing-agent/registry/categories.ts` | 修改 | 注册 storyboard_tools 类别 |

## 6. 接口契约

### Tool handler → storyboardStore
```
storyboardStore.setStoryboards(scenes)
storyboardStore.updateStoryboard(sceneId, { videoUrl, videoMaterialId })
```

### Tool handler → asyncTaskStore (batch_storyboard_video)
```
asyncTaskStore.addTask({ taskId, type: "storyboard_video", ... })
```

## 7. 边界条件

- 没有脚本也没有 topic → 返回参数错误
- 分镜 ID 不存在 → 返回 error
- 批量视频中某个场景失败 → 跳过失败场景，其余正常完成，在结果中标注失败场景
- compose_storyboard 时某些场景没有视频 → 跳过无视频场景或使用占位图片
