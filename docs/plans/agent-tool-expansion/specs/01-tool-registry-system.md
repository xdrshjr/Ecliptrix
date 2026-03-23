# Spec 01: 树形工具注册系统 (Tool Registry System)

## 1. 概述

构建一个树形工具注册表 (Tool Registry)，将 Agent 的所有工具组织为分类 → 工具的两层结构。引入 `explore_tools` meta tool，让 Agent 在运行时按需加载某个分类下的完整工具定义。每次 turn 工具独立加载，不跨 turn 持久。

## 2. 设计

### 2.1 工具注册表数据结构

```
ToolCategory {
  id: string              // e.g. "search_tools"
  name: string            // e.g. "搜索获取工具"
  description: string     // 一行简介，用于 L0 系统提示
  tools: AgentTool[]      // 该类别下的所有工具定义（含完整 schema）
}

ToolRegistry {
  categories: Map<string, ToolCategory>

  // 获取所有类别的摘要（用于 L0）
  getCategorySummaries(): { id, name, description }[]

  // 获取某个类别的完整工具定义（用于 explore_tools 返回）
  getCategoryTools(categoryId: string): AgentTool[]

  // 获取所有"始终可用"的工具（核心编辑工具 + explore_tools 自身）
  getAlwaysAvailableTools(): AgentTool[]
}
```

### 2.2 工具类别定义

| Category ID | 名称 | 包含工具 | 始终可用？ |
|-------------|------|----------|-----------|
| `query_tools` | 查询工具 | get_timeline, list_materials, search_materials | **是** — 始终可用 |
| `editing_tools` | 编辑工具 | add_to_track, trim_clip, delete_clip, move_clip, resize_clip | **是** — 始终可用 |
| `search_tools` | 搜索获取 | search_video, search_image, search_audio | 否 — 按需加载 |
| `ai_gen_tools` | AI 生成 | generate_ai_image, generate_ai_video, image_to_video | 否 — 按需加载 |
| `tts_tools` | 语音合成 | generate_tts, batch_generate_tts | 否 — 按需加载 |
| `script_tools` | 脚本工具 | generate_video_script, expand_video_script, understand_video_script | 否 — 按需加载 |
| `storyboard_tools` | 分镜工具 | generate_storyboard, describe_storyboard, batch_storyboard_video, compose_storyboard | 否 — 按需加载 |
| `material_tools` | 素材管理 | add_material_to_library, remove_material | 否 — 按需加载 |

### 2.3 `explore_tools` Meta Tool

```
Tool: explore_tools
Description: "查看某个工具类别的详细工具列表。调用后该类别的工具将在本轮对话中可用。"
Parameters:
  - category: string (required) — 要探索的工具类别 ID
    enum: ["search_tools", "ai_gen_tools", "tts_tools", "script_tools",
           "storyboard_tools", "material_tools"]
Returns:
  - tools: Array<{ name, description, parameters_schema }> — 该类别下所有工具的完整定义
  - usage_hints: string — 使用提示和注意事项
```

**关键行为**：
- `explore_tools` 本身是"始终可用"工具之一
- 调用 `explore_tools` 不消耗实际 API 调用，只是向 Agent 上下文注入工具信息
- 返回的工具 schema 会被 pi-agent-core 动态注册为可用工具
- 每个 turn 开始时，可用工具重置为"始终可用"集合

### 2.4 动态工具注入机制

在 `agent.ts` 的 `createVideoEditingAgent` 中：

1. 初始化时只注册"始终可用"工具 + `explore_tools`
2. `explore_tools` 的 handler 执行时：
   - 从 ToolRegistry 获取指定类别的工具定义
   - 返回工具的 schema 描述给 LLM（作为 tool result 的一部分）
   - 同时将这些工具动态添加到当前 Agent 实例的可用工具列表中
3. LLM 在后续响应中可以直接调用这些动态加载的工具

### 2.5 pi-agent-core 动态工具注册

需要确认 `@mariozechner/pi-agent-core` 是否支持运行时动态添加工具。

**方案 A**（优先）：如果 pi-agent-core 的 Agent 支持运行时修改 tools 列表
- 在 explore_tools handler 中直接调用 `agent.addTools(newTools)`

**方案 B**（兜底）：如果不支持运行时添加
- 在 Agent 初始化时注册所有工具，但在 system prompt 中只展示摘要
- `explore_tools` 只返回详细描述供 LLM 参考，工具本身始终可调用
- 这种方式下 LLM 可能不知道有这些工具，除非先调用 explore_tools

**方案 C**（替代）：预加载所有工具但限制系统提示
- 所有工具始终注册（LLM 的 function-calling schema 中包含所有工具）
- 系统提示中只展示类别摘要
- `explore_tools` 返回详细使用指导，帮助 LLM 决定调用哪个工具
- 优点：无需动态注册；缺点：function schema token 开销较大

### 2.6 L0 系统提示模板

```
## Tools

你拥有以下工具。基础工具始终可用，高级工具需要先调用 explore_tools 查看详情。

### 始终可用
- get_timeline: 获取完整时间线状态
- list_materials: 列出素材库中的所有素材
- search_materials: 搜索素材库中的素材
- add_to_track: 将素材添加到时间线轨道
- trim_clip: 修剪片段
- delete_clip: 删除片段
- move_clip: 移动片段
- resize_clip: 调整片段时长

### 高级工具类别（调用 explore_tools 查看详情后可用）
- search_tools: 搜索外部视频/图片/音频素材（Pexels/Unsplash/Freesound）
- ai_gen_tools: AI 图像生成、AI 视频生成、图生视频
- tts_tools: 文字转语音合成
- script_tools: AI 视频脚本生成与编辑
- storyboard_tools: AI 分镜生成、描述、批量视频化
- material_tools: 素材库管理（添加/删除素材）

当用户需求涉及高级功能时，先调用 explore_tools({ category: "xxx" }) 了解可用工具，然后执行。
```

## 3. 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/lib/video-editing-agent/registry/ToolRegistry.ts` | 新建 | 工具注册表核心类 |
| `src/lib/video-editing-agent/registry/categories.ts` | 新建 | 所有工具类别定义 |
| `src/lib/video-editing-agent/registry/index.ts` | 新建 | 注册表导出 |
| `src/lib/video-editing-agent/tools/exploreTools.ts` | 新建 | explore_tools meta tool 实现 |
| `src/lib/video-editing-agent/tools/index.ts` | 修改 | 接入 ToolRegistry，替换硬编码工具列表 |
| `src/lib/video-editing-agent/agent.ts` | 修改 | 使用 ToolRegistry 初始化 Agent |
| `src/lib/video-editing-agent/systemPrompt.ts` | 修改 | L0 系统提示使用树形目录格式 |

## 4. 接口契约

### ToolRegistry → agent.ts
```
registry.getAlwaysAvailableTools(): AgentTool[]
registry.getCategorySummaries(): CategorySummary[]
```

### explore_tools → ToolRegistry
```
registry.getCategoryTools(categoryId): AgentTool[]
```

### agent.ts → systemPrompt.ts
```
buildSystemPrompt(timelineState, materials, categorySummaries): string
```

## 5. 边界条件

- Agent 在一个 turn 中调用 `explore_tools` 多次（不同类别）→ 所有类别工具累积可用
- Agent 调用不存在的 category → 返回错误信息，不影响执行
- 工具总数超过 LLM context 限制 → 方案 B/C 的 schema 控制兜底
