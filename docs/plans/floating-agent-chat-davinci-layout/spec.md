# 设计方案：浮动 Agent 对话面板 + 达芬奇风格主编辑布局

- **Feature slug**: `floating-agent-chat-davinci-layout`
- **Version**: v2（评审就地修复稿；P0/P1 已闭环）
- **Author**: Subtask #0 / 方案设计（solution architect）
- **Reviewer**: Subtask #1 / 设计评审（Anthropic 资深工程评审）
- **Scope**: 仅前端（Next.js 15 / React 19 / TypeScript / Tailwind CSS 3），不涉及后端、数据库与 API。
- **作用范围文件**: 主要改动集中在 `src/components/video/VideoEditingInterface.tsx`、`src/styles/video-editing.css`，新增 `src/components/video/components/AgentChatDock/` 目录下若干组件，外加 `src/lib/i18n.ts` 与 `tailwind.config.js` 的少量增量。

---

## 评审记录（Review Notes）

> **评审人**：Subtask #1 / 设计评审（Anthropic 资深工程评审）。
> **评审基线（已逐行核对源码，非凭记忆）**：`VideoEditingInterface.tsx`（render 根 line 2598-2719、chatProps 接线 line 2602-2619、左侧列 line 2601）、`src/styles/video-editing.css`（布局类与 1024/768 断点）、`tailwind.config.js`（zIndex 语义表，line 121-132）、`VideoChatWindow.tsx`（props 契约 line 27-48）、`src/contexts/LocaleContext.tsx`（`t: Translations`，对象式）+ `src/lib/i18n.ts`（i18n 机制）、`package.json`（测试运行器 `vitest run`）、`src/components/video/components/index.ts`（barrel 风格）。**全仓 grep 确认 `.video-editing-left-sidebar` 仅 `VideoEditingInterface.tsx` 与 `video-editing.css` 引用**（另一命中为 `docs/diagnoses/` 文档，非代码）。
>
> 下列每条均按 可行性 / 完整性 / 一致性 / 右尺寸 四维评估。**P0、P1 已在本 v2 稿正文就地修复**；P2 记录在案并按正文标注处理（不阻塞合入）。

| 编号 | 维度 | 严重度 | 问题 | 处置 |
|---|---|---|---|---|
| R-1 | 一致性 / 可行性 | **P0** | §3.3 提出 `t('videoEditor.agentDock.fabLabel')` 形式的扁平字符串键。但本仓 i18n 是**对象式强类型访问**：`useLocale()` 返回 `t: Translations`（对象），消费方写 `t.videoScript.tab.aiVideo`；**不存在 `t(key)` 函数，也不存在 `videoEditor` 命名空间**（现有为 `videoEditing` / `videoScript`）。且新增键必须同步更新 `Translations` **TS 接口**，否则 `npm run type-check` 失败——而 type-check 通过是本方案 DoD。原稿会让下游实现直接撞墙。 | 已重写 §3.3：文案挂到既有 `videoEditing.agentDock.*` 子命名空间，对象式访问 `t.videoEditing.agentDock.fabLabel`；明确三处落点（`Translations` 接口块 + en 对象 + zh 对象）必须同步。 |
| R-2 | 完整性 / 可行性 | **P1** | §2.2(A) 定义了 `dock:850`/`dock-panel:860` 两个 z 语义层，但 §8.2 的 CSS 骨架既未写 `z-index`，正文也未说明在 JSX 上挂 `z-dock`/`z-dock-panel`。时间轴锁定遮罩 `.agent-timeline-lock-overlay` 为 `z-index:50` 的绝对定位元素且参与根 stacking context；`z-auto` 的 FAB/浮窗会被它**覆盖**——恰在 Agent 执行期间：关闭态 FAB 的忙碌指示被盖住、打开态浮窗下半部（含输入框与「取消」按钮）不可点击。这同时违反 §6.2 验收步骤 5。 | 已在 §2.2(A) / §8.2 / §8.3 明确：FAB 与浮窗根元素在 JSX 上分别挂 `z-dock` / `z-dock-panel`（以 tailwind 语义 token 为单一真源），二者 > 50 < `overlay:900` < `modal:1000`，确保执行期可见可点、模态仍正确盖住浮窗。 |
| R-3 | 右尺寸 | P2 | §3.2/§5 的 `useAgentChatDock` hook 对一个布尔开合属过度封装（多一个文件）。 | 评审建议直接用父组件 `useState`，省去该 hook 文件；§5 已标注（不阻塞）。 |
| R-4 | 完整性（a11y） | P2 | 仅说明 Esc 关闭与打开聚焦，未说明关闭后**焦点回到 FAB** 及浮窗内焦点管理。 | §2.3 已补焦点回收一句（不阻塞）。 |
| R-5 | 完整性（rollout） | P2 | 无特性开关、硬切换，未给回滚说明。 | 纯前端 UI 重排、无持久化/接口变更，硬切换可接受；§7 已注明回滚=`git revert`（不阻塞）。 |
| R-6 | 一致性 | P2（已确认无回归） | 根容器加 `relative` 是否影响既有 `fixed inset-0 z-modal` 模态锚定？ | `position:relative`（z-index auto）不创建 stacking context、不改变 `fixed` 子元素的视口锚定（仅 transform/filter/perspective 会），模态不受影响。维持原方案。 |
| R-7 | 一致性 | P2 | 新增 `AgentChatDock/*` 须满足 CLAUDE.md 阈值（单文件≤800 行、单函数≤50 行、嵌套≤4）。 | 组件均为小文件，预期天然达标；§5 列为实现期自查项。 |

