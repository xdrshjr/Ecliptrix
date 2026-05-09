# Iter7 Fix Plan — 2026-05-09

> 来源 Bug 报告：`docs/diagnoses/iter7-bug-report-20260509/bug-report.md`
> 步骤 2 输出：代码定位 + 根因分析 + 修复方案。
> 后续步骤 3 将基于本文件实施代码修改。

## 总览

| Bug | 标题 | 文件 | 关键位置 | 类别 |
|---|---|---|---|---|
| #1 | `<title>` 未本地化 | `src/hooks/useTasks.ts` | L7、L119、L129–135 | i18n |
| #2 | `Project actions` aria-label 硬编码 | `src/components/video/projects/ProjectCard.tsx` | L107 | i18n / a11y |
| #3 | 时间显示混合中英 | `src/components/video/projects/ProjectCard.tsx`<br>`src/components/chat/ChatTypeSelectionModal.tsx` | L26–43、L162<br>L12–30、L367 | i18n |
| #4 | 项目操作菜单缺 menu/menuitem 角色 | `src/components/video/projects/ProjectCard.tsx` | L99–152 | a11y |
| #5 | 「新建分类/项目」Modal 不是 ARIA dialog | `src/components/video/projects/ProjectFormDialog.tsx`<br>`src/components/video/projects/CategoryFormDialog.tsx` | L62–72<br>L51–61 | a11y |
| #6 | AI 分镜空态提示方向错误 | `src/lib/i18n.ts` | L7131（zh-CN） | UX / i18n |
| #7 | AI 混剪 Modal 无选中态语义 | `src/components/video/components/AIMixingModeSelectionModal/AIMixingModeSelectionModal.tsx` | L67–217 | a11y / UX |
| #8 | 「新对话」Modal Close 按钮英文 | `src/components/chat/ChatTypeSelectionModal.tsx` | L193 | i18n |
| #9 | ImageOverlay 控制台刷屏 | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx`<br>`src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx`<br>`src/components/video/utils/logger.ts` | L2139、L2151、L2205<br>L43–52、L178、L183<br>L69（warn 未 gate） | log hygiene |

---

## Bug #1 — `<title>` 未按语言本地化

### 代码定位

- `src/hooks/useTasks.ts`
  - L7：`const DEFAULT_TITLE = 'Ecliptrix - Where light and shadow collide';`（默认标题硬编码）
  - L118–122：`document.title = activeTask ? \`${activeTask.title} · Ecliptrix\` : DEFAULT_TITLE;`
  - L129–135：`taskTypeNames` map 为硬编码英文 (`'Video Editing' / 'AI Chat' / ...`)，作为 `Task.title` 持久化进 LocalStorage。
- `src/hooks/__tests__/useTasks.persistence.test.ts`：测试断言 `document.title.startsWith('AI Chat')`，需要同步更新。

### 根因

`useTasks` 在创建 task 时直接使用英文字符串作为 `Task.title`，并写入 LS、URL、`document.title`。整个链路从未走 `useLocale`/`i18n`。即使前端 UI 用 `t.*` 翻译显示，标题持久化字段仍是英文。同样 `DEFAULT_TITLE` 一直是英文。

### 修复方案

1. 引入「类型→翻译键」中间层，避免把人类可读字符串当作主键存储。
   - 新增 i18n 字段 `tasks: { types: { content, video, brainstorm, workflow, chat }, defaultPageTitle }`，三种语言各填一份（zh-CN / en / 其他已有 locale）。
2. 在 `Task` 数据上不再 hard-code title，而是默认 `title` 从 `getTaskTypeLabel(type, locale)` 得出。`taskTypeNames` 改为：
   ```ts
   const buildTaskTypeLabel = (t: Translation, type: TaskType): string => {
     switch (type) {
       case 'content': return t.tasks.types.content;
       case 'video':   return t.tasks.types.video;
       case 'brainstorm': return t.tasks.types.brainstorm;
       case 'workflow': return t.tasks.types.workflow;
       case 'chat':    return t.tasks.types.chat;
     }
   };
   ```
