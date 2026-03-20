# Spec 04: Hook 重构 — 统一生成逻辑封装

## 概述

新建 `useEnhancedScriptGeneration` Hook，封装增强后的脚本生成逻辑，包含输入源管理、路由决策、参数组装、API 调用和结果处理。同时修改现有 Hook 的调用方式以适配新流程。

## 新建 Hook

### `useEnhancedScriptGeneration`

**文件位置**：`src/components/video/hooks/useEnhancedScriptGeneration.ts`

**职责**：
1. 管理增强面板的所有状态（Tab、对话开关、提示词、润色状态）
2. 根据输入组合决定调用哪个 API
3. 组装参数、调用生成 API
4. 处理生成结果和错误
5. 提供提示词润色功能

### 输入参数

```
interface UseEnhancedScriptGenerationParams {
  // 现有参数（从父组件/上下文获取）
  selectedVideos: VideoInfo[];
  videoAnalysisResults: Map<string, AnalysisResult>;
  scriptConfig: ScriptConfig;

  // 对话数据
  conversations: Conversation[];
  activeConversationId: string | null;

  // 回调
  onScriptGenerated: (segments: ScriptSegment[]) => void;
  onAIVideoScriptGenerated: (segments: AIVideoScriptSegment[]) => void;
  onError: (error: string) => void;
}
```

### 返回值

```
interface UseEnhancedScriptGenerationReturn {
  // Tab 状态
  activeTab: 'ai-video' | 'normal';
  setActiveTab: (tab: 'ai-video' | 'normal') => void;

  // 对话开关
  includeChatMessages: boolean;
  setIncludeChatMessages: (value: boolean) => void;
  chatMessageCount: number;
  hasChatMessages: boolean;

  // 自定义提示词
  customPrompt: string;
  setCustomPrompt: (value: string) => void;

  // 提示词润色
  polishPrompt: () => Promise<void>;
  isPolishing: boolean;
  canUndo: boolean;
  undoPolish: () => void;

  // 生成
  generate: () => Promise<void>;
  isGenerating: boolean;
  canGenerate: boolean;          // 至少有一种输入源

  // 进度（复用现有进度逻辑）
  progress: number;
  progressMessage: string;
}
```

### 内部逻辑

#### 1. 对话消息获取

```
const activeConversation = conversations.find(c => c.id === activeConversationId)
const chatMessages = activeConversation?.messages ?? []
const hasChatMessages = chatMessages.length > 0
const chatMessageCount = chatMessages.length
```

#### 2. canGenerate 计算

```
const canGenerate =
  selectedVideos.length > 0 ||
  (includeChatMessages && hasChatMessages) ||
  customPrompt.trim().length > 0
```

#### 3. generate() 路由决策

```
async function generate():
  if activeTab === 'ai-video':
    调用 generateAIVideoScript()
  else:
    if selectedVideos.length > 0:
      调用 generateVideoUnderstandingScript()
    else:
      调用 generateTextScript()
```

#### 4. polishPrompt() 实现

```
async function polishPrompt():
  if !customPrompt.trim() || isPolishing: return

  setIsPolishing(true)
  setPreviousPrompt(customPrompt)  // 保存原文用于撤销

  const context = {
    prompt: customPrompt,
    chatMessages: includeChatMessages ? chatMessages : undefined,
    videoAnalysisContext: buildVideoAnalysisContext(),
    targetType: activeTab
  }

  const result = await polishPromptAPI(context)

  if result.success:
    setCustomPrompt(result.polishedPrompt)
  else:
    showToast(result.message)
    setPreviousPrompt(null)  // 清除撤销状态

  setIsPolishing(false)
```

#### 5. undoPolish() 实现

```
function undoPolish():
  if previousPrompt !== null:
    setCustomPrompt(previousPrompt)
    setPreviousPrompt(null)
```

#### 6. 撤销状态管理