---

## 1. Overview（概述）

当前 Ecliptrix 的视频编辑工作区（`VideoEditingInterface`）采用「左侧贯穿上下的 Agent 对话面板（20% 宽）+ 右侧 80% 工作区」的两段式布局。右侧工作区上方是三个等宽（各 33.33%）的面板——文本脚本（ScriptPanel）、素材管理（MaterialsPanel）、播放预览（VideoPlayerPanel），下方是占 30% 高度的时间轴（TimelinePanel）。这一布局把一个对话式 AI 助手当作一等公民常驻在最左侧，挤压了真正的剪辑工作区，且与 DaVinci Resolve、Premiere 等主流非线性编辑器（NLE）以「预览居中、媒体池/检视器分居两翼、时间线贯穿底部」为核心的视觉范式相去甚远。

本方案要做两件事。其一，把最左侧那一整列 Agent 对话面板从常驻布局中**移除**，改造为 Notion 风格的「右下角圆形浮动按钮（FAB）+ 点击展开的浮动弹窗」。浮动弹窗悬浮在编辑工作区右侧，高度约占软件高度的 80%、宽度约占 30%；弹窗内部依旧挂载现有的 `VideoChatWindow` 组件，**对话、Agent 模式、执行态、撤销、取消等全部交互逻辑保持不变**——用户仍可通过与 Agent 对话来驱动视频剪辑，唯一变化是它从「常驻列」变成「按需浮层」。其二，把腾出来的空间重新分配给主编辑界面，使其更贴近达芬奇式 NLE：上方区域改为「左 25% 文本脚本 | 中 50% 播放/合成预览 | 右 25% 素材管理」，下方时间轴改为**贯穿整窗全宽**。

这样改造后，预览面板获得 50% 的中央主舞台位置，脚本与素材作为左右辅翼各占 25%，时间轴横贯底部，整体观感与专业剪辑软件一致；而 AI 能力以「随叫随到、不占空间」的浮层形式存在，既保留了产品差异化的 Agent 剪辑能力，又把屏幕主权交还给剪辑本身。改造是纯前端、纯 UI 结构与样式层面的工作，不触碰播放引擎、合成、导出、素材解析等核心数据链路，因此风险面集中在布局与状态管理，回归风险可控。

---

## 2. Technical Design（技术设计）

### 2.1 现状架构（事实基线）

入口链路：`src/app/page.tsx` → `src/components/Container.tsx` → `src/components/video/projects/VideoEditorContainer.tsx` → `src/components/video/VideoEditingInterface.tsx`。

`VideoEditingInterface.tsx` 的 render 根（当前 line ~2598-2719）结构如下（精简引用）：

```tsx
return (
  <div className="flex-1 flex min-h-0 overflow-hidden">
    {/* 左侧 AI Chat 列，20% 宽 */}
    <div className="video-editing-left-sidebar flex flex-col border-r border-border bg-card relative z-sidebar">
      <VideoChatWindow conversation={activeConversation} onSendMessage={handleSendChatMessage} ... />
    </div>

    {/* 右侧 80% 工作区 */}
    <div className="video-editing-right-area flex flex-col min-h-0 overflow-hidden">
      <div className="video-editing-upper-panels flex min-h-0 overflow-hidden">
        <div className="video-editing-script-panel bg-muted border-r border-border"><ScriptPanel ... /></div>
        <MaterialsPanel ... className="video-editing-materials-panel bg-card border-r border-border" />
        <div className="video-editing-player-panel bg-card"><VideoPlayerPanel ref={videoPlayerRef} ... /></div>
      </div>
      <div className="video-editing-timeline-section border-t border-border bg-muted relative">
        {agent.agentIsExecuting && <div className="agent-timeline-lock-overlay" />}
        <TimelinePanel ... />
      </div>
    </div>

    {/* 之后是若干 fixed inset-0 的模态：VideoSearchModal / AudioSearchModal / ImageSearchModal / ContentPolishModal ... */}
  </div>
);
```

布局完全由 `src/styles/video-editing.css` 中的固定百分比 flex 类驱动（**无 react-resizable-panels / allotment 之类的可拖拽分栏库**）：

| 类名 | 当前宽 | 当前高 | flex 行为 |
|---|---|---|---|
| `.video-editing-left-sidebar` | 20% | 100% | `flex-shrink:0; overflow:hidden` |
| `.video-editing-right-area` | 80% | 100% | `flex:1` |
| `.video-editing-upper-panels` | 100%（右区） | 70% | `flex-shrink:0`（外加 JSX 上的 `flex`） |
| `.video-editing-script-panel` | 33.33% | 100% | `flex-shrink:0` |
| `.video-editing-materials-panel` | 33.33% | 100% | `flex-shrink:0` |
| `.video-editing-player-panel` | 33.33% | 100% | `flex:1`（末位填充） |
| `.video-editing-timeline-section` | 100%（右区） | 30% | `flex-shrink:0` |

z-index 语义量表（`tailwind.config.js` `theme.extend.zIndex`，勿用裸数值）：`base:0`、`sidebar:10`、`dropdown:20`、`overlay:900`、`modal:1000`、`popover:1100`、`toast:1200`、`debug:9999`。已有模态用法示例（`WatermarkRemovalModal.tsx:488`）：`fixed inset-0 bg-black/30 flex items-center justify-center z-modal p-4`。

