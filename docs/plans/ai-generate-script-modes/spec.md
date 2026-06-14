# 解说脚本「AI 生成」下拉双模式（解说直接生成 / 视频理解生成）开发方案

- **Feature slug**: `ai-generate-script-modes`
- **文档版本**: v2（Subtask #1 评审已完成，P0/P1 均已就地修复并锁定决议）
- **作者**: 方案设计节点（Subtask #0）
- **目标读者**: 评审节点（Subtask #1）、开发节点（Subtask #2）、Review 节点（Subtask #3）
- **关联模块**: `src/components/video/ScriptPanel.tsx`、`src/components/video/VideoEditingInterface.tsx`、`src/app/api/chat/route.ts`

---

## 评审记录（Review Notes — Subtask #1）

> 评审人：方案评审节点（Subtask #1）。评审已逐节对照代码库**实测核验**：`ScriptPanel.tsx`（2701 行）、`useStoryboardChat.ts`、`src/app/api/chat/route.ts`、`src/components/ui/Modal.tsx`、`src/types/index.ts`、`videoEditingTypes.ts`、`src/lib/i18n.ts`、`VideoEditingInterface.tsx`、`ConvertToScriptModal.tsx`。
>
> **可行性核验通过**：入口按钮位置（ScriptPanel narration 头部 `script-panel-header relative`）、`onGenerateScript/isGenerating/segments/onUpdateSegments` props、`/api/chat` SSE（`data:{content|reasoning}` + `[DONE]`，读 `LLM_API_URL/LLM_API_KEY`）与 `useStoryboardChat`/`extractJson` 范式、`Modal.tsx`（Esc/焦点陷阱/`aria-modal`/还焦）、`ScriptSegment{id,title,sentences,narrationText?}`+`ScriptSentence{id,text,narration?}` 字段、i18n 三处同改（接口 + zh + en）、`crypto.randomUUID()` 兜底范式，均与方案描述一致。方案整体**可建、可落地、无需新增后端接口**。

| # | 维度 | 严重度 | 问题 | 处置（v2） |
|---|---|---|---|---|
| R1 | 完整性/右尺寸 | **P1** | §8 留 4 个未决开放问题，下游开发无据可依。 | 已在 §8 全部决议并回灌正文，§8 改为「评审已决议」。 |
| R2 | 正确性 | **P1** | 第 1 步若用「现有解说脚本聚合文本」预填 `draftText`，第 2 步又「追加」拆分结果 → 既有内容被复制成双份。 | 决议：compose 初始 `draftText` **默认空串**（§2.2 B-1），杜绝追加重复。 |
| R3 | 一致性 | **P1** | §2.4 用裸 `onUpdateContent` 另起写入旁路，绕开面板既有 `scriptGeneration.handleUpdateSegments`，持久化副作用可能不一致。 | 改为复用 `handleUpdateSegments([...existing, ...new])` 单一写入路径（§2.4）。 |
| R4 | 完整性 | **P1** | 拆分（第二次 fetch）的中止未定义；流式改写进行中用户编辑左侧/点下一步 → 竞态 + 文案被结束回写覆盖。 | §2.2 B/C 与 hook 约定：改写与拆分**共用一个 `AbortController`**；`close()` 同时中止两者；改写流式中**禁用「下一步」并锁定左侧 textarea**，流结束统一回写。 |
| R5 | 可行性 | **P1** | 实测确认 tab 内容区 `overflow-hidden`（~ScriptPanel:1972）+ 内层 `overflow-y-auto`（~2018）。下拉仅靠 `absolute z-50` 易被祖先裁剪。 | 默认采用基于按钮 `getBoundingClientRect` 的 `fixed`/portal 定位（§2.2 A），不再以 `absolute` 为主路径。 |
| R6 | 右尺寸 | P2 | ScriptPanel「无新 props 回退旧单按钮」双路径，对唯一内部消费者属过度兼容。 | 直接以菜单替换旧按钮，去掉双路径分支。 |
| R7 | 完整性 | P2 | `NarrationDirectScriptModalProps.taskId?` 全程未被使用，为悬空 prop。 | 移除（如后续需埋点再按需引入）。 |
| R8 | 一致性 | P2 | §5 称「复用 `ChatMessage`」，但 `useStoryboardChat` 实际用自有 `StoryboardChatMessage`。 | 明确 `useNarrationChat` 沿用 `StoryboardChatMessage` 同款结构，勿与路由 `ChatMessage` 混用。 |
| R9 | 完整性 | P2 | §4.3 `join('')` 在英文句间会丢空格（"A.""B."→"A.B."）。 | 拼接 `narrationText` 时英文句间补空格、中文标点直接相接。 |
| R10 | 右尺寸 | P2 | 第 2 步「上移下移可选」语义含糊。 | 本期明确仅「编辑/新增/删除」，排序移出本期（§2.2 C）。 |
| R11 | 一致性 | P2 | ScriptPanel 已 2701 行，远超 CLAUDE.md 800 行阈值。 | 仅做「按钮替换 + 透传 props」最小改动，禁止在该文件新增业务分支。 |
| R12 | 可访问性 | P2 | 触发按钮缺 `aria-haspopup`/`aria-expanded`。 | 触发按钮补 `aria-haspopup="menu"`/`aria-expanded`，菜单 `role="menu"`、项 `role="menuitem"`。 |

