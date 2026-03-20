# Spec 01: UI 增强 — Tab 切换、对话开关、提示词框、优化按钮

## 概述

在现有 VideoUnderstandingScriptModal 基础上，新增以下 UI 控件区域，保留所有现有功能不变。

## UI 布局

```
┌─────────────────────────────────────────────────┐
│  VideoUnderstandingScriptModal                  │
│                                                 │
│  ┌─────────────────┬──────────────────┐         │
│  │  AI视频脚本 Tab  │  普通脚本 Tab     │         │
│  └─────────────────┴──────────────────┘         │
│                                                 │
│  ═══════ 视频选择区域（现有，保留） ═══════       │
│  [ ] 视频1  [ ] 视频2  ...                       │
│  分析模式: ○快速  ○专业                           │
│                                                 │
│  ─────── 新增区域 ───────                        │
│                                                 │
│  ┌─ 对话内容 ──────────────────────────┐         │
│  │ [Toggle 开关]  包含对话内容          │         │
│  │ 状态文字: "当前对话 12 条消息"        │         │
│  └────────────────────────────────────┘         │
│                                                 │
│  ┌─ 自定义提示词 ──────────────────────┐         │
│  │ ┌──────────────────────────┬─────┐ │         │
│  │ │ 输入你的生成需求...       │ ✨  │ │         │
│  │ │                          │优化 │ │         │
│  │ │                          │     │ │         │
│  │ └──────────────────────────┴─────┘ │         │
│  │ 42/500                    [↩撤销] │         │
│  └────────────────────────────────────┘         │
│                                                 │
│  ═══════ 生成配置（现有，保留） ═══════           │
│  语言/分段数等配置...                             │
│                                                 │
│  [取消]                        [生成脚本]        │
│                                                 │
└─────────────────────────────────────────────────┘
```

## 组件详细设计

### 1. Tab 标签切换

- **位置**：模态框顶部，视频选择区域之上
- **两个 Tab**：
  - `AI视频脚本`：生成用于 Ark 视频生成的场景描述脚本（AIVideoScriptSegment）
  - `普通脚本`：生成用于时间线编辑的分段脚本（ScriptSegment）
- **默认选中**：`AI视频脚本`
- **切换行为**：仅影响最终调用的 API 端点和输出格式，不影响输入区域的控件
- **样式**：使用项目现有的 Tab 组件风格（参考 shadcn Tabs），底部高亮线

### 2. 对话内容开关

- **位置**：视频选择区域下方
- **组件**：
  - Toggle/Switch 开关组件
  - 标签文字："包含对话内容"
  - 状态文字：开启时显示 "当前对话 {N} 条消息"；无对话时显示 "暂无对话内容" 且开关禁用
- **默认状态**：关闭
- **数据来源**：从父组件传入的 conversations 和 activeConversationId 获取当前对话消息
- **边界情况**：
  - 无活跃对话 → 开关 disabled + 提示文字
  - 对话消息为空 → 同上

### 3. 自定义提示词文本框

- **位置**：对话内容开关下方
- **组件**：
  - 多行 Textarea，placeholder: "输入你的生成需求描述..."
  - 右侧/右上角：✨ 优化按钮（icon button）
  - 底部左侧：字数统计 `{count}/500`
  - 底部右侧：撤销按钮（仅在优化后显示）
- **字数限制**：500 字符
- **优化按钮**：
  - 图标：sparkles（✨）+ 文字 "优化"
  - 点击触发 LLM 润色（见 Spec 02）
  - 优化中显示 loading spinner，按钮变为 disabled
  - 文本框为空时按钮 disabled
- **撤销按钮**：
  - 仅在一键优化替换文本后出现
  - 点击恢复优化前的原始文本
  - 用户手动编辑文本后撤销按钮消失

### 4. 视频选择区域调整

- **保持现有所有功能**
- **新增行为**：视频选择变为可选（不再强制要求至少选一个视频）
- **验证规则变更**：
  - 旧规则：必须选择至少 1 个视频
  - 新规则：至少满足以下之一 → 选择了视频 OR 开启了对话内容 OR 填写了自定义提示词
  - 三者全空时生成按钮 disabled

### 5. 生成按钮

- **保持现有位置和样式**
- **Disabled 条件**：三种输入源全部为空（无视频 + 对话关闭 + 提示词为空）
- **按钮文案**：根据 Tab 切换
  - AI视频脚本 Tab → "生成AI视频脚本"
  - 普通脚本 Tab → "生成脚本"

## 状态管理

新增状态（在 Modal 组件内部管理）：

```
activeTab: 'ai-video' | 'normal'          // Tab 选择
includeChatMessages: boolean                // 对话开关
customPrompt: string                        // 自定义提示词
previousPrompt: string | null               // 优化前的原始文本（用于撤销）
isPolishing: boolean                        // 润色中状态
```

## Props 接口变更

Modal 组件需要新增以下 props：

```
chatMessages?: ChatMessage[]                // 当前对话消息（从父组件传入）
hasChatMessages: boolean                    // 是否有对话消息可用
chatMessageCount: number                    // 对话消息数量（用于显示）
```

## 响应式设计

- 新增区域采用与现有控件一致的间距和排版
- 文本框最小高度 3 行，最大高度 6 行（可滚动）
- 移动端：优化按钮移至文本框下方，全宽显示

## 国际化

所有新增文案需添加到 `src/lib/i18n.ts`：

| key | 中文 | English |
|-----|------|---------|
| videoScript.tab.aiVideo | AI视频脚本 | AI Video Script |
| videoScript.tab.normal | 普通脚本 | Normal Script |
| videoScript.chatToggle.label | 包含对话内容 | Include chat content |
| videoScript.chatToggle.count | 当前对话 {count} 条消息 | {count} messages in current chat |
| videoScript.chatToggle.empty | 暂无对话内容 | No chat content available |
| videoScript.customPrompt.placeholder | 输入你的生成需求描述... | Enter your generation requirements... |
| videoScript.customPrompt.polish | 优化 | Polish |
| videoScript.customPrompt.polishing | 优化中... | Polishing... |
| videoScript.customPrompt.undo | 撤销 | Undo |
| videoScript.generate.aiVideo | 生成AI视频脚本 | Generate AI Video Script |
| videoScript.generate.normal | 生成脚本 | Generate Script |
| videoScript.validation.empty | 请至少选择一种输入来源 | Please select at least one input source |
