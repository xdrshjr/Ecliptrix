# Spec 06: 脚本工具 (Script Tools)

## 1. 概述

为 Agent 添加脚本相关工具：`generate_video_script`（AI 视频脚本生成）、`expand_video_script`（脚本扩展细化）、`understand_video_script`（基于视频生成解说脚本）。Agent 作为脚本面板控制器，生成结果直接写入 scriptStore。

## 2. 工具定义

### 2.1 generate_video_script

```
Tool: generate_video_script
Description: "根据主题/描述生成 AI 视频脚本。脚本将直接显示在脚本面板中。"
Parameters:
  - topic: string (required) — 视频主题或简要描述
  - style: string (optional) — 脚本风格 (e.g. "教程", "Vlog", "纪录片", "短视频")
  - duration_target: number (optional) — 目标视频时长（秒）
  - language: string (optional, default: "zh") — 输出语言
  - additional_requirements: string (optional) — 额外要求
Returns:
  - success: boolean
  - script: { content: string, word_count: number, estimated_duration: number }
  - message: string
```

**实现路径**：调用 `/api/ai-video-script-generation`（流式响应）。

**关键行为**：
- Handler 调用 API 获取流式脚本内容
- 逐段写入 scriptStore.appendScriptContent()，实现脚本面板的流式更新效果
- 完成后设置 scriptStore.setScriptType('ai_generated')

### 2.2 expand_video_script

```
Tool: expand_video_script
Description: "将简短的脚本大纲扩展为完整的视频脚本。支持对现有脚本进行细化。"
Parameters:
  - outline: string (optional) — 脚本大纲（不提供则使用脚本面板当前内容）
  - expansion_type: string (optional, default: "full") — "full" | "section" (全文扩展/章节扩展)
  - target_word_count: number (optional) — 目标字数
Returns:
  - success: boolean
  - script: { content: string, word_count: number, estimated_duration: number }
  - message: string
```

**实现路径**：调用 `/api/ai-video-script-expand`。

**关键行为**：
- 如果 outline 未提供，从 scriptStore.scriptContent 读取当前脚本内容
- 扩展结果替换或追加到 scriptStore

### 2.3 understand_video_script

```
Tool: understand_video_script
Description: "分析素材库中的视频内容，自动生成匹配的解说脚本。"
Parameters:
  - material_ids: string[] (optional) — 要分析的视频素材 ID 列表（不提供则分析所有视频素材）
  - style: string (optional) — 解说风格
  - language: string (optional, default: "zh")
Returns:
  - success: boolean
  - script: { content: string, word_count: number }
  - message: string
```

**实现路径**：调用 `/api/video-understanding-script`。

## 3. 脚本面板集成

Agent 作为脚本面板控制器的实现方式：

```
generate_video_script handler:
    1. scriptStore.resetScript()
    2. scriptStore.setGenerating(true)
    3. scriptStore.setScriptType('ai_generated')
    4. POST /api/ai-video-script-generation (stream)
    5. 流式读取:
       for chunk in stream:
         scriptStore.appendScriptContent(chunk)
         scriptStore.setGenerationProgress(progress)
    6. scriptStore.setGenerating(false)
    7. 返回摘要给 Agent
```

**脚本面板 UI 响应**：
- 监听 scriptStore.isGenerating → 显示生成中动画
- 监听 scriptStore.scriptContent → 实时更新编辑器内容
- 监听 scriptStore.generationProgress → 显示进度条

## 4. 与其他工具的协作场景

**场景 1：生成脚本 → 生成分镜 → 生成视频**
```
Agent:
  1. generate_video_script({ topic: "海洋保护" })
  2. generate_storyboard({ script: scriptStore.scriptContent })  // 使用脚本生成分镜
  3. batch_storyboard_video({ storyboard_id: "xxx" })  // 分镜批量生成视频
```

**场景 2：分析视频 → 生成解说 → TTS**
```
Agent:
  1. understand_video_script({ material_ids: ["vid-001"] })
  2. generate_tts({ text: scriptStore.scriptContent })
  3. add_to_track({ materialId: ttsResult.id })
```

## 5. 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/lib/video-editing-agent/tools/generateVideoScript.ts` | 新建 | 脚本生成工具 |
| `src/lib/video-editing-agent/tools/expandVideoScript.ts` | 新建 | 脚本扩展工具 |
| `src/lib/video-editing-agent/tools/understandVideoScript.ts` | 新建 | 视频理解脚本工具 |
| `src/lib/video-editing-agent/registry/categories.ts` | 修改 | 注册 script_tools 类别 |

## 6. 接口契约

### Tool handler → scriptStore
```
scriptStore.setScriptContent(content)
scriptStore.appendScriptContent(chunk)
scriptStore.setGenerating(boolean)
```

### Tool handler → Agent
```
{ success: true, script: { content, word_count, estimated_duration }, message }
```

## 7. 边界条件

- 脚本面板当前有内容且 Agent 生成新脚本 → 覆盖（Agent 决定是否保留旧内容）
- 流式生成被 Agent 取消 → 保留已生成部分，isGenerating 设为 false
- 视频理解需要视频有分析结果 → 如果视频未分析，先触发分析或返回提示
- API 返回非 200 → 返回 error message，不修改 scriptStore