> 5 项 P1（R1–R5）均已在本 v2 正文就地修复；P2（R6–R12）列为开发期放行条件，见文末「评审结论」。

---

## 1. Overview（概述）

视频编辑界面中部的「文本脚本」面板（`ScriptPanel.tsx`）顶部有一个 **「AI 生成」** 按钮。当前它的行为是：点击后直接调用父组件 `handleScriptGenerationClick`，打开旧的 `ConvertToScriptModal`（一个偏「视频理解 + 参数配置」的弹窗）。本需求要求把这个入口改造成一个 **向下弹出的下拉菜单**，菜单内提供两个模式入口：**「解说直接生成」** 与 **「视频理解生成」**。点击不同入口进入不同工作流。

**「解说直接生成」** 是本期要完整实现的模式。它是一个 **两步式（Stepper）弹窗**：第一步左侧是文案脚本编辑区、右侧是与 AI 的对话区，用户通过右侧不断提需求让 AI 改写左侧文案，也可以直接手动编辑左侧文案，满意后点「下一步」；第二步调用 AI 把整段文案 **逐句拆分** 成解说句子列表，左侧展示可增删改的句子列表，用户编辑完善后点「完成」，系统把这批拆分后的解说句子 **追加** 到面板下方的解说脚本列表中（即 `ScriptPanel` 的解说脚本 segments）。

**「视频理解生成」** 本期 **只预留弹窗外壳**，内部功能不开发，后续迭代再做。这样做的价值是：先把交互骨架（下拉菜单 + 两个并列入口 + 占位弹窗）一次性落地，第二个模式的实现可以在不改动入口与菜单的前提下增量补齐。整体视觉必须与现有项目（shadcn/ui new-york 风格、CSS 变量主题、`bg-card`/`border-border`/`text-foreground`/`primary` 体系、深浅色双主题）保持统一，达到「美观、优雅、顶级」并符合人机交互最佳实践（键盘可达、焦点陷阱、动画过渡、空态/加载/错误态完整）。

> **术语澄清（评审已决议 R1/Q1）**：需求原文「下拉多选」。两个模式是互斥工作流（点一个即进入该流程，无法同时执行），故按「下拉式的多个选项菜单（multiple options）」实现为 **单选动作菜单**（点击某项即启动对应流程并关闭菜单），**不采用** 复选框式多选。此结论已锁定，下游据此实现。

---

## 2. Technical Design（技术设计）

### 2.1 架构与现有可复用资产

- **入口按钮**：`ScriptPanel.tsx` 解说 tab 头部（`activeTab === 'narration'` 分支，当前约 1817–1839 行）的 `<button onClick={handleGenerateScript}>`。
- **父级编排**：`VideoEditingInterface.tsx` 通过 `onGenerateScript={handleScriptGenerationClick}`（约 2633 行）把按钮接到旧流程；解说 segments 通过 `segments={content?.scriptSegments || getMockScriptSegments(locale)}` 与 `onUpdateSegments={scriptGeneration.handleUpdateSegments}` 渲染与回写。
- **流式对话**：`/api/chat`（SSE，OpenAI 兼容 `data: {content|reasoning}` + `data: [DONE]`）。前端消费的成熟范式是 `src/components/video/hooks/useStoryboardChat.ts`：构造 `[system, ...history]` → `fetch('/api/chat')` → `reader.read()` 累加 `content` → 流结束后把最后一条 assistant 消息替换为「摘要」。本方案的对话面板与拆分调用都复用该范式与同一路由，**无需新增后端接口**。
- **数据结构**：`ScriptSegment { id, title, sentences: ScriptSentence[], narrationText?, ... }`、`ScriptSentence { id, text, narration?, ... }`（`src/types/index.ts`）。拆分结果天然映射为「一个新 segment，内含多条 sentence」。
- **弹窗外壳**：`src/components/ui/Modal.tsx`（已含 Esc 关闭、Tab 焦点陷阱、`aria-modal`、还焦），新弹窗优先复用它作为外层容器。
- **样式参考**：`ConvertToScriptModal.tsx` 的 header/footer/分栏/动画（`scale-95→scale-100 opacity` 过渡、`bg-primary/10` 头部、`bg-muted` 底部）是与项目一致的弹窗视觉基线。