`VideoChatWindow`（`src/components/video/components/VideoChatWindow/VideoChatWindow.tsx`）的 props 见下文 §3.1；它内部用 `TimelineChatPanel` 渲染消息、`AgentBusyBar` 渲染忙碌态，依赖 `useLocale()` 取多语言文案。**本方案不修改该组件的任何内部逻辑或 props**。

### 2.2 目标架构

#### (A) 浮动 Agent 对话 Dock（FAB + 浮窗）

新增一个自包含的「Agent Chat Dock」模块，挂在编辑工作区根容器内（而非 portal 到 body），以便其 80%/30% 尺寸与定位锚定到**编辑区**而非整个浏览器视口——这样浮窗不会盖住顶部 Tab/导航条，符合「占软件 80% 高度」的语义。

- 把根容器 `<div className="flex-1 flex min-h-0 overflow-hidden">` 追加 `relative`，作为 FAB 与浮窗的绝对定位上下文。
- 删除整个 `.video-editing-left-sidebar` 列（含其上的 `VideoChatWindow` 挂载点）。
- 在右侧工作区之后、模态之前，新增 `<AgentChatDock ... />`，它内部：
  - 关闭态：渲染一个圆形 FAB（`AgentChatFloatingButton`），绝对定位于编辑区右下角（`absolute bottom-6 right-6`），直径约 56px，主色填充，内含聊天/AI 图标；当 `agentIsExecuting` 为真时叠加一圈脉冲/旋转指示，让用户在浮窗关闭时也能感知 Agent 正在工作。
  - 打开态：渲染浮窗（`AgentChatFloatingPanel`），绝对定位于右下角（`absolute bottom-6 right-6`），`width:30%`、`height:80%`（相对编辑区根），带卡片底色、圆角、边框与阴影；顶部是标题栏（标题文案 + 关闭按钮），主体区把现有 `VideoChatWindow` 原样塞进去（透传全部 props）。打开时 FAB 隐藏（浮窗自带关闭按钮，亦保留一个收起入口）。
- 开合状态由 `VideoEditingInterface` 持有的布尔 `isAgentDockOpen`（`useState`，默认 `false`）或一个轻量 hook `useAgentChatDock()` 管理；交互：点击 FAB → 打开并自动聚焦输入框；点击关闭按钮或按 `Esc` → 关闭。点击浮窗外部默认**不**关闭（剪辑场景下用户常需边看画面边问 Agent，避免误关）。
- 层级：FAB 与浮窗位于编辑内容之上、真模态之下。新增两个语义 z-index token `dock` 与 `dock-panel`（`dock:850`、`dock-panel:860`，均 < `overlay:900` < `modal:1000`）。**评审修正（R-2）：这两个 token 必须真正应用到元素上——在 JSX 上分别给 FAB 根挂 `z-dock`、给浮窗根挂 `z-dock-panel`（以 tailwind 语义 token 为单一真源；§8.2 的手写 CSS 不再重复写 `z-index`，避免双源漂移）。** 这是阻塞项而非装饰：时间轴锁定遮罩 `.agent-timeline-lock-overlay` 是 `z-index:50` 的绝对定位元素并参与根 stacking context；若 FAB/浮窗保持 `z-auto`，会被该遮罩覆盖——Agent 执行期间关闭态 FAB 的忙碌指示会被盖住、打开态浮窗下半部（含输入框与「取消」按钮）将不可点击。设为 850/860（> 50）即保证执行期可见可点；同时 < `modal:1000`，故 `VideoSearchModal` 等 `z-modal` 全屏模态打开时仍正确盖住浮窗（模态优先）。

打开/关闭用 CSS 过渡（opacity + translateY/scale，约 200ms ease-out），可复用 `tailwindcss-animate`；尊重 `prefers-reduced-motion`。

#### (B) 达芬奇风格主布局重排

- 右侧工作区改为全宽：`.video-editing-right-area { width:100%; }`（左侧列已删，flex 自然占满）。
- 上方三栏**重新排序为 脚本 → 预览 → 素材**，并改宽度为 25% / 50% / 25%：
  - `.video-editing-script-panel { width:25%; }`（保持左翼第一位）
  - `.video-editing-player-panel { width:50%; }`（移到**中间**，作为主预览舞台）
  - `.video-editing-materials-panel { width:25%; }`（移到**右翼**末位）
  - JSX 中三个面板的渲染顺序相应调整为：ScriptPanel、VideoPlayerPanel、MaterialsPanel。注意末位面板当前靠 `flex:1` 填充，调整后应让**中间的预览**用 `flex:1`、两翼用固定 25% + `flex-shrink:0`，避免 1px 取整缝隙；或三者都给精确 `flex-basis` 并允许末位 `flex:1`。本方案采用：脚本/素材 `width:25%; flex-shrink:0`，预览 `flex:1; min-width:0`（中间填充剩余，≈50%）。
- 时间轴 `.video-editing-timeline-section` 维持 `width:100%`，因左列移除而自然贯穿整窗全宽，无需额外改动其宽度；保留 `agent-timeline-lock-overlay` 锁定逻辑。
- 响应式断点同步更新（见 §2.4）。

### 2.3 关键代码路径与操作时序