3. `useTasks` 改造：
   - 通过 `useLocale()` 取出 `t` 与 `locale`（hook 已是 client-only，可直接调用）。
   - `DEFAULT_TITLE` 改为 `t.tasks.defaultPageTitle`（fallback 仍可保留品牌词「Ecliptrix」）。
   - `createTask` 在写入 task 时使用本地化 label。
   - 持久化 effect 中 `document.title = …` 同样改用本地化 fallback。
4. **迁移既存 LS 数据**：在 `reviveState` 内部检测 `task.title` 是否命中已知英文 canonical 名称（'Content Creation' / 'Video Editing' / 'Brainstorming' / 'WorkFlow' / 'AI Chat'），若是，则按 `task.type` 重新解析为当前 locale 文本；用户已自定义命名（非命中清单）则保持不动。
5. 同步更新单测 `useTasks.persistence.test.ts`：将「期望 `document.title.startsWith('AI Chat')`」替换为「期望 startsWith(t.tasks.types.chat)」（可在 mock 中直接拼装）。

### 风险与注意事项

- `useTasks` 当前不依赖任何 React Context；新增 `useLocale` 依赖会让该 hook 仅能在 `LocaleProvider` 子树使用。需确认 `LocaleProvider` 在 root layout 已挂载（已确认，`src/app/layout.tsx` / `RootProviders` 内）。
- 切换语言时 `document.title` 不会自动更新——hook 的 effect 依赖 `[appState, hydrated]`。修复时把 `t.tasks.defaultPageTitle` / `t.tasks.types.*` 加入 effect 依赖，可让 locale 切换即时生效。
- 历史 task 的 `title` 字段在迁移时只在 hydration 阶段做一次重写；之后用户持续使用同一 locale 写入。如果用户中途切换语言，老 task 的 title 不会自动翻新（这与「用户自定义命名」无法在数据层区分），属可接受的渐进式改善。

### 测试建议

- 单测 `useTasks.persistence.test.ts`：补充 `creates zh-CN labelled task when locale=zh-CN` / `re-localizes legacy English titles on hydration`。
- E2E：以 zh-CN 进入项目，断言 `document.title === '视频编辑 · Ecliptrix'`；切换 en 后断言 `Video Editing · Ecliptrix`。

---

## Bug #2 — `Project actions` aria-label 硬编码英文

### 代码定位

- `src/components/video/projects/ProjectCard.tsx:107` — `aria-label="Project actions"`
- `src/components/video/projects/__tests__/ProjectCard.test.tsx:45` — 旧断言 `expect(cardSrc).toMatch(/aria-label="Project actions"/)` 锁死了硬编码英文。

### 根因

字面量未走 i18n；`useLocale()` 已在文件 L51 引入但未使用到 aria-label 上。

### 修复方案

1. `src/lib/i18n.ts` 在 `videoProjects` namespace 新增字段：
   - 接口（L524–569）追加：`projectActions: string;` `closeMenu: string;`
   - `en` 增：`projectActions: 'Project actions',` `closeMenu: 'Close menu',`
   - `zh-CN`（L6000+）增：`projectActions: '项目操作',` `closeMenu: '关闭菜单',`
   - 其他 locale（如 zh-TW、ja、若存在）同步补齐。
2. `ProjectCard.tsx:107` 改为 `aria-label={t.videoProjects.projectActions}`。当 `project.name` 可用时，可进一步上下文化为模板：在 i18n 中改成 `projectActionsFor: '{name} 的操作'` 并以 `replace('{name}', project.name)` 拼接，提升 a11y。
3. 单测断言放宽为 `toMatch(/aria-label=\{[^}]*projectActions/)`，改成检查 i18n 引用而非字面量。

### 风险与注意事项

- 当 `project.name` 为空（fallback 到 `t.videoProjects.untitled`）时，应回退到通用「项目操作」短语。

### 测试建议

- 单测：渲染 ProjectCard 在 zh-CN，断言按钮 accessible name 为 `项目操作`（或带项目名）。

---

## Bug #3 — 时间显示混合中英文

### 代码定位

- `src/components/video/projects/ProjectCard.tsx`
  - L26–43 `formatRelative()` 返回 `${minutes}m` / `${hours}h` / `${days}d`，无 locale 概念。
  - L162 `{t.videoProjects.lastOpened}:{' '}` —— 中文 locale 仍输出 ASCII `:`；中文排版应使用全角 `：` 或留空。