### 2.2 关键代码路径与操作时序

**(A) 下拉菜单展开/选择**
1. 解说 tab 头部渲染 `AiGenerateMenu`（替换原单按钮），按钮点击 `toggleOpen()`。
2. 菜单 **默认采用基于触发按钮 `getBoundingClientRect` 的 `fixed`/portal 定位**（评审决议 R5：实测确认 tab 内容区存在 `overflow-hidden`、内层存在 `overflow-y-auto` 祖先，纯 `absolute z-50` 会被裁剪），渲染到 body 层、跟随按钮正下方（`top = rect.bottom + 4`、左对齐 `rect.left`）。触发按钮带 `aria-haspopup="menu"`、`aria-expanded`（R12）；菜单 `role="menu"`、含两个 `role="menuitem"`：「解说直接生成」「视频理解生成」。
3. 点击「解说直接生成」→ `onSelectNarrationDirect()` 并关闭菜单；点击「视频理解生成」→ `onSelectVideoUnderstanding()` 并关闭菜单。
4. 关闭条件：外部点击（document mousedown）、Esc、选中某项、失焦。键盘 ↑/↓ 在菜单项间移动，Enter 触发，Esc 关闭并把焦点还给触发按钮。

**(B) 解说直接生成 — 第 1 步（撰写）**
1. `useNarrationDirectScript.open()` 置 `isOpen=true`、`step='compose'`，并把 `draftText` **初始化为空串**（评审决议 R2/Q3：**不得** 用「现有解说脚本聚合文本」预填——否则第 2 步「追加」会与已有内容形成重复双份）。如确需种子文本，仅允许来自本次 AI 对话上下文，不得来自既有 `content.scriptSegments`。
2. 弹窗左侧 `<textarea>` 双向绑定 `draftText`（用户可直接编辑）；右侧为 `NarrationChatPanel`（基于 `useNarrationChat`）。
3. 用户在右侧输入需求并发送 → 出站消息体把 **当前 `draftText`（含用户手改）作为上下文** 一并发送（见 §4.2 prompt 约定）→ 流式返回完整改写后的文案 → 流结束后把累计文本 **一次性写回 `draftText`**（替换左侧），右侧该条 assistant 气泡替换为「已更新左侧文案」摘要。**并发保护（R4）**：改写流式进行中，左侧 `textarea` 置只读、「下一步」按钮禁用，规避「用户手改被流结束时的整段回写覆盖」的竞态；改写与拆分 **共用同一个 `AbortController`**，关闭弹窗或重新发送前先 `abort()` 旧请求。
4. 用户可多轮迭代；点「下一步」进入第 2 步。

**(C) 解说直接生成 — 第 2 步（逐句拆分与精修）**
1. 点「下一步」触发 `goToSplitStep()`：先 `splitting=true`，调用 `splitNarrationIntoSentences(draftText)`（§2.3）。
2. 拆分成功 → `splitSentences: NarrationSplitSentence[]`，`step='split'`，左侧渲染可编辑句子列表（**本期仅「编辑/新增/删除」三种操作，句子排序移出本期范围——R10**；交互观感复用 `ScriptPanel` 既有「inline `textarea` + 保存/取消 + 删除」模式，可参考其 `handleAddSentence`/`handleSaveEdit`/`handleDeleteSentence`）。拆分请求与第 1 步改写 **共用同一 `AbortController`**；`close()` 会同时中止二者。
3. 用户编辑完善后点「完成」→ `complete()` 把 `splitSentences` 组装成一个新的 `ScriptSegment` 并通过 `onComplete(segment)` 上抛父级，父级 **追加** 到 `content.scriptSegments`，关闭弹窗、重置 hook 状态。

