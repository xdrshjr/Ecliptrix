# Spec 04: AI 生成工具 (AI Generation Tools)

## 1. 概述

为 Agent 添加 AI 内容生成工具：`generate_ai_image`（ARK/Seedream 图像生成）、`generate_ai_video`（ARK 视频生成）、`image_to_video`（图生视频）。这些工具启动异步任务并返回 taskId，前端轮询系统自动追踪任务状态，完成后将结果注入 materialStore。

## 2. 工具定义

### 2.1 generate_ai_image

```
Tool: generate_ai_image
Description: "使用 AI（Seedream）根据文字描述生成图片。生成完成后自动添加到素材库。"
Parameters:
  - prompt: string (required) — 图片描述（支持中英文）
  - width: number (optional, default: 1024) — 图片宽度
  - height: number (optional, default: 1024) — 图片高度
  - count: number (optional, default: 1, max: 4) — 生成数量
  - style: string (optional) — 风格提示词
Returns:
  - success: boolean
  - taskId: string — 异步任务 ID（供前端轮询）
  - message: string — "图片生成已启动，预计需要 15-30 秒"
```

**实现路径**：调用 `/api/ark-image/generate`，获取生成结果。

**异步特性**：ARK 图像生成通常较快（15-30s），但仍采用异步模式以保持一致性。Handler 内部：
1. POST 到 `/api/ark-image/generate` 启动生成
2. 创建 AsyncTask 注入 asyncTaskStore
3. 立即返回 taskId 给 Agent
4. 前端轮询自动处理后续

### 2.2 generate_ai_video

```
Tool: generate_ai_video
Description: "使用 AI（ARK）根据文字描述生成视频。生成需要 1-5 分钟，完成后自动添加到素材库。"
Parameters:
  - prompt: string (required) — 视频描述
  - duration: number (optional, default: 5) — 期望时长（秒），受模型限制
  - aspect_ratio: string (optional, default: "16:9") — "16:9" | "9:16" | "1:1"
  - model: string (optional) — 指定模型版本
Returns:
  - success: boolean
  - taskId: string
  - message: string — "视频生成已启动，预计需要 1-5 分钟"
```

**实现路径**：调用 `/api/ark-video/generate`。

### 2.3 image_to_video

```
Tool: image_to_video
Description: "将素材库中的一张图片转换为视频动画。需要先有图片素材。"
Parameters:
  - material_id: string (required) — 素材库中的图片素材 ID
  - prompt: string (optional) — 运动方向/效果描述
  - duration: number (optional, default: 4) — 期望时长
Returns:
  - success: boolean
  - taskId: string
  - message: string
```

**实现路径**：调用 `/api/video/image-to-video`。

## 3. 异步任务处理流程

```
Agent 调用 generate_ai_video({ prompt: "sunset over ocean" })
    ↓
Tool handler:
    1. POST /api/ark-video/generate { prompt, duration, aspect_ratio }
    2. 获取 { taskId, status: "pending" }
    3. asyncTaskStore.addTask({
         taskId, type: "ai_video", status: "pending",
         metadata: { prompt, duration, aspect_ratio }
       })
    4. 返回 { success: true, taskId, message: "视频生成已启动" }
    ↓
Agent 收到结果，继续对话或执行其他操作
    ↓
前端 AsyncTaskPoller（独立组件）:
    loop 每 5 秒:
      - 遍历 asyncTaskStore 中所有 pending/processing 任务
      - 调用对应的状态查询 API
      - 更新 asyncTaskStore 中的 status 和 progress
      - 如果 status === "completed":
        - 将结果转换为 MaterialItem
        - materialStore.addMaterial(item)
        - 触发通知："AI 视频已生成完成"
```

## 4. 前端 AsyncTaskPoller 组件

```
AsyncTaskPoller
  - 挂载在 VideoEditingInterface 层级
  - 使用 useEffect + setInterval 轮询
  - 轮询间隔: 5 秒（AI 视频）、3 秒（AI 图片）、3 秒（TTS）
  - 停止条件: tasks Map 为空或所有任务已终态
  - 查询 API 映射:
    - ai_video → /api/ark-video/generate (GET with taskId)
    - ai_image → /api/ark-image/generate (GET with taskId)
    - image_to_video → /api/video/image-to-video (GET with taskId)
```

## 5. 结果自动入库 + 智能上轨

当异步任务完成时：
1. **始终**：将生成结果添加到 materialStore（素材面板可见）
2. **智能上轨**：检查原始 Agent 对话中的用户意图
   - Agent 的 tool_call metadata 中包含 `autoAddToTimeline: boolean` 字段
   - Agent LLM 根据用户措辞自行判断是否设置此字段
   - 如果 `autoAddToTimeline === true`，任务完成后自动调用 `add_to_track` 逻辑

## 6. 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/lib/video-editing-agent/tools/generateAiImage.ts` | 新建 | AI 图像生成工具 |
| `src/lib/video-editing-agent/tools/generateAiVideo.ts` | 新建 | AI 视频生成工具 |
| `src/lib/video-editing-agent/tools/imageToVideo.ts` | 新建 | 图生视频工具 |
| `src/components/video/components/AsyncTaskPoller.tsx` | 新建 | 异步任务轮询组件 |
| `src/lib/video-editing-agent/registry/categories.ts` | 修改 | 注册 ai_gen_tools 类别 |

## 7. 接口契约

### Tool handler → asyncTaskStore
```
asyncTaskStore.addTask({ taskId, type, status: 'pending', metadata })
```

### AsyncTaskPoller → Backend API
```
GET /api/ark-video/generate?taskId=xxx → { status, progress, result }
```

### AsyncTaskPoller → materialStore (on complete)
```
materialStore.addMaterial(resultToMaterialItem(task.result))
```

## 8. 边界条件

- 生成失败 → asyncTaskStore.updateTask({ status: 'failed', error }) + 通知用户
- 超时（>10min） → 标记为 failed + "生成超时，请重试"
- 素材 ID 不存在（image_to_video） → 返回 error message
- 并发生成限制 → 最多同时 3 个 AI 生成任务（asyncTaskSlice 中检查）
- Agent 在生成进行中被问到进度 → 从 asyncTaskStore 中读取最新状态回复
