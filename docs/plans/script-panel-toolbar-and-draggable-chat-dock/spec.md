# 设计方案：文案/脚本面板工具栏收敛 + 可拖动的浮动 Agent 对话按钮

- **Feature slug**: `script-panel-toolbar-and-draggable-chat-dock`
- **Version**: v2（评审修订稿；Subtask #1 评审通过并就地修复 P0/P1）
- **Author**: Subtask #0 / 方案设计（solution architect）
- **Scope**: 仅前端（Next.js 15 / React 19 / TypeScript / Tailwind CSS 3）。不涉及后端、数据库、REST/WebSocket 接口、Alembic 迁移与任何 API 契约变更。
- **作用范围文件**：`src/components/video/components/AiGenerateMenu/AiGenerateMenu.tsx`、`src/components/video/ScriptPanel.tsx`、`src/components/video/components/AgentChatDock/*`、`src/styles/video-editing.css`、`src/lib/i18n.ts`，外加对应单测。

---

## 评审记录（Review Notes · v2）

> 评审人：Subtask #1 / 方案评审（senior reviewer）。已逐条核对源码——行号、props、i18n 键、CSS、tailwind z-token、既有测试断言、VideoEditingInterface 挂载点均已比对属实。下表列出全部问题与严重度；P0/P1 已在本文档 v2 正文就地修复，P2 已给出处置决定。

| # | 维度 | 严重度 | 问题 | 处置 |
|---|---|---|---|---|
| R1 | 完备性 / 可行性 | **P1** | 「轻点 vs 拖动」激活去重在 2.4(C)/(D) 同时给出"onPointerUp 派生激活"与"保留 `onClick={onActivate}` 后备"两条路径，二者对鼠标/触屏会**双触发**（开窗后立即关窗），且把最易出错的交互留给"开发节点处理"。 | 已在 2.4(C)/(D) 重写为**单一激活路径**：Pointer 仅负责拖拽检测，激活统一走原生 `onClick`（同时覆盖键盘 Enter/Space）；hook 暴露 `movedRef`，`onClick` 首行判 `movedRef` 吞掉拖拽后的合成 click；附精确事件流表。 |
| R2 | 完备性 | **P1** | 测试更新清单不全：现有 `AgentChatDock.test.tsx` 的 `opens_panel_on_fab_click` 硬断言 `expect(dock).toContain('onClick={onOpen}')`（line 52），新结构改用 `onActivate`/`toggle` 后该断言必失败，而变更表只笼统写"更新结构断言"。 | 已在第 3 节文件表与 6.1 节**逐条点名**所有会被新结构打破的断言（line 47 `if (!isOpen)`、line 52 `onClick={onOpen}`）并给出替换。 |
| R3 | 完备性 / 一致性 | P2 | 半遮挡/钳制几何把 panel 宽高写死为 `0.30*workspaceW / 0.80*workspaceH`，但 CSS 存在 `@media (max-width:768px){ .agent-chat-floating-panel{ width: min(90%,30rem) } }`，窄屏下实际宽度 ≠ 30%。 | 已在 2.4(B) 改为**读 panel 真实 `getBoundingClientRect()`** 做钳制，无 ref 时退化为 30%/80% 估算，并注明拖拽以桌面端为主。 |
| R4 | 完备性 | P2 | 钳制会破坏"恰好遮挡一半"的不变量（FAB 拖到顶部时 panel 下移会改变遮挡比例），spec 未声明孰先孰后。 | 已在 2.4(B) 声明：**"Panel 在界"优先**，边角处遮挡比例允许偏离 1/2；"FAB 不消失"由 FAB 独立钳制 + 始终渲染保证，与 Panel 钳制解耦。 |
| R5 | 完备性 | P2 | 未处理工作区 resize 后位置可能失效。 | 已在 2.4(C) 增加 resize 守卫（监听 resize 时对 `position` 重新钳制）；因位置以 right/bottom 锚定右下角，影响有限。 |
| R6 | 适度性 | P2 | en 标题 `'Script'`→`'Copywriting / Script'` 偏长，spec 自列为待决项。 | 已在 2.3 定稿：en 用简洁的 `'Copy / Script'`。 |
| R7 | 一致性 | P2 | 可选文案（`emptyState.scriptWillAppear`、`autoMix` 报错串）是否同步未定。 | 已在 2.3 定稿：同步 `scriptWillAppear`（低风险，纳入本期）；`autoMix` 长说明串保持原样（超字面范围）。 |
| R8 | 一致性 | P2 | i18n 存在重复键 `scriptPanel.header.convertAllSpeech` 与 `scriptPanel.actions.convertAllSpeech`；菜单项用 actions 版，header 版在外部按钮移除后可能无引用。 | 标记为遗留项：本期不删（属独立 i18n 清理）；Subtask #2 若 grep 确认 `header.convertAllSpeech` 全仓零引用，可顺手移除并记入"实施过程发现的方案缺陷"段。 |

---

## 1. Overview（概述）