**(D) 视频理解生成（占位）**
1. 点击「视频理解生成」→ 打开 `VideoUnderstandingModePlaceholderModal`，仅展示标题 + 「功能开发中 / Coming soon」插画与说明 + 关闭按钮。无业务逻辑。

### 2.3 拆分逻辑（一句话一句话）

主路径 **调用 AI**（满足需求「调用 AI 对文案进行解说文案的拆分」）：复用 `/api/chat`，system prompt 要求「把下列解说文案按句子切分，输出严格 JSON：`{"sentences":["...","..."]}`，不得增删字义、不加 markdown」。解析复用 `useStoryboardChat` 同款 `extractJson` 思路。**一致性校验（R1/Q4）**：把 AI 返回各句 `join('')` 去空白后与原文去空白比对，若不一致（模型擅自改写字义）则丢弃 AI 结果、回退本地拆分，保证「不增删字义」。

兜底路径 **本地确定性拆分**（`narrationSplit.ts` 内 `localSplitNarration`）：按中英文句末标点与换行切分（`。！？!?；;\n` 作为边界，保留标点，去空白与空句）。当 AI 调用失败或返回无法解析时自动回退，保证第 2 步永不卡死。两条路径都产出 `string[]` → 映射为 `NarrationSplitSentence[]`（带稳定 id）。

### 2.4 「追加」而非「替换」语义

现有 `scriptGeneration.handleScriptGenerated` 是 **整体替换** `scriptSegments`（用于旧视频理解流程），不可复用。本需求是「**添加** 到下方面板」。评审决议（R3）：**复用面板既有的 `scriptGeneration.handleUpdateSegments` 单一写入路径**（该 setter 已被 `ScriptPanel` 的句子增删改 `onUpdateSegments` 使用，持久化与 `lastModified` 等副作用一致），不另起裸 `onUpdateContent` 旁路：

写入语义为 **首次替换、后续追加** 的显式契约（修订，见
`docs/diagnoses/narration-direct-script-first-gen-append-instead-of-replace/analysis.md`）：
首次生成（面板为空，或面板里仍是系统示意占位 `segment-1/2/3`）→ 用新解说 **替换** 示意脚本；
后续生成 → **追加** 到已有真实解说之后。占位识别为纯函数 `isPlaceholderScript`（按 `getMockScriptSegments`
派生的固定 segment id 集合做子集判定，与 locale 无关；真实脚本 id 前缀互斥，故不会误删真实内容）。

```
handleAppendNarrationSegments(newSegments: ScriptSegment[]) => {
  const existing = content?.scriptSegments ?? [];          // 调用时读取最新值，避免闭包陈旧
  const replaceExisting = existing.length === 0 || isPlaceholderScript(existing);
  scriptGeneration.handleUpdateSegments(
    replaceExisting ? newSegments : [...existing, ...newSegments]
  );
}
```

历史背景：早期实现依赖「`content.scriptSegments` 恰好为空时 `[...[], ...new] == [new]`」这一**空态巧合**完成首次替换；一旦示意占位被任意交互物化进 `content`，巧合失效退化为追加（即上述 bug）。现已改为显式判定。

---

## 3. File / Module Change Plan（文件 / 模块变更计划）

### 3.1 新增文件