打开 Agent 浮窗的时序：
1. 用户点击右下角 FAB → `AgentChatFloatingButton` 的 `onClick` 调用 `onOpen()`。
2. `VideoEditingInterface` 把 `isAgentDockOpen` 置 `true`。
3. `AgentChatDock` 条件渲染 `AgentChatFloatingPanel`，CSS 入场过渡；`useEffect` 在打开后聚焦内部 textarea（沿用 `VideoChatWindow` 既有的 textareaRef 行为，无需改动）。
4. 用户在浮窗里发消息 → `VideoChatWindow` 的 `onSendMessage` 仍指向 `handleSendChatMessage`（原样透传）→ 进入既有 Agent/Chat 链路，与改造前**完全一致**。
5. Agent 执行期间 `agent.agentIsExecuting` 为真：时间轴显示锁定遮罩（既有逻辑）；若此时浮窗被关闭，FAB 显示忙碌指示。
6. 用户按 `Esc` 或点关闭 → `isAgentDockOpen` 置 `false`，浮窗出场过渡后卸载，FAB 复现。关闭后应把键盘焦点交还给 FAB（`AgentChatFloatingButton` 持 ref，在 `onClose` 后 `.focus()`），避免焦点落到 `<body>`（评审 R-4，a11y）。

数据流不变：`activeConversation`、所有 `handle*` 回调、`agent.*` 状态从 `VideoEditingInterface` 透传给浮窗内的 `VideoChatWindow`，与原左侧列挂载完全相同——只是父级容器从 `.video-editing-left-sidebar` 换成 `AgentChatFloatingPanel`。

### 2.4 响应式策略

`video-editing.css` 现有 `@media (max-width:1024px)` 把 sidebar 提到 25%、三栏维持 33.33%；`@media (max-width:768px)` 改为竖向堆叠。改造后：
- 移除断点中对 `.video-editing-left-sidebar` / `.video-editing-right-area` 的旧规则。
- `≤1024px`：三栏保持 25/50/25（或在窄屏退化为 30/40/30，本方案保持 25/50/25 不变以简化）。
- `≤768px`：上方三栏改 `flex-direction:column`、各 100% 宽（既有竖向规则保留，去掉 sidebar 相关项）；FAB 与浮窗在窄屏下浮窗宽度放宽到 `min(90%, 30rem)`、高度 80%，避免 30% 在手机上过窄。
- 因本产品主形态是 Electron 桌面应用（宽屏），窄屏只需保证不崩坏即可。

---

## 3. Interface Design（接口设计）

本特性无 REST / WebSocket / CLI 变更，接口即新增 React 组件的 props 契约。

### 3.1 既有组件（不改）

`VideoChatWindow` 的 props 维持不变，浮窗将原样透传：

```ts
interface VideoChatWindowProps {
  conversation: Conversation | undefined;
  onSendMessage: (message: string) => Promise<void>;
  onClearMessages: () => void;
  isLoading: boolean;
  onCreativeBrainstormingClick?: () => void;
  onPolishClick?: () => void;
  onConvertMessageToScript?: (content: string) => void;
  agentMode: boolean;
  onAgentModeChange: (enabled: boolean) => void;
  agentIsExecuting: boolean;
  onAgentUndo?: (message: ChatMessage) => void; // @deprecated
  executionState?: AgentExecutionState | null;
  onUndoAll?: (messageId: string) => void;
  onUndoSingle?: (messageId: string, toolCallId: string) => void;
  onCancel?: () => void;
  hasMaterials?: boolean;
}
```

### 3.2 新增组件

```ts
// src/components/video/components/AgentChatDock/AgentChatDock.tsx
interface AgentChatDockProps {
  /** 浮窗开合受控状态 */
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Agent 是否正在执行（用于关闭态 FAB 的忙碌指示） */
  agentIsExecuting: boolean;
  /** 透传给内部 VideoChatWindow 的全部 props（直接 spread） */
  chatProps: VideoChatWindowProps;
}

// src/components/video/components/AgentChatDock/AgentChatFloatingButton.tsx
interface AgentChatFloatingButtonProps {
  onClick: () => void;
  isExecuting: boolean;
  /** 无障碍标签 / tooltip 文案（来自 i18n） */
  label: string;
}

// src/components/video/components/AgentChatDock/AgentChatFloatingPanel.tsx
interface AgentChatFloatingPanelProps {
  onClose: () => void;
  title: string;          // i18n
  children: React.ReactNode; // 内部为 <VideoChatWindow {...chatProps} />
}
```

可选轻量 hook（若不想在大组件里直接 `useState`）：

```ts
// src/components/video/components/AgentChatDock/useAgentChatDock.ts
function useAgentChatDock(initialOpen = false): {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}
```

### 3.3 i18n 文案（对象式访问，挂到既有 `videoEditing` 命名空间）

> **评审修正（R-1）**：本仓 i18n 是**对象式强类型**，不是字符串键函数。`useLocale()` 返回 `t: Translations`（一个对象），消费方写 `t.videoEditing.agentDock.fabLabel`——参见现网用法 `t.videoScript.tab.aiVideo`（`VideoUnderstandingScriptModal.tsx:345`）。**不要**用 `t('...')`，**不要**新建 `videoEditor` 命名空间（仓内不存在；现有为 `videoEditing` / `videoScript`）。
>
> 因为是强类型，新增文案需在 **三处同步落地**，缺一会导致 `npm run type-check` 失败（违反 DoD）：
> 1. **`Translations` 接口**：在 `src/lib/i18n.ts` 的 `videoEditing` 接口块（约 line 1383，与既有 `autoMix` 平级）新增 `agentDock` 子结构；
> 2. **en 翻译对象**：在 en 的 `videoEditing` 块（约 line 3883）补对应值；
> 3. **zh 翻译对象**：在 zh 的 `videoEditing` 块（约 line 6391）补对应值。

