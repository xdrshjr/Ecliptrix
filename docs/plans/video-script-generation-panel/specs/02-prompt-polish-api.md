# Spec 02: 提示词润色优化 API

## 概述

新建 `/api/prompt-polish` Next.js API 路由，接收用户输入的自定义提示词，结合可选的对话内容和视频分析上下文，调用 LLM 进行润色优化，返回优化后的提示词文本。

## API 设计

### 端点

`POST /api/prompt-polish`

### 请求体

```
{
  "prompt": string,                      // 必填，用户输入的原始提示词
  "chatMessages"?: ChatMessage[],        // 可选，当前对话消息
  "videoAnalysisContext"?: string,        // 可选，视频分析结果摘要
  "targetType": "ai-video" | "normal"    // 生成目标类型，影响优化方向
}
```

### 响应体

```
{
  "success": boolean,
  "polishedPrompt": string,              // 优化后的提示词
  "message"?: string                     // 错误信息
}
```

### 错误响应

```
{
  "success": false,
  "message": "错误描述"
}
```

HTTP 状态码：
- 200：成功
- 400：参数错误（prompt 为空）
- 500：LLM 调用失败

## LLM 调用设计

### 配置

- 使用 `LLM_API_URL` 和 `LLM_API_KEY` 环境变量（与现有 chat 路由一致）
- Model：使用 `LLM_MODEL` 环境变量（如配置）或默认模型
- Temperature：0.7（创造性但稳定）
- Max tokens：1000（润色结果不应过长）

### System Prompt

```
你是一个视频脚本生成提示词优化专家。你的任务是优化用户输入的视频脚本生成需求描述，使其更加清晰、具体、有效。

优化原则：
1. 保留用户的核心意图和关键需求
2. 补充具体化的细节描述（场景、风格、节奏、情绪等）
3. 使表述更加专业和结构化
4. 适当扩展模糊的描述，但不偏离原意
5. 保持合理长度，不过度冗余

{根据 targetType 的额外指导}

如果提供了视频分析上下文，参考视频内容来使提示词更贴合实际素材。
如果提供了对话上下文，理解对话中讨论的方向和需求来优化提示词。

直接返回优化后的提示词文本，不要添加解释或标注。
```

### targetType 特定指导

- `ai-video`：强调画面描述、镜头语言、视觉风格、场景转换
- `normal`：强调叙事结构、语言节奏、信息层次、观众引导

### User Prompt 组装

```
{如有视频分析上下文}
【参考视频内容】
{videoAnalysisContext}

{如有对话内容}
【对话背景】
{chatMessages 序列化为 "角色: 内容" 格式，截取最近消息}

【待优化的提示词】
{prompt}
```

### 对话内容截断策略

- 最多传入最近 20 条消息
- 每条消息内容截断到 500 字符
- 总对话上下文不超过 5000 字符
- 截断时优先保留最近的消息

## 实现位置

- **路由文件**：`src/app/api/prompt-polish/route.ts`
- **模式**：直接调用 LLM（与 chat 路由类似），不经过后端代理

## 前端调用

### API 客户端函数

在 `src/lib/api/` 下新建或扩展：

```
polishPrompt(params: {
  prompt: string;
  chatMessages?: ChatMessage[];
  videoAnalysisContext?: string;
  targetType: 'ai-video' | 'normal';
}): Promise<{ success: boolean; polishedPrompt: string; message?: string }>
```

### 调用时机

- 用户点击 ✨ 优化按钮
- 前端收集当前状态：提示词文本 + 对话消息（如开关开启）+ 视频分析结果（如已分析）
- 调用 API，显示 loading
- 成功后替换文本框内容，保存原文用于撤销

### 错误处理

- 网络错误 → Toast 提示 "优化失败，请重试"
- LLM 返回空结果 → Toast 提示 "优化结果为空，请修改提示词后重试"
- 保持文本框原始内容不变