本方案聚焦视频编辑工作区（`VideoEditingInterface`）里两块独立的 UI 体验问题，全部属于纯前端的结构与交互调整，不触碰播放引擎、合成、导出、素材解析等核心数据链路。

第一块是「文本脚本」面板（`ScriptPanel`）头部工具栏的收敛。当前解说（narration）tab 的右上角并排放着两个控件：一个「AI 生成」下拉按钮（`AiGenerateMenu`，含"解说直接生成 / 视频理解生成"两个入口），以及一个独立的「统一转换所有语音」图标按钮（调用 `handleBatchConvertToSpeech` 对全部片段依次跑 TTS）。两个按钮功能上都属于"对整段脚本做一次批处理动作"，并排摆放让头部显得拥挤、层级不清。需求要求把「统一转换所有语音」从外部独立按钮**收进**左侧的「AI 生成」下拉菜单内部，作为下拉项之一，点击下拉后选择即可触发；外面不再保留这个独立按钮。同时把面板标题从「文本脚本」改名为「文案/脚本」，更贴合该面板既承载解说文案又承载视频脚本的实际语义。

第二块是右下角浮动 Agent 对话 Dock（`AgentChatDock`）的交互增强。当前实现是"二选一"：浮窗关闭时只渲染右下角圆形浮动按钮（FAB），浮窗打开时只渲染 30%×80% 浮窗、FAB 整个消失。需求有两点改进：其一，浮窗打开时浮动按钮**不要消失**，浮窗只遮挡按钮的一半（按钮另一半始终露出，用户随时能感知并抓取它）；其二，这个浮动按钮要**可以拖动**改变位置。换言之，FAB 从"开合时隐时现的静态锚点"升级为"常驻、可拖拽、且与浮窗保持半遮挡相对关系"的浮层把手。

这两块改造合起来的价值：脚本面板头部更干净、命名更准确；AI 对话浮层从固定死角变成用户可自由摆放、且不会被自己的浮窗吞掉的可控浮层。改造均为 UI 层工作，回归风险集中在布局/事件处理，不影响业务数据。

---

## 2. Technical Design（技术设计）

### 2.1 现状事实基线（已逐行核对源码）

- **AiGenerateMenu**（`src/components/video/components/AiGenerateMenu/AiGenerateMenu.tsx`，243 行）：受控下拉，props 为 `onSelectNarrationDirect`、`onSelectVideoUnderstanding`、`disabled`、`isBusy`、`label`。内部 `items` 数组当前 2 项；菜单经 `createPortal` 以 `position: fixed` 渲染到 `document.body`（line 203-237），位置由触发按钮 `getBoundingClientRect` 计算（`computePosition`，line 62-66）。键盘可达：↑/↓/Home/End 在 `handleMenuKeyDown` 中循环移动（line 132-156），Enter 触发 `selectItem`（line 85-95），Esc / 外部点击 / 失焦关闭。
- **ScriptPanel 头部**（`ScriptPanel.tsx` line 1791-1948）：`activeTab === 'narration'` 分支（line 1813-1841）渲染 `<AiGenerateMenu .../>`（line 1817-1822，仅当 `onSelectNarrationDirect && onSelectVideoUnderstanding` 同时存在）+ 独立的「统一转换所有语音」`<button onClick={handleBatchConvertToSpeech}>`（line 1824-1840）。标题渲染于 line 1802：`{t.scriptPanel.header.title}`。
- **批量转换**：`handleBatchConvertToSpeech`（line 1625-1744）依次对 `segments` 调 `handleConvertToSpeech`，过程态由 `isBatchConverting`（line 184）+ `batchProgress`（line 185-194）管理。**`batchProgress` 仅被 `setBatchProgress` 写入，无任何 JSX 直接渲染它**（全文件 grep 确认），过程反馈走 `showSuccess/showError` toast 与内容区 `opacity-50 pointer-events-none` 灰显（line 2610）。因此移走外部按钮不会遗留孤儿进度条。
- **i18n**（`src/lib/i18n.ts`，对象式强类型 `Translations`）：`scriptPanel.header.title` = zh `'文本脚本'`（line 6214）/ en `'Script'`（line 3700）；`scriptPanel.header.aiGenerate` = zh `'AI 生成'`（line 6220）；`scriptPanel.actions.convertAllSpeech` = zh `'统一转换所有语音'`（line 6234）/ en `'Convert All Speech'`（line 3720）。类型签名在 `Translations` 接口 `scriptPanel.header`（line ~1196-1202，含 `convertAllSpeech`/`aiGenerate`）与 `scriptPanel.actions`（line ~1214 含 `convertAllSpeech`）块内。
- **AgentChatDock**（`AgentChatDock.tsx`，85 行）：`if (!isOpen) return <AgentChatFloatingButton .../>;`（line 58-71）否则 `return <AgentChatFloatingPanel>...<VideoChatWindow {...chatProps}/></AgentChatFloatingPanel>;`（line 73-81）。`fabRef` 用于关闭后回收焦点（line 51-56）。
- **FAB**（`AgentChatFloatingButton.tsx`，53 行）：`forwardRef` 的 `<button className="agent-chat-fab z-dock{is-busy}">`，props `onClick`/`isExecuting`/`label`。
- **Panel**（`AgentChatFloatingPanel.tsx`，65 行）：`<div className="agent-chat-floating-panel z-dock-panel" role="dialog">`，标题栏 + 关闭按钮 + body slot。
- **CSS**（`src/styles/video-editing.css` line 2332-2418）：`.agent-chat-fab { position:absolute; right:24px; bottom:24px; width:56px; height:56px; ... }`；`.agent-chat-floating-panel { position:absolute; right:24px; bottom:24px; width:30%; height:80%; ... }`。两者 z-index 不写在 CSS，由 JSX 上的 `z-dock`(=850) / `z-dock-panel`(=860) tailwind 语义 token 提供（>50 锁定遮罩，<900 overlay）。挂载于 `VideoEditingInterface.tsx` 根 `<div className="flex-1 flex min-h-0 overflow-hidden relative">`（line 2607），即 `position:relative` 的工作区——FAB/Panel 的 `absolute` 以它为定位上下文。开合状态 `isAgentDockOpen`（`useState<boolean>(false)`，line 2710-2714 接线）。