`Translations` 接口新增（`videoEditing` 块内）：

```ts
agentDock: {
  fabLabel: string;
  panelTitle: string;
  close: string;
  busy: string;
};
```

文案值（en / zh 对象同结构填入）：

| 访问路径 | zh | en |
|---|---|---|
| `t.videoEditing.agentDock.fabLabel` | 「AI 剪辑助手」 | "AI editing assistant" |
| `t.videoEditing.agentDock.panelTitle` | 「AI 剪辑助手」 | "AI Editing Assistant" |
| `t.videoEditing.agentDock.close` | 「收起」 | "Close" |
| `t.videoEditing.agentDock.busy` | 「Agent 执行中…」 | "Agent running…" |

新增组件通过 `const { t } = useLocale();` 取值，与 `VideoChatWindow` 等既有组件完全一致。

---

## 4. Data Model（数据模型 / 内存状态）

无数据库与持久化 schema 变更。仅新增一处 UI 内存态：

```ts
// VideoEditingInterface 内
const [isAgentDockOpen, setIsAgentDockOpen] = useState<boolean>(false);
```

- 默认 `false`（首次进入编辑器时浮窗关闭，FAB 可见）。
- 生命周期：组件内存态，随项目切换（`key={projectId}` 触发的重挂载）自然重置；**不写入 `content`、不参与自动保存**，避免污染项目持久化数据结构与回归测试基线。
- 若后续产品需要「记住上次开合」，可在 `content` UI state 里加可选字段 `agentDockOpen?: boolean`，但本期不做（保持持久化层零改动）。

新增 z-index token（`tailwind.config.js`）：

```js
zIndex: {
  // ...existing
  dock: '850',        // 关闭态 FAB
  'dock-panel': '860' // 打开态浮窗（仍低于 overlay:900 / modal:1000）
}
```

---

## 5. File / Module Change Plan（文件 / 模块变更计划）

| 文件 | 动作 | 一句话意图 |
|---|---|---|
| `src/components/video/components/AgentChatDock/AgentChatDock.tsx` | 新建 | Dock 容器：按 `isOpen` 切换渲染 FAB 或浮窗，透传 chatProps，处理 Esc/聚焦。 |
| `src/components/video/components/AgentChatDock/AgentChatFloatingButton.tsx` | 新建 | 右下角圆形 FAB，含图标与执行中脉冲指示，点击触发 `onOpen`。 |
| `src/components/video/components/AgentChatDock/AgentChatFloatingPanel.tsx` | 新建 | 右下角 30%×80% 浮窗外壳：标题栏 + 关闭按钮 + slot 渲染 `VideoChatWindow`。 |
| `src/components/video/components/AgentChatDock/useAgentChatDock.ts` | ~~新建~~ 评审建议**省略**（R-3） | 一个布尔开合无需独立 hook，直接在父组件 `useState` 即可，少一个文件。如确需复用再抽。 |
| `src/components/video/components/AgentChatDock/index.ts` | 新建 | 模块 barrel 导出 `AgentChatDock`。 |
| `src/components/video/VideoEditingInterface.tsx` | 修改 | 根容器加 `relative`；删除 `.video-editing-left-sidebar` 列；新增 `<AgentChatDock>`；上方三栏 JSX 顺序改为 脚本→预览→素材；新增 `isAgentDockOpen` 状态。 |
| `src/styles/video-editing.css` | 修改 | 三栏宽改 25/50/25 并调整 flex；右区 100% 宽；移除/弃用 sidebar 类；新增 FAB 与浮窗样式（`.agent-chat-fab`、`.agent-chat-floating-panel` 及入场/出场动画）；更新 1024/768 断点。 |
| `tailwind.config.js` | 修改 | `zIndex` 增 `dock`/`dock-panel` 两个语义层级。 |
| `src/lib/i18n.ts` | 修改 | 新增 §3.3 的 4 个文案键（zh + en）。 |
| `src/components/video/components/index.ts`（若存在 barrel） | 修改（按需） | 导出 `AgentChatDock`，与现有组件导出风格一致。 |
| `src/components/video/components/AgentChatDock/__tests__/AgentChatDock.test.tsx` | 新建 | 单测：开合切换、Esc 关闭、执行中 FAB 指示、props 透传。 |

> 备注：经全仓检索，依赖布局类名（`.video-editing-left-sidebar` / `*-script-panel` / `*-player-panel` / `*-materials-panel`）的只有 `VideoEditingInterface.tsx` 与 `video-editing.css` 两处；其余命中 `VideoChatWindow` 的文件（`useAgentExecution.ts`、`timeline/*`、`index.ts`）均为聊天组件内部引用，与布局宽度无关，**无需改动**。评审已实测确认：全仓 grep `.video-editing-left-sidebar` 仅命中上述两文件（外加 `docs/diagnoses/` 文档，非代码）。
>
> 备注（评审 R-7）：新增 `AgentChatDock/*` 各文件须满足 CLAUDE.md 阈值（单文件 ≤ 800 行、单函数 ≤ 50 行、嵌套 ≤ 4、圈复杂度 ≤ 10）——这些都是小展示组件，预期天然达标，列为实现期提交前自查项。`barrel` 导出风格与 `src/components/video/components/index.ts` 现状保持一致（混用 `export { default as X }` 与具名导出）。

