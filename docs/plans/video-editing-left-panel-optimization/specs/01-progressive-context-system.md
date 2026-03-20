# Spec 01: 渐进式上下文系统

## 目标

将当前一次性全量注入所有工具描述和面板状态的方式，改为三级渐进式上下文加载体系。Agent 仅在需要时才获取详细信息，大幅减少初始上下文消耗，提升响应速度和质量。

## 现状分析

### 当前实现

**文件:** `src/lib/video-editing-agent/systemPrompt.ts`

当前 `buildSystemPrompt()` 将以下信息全量注入系统提示：

1. 完整的角色说明和规则（固定 ~150 tokens）
2. `formatTimelineSummary()` — 每条轨道、每个片段的详细信息（随项目复杂度增长）
3. `formatMaterialsSummary()` — 每个素材的完整属性，包括 AI 分析结果（可达 2000+ tokens）

**问题:**
- 一个有 3 条轨道、10 个片段、20 个素材的项目，系统提示可达 3000-5000 tokens
- 用户只是问"帮我把第一个视频裁剪5秒"，Agent 也要处理全部素材和轨道信息
- 上下文越大，Agent 响应越慢，token 成本越高，注意力越分散

### Agent API 调用链

```
用户消息 → /api/video-editing-agent/chat/route.ts
  → createVideoEditingAgent()
    → buildSystemPrompt(timelineState, materials)  // 全量注入
    → Agent执行（已有完整上下文，可直接调用工具）
```

## 设计方案

### 三级上下文体系

#### Level 0: 始终注入（~200 tokens）

每次对话始终包含的最小上下文：

```
## 可用工具概览
- get_timeline: 获取时间轴当前完整状态
- search_materials: 搜索可用素材（支持按内容搜索）
- add_to_track: 将素材添加到指定轨道
- trim_clip: 裁剪片段的起止时间
- delete_clip: 删除指定片段
- move_clip: 移动片段到新位置
- resize_clip: 调整片段在轨道上的长度

## 当前项目摘要
- 轨道: 视频轨 x1 (3个片段), 音频轨 x1 (2个片段), 字幕轨 x1 (空)
- 总时长: 45.2秒
- 素材库: 视频 x5, 音频 x3, 图片 x8, 字幕 x0

## 操作指南
- 需要了解详细状态时，请使用 get_timeline 工具
- 需要查找素材时，请使用 search_materials 工具
- 直接操作时，使用对应工具并提供必要参数
```

**关键设计点:**
- 工具只列出名称和一句话描述，不包含参数 schema
- 时间轴和素材只展示统计摘要，不列出具体项
- 引导 Agent 主动使用工具获取详情

#### Level 1: 工具 Schema 按需提供

当 Agent 决定调用某个工具时，通过 function calling 的 tools 定义自动提供完整参数 schema。这是 OpenAI-compatible API 的原生能力，无需额外实现。

**当前做法:** 所有工具的完整 schema 始终在 tools 参数中
**优化做法:** 根据 L0 中的工具概览，Agent 选择工具后自然获得完整 schema

实际上 tools 参数中的 schema 是必须的（API 要求），所以 L1 的优化重点在于**简化系统提示中的冗余描述**，让 schema 成为唯一的参数定义来源。

#### Level 2: 运行时工具获取详细数据

Agent 通过工具调用获取实时详细数据：

- `get_timeline` → 返回完整轨道、片段、时间点信息
- `search_materials` → 按条件搜索素材，返回匹配结果及详细属性
- （现有工具，无需新增）

### 系统提示重构

#### 新的 `buildSystemPrompt()` 接口

```typescript
// 伪代码
function buildSystemPrompt(
  timelineState: TimelineState,
  materials: Material[]
): string {
  return `
${ROLE_AND_RULES}

## 可用工具概览
${formatToolOverview()}

## 当前项目摘要
${formatCompactSummary(timelineState, materials)}

## 操作指南
${OPERATION_GUIDELINES}
  `.trim();
}
```