- `src/components/chat/ChatTypeSelectionModal.tsx`
  - L12–30 `relativeTimeEN()` 写死 `'just now'`、`Xm ago`、`Xh ago`、`Xd ago`。
  - L367 `relativeTimeEN(workflow.updated_at || workflow.created_at)`。
- `src/components/AdminSettings/UserManagement.tsx:51` 也存在类似 `formatRelativeTime`（次要）。

### 根因

每个面板都各自实现了相对时间，且都返回英文。未抽公共工具，未传入 locale。

### 修复方案

1. **新增公共工具** `src/lib/relativeTime.ts`（或在已有 `src/lib/i18n.ts` 末尾导出函数）：
   ```ts
   export function formatRelativeTime(
     iso: string | null | undefined,
     locale: 'en' | 'zh-CN' | ...,
     t: Translation,           // 用 t.common.relativeTime.{justNow, minutes, ...}
     fallback?: string,
   ): string { /* 单点实现 */ }
   ```
   - 用 `Intl.RelativeTimeFormat(locale, { numeric: 'auto' })` 是最优解（标准 API，自动处理「刚刚」/「Just now」），配合 `t.common.relativeTime.absoluteFallback` 做超过 30 天时的日期格式。
   - `i18n.ts` 在 `common` namespace 新增 `relativeTime: { justNow, fewSeconds }`（仅在 RTF 不便覆盖的极短间隔时使用）。
2. 替换三处调用：
   - `ProjectCard.tsx` 的 `formatRelative` 删除，改为顶层调用 `formatRelativeTime(iso, locale, t, t.videoProjects.neverOpened)`，Card 中通过 `useLocale()` 拿到 `locale`。
   - `ChatTypeSelectionModal.tsx` 的 `relativeTimeEN` 删除，统一调用 `formatRelativeTime`。注意：原文案模板 `t.aiChat.chatTypeModal.updatedAt = '更新于 {time}'`，配合中文化的相对时间会变成 `更新于 22 天前` ——符合预期。
   - 推荐 `UserManagement.tsx` 也接入（不阻塞本轮，可作为后续 cleanup）。
3. **冒号本地化**：在 `ProjectCard.tsx` L162，将 `${t.videoProjects.lastOpened}:` 改为 `t.videoProjects.lastOpenedWithValue.replace('{value}', formatted)`，新增 i18n 字段：
   - en：`lastOpenedWithValue: 'Last opened: {value}'`
   - zh-CN：`lastOpenedWithValue: '上次打开：{value}'`（全角冒号）

### 风险与注意事项

- `Intl.RelativeTimeFormat` 在所有现代浏览器与 Node 14+ 已支持，本项目无 IE 目标，可放心使用。
- 既有快照测试若硬编码 `22d ago`，需要随之更新。
- 时区：`new Date(iso)` 已按用户本地时区解析，无需额外处理。

### 测试建议

- Vitest：`formatRelativeTime` 在 en/zh-CN 下分别覆盖 just-now / 30s / 5min / 3h / 7d / >30d 五档，断言输出语言一致。
- 视觉：zh-CN 下项目卡显示 `上次打开：22 天前`，无英文残留。

---

## Bug #4 — 项目操作菜单缺 ARIA `menu` / `menuitem`

### 代码定位

- `src/components/video/projects/ProjectCard.tsx` L98–152：自实现的 popup（外层 `div`，子项裸 `button`），无 menu/menuitem，无键盘上下键导航，无焦点陷阱。

### 根因

历史代码仓促实现，未走项目已有 `Radix` / `shadcn` 体系。`components.json` 已声明 shadcn `new-york`；可直接接入 `@/components/ui/dropdown-menu`（如果不存在则新增）。

### 修复方案

#### 选项 A（推荐）：迁移到 Radix DropdownMenu