---

## 6. Testing & Acceptance Criteria（测试与验收标准）

### 6.1 自动化测试（vitest + @testing-library/react，遵循仓库现有测试风格）

- `renders_fab_when_dock_closed`：默认渲染时存在 FAB、不存在浮窗。
- `opens_panel_on_fab_click`：点击 FAB 后浮窗出现、FAB 隐藏，且内部 `VideoChatWindow` 被挂载。
- `closes_panel_on_close_button_and_escape`：点关闭按钮与按 `Esc` 均能关闭浮窗、FAB 复现。
- `shows_busy_indicator_on_fab_when_executing`：`agentIsExecuting=true` 且 dock 关闭时，FAB 显示忙碌态。
- `passes_through_chat_props`：透传的 `onSendMessage` 等回调在浮窗内被正确接线（mock 校验调用）。
- 布局快照/样式断言：可对 `video-editing.css` 关键宽度做轻量断言或视觉走查（CSS 不易单测，主要靠人工走查）。

### 6.2 人工验收（桌面 Electron 走查，作为强制门禁）

1. 进入任一视频项目编辑器：**左侧不再有常驻对话列**；右下角出现圆形浮动按钮。
2. 上方区域呈「左 25% 脚本 | 中 50% 预览 | 右 25% 素材」；预览居中且明显最大；时间轴横贯底部全宽。
3. 点击 FAB：右下角弹出浮窗，目测高度≈软件高度 80%、宽度≈30%，不遮挡顶部 Tab。
4. 在浮窗内与 Agent 对话、切换 Agent 模式、触发一次剪辑操作、撤销、取消——行为与改造前一致。
5. Agent 执行时时间轴出现锁定遮罩；关闭浮窗后 FAB 显示忙碌指示；打开 `VideoSearchModal` 等模态时模态正确盖住浮窗。
6. `npm run type-check`、`npm run lint`、`npm run build` 通过；窄屏（≤768px）布局不崩坏。

### 6.3 Definition of Done

布局重排与浮动 Dock 均落地；`VideoChatWindow` 内部逻辑零改动；类型检查/构建通过；桌面走查全部通过。

---

## 7. Risks & Mitigations（风险与缓解）

| 风险 | 影响 | 缓解 |
|---|---|---|
| 浮窗用 `absolute` 锚定编辑区根，但根含 `overflow:hidden`，可能裁剪阴影/圆角溢出 | 视觉瑕疵 | 浮窗留出 `bottom/right` 内边距（如 `24px`），阴影画在容器内；必要时给根 `overflow:visible` 仅对 Dock 例外，或退化为 `position:fixed` + 计算编辑区偏移。 |
| z-index 与既有模态/VolumeSlider(999999) 冲突 | 浮窗被异常遮挡或反盖模态 | 采用语义层 `dock:850`/`dock-panel:860`（< overlay/modal）；VolumeSlider 的高 z 仅拖动时短暂出现，可接受。 |
| 三栏从 33/33/33 改 25/50/25 后，ScriptPanel/MaterialsPanel 内部假设了 1/3 宽度的栅格 | 内部内容拥挤/换行 | 两翼各 25% 仍是合理宽度；MaterialsPanel 素材网格已有 `@media` 降列规则；走查确认无溢出，必要时微调内部 grid 列数。 |
| 删除左侧列后，原 `z-sidebar`、`border-r` 等样式残留引用 | 死代码/样式错位 | 同步清理 `.video-editing-left-sidebar` 及断点内相关规则，全仓 grep 确认无其它引用。 |
| 浮窗内 `VideoChatWindow` 高度从「贯穿整列」变为「80% 浮窗」，其内部滚动/自适应高度可能错位 | 输入框或消息区高度异常 | 浮窗主体用 `flex flex-col min-h-0`，给 `VideoChatWindow` `h-full`；其内部已是 flex 自适应，预期兼容，走查验证。 |
| Electron 顶部 Tab/导航高度差异导致「80% 高度」目测不准 | 视觉偏差 | 锚定到编辑区根（而非视口），百分比相对编辑区计算，天然避开顶部条。 |
| 改动集中在 2862 行的大组件，易引入回归 | 功能回归 | 仅做「搬运挂载点 + 增删容器」，不动数据流与回调；配合 §6 单测与桌面走查双保险。 |
| i18n 三处落点漏改导致 `type-check` 失败（R-1） | 构建/DoD 不达标 | 严格按修订后 §3.3 在 `Translations` 接口 + en + zh 三处同步新增 `videoEditing.agentDock`；提交前跑 `npm run type-check`。 |
| z 层未应用，执行期遮罩盖住浮窗（R-2） | 功能不可用 | FAB/浮窗根挂 `z-dock`/`z-dock-panel`（> 50）；走查验证执行期可点。 |