#### `formatCompactSummary()` — 替代现有 `formatTimelineSummary()` + `formatMaterialsSummary()`

```typescript
// 伪代码
function formatCompactSummary(
  timeline: TimelineState,
  materials: Material[]
): string {
  // 统计信息
  const trackStats = timeline.tracks.map(t => ({
    type: t.type,
    clipCount: t.clips.length,
  }));
  const totalDuration = calculateTotalDuration(timeline);

  const materialStats = {
    video: materials.filter(m => m.type === 'video').length,
    audio: materials.filter(m => m.type === 'audio').length,
    image: materials.filter(m => m.type === 'image').length,
    subtitle: materials.filter(m => m.type === 'subtitle').length,
  };

  return `
- 轨道: ${trackStats.map(t => `${t.type}轨(${t.clipCount}个片段)`).join(', ')}
- 总时长: ${totalDuration.toFixed(1)}秒
- 素材库: 视频x${materialStats.video}, 音频x${materialStats.audio}, 图片x${materialStats.image}, 字幕x${materialStats.subtitle}
  `.trim();
}
```

#### `formatToolOverview()` — 替代当前工具的详细文本描述

```typescript
// 伪代码
function formatToolOverview(): string {
  const tools = [
    { name: 'get_timeline', desc: '获取时间轴当前完整状态（轨道、片段、时间点）' },
    { name: 'search_materials', desc: '搜索素材库（支持按名称、类型、内容描述搜索）' },
    { name: 'add_to_track', desc: '将素材添加到指定轨道的指定位置' },
    { name: 'trim_clip', desc: '裁剪片段的起止时间' },
    { name: 'delete_clip', desc: '删除指定片段' },
    { name: 'move_clip', desc: '移动片段到新的轨道或时间位置' },
    { name: 'resize_clip', desc: '调整片段在轨道上的显示长度' },
  ];
  return tools.map(t => `- ${t.name}: ${t.desc}`).join('\n');
}
```

### 工具定义优化

**当前:** 工具的 function calling schema + 系统提示中的重复文字描述
**优化后:** 工具 schema 是唯一的参数定义来源，系统提示只提供一句话概览

需要确保每个工具的 schema `description` 字段足够清晰，让 Agent 仅凭 schema 就能正确调用。

### 上下文注入点

```
请求到达 /api/video-editing-agent/chat
  ↓
构建 L0 系统提示（compactSummary）
  ↓
设置 tools 参数（完整 schema，这是 L1）
  ↓
Agent 开始推理
  ↓
Agent 决定调用 get_timeline → 获取 L2 详细数据
  ↓
Agent 基于详细数据执行操作
```

## 涉及文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/lib/video-editing-agent/systemPrompt.ts` | **重构** | 替换 formatTimelineSummary + formatMaterialsSummary 为 compact 版本 |
| `src/lib/video-editing-agent/agent.ts` | **修改** | 调整系统提示构建逻辑 |
| `src/lib/video-editing-agent/tools/` | **审查** | 确保工具 schema description 足够清晰 |

## 验收标准

1. 系统提示在任何项目规模下不超过 500 tokens（不含对话历史）
2. Agent 仍能正确理解用户意图并选择正确工具
3. Agent 在需要详细信息时主动调用 get_timeline / search_materials
4. 对于"裁剪第一个片段5秒"这类明确指令，Agent 不需要先调用 get_timeline 就能直接操作（通过 L0 摘要中的轨道信息推断）
5. Token 消耗对比当前方案减少 50% 以上（在10+素材的项目中）

## 边界情况

- **空项目**: L0 摘要显示"轨道: 无 / 素材库: 空"，Agent 应引导用户先添加素材
- **超大项目**: 即使 100+ 素材，L0 摘要也只是统计数字，不会膨胀
- **模糊指令**: "帮我改一下那个视频" — Agent 应先用 get_timeline 确认具体片段，而不是猜测
- **多轮对话**: 后续对话中 Agent 已从之前的 get_timeline 调用获取过详情，无需重复调用