| 文件 | 意图（一行） |
|---|---|
| `src/components/video/components/AiGenerateMenu/AiGenerateMenu.tsx` | 「AI 生成」触发按钮 + 向下弹出的双入口下拉菜单（键盘可达、外部点击/Esc 关闭）。 |
| `src/components/video/components/AiGenerateMenu/index.ts` | 导出 `AiGenerateMenu`。 |
| `src/components/video/components/NarrationDirectScriptModal/NarrationDirectScriptModal.tsx` | 解说直接生成两步式弹窗主体（Stepper + 左右分栏 + footer 导航）。 |
| `src/components/video/components/NarrationDirectScriptModal/ComposeStep.tsx` | 第 1 步：左侧文案编辑 `<textarea>` + 右侧对话面板布局。 |
| `src/components/video/components/NarrationDirectScriptModal/SplitStep.tsx` | 第 2 步：拆分后句子列表的增删改编辑 UI。 |
| `src/components/video/components/NarrationDirectScriptModal/NarrationChatPanel.tsx` | 右侧 AI 对话面板（消息列表、输入框、发送/中止、流式态）。 |
| `src/components/video/components/NarrationDirectScriptModal/index.ts` | 导出 `NarrationDirectScriptModal`。 |
| `src/components/video/components/VideoUnderstandingModePlaceholderModal/VideoUnderstandingModePlaceholderModal.tsx` | 视频理解生成的占位弹窗（仅标题 + Coming soon + 关闭）。 |
| `src/components/video/components/VideoUnderstandingModePlaceholderModal/index.ts` | 导出占位弹窗。 |
| `src/components/video/hooks/useNarrationDirectScript.ts` | 解说直接生成编排 hook（open/close、step、draftText、splitting、splitSentences、complete）。 |
| `src/components/video/hooks/useNarrationChat.ts` | 面向「文案改写」的流式对话 hook（仿 `useStoryboardChat`，回写完整文案）。 |
| `src/components/video/utils/narrationSplit.ts` | 句子拆分工具：AI 主路径 + `localSplitNarration` 本地兜底 + JSON 解析。 |
| `src/components/video/hooks/__tests__/useNarrationDirectScript.test.ts` | hook 状态机与 complete 产物单测。 |
| `src/components/video/utils/__tests__/narrationSplit.test.ts` | 本地拆分边界与解析兜底单测。 |

### 3.2 修改文件

| 文件 | 意图（一行） |
|---|---|
| `src/components/video/ScriptPanel.tsx` | 解说 tab 头部用 `AiGenerateMenu` **直接替换** 原单「AI 生成」按钮，新增 `onSelectNarrationDirect` / `onSelectVideoUnderstanding` props（R6：不保留旧按钮双路径——该组件唯一消费者是 `VideoEditingInterface`，过度兼容无收益）。**R11：仅做「按钮替换 + 透传 props」最小改动；该文件已 2701 行、超 CLAUDE.md 800 行阈值，禁止在其内新增任何业务逻辑分支，业务全部落在新建组件/hook。** |
| `src/components/video/VideoEditingInterface.tsx` | 实例化 `useNarrationDirectScript`；把两个菜单回调传给 `ScriptPanel`；挂载两个新弹窗；新增 `handleAppendNarrationSegments` 追加回调。 |
| `src/components/video/types/videoEditingTypes.ts` | 新增 `NarrationDirectStep`、`NarrationSplitSentence`、`UseNarrationDirectScriptReturn` 等类型。 |
| `src/components/video/components/index.ts` | 导出 `AiGenerateMenu`、`NarrationDirectScriptModal`、`VideoUnderstandingModePlaceholderModal`。 |
| `src/components/video/hooks/index.ts` | 导出 `useNarrationDirectScript`、`useNarrationChat`。 |
| `src/components/video/utils/index.ts` | 导出 `narrationSplit` 工具（若 utils 走 barrel）。 |
| `src/lib/i18n.ts` | 新增菜单与弹窗文案键（**接口类型定义 + zh + en 三处都要改**，否则 `type-check` 失败）。 |

---

## 4. Interface Design（接口设计）

### 4.1 组件 Props / Hook 签名（TypeScript）

```ts
// AiGenerateMenu.tsx
interface AiGenerateMenuProps {
  onSelectNarrationDirect: () => void;
  onSelectVideoUnderstanding: () => void;
  disabled?: boolean;
  isBusy?: boolean;          // 复用原 isGenerating 显示按钮 spinner
  label?: string;            // 默认取 t.scriptPanel.header.aiGenerate
}

// videoEditingTypes.ts
export type NarrationDirectStep = 'compose' | 'split';
export interface NarrationSplitSentence { id: string; text: string }

export interface UseNarrationDirectScriptReturn {
  isOpen: boolean;
  step: NarrationDirectStep;
  draftText: string;
  isStreaming: boolean;            // 第1步对话流式中
  isSplitting: boolean;            // 第1→2步拆分中
  splitSentences: NarrationSplitSentence[];
  error: string | null;
  open: (initialText?: string) => void;
  close: () => void;
  setDraftText: (t: string) => void;
  sendChatMessage: (content: string) => Promise<void>;   // 改写左侧文案
  goToSplitStep: () => Promise<void>;                     // 触发拆分并切到 step2
  backToCompose: () => void;
  updateSplitSentences: (next: NarrationSplitSentence[]) => void;
  complete: () => void;            // 组装 segment 并回调 onComplete
}

// NarrationDirectScriptModal.tsx
interface NarrationDirectScriptModalProps {
  controller: UseNarrationDirectScriptReturn;
  onComplete: (segment: ScriptSegment) => void;   // 父级据此 append（经 handleUpdateSegments 合并）
  // R7：原 taskId? 全程未使用，已移除；后续如需埋点再按需引入
}

// VideoUnderstandingModePlaceholderModal.tsx
interface VideoUnderstandingModePlaceholderModalProps {
  isOpen: boolean;
  onClose: () => void;
}
```