**回滚策略（评审 R-5）**：本特性为纯前端 UI 重排，**无数据库 / 持久化 / 接口变更**（`isAgentDockOpen` 仅内存态、不入 `content`），因此无需特性开关，桌面端硬切换可接受；一旦上线发现问题，回滚即对相关提交执行 `git revert`，不留数据迁移尾巴。

---

## 8. 附录：精确改动片段（供下游逐行实现参考）

### 8.1 `video-editing.css` 宽度改动（before → after）

```css
/* before */
.video-editing-left-sidebar { width:20%; height:100%; flex-shrink:0; overflow:hidden; } /* 删除整条 */
.video-editing-right-area   { width:80%; height:100%; flex:1; overflow:hidden; }
.video-editing-script-panel    { width:33.33%; height:100%; flex-shrink:0; overflow:hidden; }
.video-editing-materials-panel { width:33.33%; ... }
.video-editing-player-panel    { width:33.33%; ... flex:1; ... }

/* after */
/* .video-editing-left-sidebar 整条删除 */
.video-editing-right-area      { width:100%; height:100%; flex:1; overflow:hidden; }
.video-editing-script-panel    { width:25%; height:100%; flex-shrink:0; overflow:hidden; } /* 左翼 */
.video-editing-player-panel    { flex:1; min-width:0; height:100%; overflow:hidden; background-color:var(--card); display:flex; flex-direction:column; } /* 中央，≈50% */
.video-editing-materials-panel { width:25%; height:100%; flex-shrink:0; overflow:hidden; background-color:var(--card); } /* 右翼 */
```

> JSX 顺序需改为：`script-panel` → `player-panel` → `materials-panel`（当前是 script → materials → player）。中央预览用 `flex:1` 吃掉两翼 25%+25% 之外的剩余空间，得到约 50%。

### 8.2 FAB 与浮窗样式骨架（新增）

```css
.agent-chat-fab {
  position: absolute; right: 24px; bottom: 24px;
  /* z-index 由 JSX 上的 z-dock 工具类提供（=850 > lock-overlay 的 50，见 R-2）；此处刻意不写 z-index，保持语义 token 单一真源 */
  width: 56px; height: 56px; border-radius: 9999px;
  display: flex; align-items: center; justify-content: center;
  background: var(--primary); color: var(--card);
  box-shadow: 0 8px 24px rgba(0,0,0,0.18);
  cursor: pointer; transition: transform .15s ease, box-shadow .15s ease;
}
.agent-chat-fab:hover { transform: translateY(-1px) scale(1.04); }
.agent-chat-fab.is-busy::after { /* 脉冲环 */ content:''; position:absolute; inset:-4px; border-radius:9999px;
  border:2px solid var(--primary); animation: agent-fab-pulse 1.2s ease-out infinite; }
@keyframes agent-fab-pulse { 0%{opacity:.7; transform:scale(1)} 100%{opacity:0; transform:scale(1.25)} }

.agent-chat-floating-panel {
  position: absolute; right: 24px; bottom: 24px;
  /* z-index 由 JSX 上的 z-dock-panel 工具类提供（=860 > lock-overlay 的 50，见 R-2）；浮窗下半部与时间轴锁定遮罩重叠，必须高于它，否则执行期输入框/取消按钮不可点 */
  width: 30%; height: 80%;
  display: flex; flex-direction: column; min-height: 0;
  background: var(--card); border: 1px solid var(--border);
  border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,0.24);
  overflow: hidden; animation: agent-panel-in .2s ease-out;
}
@keyframes agent-panel-in { from{opacity:0; transform:translateY(12px) scale(.98)} to{opacity:1; transform:none} }
@media (prefers-reduced-motion: reduce) {
  .agent-chat-fab, .agent-chat-floating-panel { animation: none; transition: none; }
}
@media (max-width: 768px) { .agent-chat-floating-panel { width: min(90%, 30rem); } }
```

### 8.3 `VideoEditingInterface.tsx` 结构改动要点

1. 根 `<div>` 追加 `relative`：`<div className="flex-1 flex min-h-0 overflow-hidden relative">`。
2. 删除 `.video-editing-left-sidebar` 整段及其内的 `<VideoChatWindow .../>`。
3. 上方三栏顺序调整为 ScriptPanel → VideoPlayerPanel → MaterialsPanel。
4. 在右侧工作区 `</div>` 之后、`<VideoSearchModal>` 之前，新增：

```tsx
<AgentChatDock
  isOpen={isAgentDockOpen}
  onOpen={() => setIsAgentDockOpen(true)}
  onClose={() => setIsAgentDockOpen(false)}
  agentIsExecuting={agent.agentIsExecuting}
  chatProps={{
    conversation: activeConversation,
    onSendMessage: handleSendChatMessage,
    onClearMessages: handleClearChatMessages,
    isLoading: isChatLoading,
    onCreativeBrainstormingClick: handleCreativeBrainstormingClick,
    onPolishClick: handlePolishClick,
    onConvertMessageToScript: handleConvertMessageToScript,
    agentMode: agent.agentMode,
    onAgentModeChange: agent.setAgentMode,
    agentIsExecuting: agent.agentIsExecuting,
    executionState: agent.executionState,
    onAgentUndo: undefined,
    onUndoAll: agent.undoAllOperations,
    onUndoSingle: agent.undoSingleOperation,
    onCancel: agent.cancelExecution,
    hasMaterials: materialManagement.allMaterials.length > 0,
  }}
/>
```

