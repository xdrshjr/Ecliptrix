# Spec 03: 生成流程 — 前端组装逻辑和 API 扩展

## 概述

定义前端如何根据用户的输入组合（视频/对话/提示词）和 Tab 选择（AI视频/普通），组装参数并调用对应的生成 API。同时定义需要对现有 API 端点做的参数扩展。

## 路由决策矩阵

```mermaid
graph TD
    A[用户点击生成] --> B{当前 Tab?}
    B -->|AI视频脚本| C{有选择视频?}
    B -->|普通脚本| D{有选择视频?}

    C -->|有视频| E[/api/ai-video-script-generation]
    C -->|无视频| E

    D -->|有视频| F[/api/video-understanding-script]
    D -->|无视频| G[/api/video-script-generation]

    E --> H[返回 AIVideoScriptSegment[]]
    F --> I[返回 ScriptSegment[]]
    G --> I
```

### 决策规则

| Tab | 有视频 | 调用端点 | 说明 |
|-----|--------|----------|------|
| AI视频脚本 | ✅ | `/api/ai-video-script-generation` | 扩展：增加 videoAnalysis + customPrompt 参数 |
| AI视频脚本 | ❌ | `/api/ai-video-script-generation` | 扩展：仅用 chatMessages + customPrompt |
| 普通脚本 | ✅ | `/api/video-understanding-script` | 扩展：增加 chatMessages + customPrompt 参数 |
| 普通脚本 | ❌ | `/api/video-script-generation` | 扩展：增加 customPrompt 参数（已有 chatMessages） |

## API 端点扩展

### 1. `/api/ai-video-script-generation/route.ts` 扩展

**现有参数**：
```
{
  chatMessages: ChatMessage[],  // 必填
  scriptConfig?: ScriptConfig
}
```

**扩展后**：
```
{
  chatMessages?: ChatMessage[],           // 改为可选
  scriptConfig?: ScriptConfig,
  customPrompt?: string,                  // 新增：自定义提示词
  videoAnalysisContext?: string,           // 新增：视频分析结果文本
  selectedVideos?: VideoInfo[]            // 新增：选中视频的基本信息
}
```

**Prompt 组装变更**：
- 在现有 system prompt 基础上，追加 customPrompt 内容
- 如有 videoAnalysisContext，作为额外上下文注入 user prompt
- chatMessages 仍按现有方式处理，但改为可选
- 验证：chatMessages、customPrompt、videoAnalysisContext 至少有一个非空

### 2. `/api/video-understanding-script/route.ts` 扩展

此路由是后端代理，转发到 `${BACKEND_URL}/api/video-understanding-script`。

**现有参数**：
```
{
  selectedVideos: VideoInfo[],
  referenceText?: string,
  parameters?: object,
  taskId?: string
}
```

**扩展后**：
```
{
  selectedVideos: VideoInfo[],
  referenceText?: string,
  parameters?: object,
  taskId?: string,
  chatMessages?: ChatMessage[],           // 新增
  customPrompt?: string                   // 新增
}
```

**处理逻辑**：
- 前端将 chatMessages 序列化为文本，与 customPrompt 合并，放入 referenceText 字段
- 格式：`{原有referenceText}\n\n【对话参考】\n{对话摘要}\n\n【用户需求】\n{customPrompt}`
- 这样后端无需修改，复用现有 referenceText 处理逻辑

### 3. `/api/video-script-generation/route.ts` 扩展

**现有参数**：
```
{
  markdownContent: string,
  taskId?: string,
  scriptConfig?: ScriptConfig,
  chatMessages?: ChatMessage[]
}
```

**扩展后**：
```
{
  markdownContent?: string,               // 改为可选
  taskId?: string,
  scriptConfig?: ScriptConfig,
  chatMessages?: ChatMessage[],
  customPrompt?: string                   // 新增
}
```

**处理逻辑**：
- customPrompt 追加到 markdownContent 末尾（如有）
- 如果 markdownContent 为空但有 chatMessages/customPrompt，自动组装 markdownContent
- 格式：`【用户需求】\n{customPrompt}\n\n【对话内容】\n{chatMessages序列化}`

## 前端参数组装逻辑

### 组装函数伪代码

```
function assembleGenerationParams(state):
  params = {}

  // 1. 视频相关
  if hasSelectedVideos:
    params.selectedVideos = selectedVideos
    params.videoAnalysisContext = 视频分析结果文本

  // 2. 对话内容
  if includeChatMessages && chatMessages.length > 0:
    params.chatMessages = truncateChatMessages(chatMessages, maxMessages=50, maxCharsPerMsg=1000)

  // 3. 自定义提示词
  if customPrompt.trim():
    params.customPrompt = customPrompt.trim()

  // 4. 现有配置
  params.scriptConfig = currentScriptConfig

  return params
```

### 对话消息序列化

用于 video-understanding-script 路由（需要合并到 referenceText）：

```
function serializeChatMessages(messages):
  return messages.map(msg =>
    `${msg.role === 'user' ? '用户' : 'AI'}: ${msg.content}`
  ).join('\n')
```

### 截断策略

- chatMessages：最多 50 条，每条最多 1000 字符
- videoAnalysisContext：最多 3000 字符
- customPrompt：前端限制 500 字符

## 输出处理

### AI视频脚本 Tab

生成结果为 `AIVideoScriptSegment[]`，写入到 `VideoEditingTaskContent.aiVideoScriptSegments`，与现有 AIVideoScriptTab 组件对接。

### 普通脚本 Tab

生成结果为 `ScriptSegment[]`，写入到 `VideoEditingTaskContent.scriptSegments`，与现有 ScriptPanel 组件对接。之后自动触发关键词生成（`/api/script-keywords-generation`）。

## 错误处理

| 错误 | 处理 |
|------|------|
| 所有输入源为空 | 前端拦截，生成按钮 disabled |
| API 返回空结果 | Toast: "生成结果为空，请调整输入内容" |
| LLM 调用超时 | Toast: "生成超时，请重试"，保留用户输入 |
| 网络错误 | Toast: "网络错误，请检查连接" |
| 部分视频分析失败 | 继续生成，跳过未分析的视频，Toast 告知 |