### 2.2 需求 1：把「统一转换所有语音」收进「AI 生成」下拉

**思路**：扩展 `AiGenerateMenu` 的 `items` 模型，使其支持"带禁用/忙碌态、且分组分隔"的菜单项；新增第三项"统一转换所有语音"。`ScriptPanel` 删除外部独立按钮，把 `handleBatchConvertToSpeech` 与其禁用/忙碌态通过新 props 注入菜单。

**AiGenerateMenu 改造**（保持向后兼容，原两入口签名不变）：

1. 新增 props：
   - `onConvertAllSpeech?: () => void` —— 选中"统一转换所有语音"时调用。
   - `convertAllSpeechDisabled?: boolean` —— 无片段（`segments.length === 0`）时禁用该项。
   - `isConvertingAllSpeech?: boolean` —— 批量转换进行中，该项显示 spinner 并禁用。
2. 把内部 `items` 元素类型从隐式扩展为显式结构：`{ key; title; desc; onSelect; disabled?: boolean; busy?: boolean }`。仅当 `onConvertAllSpeech` 存在时追加第三项：
   ```ts
   ...(onConvertAllSpeech ? [{
     key: 'convert-all-speech',
     title: t.scriptPanel.actions.convertAllSpeech,        // '统一转换所有语音'
     desc: t.scriptPanel.actions.convertAllSpeechDesc,     // 新增文案
     onSelect: onConvertAllSpeech,
     disabled: convertAllSpeechDisabled,
     busy: isConvertingAllSpeech,
   }] : []),
   ```
3. `selectItem(index)`：进入即判断 `if (item.disabled || item.busy) return;`（不关闭、不触发），避免禁用项被 Enter/点击误触发。
4. `handleMenuKeyDown` 的 ↑/↓ 仍按 `items.length` 循环，不跳过禁用项（实现简单、可达性可接受）；视觉上禁用项加 `opacity-50 cursor-not-allowed`，忙碌项渲染 spinner（复用触发按钮里那段 `animate-spin` SVG）。
5. 渲染层：第三项前插入一条分隔线（`<div className="my-1 h-px bg-border" role="separator" />`），把"生成脚本"两项与"批处理动作"一项在视觉上分组；分隔线不进入 `itemRefs`/键盘焦点序列。
6. **触发按钮忙碌态合并**：触发按钮的 `isBusy` 当前来自 `isGenerating`；批量转换时也应让触发按钮转圈，故 `ScriptPanel` 传 `isBusy={isGenerating || isBatchConverting}`（见下）。

**ScriptPanel 改造**（`ScriptPanel.tsx`）：

1. 删除 line 1823-1840 的独立「统一转换所有语音」`<button>` 整块（连同其外层注释）。
2. 改造 line 1817-1822 的 `<AiGenerateMenu>` 调用，追加三个 props：
   ```tsx
   <AiGenerateMenu
     onSelectNarrationDirect={onSelectNarrationDirect}
     onSelectVideoUnderstanding={onSelectVideoUnderstanding}
     isBusy={isGenerating || isBatchConverting}
     onConvertAllSpeech={handleBatchConvertToSpeech}
     convertAllSpeechDisabled={segments.length === 0}
     isConvertingAllSpeech={isBatchConverting}
   />
   ```
   注意：原渲染条件 `onSelectNarrationDirect && onSelectVideoUnderstanding` 保持不变（菜单本就只在解说 tab、且两入口齐备时出现）；`handleBatchConvertToSpeech` 是组件内已定义的稳定闭包，可直接传引用。
3. `handleBatchConvertToSpeech` 自身逻辑零改动（其内部已自带 `isBatchConverting || segments.length === 0` 的重复防御，与菜单项禁用态形成双保险）。
4. `<>...</>` Fragment 在删掉第二个按钮后只剩 `<AiGenerateMenu>` 一个子节点，可保留 Fragment 也可去壳，二者等价；建议保留以减少 diff 噪音。