1. 查找/新增 `src/components/ui/dropdown-menu.tsx`（shadcn 标准产物）。若已存在直接复用。
2. `ProjectCard.tsx` 重写：
   ```tsx
   import {
     DropdownMenu,
     DropdownMenuTrigger,
     DropdownMenuContent,
     DropdownMenuItem,
   } from '@/components/ui/dropdown-menu';

   <DropdownMenu>
     <DropdownMenuTrigger asChild>
       <button aria-label={t.videoProjects.projectActions} …>…</button>
     </DropdownMenuTrigger>
     <DropdownMenuContent align="end">
       <DropdownMenuItem onSelect={onRename}>{t.videoProjects.rename}</DropdownMenuItem>
       <DropdownMenuItem onSelect={onDelete} className="text-destructive">
         {t.videoProjects.delete}
       </DropdownMenuItem>
     </DropdownMenuContent>
   </DropdownMenu>
   ```
3. 删除自实现的 `menuOpen` state 与 backdrop `<div className="fixed inset-0 z-10" />`。Radix 的 popup primitive 内置 portal、Esc 关闭、外点击关闭、上下键导航、焦点循环。
4. 注意 outer `<div onClick={onOpen}>` 与新菜单触发器的 `e.stopPropagation()` 行为：Radix `DropdownMenuTrigger asChild` + 内部按钮要保留 `onClick={(e) => e.stopPropagation()}`，避免菜单打开时触发卡片 onOpen。
5. 同步删除 ProjectCard 测试中针对 `menuOpen` 自定义 z-index 类的断言（如有），改为查找 `role="menu"` / `role="menuitem"`。

#### 选项 B（回退）：原地补 ARIA

仅在 shadcn 引入成本不可接受时使用。给现有 popup 容器加 `role="menu"`、给两个 button 加 `role="menuitem"`，再实现 `onKeyDown`：`ArrowDown`/`ArrowUp` 切换 focus、`Esc` 关闭、`Tab` 关闭并归还 trigger 焦点。代码量不亚于选项 A，但缺少 portal 与 collision-aware 定位，故不推荐。

### 风险与注意事项

- `ProjectSidebar` 中分类编辑/删除按钮（L143–171）也是裸 button + hover 显示，但属于 inline action 不构成菜单组，本轮不一并迁移以控制 scope。
- Radix 的 portal 会把 menu 渲染到 body，原先 `menuOpen ? z-30 : ''` 的卡片 z-index 提升不再必要——可移除。
- 影响视觉的暗色主题需确认 shadcn dropdown 颜色 token 已经在 globals.css 里（`--popover`、`--popover-foreground`），否则补一行覆盖。

### 测试建议

- a11y 单测（jsdom + @testing-library）：断言点击触发器后，菜单容器 `role="menu"`、子项 `role="menuitem"`、`ArrowDown` 后第一项被聚焦。
- 手动：键盘从 trigger 按下 Enter 打开 → ArrowDown / Up 切换 → Esc 关闭，焦点回到 trigger。

---

## Bug #5 — 「新建分类/新建项目」Modal 不是 ARIA dialog

### 代码定位

- `src/components/video/projects/ProjectFormDialog.tsx` L62–72：根 `<div className="fixed inset-0 z-modal">`，无 `role` / `aria-modal` / `aria-labelledby`，无 `Esc` 监听，无焦点陷阱。
- `src/components/video/projects/CategoryFormDialog.tsx` L51–61：同上，`<div>` 包 `<form>`。
- 对比品：`AIMixingModeSelectionModal.tsx` L67–79（已含 `role="dialog"` `aria-modal="true"` `aria-labelledby`），是项目内的「黄金示例」。

### 根因

历史快速 ship 的 modal 复用了 `fixed inset-0 z-modal` pattern 但只写了视觉，没补 ARIA。

### 修复方案

1. **统一封装基础组件**（推荐）：在 `src/components/ui/Modal.tsx`（或复用 `dialog.tsx` 若 shadcn 已生成）中提供 `<Modal isOpen labelledById onClose>` API，内部负责：
   - `role="dialog"` / `aria-modal="true"` / `aria-labelledby={labelledById}`
   - 监听 `Escape` 关闭
   - `onClick` backdrop 关闭
   - 首焦点：进入时聚焦第一个 focusable，关闭时还原
   - body scroll lock（可选）
2. 重写 `ProjectFormDialog` & `CategoryFormDialog`：
   ```tsx
   <Modal isOpen={isOpen} labelledById="project-form-title" onClose={onCancel}>
     <form onSubmit={handleSubmit} className="bg-card rounded-md …">
       <h3 id="project-form-title" className="text-lg font-semibold">…</h3>
       …
     </form>
   </Modal>
   ```