5. 在组件状态区新增：`const [isAgentDockOpen, setIsAgentDockOpen] = useState(false);`（评审 R-3：直接用 `useState`，不引入 `useAgentChatDock` hook）。
6. **（评审 R-2，阻塞项）** `AgentChatFloatingButton` 的圆形根元素 className 含 `z-dock`，`AgentChatFloatingPanel` 的浮窗根元素 className 含 `z-dock-panel`（如 `className="agent-chat-fab z-dock"` / `className="agent-chat-floating-panel z-dock-panel"`）。两者 z 值（850/860）须 > `.agent-timeline-lock-overlay` 的 50，确保 Agent 执行期间 FAB 忙碌指示可见、浮窗输入框与「取消」按钮可点。

---

---

## 评审结论（Review Verdict）

**结论：有条件通过（Approved with conditions）。**

整体评价：设计与现状代码**高度吻合**——render 根结构、chatProps 接线、`VideoChatWindow` props 契约、z-index 语义表、测试运行器（`vitest run`）、布局类名引用面均经评审逐行核对属实；方案纯前端、不触碰播放/合成/导出/素材解析等核心数据链路，范围与风险评估**右尺寸合理**，未见过度工程（仅 R-3 的可选 hook 略冗，已建议删去）。两个阻塞问题已在本 v2 稿正文闭环：

- **R-1（P0，i18n 机制错配）** → §3.3 已改为对象式 `t.videoEditing.agentDock.*` 并明确接口/en/zh 三处同步。
- **R-2（P1，z-index 未应用致执行期遮挡）** → §2.2(A)/§8.2/§8.3 已要求挂 `z-dock`/`z-dock-panel`（> 50）。

**放行条件（实现期必须满足）**：
1. i18n 严格按修订后 §3.3 落地（对象式访问 + `Translations` 接口/en/zh 三处同步），确保 `npm run type-check` 通过。
2. FAB 与浮窗根元素必须挂 `z-dock` / `z-dock-panel`，并在桌面走查中实证「Agent 执行期间浮窗输入框/取消按钮可点、关闭态 FAB 忙碌指示可见」。
3. 同步清理 `.video-editing-left-sidebar` 及 1024/768 断点内相关规则（全仓引用仅 `VideoEditingInterface.tsx` 与 `video-editing.css`，已核实）。
4. §6.2 桌面 Electron 走查为**强制门禁**，必须全部通过。

P2 建议（R-3 / R-4 / R-5 / R-7）不阻塞合入，按正文标注处理即可。满足上述 4 项放行条件后，本设计可进入实现阶段。

---

## 实施过程发现的方案缺陷（Issues Found During Implementation）

> 记录人：Subtask #2 / 代码开发。以下为实现期发现的方案小缺口及就地修正，均不改变整体架构，仅为让代码可编译/可读而做的最小补全。

| 编号 | 维度 | 问题 | 处置 |
|---|---|---|---|
| I-1 | 完整性 | §3.2 让 `AgentChatDockProps.chatProps` 取类型 `VideoChatWindowProps`，但 §5 的「文件 / 模块变更计划」未把 `VideoChatWindow/VideoChatWindow.tsx` 与 `VideoChatWindow/index.ts` 列为待改文件——而该 `interface VideoChatWindowProps` **原本未 `export`**，无法被 `AgentChatDock` 导入。若不导出则只能在 Dock 内重复声明一份等价类型（双源、易漂移），违背单一真源原则。 | 在 `VideoChatWindow.tsx` 将 `interface` 改为 `export interface`（纯类型导出，零行为/props 变更，不违反「不改该组件内部逻辑」），并在 `VideoChatWindow/index.ts` 追加 `export type { VideoChatWindowProps }`。两文件属变更计划的隐含必需项，已补改。 |
| I-2 | 完整性（a11y） | §3.2 的 `AgentChatFloatingPanel` props 仅列 `onClose/title/children`，关闭按钮缺无障碍标签来源。 | 新增 `closeLabel: string` prop，消费既有 §3.3 的 `t.videoEditing.agentDock.close`，作为关闭按钮 `aria-label`/`title`；属对既定 i18n 键的正常使用，无新增文案。 |
| I-3 | 右尺寸（增强） | §2.2(A) 仅要求关闭态 FAB 用脉冲环表达忙碌，未明确是否复用 `busy` 文案。 | 实现时让 FAB 在 `agentIsExecuting` 时把 `aria-label`/`title` 切换为 `t.videoEditing.agentDock.busy`（屏幕阅读器可播报「Agent 执行中…」），使该 i18n 键被真实消费；纯增强，不影响视觉。 |
| I-4 | 一致性（视觉） | 三栏重排为 脚本→预览→素材 后，原「素材带 `border-r`、预览无边框（末位）」的分隔线在新顺序下会错位（预览在中间却无右边框、素材在末位却仍带右边框）。 | 调整为：脚本 `border-r`、预览 `border-r`、素材（末位）去掉 `border-r`，使相邻面板间各有一条分隔线、最右缘无多余边框。属重排的自然结果，未新增样式类。 |

上述修正后：`npm run type-check` 通过、`npm run build` 成功、新增 `AgentChatDock.test.tsx`（22 项源码结构断言）全绿、ESLint 对新文件零告警。

---

（本文档已由 Subtask #1 完成设计评审：P0/P1 就地修复完毕，版本升至 **v2**。Subtask #2 已完成代码开发，并在上方记录实施期补全。）