### 2.3 需求 2：标题「文本脚本」→「文案/脚本」

纯文案改动，改 i18n 即可，组件读取处（`ScriptPanel.tsx` line 1802 `{t.scriptPanel.header.title}`）无需动：

- zh：`scriptPanel.header.title` `'文本脚本'` → `'文案/脚本'`（line 6214）。
- en：`scriptPanel.header.title` `'Script'` → `'Copy / Script'`（line 3700。**评审 R6 定稿**：取简洁的 `'Copy / Script'`，既对齐中文"文案/脚本"语义又不过长；不采用更冗长的 `'Copywriting / Script'`）。
- 一致性附带项（**评审 R7 定稿**）：空状态文案 `scriptPanel.emptyState.scriptWillAppear` zh `'文本脚本将显示在这里'`（line 6257）**同步改为** `'文案/脚本将显示在这里'`，en `'Text script will be displayed here'`（line 3743）**同步改为** `'Copy / Script will appear here'`（低风险、提升一致性，纳入本期）；`autoMix` 报错里的「文本脚本」（line 6406，`noScriptMaterials`）属解释性长句、超出"面板标题改名"的字面范围，**保持原样**，避免长句改写引入二义。

### 2.4 需求 3：浮窗打开时 FAB 半遮挡不消失 + FAB 可拖动

**核心改动：AgentChatDock 从"二选一"改为"FAB 常驻 + Panel 叠加"，并引入可拖拽位置状态。**

#### (A) 渲染结构调整（`AgentChatDock.tsx`）

由：
```tsx
if (!isOpen) return <FAB .../>;
return <Panel>...<VideoChatWindow/></Panel>;
```
改为：
```tsx
return (
  <>
    <AgentChatFloatingButton
      ref={fabRef}
      position={fabPosition}            // null=用 CSS 默认右下角；否则用内联 right/bottom
      isExecuting={agentIsExecuting}
      label={agentIsExecuting ? t.videoEditing.agentDock.busy : t.videoEditing.agentDock.fabLabel}
      onActivate={toggle}               // 轻点=开合切换（拖拽不触发）
      onDragMove={handleDragMove}       // 见 (C) hook
      onDragStateChange={setDragging}
    />
    {isOpen && (
      <AgentChatFloatingPanel
        onClose={onClose}
        title={t.videoEditing.agentDock.panelTitle}
        closeLabel={t.videoEditing.agentDock.close}
        anchor={fabPosition}            // 据 FAB 位置算自身位置，半遮挡 FAB
      >
        <VideoChatWindow {...chatProps} />
      </AgentChatFloatingPanel>
    )}
  </>
);
```
- `toggle` = `isOpen ? onClose() : onOpen()`，由父级 `onOpen/onClose` 组合（props 契约不变，VideoEditingInterface 接线零改动）。
- FAB 始终渲染 → 打开态它依然存在，仅被 Panel 半遮挡（z 关系见下）。
- z-index：FAB `z-dock`(=850)、Panel `z-dock-panel`(=860) 维持不变；Panel 在上，故被遮挡的那半 FAB 自然被盖住，露出的那半在 Panel 之外可见可点。

#### (B) 半遮挡几何（panel 锚定 FAB）

以"距工作区右/下边的距离"`{ right, bottom }`（px）描述 FAB 锚点，默认 `null` ≙ CSS 的 `right:24 / bottom:24`。设 FAB 边长 `S=56`，则：

- Panel 右距 = FAB 右距（右边缘对齐，Panel 远宽于 FAB，水平方向完全覆盖 FAB 宽度）。
- Panel 下距 = FAB 下距 `+ S/2`（=28）。即 Panel 底边落在 FAB 垂直中线上。

效果：Panel 覆盖 FAB 的**上半**，FAB 下半（28px）从 Panel 底边下方露出 → 恰好"遮挡一半、按钮不消失"。默认态（未拖动）同此公式：Panel 较现状上移 28px，视觉差异极小。

- 越界钳制：FAB 被拖到顶/左附近时，Panel（向左上展开、宽 30%/高 80%）可能溢出工作区。实现须钳制 Panel 的 `right`/`bottom`，保证其完整留在工作区内（留 8px 安全边）：`bottom ≤ workspaceH - panelHeightPx - 8`、`right ≤ workspaceW - panelWidthPx - 8`、二者均 `≥ 8`。**`panelWidthPx`/`panelHeightPx` 取 Panel 元素的真实 `getBoundingClientRect()`（评审 R3）**，不得写死 `0.30*workspaceW / 0.80*workspaceH`——CSS 在 `@media (max-width:768px)` 下把 panel 宽改为 `min(90%, 30rem)`，写死比例会在窄屏算错钳制边界；Panel 未挂载（关闭态）时退化为 `0.30*workspaceW / 0.80*workspaceH` 估算。workspaceW/H 由工作区 ref 的 `clientWidth/clientHeight` 实时读取。
- **钳制优先级（评审 R4）**：当 FAB 拖到顶/左导致"FAB 下距 + S/2"超界时，**以"Panel 完整留在工作区内"为先**，遮挡比例允许偏离 1/2；需求中"浮动按钮不要消失"由 (C) 对 FAB 自身的独立钳制 + FAB 始终渲染共同保证，与 Panel 钳制解耦——两者各自钳制，不会因 Panel 让位而把 FAB 推出可视区。
- **resize 守卫（评审 R5）**：`useDraggableFab` 监听工作区/`window` resize，对已存 `position` 重新做 `[0, workspaceW-S]/[0, workspaceH-S]` 钳制，避免缩窗后 FAB 落到不可见区；因位置以 right/bottom 锚定右下角，多数缩放天然安全。