3. **若不抽公共组件**（最小变更）：分别在两个 file 的根 `<div>` 上直接补：
   ```tsx
   <div
     className="fixed inset-0 z-modal …"
     role="dialog"
     aria-modal="true"
     aria-labelledby="project-form-title"
     onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
   >
     <form …>
       <h3 id="project-form-title" …>{mode === 'create' ? t.videoProjects.newProject : t.videoProjects.rename}</h3>
       …
     </form>
   </div>
   ```
   并用 `useEffect` 监听 `keydown.Escape` → `onCancel()`；`autoFocus` 已有的 input 即首焦点。
4. 优先选择「方案 1」抽公共组件，可一次性把后续待出现的 Modal（包括项目内多个剩余裸 div modal，例如 `StoryboardScriptTab` L399 的 deleteConfirm）后续也接入。本轮 scope 限定两个 dialog；公共组件先建立、后续渐进迁移。

### 风险与注意事项

- 焦点陷阱：原先无 trap，用户 Tab 出去会到背景元素。Modal 公共组件需要找出容器内最后一个 focusable 后绑 `keydown.Tab`，或采用 `focus-trap-react` 之类的现成依赖；为避免引入新依赖，可手写最小 trap（首/尾元素互相 wrap）。
- `ProjectFormDialog` 内 `autoFocus` input 已具备初焦点，无需重设。

### 测试建议

- a11y 单测：打开 dialog 后 `getByRole('dialog')` 命中、`aria-modal === 'true'`、Esc 触发 `onCancel`。
- 手动：屏幕阅读器朗读「项目名称对话框 创建项目」，符合预期。

---

## Bug #6 — 「AI 分镜」空态指示语方向错

### 代码定位

- `src/lib/i18n.ts:7131`（zh-CN）：`selectStoryboardPackHint: '在上方下拉菜单中选择已生成的分镜包',`
- `src/lib/i18n.ts:4379`（en）：`selectStoryboardPackHint: 'Select a generated storyboard pack from the dropdown above',`
- 消费点：`src/components/video/components/StoryboardScriptTab/StoryboardScriptTab.tsx:197`，渲染顺序为「文字提示 → PackSelector」（即 dropdown 在提示**下方**）。

### 根因

文案先写，DOM 后调；翻译文案的方向词与最终布局不一致。

### 修复方案

- zh-CN：`selectStoryboardPackHint: '请在下方下拉菜单中选择已生成的分镜包',`
- en：`selectStoryboardPackHint: 'Select a generated storyboard pack from the dropdown below',`
- 其他 locale 检索 `selectStoryboardPackHint` 出现位置，一并更新。
- （可选增强）在 `availablePacks.length === 0` 时追加引导链接「前往 素材管理 → 分镜包 生成」。本轮先只修方向词以保持 scope。

### 风险与注意事项

- 文案修改属于纯 i18n，不涉及组件结构，回归风险极低。
- 若有快照测试包含旧文案，需同步更新（`grep '在上方下拉菜单中' src/__tests__` 已确认未发现匹配）。

### 测试建议

- 视觉验证 zh-CN/en 文案；确保提示与 PackSelector 的相对位置一致。

---

## Bug #7 — AI 混剪模式 Modal 无选中态语义

### 代码定位

- `src/components/video/components/AIMixingModeSelectionModal/AIMixingModeSelectionModal.tsx`
  - L25：`useState<'quick' | 'professional'>('quick')` —— 实际**已**有默认 'quick'，与 bug 报告「无默认」描述略有出入；问题在于该状态对屏幕阅读器与 Playwright 不可见。
  - L117–153 / L156–217：两张「卡片」是 `<div onClick>`，无 button/radio 角色、无 `aria-checked` / `aria-pressed`。

### 根因

视觉上有 selected 高亮（`border-primary bg-primary/10`），但 DOM 没有任何 a11y 标记，所以 axe / Playwright accessibility tree 看不到选中状态；用户测试时也容易认为「没有选择就能点开始」。

### 修复方案