### 4.2 复用的后端接口（无新增）

- `POST /api/chat`（SSE）：请求 `{ messages: {role, content}[] }`，响应 `data: {content?, reasoning?}` 分块 + `data: [DONE]`。
  - **对话改写 system prompt（要点）**：「你是专业短视频解说文案撰稿人；每次都输出 **当前完整的解说文案纯文本**（不要 markdown/不要解释/不要分镜），在用户最新需求基础上修改我给出的『当前文案』。」出站 user 内容拼接：`当前文案：\n<draftText>\n\n用户需求：<content>`。
  - **拆分 system prompt（要点）**：「把下列解说文案按自然句切分，仅输出严格 JSON：`{"sentences":[...]}`，不得改写字义、不加标点之外内容、不加代码块。」

### 4.3 完成时的 segment 组装规则

```ts
const segment: ScriptSegment = {
  id: genId(),                              // crypto.randomUUID() 优先，回退 `seg-${Date.now()}-${rand}`
  title: t.narrationDirectScript.defaultSegmentTitle,   // 例如「解说段落」
  narrationText: joinNarration(splitSentences.map(s => s.text)),  // 供 TTS 优先使用；R9：中文标点直接相接、英文句间补空格，避免 "A.""B."→"A.B."
  sentences: splitSentences.map(s => ({ id: genId(), text: s.text, narration: s.text })),
};
```

---

## 5. Data Model（数据模型）

本特性 **不引入数据库变更**，复用既有内存模型并新增少量 UI 态类型：

- 复用：`ScriptSegment` / `ScriptSentence`（`src/types/index.ts`）。流式对话消息 **沿用 `useStoryboardChat` 的 `StoryboardChatMessage` 同款结构**（`{ id, role, content, reasoningContent? }`），不要与 `/api/chat` 路由内部的 `ChatMessage` 混用（R8）。
- 新增（`videoEditingTypes.ts`）：`NarrationDirectStep`、`NarrationSplitSentence`、`UseNarrationDirectScriptReturn`。
- hook 内部态：`{ isOpen, step, draftText, isStreaming, isSplitting, splitSentences, error }`，以及 `useNarrationChat` 的 `{ messages: ChatMessage[], isStreaming }` 与 `AbortController` ref。
- 持久化：拆分结果落到 `content.scriptSegments`（沿用既有 `onUpdateContent` 持久化链路），无需新增存储字段。

---

## 6. Testing & Acceptance Criteria（测试与验收标准）

### 6.1 单元测试

- `narrationSplit.test.ts`：`localSplitNarration` 对 `。！？!?；;\n` 边界正确切句、去空句、保留标点；`parseSentencesJson` 能解析裸 JSON / 代码块包裹 / 首尾花括号截取；无法解析时回退本地拆分。
- `useNarrationDirectScript.test.ts`：`open` 初始化 `step='compose'`；`goToSplitStep` 成功后 `step='split'` 且 `splitSentences` 非空；拆分失败回退本地拆分且不抛出；`complete` 产出的 `ScriptSegment` 的 `sentences.length === splitSentences.length` 且 `narrationText` 为各句拼接；`close` 重置全部状态并 abort 流。
- `useNarrationChat`：mock `fetch` 的 SSE，断言多 `data:` 分块被累加、`[DONE]` 终止、流结束后回写完整文案、`abort()` 设置 `isStreaming=false`。

### 6.2 验收标准（Definition of Done）

1. 解说 tab 头部「AI 生成」点击后 **向下弹出** 含两项的下拉菜单，视觉与项目统一、支持键盘与 Esc/外部点击关闭。
2. 选「解说直接生成」打开两步弹窗：第 1 步左编辑右对话，右侧提需求能改写左侧文案，左侧亦可手动编辑；「下一步」触发 AI 逐句拆分。
3. 第 2 步左侧展示可增删改的拆分句子列表；「完成」后这些句子作为一个新解说 segment **追加** 到下方解说脚本面板，且可正常参与后续 TTS/字幕等既有功能。
4. 选「视频理解生成」打开占位弹窗（仅标题 + Coming soon + 关闭），无报错。
5. `npm run type-check` 与 `npm run lint` 通过；新增单测通过；桌面端手动走查（项目强制门槛）全流程通过。

