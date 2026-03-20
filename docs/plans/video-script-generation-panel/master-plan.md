# Master Plan: 视频脚本生成面板增强

## 概述

增强现有的 VideoUnderstandingScriptModal，使其在根据视频理解生成脚本时，支持可选叠加对话内容和自定义提示词，并提供 LLM 一键润色优化提示词的能力。同时新增 Tab 切换支持 AI 视频脚本和普通脚本两种生成目标。

## 目标

1. **对话内容集成**：用户可通过开关选择是否将当前活跃对话的全部消息作为上下文参与脚本生成
2. **自定义提示词**：提供文本输入框，用户可填入自定义生成需求描述
3. **提示词润色优化**：一键调用 LLM 优化用户输入的提示词，结合对话和视频分析上下文
4. **双模式输出**：通过 Tab 标签切换支持 AI 视频脚本（Ark 视频生成）和普通脚本（时间线编辑）两种输出
5. **灵活组合**：视频理解 + 对话内容 + 自定义提示词三者全部可选叠加，允许无视频时仅用对话/提示词生成

## 范围

### 包含（In Scope）

- VideoUnderstandingScriptModal UI 增强（新增控件区域）
- 对话内容开关及数据获取逻辑
- 自定义提示词文本框（500 字限制，与现有一致）
- 提示词润色优化 API 路由（Next.js API route，复用 LLM_API_URL 配置）
- 润色交互：一键优化 → 直接替换 + 撤销按钮
- Tab 标签切换 AI 视频脚本 / 普通脚本
- 前端组装不同输入源，调用对应生成端点
- 无视频时允许生成（仅基于对话/提示词）

### 不包含（Out of Scope）

- 后端脚本生成逻辑变更（复用现有端点）
- 对话消息选择/过滤功能
- 提示词模板库
- 提示词历史记录
- 多版本润色对比

## 架构设计

### 数据流

```
用户交互层
├── Tab: AI视频脚本 / 普通脚本
├── 视频选择（现有功能，可选）
├── 对话内容开关（toggle）
├── 自定义提示词文本框
│   └── 一键优化按钮 → /api/prompt-polish → LLM → 替换文本框
└── 生成按钮

前端组装层（Hook）
├── 收集: 已选视频 + 分析结果（如有）
├── 收集: 当前对话消息（如开启）
├── 收集: 自定义提示词（如填写）
├── 根据 Tab 选择调用对应 API
│   ├── AI视频脚本 → /api/ai-video-script-generation（扩展参数）
│   └── 普通脚本 → /api/video-understanding-script 或 /api/video-script-generation
└── 返回脚本结果

API 层
├── /api/prompt-polish（新建）- 提示词润色
├── /api/ai-video-script-generation（扩展）- 增加视频分析+自定义提示词参数
├── /api/video-understanding-script（现有）- 视频理解脚本
└── /api/video-script-generation（现有）- 文本脚本
```

### API 策略

| 场景 | 有视频 | 有对话 | 有提示词 | 调用端点 |
|------|--------|--------|----------|----------|
| AI脚本+视频 | ✅ | 可选 | 可选 | /api/ai-video-script-generation（扩展） |
| AI脚本-无视频 | ❌ | ✅/可选 | ✅/可选 | /api/ai-video-script-generation（扩展） |
| 普通脚本+视频 | ✅ | 可选 | 可选 | /api/video-understanding-script（扩展） |
| 普通脚本-无视频 | ❌ | ✅/可选 | ✅/可选 | /api/video-script-generation（扩展） |

### 关键设计决策

1. **前端组装模式**：前端负责收集和组装不同输入源，根据 Tab 选择和是否有视频来决定调用哪个端点，避免新建统一端点的复杂度
2. **扩展现有端点**：在现有 API 路由中新增可选参数（`chatMessages`、`customPrompt`、`videoAnalysisContext`），保持向后兼容
3. **润色 API 独立路由**：提示词润色是独立的轻量操作，新建 `/api/prompt-polish` 路由，使用 LLM_API_URL 配置
4. **对话内容传递**：前端直接从 ChatContext/conversations 获取消息，序列化后作为参数传递给生成 API

## 依赖

- 现有组件：VideoUnderstandingScriptModal、useVideoUnderstandingScript、useConvertToScript
- 现有 API：/api/video-script-generation、/api/ai-video-script-generation、/api/video-understanding-script
- 对话数据：VideoEditingTaskContent.conversations、activeConversationId
- LLM 配置：LLM_API_URL、LLM_API_KEY（环境变量）

## 风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 对话内容过长导致 token 超限 | 生成失败 | 前端截断策略，保留最近 N 条消息 |
| 润色 API 响应慢影响体验 | 用户等待 | 显示 loading 状态，支持取消 |
| 多输入源组合导致 prompt 质量不稳定 | 脚本质量下降 | 精心设计 system prompt，明确各输入源的权重和角色 |
| 现有功能回归 | 原有流程出错 | 所有新增功能均为可选，默认行为与原有一致 |

## 规格文件目录

| 文件 | 内容 |
|------|------|
| specs/01-ui-enhancement.md | UI 增强：Tab切换、对话开关、提示词框、优化按钮 |
| specs/02-prompt-polish-api.md | 提示词润色 API 路由设计 |
| specs/03-generation-flow.md | 生成流程：前端组装逻辑和 API 扩展 |
| specs/04-hook-refactoring.md | Hook 重构：统一生成逻辑封装 |