1. 用 ARIA radiogroup 重新表达两张卡片：
   ```tsx
   <div role="radiogroup" aria-labelledby="ai-mixing-mode-title">
     <div
       role="radio"
       tabIndex={0}
       aria-checked={selectedMode === 'quick'}
       data-selected={selectedMode === 'quick'}
       onClick={() => setSelectedMode('quick')}
       onKeyDown={(e) => {
         if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setSelectedMode('quick'); }
         if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setSelectedMode('professional');
       }}
       …
     >…</div>
     {/* professional 同理，含 ArrowLeft/Up 切回 quick */}
   </div>
   ```
2. 现有视觉「单选圆」继续显示（`selectedMode === 'quick'` 渲染内部小圆），同时 CSS 选择器若依赖 `data-selected` 可顺带替换 `border-primary` 判定，让纯 CSS 也能反应状态。
3. **额外提升信任度**：在 footer 的「确定」按钮改为始终展示当前选择名（如「开始 AI 混剪 · 快速」），让用户即使没动卡片也能在按钮上确认走哪个模式。
4. 若产品策略希望强制显式选择，可改为 `useState<'quick' | 'professional' | null>(null)` + 「确定」按钮 `disabled={!selectedMode}`。本方案保留默认 'quick'（更友好），同时通过 ARIA 与 button 文案显式化默认值。

### 风险与注意事项

- 加 `tabIndex={0}` 后，焦点路径会进入卡片；为避免 Tab 在两张卡片间多次停留，符合 WAI-ARIA radiogroup 推荐做法（仅 selected 卡片 tabIndex=0，未选为 -1）。需要在键盘切换时同步迁移 focus。
- Bug 报告 #7 描述的「直接点开始按钮跑通」并非 bug 本质，bug 本质是状态对 a11y/UI 不显式。修复后应加 e2e 用例确认 axe 能识别选中态。

### 测试建议

- a11y 单测：渲染初始 modal，断言 `getByRole('radiogroup')` 命中、第一项 `aria-checked='true'`；`fireEvent.keyDown` 右箭头 → 第二项 aria-checked='true'；按 Enter 触发 onConfirm。
- 视觉：默认显示「快速混剪」选中圆，footer 按钮文案带模式名。

---

## Bug #8 — 「新对话」Modal 关闭按钮 `aria-label="Close"`

### 代码定位

- `src/components/chat/ChatTypeSelectionModal.tsx:193` — `aria-label="Close"`
- 同时存在的兄弟问题（顺手处理）：
  - `WorkflowSelectionModal.tsx:122`、`AiVideoModal.tsx:247`、`AiImageModal.tsx:217`、`WorkflowConfigModal.tsx:376`、`MyMaterialsModal.tsx:219`、`GridPackModal.tsx:45` 等多处 `aria-label="Close"` 硬编码。
  - workflow config panels（如 `ChatLLMConfigPanel.tsx:115`）的 `Close panel` 同源问题。

### 根因

字面量未走 i18n。i18n 已存在 `t.common.close = '关闭'`，仅是缺乏接入。

### 修复方案

1. **本轮必修**：`ChatTypeSelectionModal.tsx:193` 改 `aria-label={t.common.close}`。
2. **本轮顺手修（推荐）**：上面列出的 9 处 `aria-label="Close"`，统一替换为 `aria-label={t.common.close}`；`Close panel` 替换为 `aria-label={t.common.closePanel ?? t.common.close}`，并在 i18n `common` 中补 `closePanel` key（en `Close panel`, zh-CN `关闭面板`）。
3. 兄弟问题集中在一个 PR 里完成，避免后续迭代再扫一遍。

### 风险与注意事项

- 多处替换属于机械替换，回归风险低；用 `git grep 'aria-label="Close"'` 应在 fix 完成后无任何源码命中（测试断言文件可能仍出现，单测同步更新）。

### 测试建议

- 单测：渲染 `ChatTypeSelectionModal` 在 zh-CN，`getByRole('button', { name: '关闭' })` 命中。
- Lint：可在 ESLint 中补一条 `no-restricted-syntax` 禁止后续新增 `aria-label="Close"` / `aria-label="Close panel"`，但这是可选 hardening。

---

## Bug #9 — `ImageOverlay` 控制台刷屏 / 容器零尺寸 warning