### 6.3 手动走查脚本（桌面端）

进入视频编辑 → 点「AI 生成」→ 菜单下拉 → 解说直接生成 → 右侧输入「写一段 30 秒咖啡探店解说」→ 左侧出现文案 → 手改一句 → 再要求「更口语化」→ 下一步 → 句子列表出现 → 增/删/改一句 → 完成 → 下方解说脚本新增段落且句子无误 → 重新点「AI 生成」→ 视频理解生成 → 占位弹窗显示。

---

## 7. Risks & Mitigations（风险与缓解）

| 风险 | 影响 | 缓解 |
|---|---|---|
| 「下拉多选」语义歧义（菜单 vs 复选框） | 交互方向偏差 | §1 已显式声明按「单选动作菜单」实现，留给 Subtask #1 确认。 |
| AI 改写时混入解释/markdown 污染左侧文案 | 文案脏 | 强约束 system prompt + 流结束后剥离 ``` 代码块；用户可手动编辑兜底。 |
| 拆分 LLM 返回不可解析 | 第 2 步卡死 | `localSplitNarration` 本地确定性兜底，永不阻断。 |
| 下拉菜单被面板 `overflow-hidden` 祖先裁剪 | 菜单显示不全 | 实测已确认 tab 内容区（~ScriptPanel:1972）`overflow-hidden` + 内层（~2018）`overflow-y-auto`，故 **默认即用基于按钮 `getBoundingClientRect` 的 `fixed`/portal**（R5），不以 `absolute` 为主路径；开发期桌面走查复核菜单完整可见。 |
| 误用「替换」语义清空已有解说 | 数据丢失 | 新增独立 `handleAppendNarrationSegments` 追加回调，不复用旧 `handleScriptGenerated` 替换逻辑。 |
| i18n 仅改 zh/en 漏改接口类型 | `type-check` 失败 | 变更计划明确要求接口定义 + zh + en 三处同改，并在 PR 自查。 |
| 关闭弹窗时流式请求未中止 | 资源泄漏/竞态 | `close()` 调用 `AbortController.abort()` 并清理 ref。 |
| 与既有 `ConvertToScriptModal` / `VideoUnderstandingScriptModal` 混淆 | 误接半成品流程 | 本特性新建独立占位弹窗，不接旧组件；旧入口保持不动，二者解耦。 |
| 空文案点「下一步」 | 拆分空结果 | `goToSplitStep` 前校验 `draftText.trim()`，为空时禁用按钮并提示。 |

---

## 8. 评审已决议（原开放问题，Subtask #1 锁定）

> 以下决议已回灌正文（§1 / §2.2 / §2.3 / §2.4），开发节点须严格遵循，不得再次发散。

1. **菜单语义** → 单选动作菜单（multiple options，非复选框）；点击即进入对应流程并关闭菜单。（正文 §1 / §2.2 A）
2. **完成写入语义** → **首次（空态或仅系统示意占位）替换、后续追加**：经 `scriptGeneration.handleUpdateSegments` 单一写入路径合并写入；首次生成用新解说替换示意占位（`isPlaceholderScript` 按占位 segment id 子集判定），后续生成追加。（§2.4；修订自原「始终追加靠空态巧合替换」，见 `docs/diagnoses/narration-direct-script-first-gen-append-instead-of-replace/analysis.md`）
3. **第 1 步初始文案** → **默认空串**；禁止用「现有解说脚本聚合文本」预填（否则与「追加」叠加成重复内容）。如需种子文本仅可取自本次 AI 对话，不取既有 segments。（§2.2 B-1）
4. **拆分路径** → **AI 主 + 本地确定性兜底** 保持不变（满足需求「调用 AI 拆分」字面要求）；因句子切分本质为确定性操作，要求 AI 结果与原文做字符一致性校验，一旦发现字义被改写即自动回退 `localSplitNarration`，确保「不增删字义」。（§2.3）

> 字数与结构自检：本文档包含 Overview、Technical design、File/module change plan、Interface design、Data model、Testing & acceptance、Risks & mitigations 全部必需小节，正文 > 800 字，文件清单逐项含一行意图，可供下游工程师按行实现。

---

## 评审结论（Review Verdict — Subtask #1）

**有条件通过（Approved with conditions）。**

方案经代码库逐节实测核验，**可行性、一致性、完整性整体达标**：复用 `/api/chat` SSE + `useStoryboardChat`/`extractJson` 范式、`Modal.tsx` 焦点陷阱、`ScriptSegment`/`ScriptSentence` 模型与 i18n 三处同改均与现网吻合，无需新增后端接口，技术风险可控、范围右尺寸（13 新增多为小颗粒组件/hook，符合 800 行/50 行阈值拆分）。本轮发现的 **5 项 P1 已在 v2 正文就地修复并锁定决议**：R1 决议 4 个开放问题、R2 初始文案空串防重复、R3 复用 `handleUpdateSegments` 单一写入、R4 统一 `AbortController` + 流式并发保护、R5 下拉默认 `fixed`/portal 抗裁剪。**无遗留 P0 / P1。**

开发节点（Subtask #2）须满足以下**放行条件**（均为 P2，已在「评审记录」列明）：

1. **R6**：ScriptPanel 直接以菜单替换旧按钮，不保留双路径。
2. **R7**：移除未使用的 `taskId?` prop。
3. **R8**：对话消息沿用 `StoryboardChatMessage` 同款结构，勿与路由 `ChatMessage` 混用。
4. **R9**：`narrationText` 拼接英文句间补空格，避免相接丢空格。
5. **R10**：第 2 步仅「编辑/新增/删除」，句子排序不在本期。
6. **R11**：ScriptPanel（已 2701 行）仅做按钮替换 + 透传 props，零新增业务分支。
7. **R12**：触发按钮补 `aria-haspopup`/`aria-expanded`，菜单/项补 `role`。

满足以上条件并通过 §6 单测与桌面走查（项目强制门槛）后，即可进入开发。

---

## 实施过程发现的方案缺陷（Issues Found During Implementation — Subtask #2）

> 开发节点（Subtask #2）实现过程中发现的、与 §4.1 接口示意存在的小幅不一致，均已就地采用更一致的实现并记录于此，行为与设计意图完全一致。

1. **`onComplete` 的归属（§4.1）**：§4.1 把 `onComplete` 列在 `NarrationDirectScriptModalProps` 上，但 `UseNarrationDirectScriptReturn.complete: () => void` 的注释明确要求「组装 segment 并回调 onComplete」——`complete()` 由 hook 实现且无入参，故 hook 必须在实例化时持有 `onComplete`。实现采用：`onComplete` 作为 `useNarrationDirectScript({ onComplete, defaultSegmentTitle, locale })` 的**选项**（由 `VideoEditingInterface` 传入 `handleAppendNarrationSegments`），`NarrationDirectScriptModal` 仅接收 `controller` 一个 prop（避免悬空 prop，与 R7 精神一致）。父级「追加经 handleUpdateSegments 合并写入」的语义不变。

2. **`NarrationChatMessage` 类型落点（§5 / R8）**：§5 要求对话消息「沿用 `StoryboardChatMessage` 同款结构」且「不与路由 `ChatMessage` 混用」。为避免与 `useStoryboardChat` 产生跨模块耦合，实现在 `videoEditingTypes.ts` 内新增 `NarrationChatMessage extends ChatMessage { reasoningContent?; summaryText? }`（同款字段），`useNarrationChat` / `useNarrationDirectScript` 均引用该集中类型；`UseNarrationDirectScriptReturn` 增补 `chatMessages: NarrationChatMessage[]`、`abortChat()` 供右侧对话面板渲染（§4.1 返回类型为示意，非穷举）。

3. **`defaultSegmentTitle` 入参（§4.3）**：§4.3 的 `title` 取 `t.narrationDirectScript.defaultSegmentTitle`。i18n 在组件层，hook 不直接读 `t`，故 `defaultSegmentTitle` 作为 hook 选项由 `VideoEditingInterface` 传入（随 locale 变化、`complete()` 取最新值），新增 i18n 键 `narrationDirectScript.defaultSegmentTitle`（zh「解说段落」/ en「Narration segment」）。

> 以上均为接口落点的最小调整，不改变任何工作流、写入语义或评审决议（R1–R12）；§3 文件变更计划逐项均已落地，`type-check` 通过、新增单测（narrationSplit 16 + useNarrationDirectScript 10）全绿。