```
// previousPrompt 在以下情况被清除：
// - 用户点击撤销
// - 用户手动编辑文本框内容（通过 setCustomPrompt 包装判断）
// - 润色失败

const canUndo = previousPrompt !== null

// 包装 setCustomPrompt 以检测手动编辑
function handleCustomPromptChange(value: string):
  setCustomPrompt(value)
  // 如果不是来自 polishPrompt 的调用，清除撤销状态
  if !isPolishing:
    setPreviousPrompt(null)
```

## 现有 Hook 调整

### `useConvertToScript`

**变更**：不需要修改。此 Hook 处理的是 "对话转脚本" 的另一个入口（从 ChatWindow 触发），与本次增强的入口不同。

### `useVideoUnderstandingScript`

**变更**：扩展参数接口，新增 chatMessages 和 customPrompt 可选参数。

```
// 新增参数
interface VideoUnderstandingScriptParams {
  // ...现有参数
  chatMessages?: ChatMessage[];
  customPrompt?: string;
}
```

内部在组装 referenceText 时合并新参数：

```
const enrichedReferenceText = buildEnrichedReferenceText(
  referenceText,
  chatMessages,
  customPrompt
)
```

### `useScriptGeneration`

**变更**：扩展 `handleGenerateScriptWithConfig` 参数，新增 customPrompt。

```
async function handleGenerateScriptWithConfig(
  config: ScriptConfig,
  chatMessages?: ChatMessage[],
  customPrompt?: string           // 新增
):
  // 将 customPrompt 合并到发送给 API 的内容中
```

## 辅助函数

### `buildVideoAnalysisContext()`

将视频分析结果序列化为文本摘要：

```
function buildVideoAnalysisContext(
  selectedVideos: VideoInfo[],
  analysisResults: Map<string, AnalysisResult>
): string | undefined:
  const analyzed = selectedVideos
    .filter(v => analysisResults.has(v.id))
    .map(v => {
      const result = analysisResults.get(v.id)
      return `视频「${v.name}」: ${result.summary}`
    })

  return analyzed.length > 0 ? analyzed.join('\n') : undefined
```

### `buildEnrichedReferenceText()`

合并多种输入源为 referenceText：

```
function buildEnrichedReferenceText(
  originalRef?: string,
  chatMessages?: ChatMessage[],
  customPrompt?: string
): string:
  const parts = []
  if originalRef: parts.push(originalRef)
  if chatMessages?.length:
    parts.push('【对话参考】\n' + serializeChatMessages(chatMessages))
  if customPrompt?.trim():
    parts.push('【用户需求】\n' + customPrompt.trim())
  return parts.join('\n\n')
```

## 组件集成

### VideoUnderstandingScriptModal

```
// 使用新 Hook
const enhancedGeneration = useEnhancedScriptGeneration({
  selectedVideos,
  videoAnalysisResults,
  scriptConfig,
  conversations: props.conversations,
  activeConversationId: props.activeConversationId,
  onScriptGenerated: props.onScriptGenerated,
  onAIVideoScriptGenerated: props.onAIVideoScriptGenerated,
  onError: handleError,
})

// 渲染新 UI 控件
<TabSwitch value={enhancedGeneration.activeTab} onChange={enhancedGeneration.setActiveTab} />
<ChatToggle
  enabled={enhancedGeneration.includeChatMessages}
  onChange={enhancedGeneration.setIncludeChatMessages}
  count={enhancedGeneration.chatMessageCount}
  disabled={!enhancedGeneration.hasChatMessages}
/>
<PromptInput
  value={enhancedGeneration.customPrompt}
  onChange={enhancedGeneration.setCustomPrompt}
  onPolish={enhancedGeneration.polishPrompt}
  isPolishing={enhancedGeneration.isPolishing}
  canUndo={enhancedGeneration.canUndo}
  onUndo={enhancedGeneration.undoPolish}
/>
<GenerateButton
  onClick={enhancedGeneration.generate}
  disabled={!enhancedGeneration.canGenerate}
  loading={enhancedGeneration.isGenerating}
  label={enhancedGeneration.activeTab === 'ai-video' ? t('videoScript.generate.aiVideo') : t('videoScript.generate.normal')}
/>
```