### 代码定位

- `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx`
  - L2139：`logger.debug('render image overlays', { … overlayCount, containerDimensions, overlays … })` — 每次 React render 都跑（且 `overlays.map(o => ({ id, url, position }))` 携带 OSS URL）。
  - L2151：`logger.warn('container dimensions are zero', {})` — `warn` 未受 `NODE_ENV === 'production'` gate（见下）。
  - L2205：preview 模式重复一份相同 debug。
- `src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx`
  - L43–52：组件主 render 体内的 `overlayLogger.debug('render', {... imageUrl ...})` —— 每次重渲染都触发，并把 `imageUrl` 作为字段写出。
  - L178：`overlayLogger.warn('container-zero', { imageId })`、L183：`overlayLogger.warn('pixel-position-zero', { imageId })` —— 首帧必中（containerDimensions 初始 0×0）。
- `src/components/video/utils/logger.ts`
  - L17–25 `info()`：已 gate `production && !NEXT_PUBLIC_VIDEO_EDIT_DEBUG → return`。
  - L45–49 `debug()`：已 gate（同上）。
  - L69–84 `warn()`：**没有任何 gate**，`console.warn` 无条件触发——即使在 production 也会出现。
  - L91–119 `error()`：未 gate（合理，保留）。

### 根因

1. 渲染期 debug 携带 URL：调试早期遗留，dev 环境噪音大。  
2. `warn()` 在 production 也会触发，导致首帧的「container-zero」warning 进入用户控制台。  
3. 「容器为零」是首帧必然结果（`containerDimensions` 初值为 0×0，需 ResizeObserver 后才赋值），不是真正的异常，不该 warn。

### 修复方案

#### 9.1 让 `warn` 也接受 production gate（保留显式 escape hatch）

```ts
warn(action: string, data?: Record<string, any>) {
  if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_VIDEO_EDIT_DEBUG) {
    return;
  }
  // 原 console.warn …
}
```

> 折中：`error()` 不 gate（确保线上崩溃可见），`warn()` 需要诊断时再开 `NEXT_PUBLIC_VIDEO_EDIT_DEBUG`。

#### 9.2 移除/降级首帧无意义 warning

在 `ImageOverlay.tsx`：
- L177–180：`if (containerWidth === 0 || containerHeight === 0) return null;` —— 删除 warn 调用，直接 return null（首帧本就如此）。
- L182–185：`pixel-position-zero` —— 改为 `debug` 级别（实际是有效的诊断信息但不需要 warn）。

在 `VideoPlayerPanel.tsx`：
- L2150–2152：`if (containerDimensions.width === 0 || containerDimensions.height === 0) { logger.warn('container dimensions are zero', {}); }` —— 删除（与 9.1 + ImageOverlay 改动联合后冗余）。

#### 9.3 让 debug 不携带 OSS URL

在 `ImageOverlay.tsx` L43–52 与 `VideoPlayerPanel.tsx` L2139 & L2205：
- 把 `imageUrl` 字段从 debug payload 中删除（保留 `imageId` 作为关联键），或仅在 `process.env.NEXT_PUBLIC_VIDEO_EDIT_DEBUG` 显式开启时才 include URL。
- 同步把 `overlays.map(o => ({ id, url, position }))` 改为 `overlays.map(o => ({ id, position }))`。

#### 9.4（可选）每帧 render debug 节流

`ImageOverlay` 体内的 `debug('render', …)` 在 dev 也会海量。可以：
- 仅在 props 真正变化时输出（用 ref 比对 prev props）；或
- 直接删除该行——`logger.debug` 的设计目的是事件级别（drag-start / image-loaded 等），渲染本身一般无需 log。

推荐删除该行（保留 drag-* 与 image-loaded/error 等事件型 log），噪音直接消除。

### 风险与注意事项

- 修改 `logger.warn` 全局 gate 会影响调用 warn 的其他位置（如 `logger.warn('Failed to restore state'`）——但由于 production 默认走严格路线，本来就不应有 warn 噪音；如某个 warn 在 prod 必须可见，应升级为 `error` 或显式打开 `NEXT_PUBLIC_VIDEO_EDIT_DEBUG`。
- 删除 ImageOverlay 主体的 `debug('render')` 是一次性清理；若后续诊断需要可临时加回。