#### (C) 拖拽实现（新增 hook `useDraggableFab.ts`）

抽到独立 hook，保持 `AgentChatDock` 精简、便于单测。职责：

- 状态 `position: { right: number; bottom: number } | null`（默认 `null` 用 CSS 锚点；首次拖动后变为具体值）。会话内有效、跨开合保留（hook 随 Dock 常驻不卸载）；**不持久化**（与现有"默认关闭、不持久化"约定一致；如需跨刷新记忆可后续加 localStorage，本期不做）。
- 指针事件（Pointer Events，兼容鼠标/触控）：`onPointerDown` 记录 `startX/startY` 与起始 `right/bottom`（`null` 时按当前 DOM rect 折算成 right/bottom 初值），`setPointerCapture`；`onPointerMove` 计算 `dx=clientX-startX`、`dy=clientY-startY`，新 `right = startRight - dx`、`bottom = startBottom - dy`，按 `[0, workspaceW - S]`/`[0, workspaceH - S]` 钳制后 setState。
- **点击 vs 拖动判定（评审 R1：单一激活路径）**：位移超过阈值 `DRAG_THRESHOLD = 5px` 才置 `isDragging=true` 并记 `movedRef.current = true`。**激活（开合切换）不在 `onPointerUp` 触发**——`onPointerUp` 只做 `releasePointerCapture` 与状态清理；激活统一走原生 `onClick`（见 (D)）。`onPointerDown` 进入时先 `movedRef.current = false`（每次交互重置，避免上一次拖拽的残留标志吞掉本次 tap）。`onDragStateChange(isDragging)` 上报，供 FAB 在拖动中加 `is-dragging` 视觉态（去 hover 缩放、加 `cursor:grabbing`）。
- 工作区尺寸来源：hook 接收一个 `boundsRef`（指向 `.flex-1...relative` 工作区根）或退化为 `window.innerWidth/Height`。建议 `AgentChatDock` 通过 `fabRef.current?.offsetParent` 拿到定位父元素尺寸，避免额外穿 ref。
- 键盘可达性不回归：FAB 仍是原生 `<button>`，Enter/Space 经 `onClick`→`onActivate` 开合；拖动是 Pointer 通道的增强，不影响键盘。

#### (D) FAB 组件改造（`AgentChatFloatingButton.tsx`）

- 新增 props：`position`、`onActivate`、`onDragMove`/`onDragStateChange`（或直接接收 hook 返回的 `dragHandlers` 与 `style`，二选一，建议后者：hook 返回 `{ position, dragHandlers, isDragging }`，Dock 把 `dragHandlers` spread 到 button、`style` 内联 `right/bottom`）。
- 内联样式：`position != null` 时 `style={{ right: position.right, bottom: position.bottom }}`（覆盖 CSS 默认值）；`null` 时不写 style，沿用 CSS。
- **激活路径（评审 R1，唯一）**：FAB 的 `onClick` 是**唯一**激活入口，覆盖鼠标点击、触屏 tap（浏览器在 pointerup 后合成 click）与键盘 Enter/Space（原生 `<button>` 行为）。hook 暴露 `movedRef`（或等价的 `consumeClick()` 守卫）；`onClick` 首行即 `if (movedRef.current) return;`——拖拽后浏览器仍会派发一次 click，被此守卫吞掉，从而"拖一下不会开窗"。**绝不在 `onPointerUp` 里调用 `onActivate`**，以杜绝与 click 的双触发。事件流：
  - 鼠标轻点：pointerdown(`moved=false`) → pointerup(清理) → click(`moved=false` → `onActivate`) ✓
  - 鼠标拖动：pointerdown → pointermove(越阈 `moved=true`) → pointerup(清理) → click(`moved=true` → 守卫吞掉) ✓
  - 键盘 Enter/Space：仅 click(无前置 pointer，`moved=false` → `onActivate`) ✓
- 拖动态：`className` 追加 `${isDragging ? ' is-dragging' : ''}`。

#### (E) Panel 组件改造（`AgentChatFloatingPanel.tsx`）

- 新增 `anchor?: { right: number; bottom: number } | null` 与（可选）`bounds` 尺寸；据 (B) 公式算内联 `right/bottom` 并钳制；`anchor==null` 时退化为"CSS 默认 + 上移 28px"（即内联 `bottom: 'calc(24px + 28px)'` 或直接给定 `bottom:52, right:24`，保证默认态也半遮挡）。

#### (F) CSS（`src/styles/video-editing.css`）

- `.agent-chat-fab` 增加 `touch-action: none;`（让 Pointer 拖动在触屏不被滚动手势抢断）与拖动态 `.agent-chat-fab.is-dragging { cursor: grabbing; transform: none; }`；默认加 `cursor: grab`（语义上可拖）。`right/bottom/width/height/border-radius` 等保持。
- `.agent-chat-floating-panel` 的 `width:30% / height:80%` 保持（既有测试断言依赖）；默认 `bottom` 由内联样式接管半遮挡，CSS 默认值可保留作 SSR/无 JS 退化。
- 维持"z-index 不写进 CSS、由 token 提供"的单一真源约定。

---

## 3. File / Module 变更计划

| 文件 | 动作 | 一句话意图 |
|---|---|---|
| `src/components/video/components/AiGenerateMenu/AiGenerateMenu.tsx` | 修改 | 新增 `onConvertAllSpeech`/`convertAllSpeechDisabled`/`isConvertingAllSpeech` props，items 加第三项+分隔线，`selectItem` 跳过禁用/忙碌项，禁用/spinner 视觉态 |
| `src/components/video/ScriptPanel.tsx` | 修改 | 删除外部「统一转换所有语音」按钮，把 `handleBatchConvertToSpeech` 与禁用/忙碌态注入 `AiGenerateMenu`，`isBusy` 合并 `isBatchConverting` |
| `src/components/video/components/AgentChatDock/AgentChatDock.tsx` | 修改 | 改为 FAB 常驻 + Panel 叠加渲染；接入 `useDraggableFab`，把 `position`/拖拽处理透传 FAB、把 `anchor` 透传 Panel；`toggle` 组合 onOpen/onClose |
| `src/components/video/components/AgentChatDock/AgentChatFloatingButton.tsx` | 修改 | 接收 `position`/`dragHandlers`/`isDragging`，内联 right/bottom，轻点才 `onActivate`，拖动态 class |
| `src/components/video/components/AgentChatDock/AgentChatFloatingPanel.tsx` | 修改 | 接收 `anchor`，据 FAB 位置算自身位置并钳制，实现半遮挡 |
| `src/components/video/components/AgentChatDock/useDraggableFab.ts` | 新增 | 封装 FAB 拖拽：position 状态、Pointer 事件、点击/拖动阈值判定、边界钳制 |
| `src/styles/video-editing.css` | 修改 | `.agent-chat-fab` 加 `touch-action:none`/`cursor:grab`/`.is-dragging`；Panel 默认半遮挡退化值 |
| `src/lib/i18n.ts` | 修改 | `scriptPanel.header.title` zh→'文案/脚本'(/en)；新增 `scriptPanel.actions.convertAllSpeechDesc`（接口+en+zh）；（可选）空状态同步 |
| `src/components/video/components/AgentChatDock/__tests__/AgentChatDock.test.tsx` | 修改 | 更新结构断言（**评审 R2，逐条**）：① `renders_fab_when_dock_closed`（line 46-49）的 `if (!isOpen)` 断言改为"FAB 常驻 + `isOpen &&` 渲染 Panel"；② `opens_panel_on_fab_click`（line 51-56）的 `expect(dock).toContain('onClick={onOpen}')`（line 52）**必须改写**为断言 `onActivate`/`toggle` 接线（新结构里 `onClick={onOpen}` 已不存在，留着此断言必红）；③ 新增"`useDraggableFab` 被引入、`dragHandlers`/`onPointerDown` 出现在 FAB、`is-dragging`/`movedRef` 守卫逻辑存在、Panel 接收 `anchor`"。**保留且不破坏**：`agent-chat-fab z-dock`、`agent-chat-floating-panel z-dock-panel`、z-token、`width:30%`/`height:80%`、barrel 导出、i18n agentDock 键、VideoEditingInterface DaVinci 顺序、close 按钮/Escape→`onClose()` 断言 |
| `src/components/video/components/AiGenerateMenu/__tests__/*`（如存在则改，无则新增） | 新增/修改 | 断言第三项"统一转换所有语音"存在、禁用/忙碌态、`onConvertAllSpeech` 接线 |

> 约束复核（CLAUDE.md）：所有改动文件均远低于 800 行；新增 `useDraggableFab.ts` 预计 <120 行、单函数 <50 行、嵌套 <4；`selectItem`/拖拽回调保持早返回风格。

---

## 4. Interface 设计（组件 props 契约）

无任何 REST / WebSocket / CLI 变更。仅前端组件 props 增量：