### 测试建议

- 手动：dev 模式打开 video editor，加图片素材，观察 Console，应：
  - 不再出现 `Container dimensions are zero` 类 warning
  - 不再出现 `[ImageOverlay] render` 每帧 LOG
  - 仍能在 image load 失败时看到 error
- 单测：`logger.warn` 在 `process.env.NODE_ENV='production'` 下 stub `console.warn` 并断言 0 次调用；`NEXT_PUBLIC_VIDEO_EDIT_DEBUG='1'` 下断言 1 次调用。

---

## 优先级与依赖关系

修复执行建议顺序（按收益密度 + 解耦先后）：

1. **基础 i18n / 字面量类**（独立、低风险、易快速合并）：Bug #6（仅文案）→ Bug #8（多处机械替换）→ Bug #2（单点 + i18n 增量）。
2. **utility/底层重构**：Bug #3（新增 `formatRelativeTime`）→ Bug #1（`useTasks` 接入 i18n + 迁移）。两者可并行：Bug #3 不阻塞 #1，但二者都涉及 i18n 接口扩展，建议同一个 PR。
3. **a11y 组件改造**：Bug #5（Modal 公共组件）→ Bug #4（Radix DropdownMenu）→ Bug #7（radiogroup 语义）。Bug #5 引入的 `<Modal>` 公共组件可被 #4 / #7 复用，建议先做。
4. **log hygiene**：Bug #9，独立。

### 跨 Bug 共享改动清单

- `src/lib/i18n.ts`：新增 `videoProjects.projectActions` / `projectActionsFor` / `closeMenu` / `lastOpenedWithValue`（#2、#3）；新增 `tasks.types.*` / `tasks.defaultPageTitle`（#1）；新增 `common.relativeTime.*` / `common.closePanel`（#3、#8）；修正 `selectStoryboardPackHint` 上方→下方（#6）。三种 locale 同步。
- `src/components/ui/Modal.tsx`（新文件）+ `src/components/ui/dropdown-menu.tsx`（确认存在或新增）。
- 单测文件：`useTasks.persistence.test.ts`、`ProjectCard.test.tsx`、`ChatTypeSelectionModal.test.tsx`、新增 `Modal.test.tsx` / `formatRelativeTime.test.ts`、`logger.test.ts`。

### 全局风险

- i18n 字段改动需保证三种 locale 同时合上，避免 `t.foo.bar` 在某 locale 下成 `undefined`。CI 里若有 `i18n` schema test，需通过。
- `useTasks` LS 数据迁移仅做一次（hydration），逻辑要写得幂等且能识别已迁移条目，避免被多次重写。
- shadcn/Radix 引入需要确认 dependency 已存在（`@radix-ui/react-dropdown-menu` / `@radix-ui/react-dialog`）；若未安装，须 `npm i` 并将版本纳入 lockfile 同 PR。

---

## 完工验收清单（供步骤 3/4 使用）

- [ ] `npm run type-check` 全绿
- [ ] `npm run lint` 全绿
- [ ] `npm run test` 全绿，新增的 a11y / i18n / logger 单测覆盖全部 9 个 Bug
- [ ] zh-CN 进入项目编辑器：`document.title === '视频编辑 · Ecliptrix'`
- [ ] 项目卡 ⋯ 触发器：accessible name = `项目操作`；展开后 `role=menu` / `role=menuitem`，键盘可导航
- [ ] 「新建项目/分类」Modal：`role=dialog` `aria-modal=true`，Esc 关闭，背景焦点不可触达
- [ ] 项目列表显示 `更新于 22 天前` / `上次打开：3 分钟前`，无 `Xd ago`/`Xm` 残留
- [ ] AI 分镜空态文案为「请在下方下拉菜单中选择已生成的分镜包」
- [ ] AI 混剪模式 Modal：`role=radiogroup`、初始 quick `aria-checked=true`、键盘可切换
- [ ] 新对话 Modal Close 按钮 accessible name = `关闭`
- [ ] dev 控制台进入 video editor 后，无 `[ImageOverlay] Rendering overlay` / `Container dimensions are zero`；error 级别保持可见