```ts
// AiGenerateMenu 新增（均可选，向后兼容）
interface AiGenerateMenuProps {
  onSelectNarrationDirect: () => void;
  onSelectVideoUnderstanding: () => void;
  disabled?: boolean;
  isBusy?: boolean;
  label?: string;
  onConvertAllSpeech?: () => void;          // 新增：选中"统一转换所有语音"
  convertAllSpeechDisabled?: boolean;       // 新增：无片段时禁用该项
  isConvertingAllSpeech?: boolean;          // 新增：批量转换中显示 spinner 并禁用
}

// 内部 item 结构（显式化）
interface AiGenerateMenuItem {
  key: string;
  title: string;
  desc: string;
  onSelect: () => void;
  disabled?: boolean;
  busy?: boolean;
}

// AgentChatFloatingButton 新增
interface AgentChatFloatingButtonProps {
  isExecuting: boolean;
  label: string;
  position: FabPosition | null;             // 新增：null=CSS 默认锚点
  isDragging: boolean;                      // 新增：拖动视觉态
  onActivate: () => void;                   // 新增：轻点=开合切换（替代旧 onClick 的开启语义）
  dragHandlers: {                           // 新增：spread 到 <button>
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
  };
}

// AgentChatFloatingPanel 新增
interface AgentChatFloatingPanelProps {
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: React.ReactNode;
  anchor: FabPosition | null;               // 新增：据 FAB 位置算半遮挡位置
}

// useDraggableFab 返回
interface UseDraggableFabResult {
  position: FabPosition | null;
  isDragging: boolean;
  dragHandlers: { onPointerDown; onPointerMove; onPointerUp };
}

type FabPosition = { right: number; bottom: number }; // px，距工作区右/下边
```

`AgentChatDock` 对外 props（`isOpen`/`onOpen`/`onClose`/`agentIsExecuting`/`chatProps`）**保持不变**，故 `VideoEditingInterface.tsx` 的挂载代码（line 2710-2729）零改动。

---

## 5. Data Model（数据模型）

无数据库 / 持久化模型变更。唯一新增的运行时内存状态：

- `useDraggableFab` 内 `position: FabPosition | null`（默认 `null`），以及瞬时 `isDragging: boolean`、拖拽起点 `dragStartRef: { x; y; right; bottom }`。
- 生命周期：随 `AgentChatDock` 常驻，浮窗开/合不重置位置；页面刷新后回到默认右下角（不持久化）。
- 不进入任何 store / Context / localStorage（如未来要"记住位置"，再以 `ecliptrix-agent-dock-pos` 键持久化，本期 out of scope）。

i18n 新增键：
- `scriptPanel.actions.convertAllSpeechDesc`：zh 例 `'对全部片段依次生成语音'`；en 例 `'Run TTS on every segment in order'`（同步 `Translations` 接口）。

---

## 6. Testing & 验收标准

### 6.1 自动化测试（vitest run，沿用本仓"读源码断结构"模式）

- **AiGenerateMenu**：第三项标题命中 `t.scriptPanel.actions.convertAllSpeech`；`onConvertAllSpeech` 透传；`selectItem` 含禁用/忙碌早返回；分隔线存在。
- **AgentChatDock 结构**（更新现有 `AgentChatDock.test.tsx`）：
  - 移除/改写 `renders_fab_when_dock_closed` 的 `if (!isOpen)` 断言，新增"FAB 始终渲染、Panel 由 `isOpen &&` 渲染"。
  - **（评审 R2）改写 `opens_panel_on_fab_click`：旧断言 `expect(dock).toContain('onClick={onOpen}')`（line 52）在新结构（FAB 用 `onActivate={toggle}`）下必失败，改为断言 `onActivate`/`toggle` 接线；并补充"键盘 Enter→`onClick`→`onActivate` 单一激活路径、`movedRef` 守卫存在"断言。**
  - 断言 `useDraggableFab` 被引入、`dragHandlers`/`onPointerDown` 出现在 FAB、`is-dragging` class 逻辑存在。
  - 断言 Panel 接收 `anchor`、依 FAB 位置算半遮挡。
  - **保留**：`agent-chat-fab z-dock`、`agent-chat-floating-panel z-dock-panel`、tailwind `dock:'850'`/`'dock-panel':'860'`、CSS `width: 30%`/`height: 80%`、barrel 导出、i18n agentDock 键、VideoEditingInterface DaVinci 顺序等既有断言。
- **i18n**：`scriptPanel.header.title` zh 命中 `'文案/脚本'`；`convertAllSpeechDesc` zh/en 存在。
- 运行 `npm run type-check`（tsc --noEmit）必须通过——新增 props/键需同步 `Translations` 接口与 en/zh 两对象。

### 6.2 手工验收（桌面端走查为强制门禁）

1. 「文案/脚本」面板标题正确显示为"文案/脚本"（zh）；外部不再有独立「统一转换所有语音」按钮。
2. 解说 tab 点「AI 生成」展开下拉，含三项："解说直接生成 / 视频理解生成 / 统一转换所有语音"；点第三项触发批量 TTS（与旧按钮行为一致，toast 一致）；无片段时该项禁用；转换中该项显示 spinner、触发按钮转圈。
3. 右下角浮动按钮存在；点击展开浮窗，**浮窗只遮住按钮上半、下半始终可见**，按钮不消失。
4. 拖动浮动按钮可改变位置（鼠标 + 触控）；拖动中不误触发开合；松手后轻点仍能开合；浮窗打开态拖动按钮时浮窗随之移动并维持半遮挡；按钮/浮窗不被拖出可视区。
5. Agent 执行期：FAB 忙碌脉冲可见、浮窗输入框/取消按钮可点（z 层级未回归）；Esc 仍关闭浮窗、关闭后焦点回到 FAB。
6. `npm run type-check` 与相关 vitest 全绿。

---

## 7. Risks & Mitigations（风险与缓解）

| 风险 | 影响 | 缓解 |
|---|---|---|
| Pointer 拖动与原 `onClick` 双触发，导致"拖一下也开窗" | 交互错乱 | 5px 阈值区分点击/拖动；hook 暴露 `consumeClick`/`wasDragging` 守卫，pointerup 已处理则吞掉随后的 click |
| 触屏拖动被页面滚动抢断 | 移动端拖不动 | `.agent-chat-fab { touch-action: none }` + `setPointerCapture` |
| FAB 拖到边角后浮窗溢出工作区不可点 | 输入框/取消被裁 | (B) 钳制 Panel right/bottom 留 8px 安全边；尺寸用工作区 ref 实时读取 |
| 既有 `AgentChatDock.test.tsx` 断言 `if (!isOpen)` 结构 | 测试红 | 本方案明确更新该测试为新结构（属变更计划内） |
| i18n 漏改 `Translations` 接口或 en 对象 | type-check / 构建失败 | 强调三处（接口 + en + zh）同步落点；以 type-check 为 DoD |
| 改 `header.title` 影响其它读取点 | 文案不一致 | 已 grep 确认标题仅 `ScriptPanel.tsx:1802` 读取 `header.title`；空状态/报错另列为可选一致性项 |
| 移走外部批量按钮后用户找不到入口 | 可发现性下降 | 下拉项带 `desc` 说明、加分隔线分组；触发按钮文案"AI 生成"已是显眼主按钮 |
| 半遮挡导致 FAB 露出部分太小不易抓取 | 拖拽手感差 | 露出 28px（半个 56px FAB）足够命中；`cursor:grab` 提示可拖；如评审认为不足可调 S/2→更小遮挡比例 |
| z-index 关系回归（Panel 未盖住被遮挡半个 FAB，或锁定遮罩盖住 FAB） | 视觉错乱/执行期不可点 | 维持 `z-dock`(850)<`z-dock-panel`(860)，均 >50；测试保留 token 断言 |

### 回滚

纯前端 UI/交互调整、无持久化与接口变更，硬切换可接受；回滚 = `git revert` 对应提交即可，无数据迁移。

---

## 8. 实现顺序建议（供 Subtask #2）

1. i18n（接口 + en + zh）：`header.title`、`actions.convertAllSpeechDesc` —— 先落，避免 type-check 阻塞。
2. AiGenerateMenu items/props 改造 + ScriptPanel 删按钮接线（需求 1+2 闭环，可独立验收）。
3. `useDraggableFab` hook → FAB → Panel → AgentChatDock 结构改造 → CSS（需求 3）。
4. 更新/新增单测，跑 `vitest run` 与 `npm run type-check`，最后桌面端走查。

---

## 评审结论（Review Verdict · v2）

**结论：有条件通过（Approved with conditions）。**

方案在可行性、完备性、一致性、适度性上整体达标：目标文件、行号、props、i18n 键（含 `convertAllSpeechDesc` 确为新键）、CSS、tailwind z-token、既有测试断言与 VideoEditingInterface 挂载点均经逐条核对属实；改动纯前端，无 REST/WebSocket/数据库/迁移变更，回滚为 `git revert`，风险可控。本轮已就地修复全部 P0/P1（无 P0）：

- **R1（P1）**：拖拽/轻点激活收敛为**单一 `onClick` 路径 + `movedRef` 守卫**，附事件流表，消除"拖一下即开窗"的双触发风险。
- **R2（P1）**：测试更新清单补齐，逐条点名 `if (!isOpen)`、`onClick={onOpen}` 等会被新结构打破的断言及其替换。

落地须满足以下条件（交由 Subtask #2 执行时遵守）：

1. FAB 激活**只走 `onClick`**，`onPointerUp` 不得调用 `onActivate`；`onClick` 首行 `if (movedRef.current) return;`，`onPointerDown` 重置 `movedRef`。
2. Panel 半遮挡/钳制几何取 **panel 真实 `getBoundingClientRect()`**，不得写死 30%/80%；钳制以"Panel 在界"优先，"FAB 不消失"由 FAB 独立钳制 + 始终渲染保证。
3. `AgentChatDock.test.tsx` 按第 3 节/6.1 节逐条改写；`Translations` 接口 + en + zh 三处同步新增 `convertAllSpeechDesc`；`npm run type-check` 与相关 `vitest run` 须全绿。
4. 桌面端走查（6.2）为强制门禁：三项需求（下拉收纳批量转换、标题改名「文案/脚本」、FAB 半遮挡不消失 + 可拖动）均须人工确认。

无 P0/P1 遗留；R3–R8（P2）已在正文给出处置决定，不阻塞开发。
