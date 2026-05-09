# Iter7 Fix Plan — REVIEWED — 2026-05-09

> 来源 Bug 报告：`docs/diagnoses/iter7-bug-report-20260509/bug-report.md`
> 输入：`fix-plan.md`（步骤 2 输出）
> 本文件：步骤 3 审查与修正后的最终方案；步骤 4 应直接据此实施。

---

## 审查摘要

对 `fix-plan.md` 的 9 个 Bug 修复方案逐项做了**技术正确性 / 代码质量 / 副作用 / 完整性**四维审查，发现以下需要修正的关键问题，下文按 Bug 编号给出**已采纳（KEEP）**与**修正项（REVISED）**：

### 全局修正（影响多个 Bug）

| # | 原方案问题 | 修正 |
|---|---|---|
| G1 | 反复声明「三种 locale 同步」/ 提到 zh-TW、ja | 实际只有 2 个 locale：`en` 与 `zh-CN`（`src/lib/i18n.ts` L2725 / L5477，文件末尾 `SupportedLocale = keyof typeof translations`）。所有改动**只需同步两个 locale**。|
| G2 | 推荐 Bug #4 Option A（Radix DropdownMenu）/ Bug #5 复用 shadcn `dialog.tsx` | `package.json` 中**没有任何 `@radix-ui/*` 或 shadcn 组件依赖**；`src/components/ui/` 仅含 `ConfirmationDialog / MobileWarningDialog / RoleBadge / Toast / ToastContainer`，**没有 `dropdown-menu.tsx` / `dialog.tsx`**。本轮**禁止新增依赖**，所有 a11y 改造采用纯手写 + ARIA 路线（即原方案的「Option B / 最小变更」），并通过新建 `src/components/ui/Modal.tsx`（自实现）统一封装。|
| G3 | 多处提到「shadcn 标准产物」「Radix portal」 | 改造措辞：使用项目内自实现的 `Modal` / 自实现 dropdown 容器，依赖 `useEffect` + `keydown` 监听 + `aria-*` 属性。|
| G4 | `useTasks` `taskTypeNames` 列出 5 个类型（含 `content`） | `src/types/index.ts:4` 定义 `Task.type = 'workflow' \| 'video' \| 'brainstorm' \| 'chat'`，**`content` 不是合法 TaskType**，原代码该分支永远不可达（dead code）。修正：i18n 与 `buildTaskTypeLabel` 仅覆盖 4 种合法类型，删除 `taskTypeNames.content` 死分支。|
| G5 | 多处建议引入 `focus-trap-react` 或新依赖 | **不引入新依赖**；Modal 组件采用「记录打开前 activeElement → 关闭时 focus restore」+ `Tab/Shift+Tab` 在容器内手写循环。|

---

## Bug #1 — `<title>` 未按语言本地化

**状态**：方案正确，按以下修正实施。

### 代码定位（重新核对）

- `src/hooks/useTasks.ts`
  - L7 `DEFAULT_TITLE` 硬编码英文 ✅
  - L118–122 `document.title = activeTask ? \`${activeTask.title} · Ecliptrix\` : DEFAULT_TITLE` ✅
  - L129–135 `taskTypeNames` map 含 5 个键，其中 `content` 在 `TaskType` 中**不存在**，是死代码
- `src/hooks/__tests__/useTasks.persistence.test.ts:26, 49` 硬编码 `'Ecliptrix - Where light and shadow collide'` 与 `'AI Chat'`

### 修正方案

1. **i18n 增量（en + zh-CN）**：
   - `Translations` 接口 L517–523 `tasks` 块新增字段（保留既有键以避免破坏其他消费方）：
     ```ts
     tasks: {
       workflow: string;
       videoEditing: string;
       brainstorming: string;
       brainstormingComingSoon: string;
       aiChat: string;
       // 新增：
       types: { workflow: string; video: string; brainstorm: string; chat: string };
       defaultPageTitle: string;
     };
     ```
   - en（L3241）追加：
     ```ts
     types: { workflow: 'Workflow', video: 'Video Editing', brainstorm: 'Brainstorming', chat: 'AI Chat' },
     defaultPageTitle: 'Ecliptrix — Where light and shadow collide',
     ```
   - zh-CN（L5994 附近）追加：
     ```ts
     types: { workflow: '工作流', video: '视频编辑', brainstorm: '头脑风暴', chat: 'AI 对话' },
     defaultPageTitle: 'Ecliptrix — 光影交汇之处',
     ```
   - 不复用既有 `tasks.workflow/videoEditing/...` 是因为：(a) 原键的语义是「Tab 名称」字面文本，与「task.title 持久化值」需求不同；(b) 改键值会污染其他消费方。新增 `tasks.types` 子命名空间，明确职责。

2. **`useTasks.ts` 改造**：
   ```tsx
   import { useLocale } from '@/contexts/LocaleContext';
   ...
   const { t } = useLocale();
   const buildTaskTypeLabel = (type: TaskType): string => {
     switch (type) {
       case 'workflow':   return t.tasks.types.workflow;
       case 'video':      return t.tasks.types.video;
       case 'brainstorm': return t.tasks.types.brainstorm;
       case 'chat':       return t.tasks.types.chat;
     }
   };
   ```
   - 删除 `taskTypeNames` map 与 `'content'` 死分支。
   - L121 `DEFAULT_TITLE` 改为 `t.tasks.defaultPageTitle`（顶层定义保留为常量品牌串作为 SSR 首屏 fallback；effect 内使用 `t.tasks.defaultPageTitle`）。
   - 持久化 effect 的依赖数组追加 `t.tasks.defaultPageTitle, t.tasks.types`，使切换语言即时刷新 `document.title`。

3. **LS 数据迁移（hydration 阶段一次性）**：
   ```ts
   const LEGACY_TITLE_TO_TYPE: Record<string, TaskType> = {
     'Video Editing': 'video',
     'AI Chat': 'chat',
     'Brainstorming': 'brainstorm',
     'WorkFlow': 'workflow',
     'Workflow': 'workflow',
     // 'Content Creation' 历史遗留，已无 TaskType 对应；命中时按 task.type 重映射
   };
   // 在 reviveState 内：仅当 task.title 完全等于以上 canonical 英文时才重写为 buildTaskTypeLabel(task.type)；
   // 用户已自定义命名（不在清单内）保持不动。
   ```
   - **幂等性保证**：迁移后 `task.title` 变成 locale 文本，下次 hydration 不再命中 canonical 英文清单，不会被多次重写。

4. **测试同步**：
   - `useTasks.persistence.test.ts:26` 改为 `document.title = ...defaultPageTitle 的 en 值`（与默认 locale 一致），或在测试 setup 中使用 `getTranslations('en')`。
   - `useTasks.persistence.test.ts:49` 断言 `document.title.startsWith(translations.en.tasks.types.chat)` —— 不依赖字面量。
   - 新增用例：`creates zh-CN labelled task when locale=zh-CN`（mock LocaleContext 以 zh-CN 渲染，断言 title 为「AI 对话」）；`re-localizes legacy English titles on hydration`（LS 注入 `'AI Chat'` task，hydration 后断言转换为当前 locale 文本）。

### 风险与注意事项（修正）

- `useTasks` 加 `useLocale` 依赖：`LocaleProvider` 在 `src/app/layout.tsx` 已挂载（已确认），生效范围 = 整个 client tree。
- **SSR 安全**：`useTasks` 是 `'use client'` hook，`useLocale` 同为 client，无 SSR 风险。
- **`DEFAULT_TITLE` 顶层常量**：保留作为模块级 fallback（在 hook 未运行时如初次首屏闪现），但 effect 内**只用**翻译值——避免硬编码英文写回 `document.title`。

---

## Bug #2 — `Project actions` aria-label 硬编码英文

**状态**：保留原方案，删除「按项目名定制 aria-label」的额外推荐（YAGNI，未上线先简化）。

### 修正方案

1. `src/lib/i18n.ts`：在 `videoProjects` namespace（接口 L524、en L3248、zh-CN L6000）追加：
   - 接口：`projectActions: string; closeMenu: string;`
   - en：`projectActions: 'Project actions', closeMenu: 'Close menu',`
   - zh-CN：`projectActions: '项目操作', closeMenu: '关闭菜单',`
   - **删除**原方案中的 `projectActionsFor: '{name} 的操作'` —— 当前 a11y 收益相对实现复杂度不划算，且 `project.name` 可能为空字符串需要 fallback；本轮先做最小改动。
2. `src/components/video/projects/ProjectCard.tsx:107` 改为 `aria-label={t.videoProjects.projectActions}`。
3. **测试同步**：
   - `ProjectCard.test.tsx:45` 断言放宽：从 `expect(cardSrc).toMatch(/aria-label="Project actions"/)` 改为 `expect(cardSrc).toMatch(/aria-label=\{t\.videoProjects\.projectActions\}/)`。

### 测试建议

- Vitest（jsdom）：渲染 ProjectCard 在 zh-CN（mock LocaleContext），断言 `getByRole('button', { name: '项目操作' })` 命中。

---

## Bug #3 — 时间显示混合中英文

**状态**：方案正确，按以下修正实施。

### 修正方案

1. **新增 `src/lib/relativeTime.ts`**（新文件，独立工具）：
   ```ts
   import type { Translations } from './i18n';
   import type { SupportedLocale } from './i18n';

   const intlMap: Record<SupportedLocale, string> = { en: 'en', 'zh-CN': 'zh-CN' };

   export function formatRelativeTime(
     iso: string | null | undefined,
     locale: SupportedLocale,
     t: Translations,
     fallback?: string,
   ): string {
     if (!iso) return fallback ?? '';
     const ts = Date.parse(iso);
     if (Number.isNaN(ts)) return fallback ?? '';
     const diffMs = Date.now() - ts;
     const sec = Math.round(diffMs / 1000);
     // <60s 返回「刚刚 / just now」
     if (Math.abs(sec) < 60) return t.common.relativeTime.justNow;
     try {
       const rtf = new Intl.RelativeTimeFormat(intlMap[locale] ?? 'en', { numeric: 'auto' });
       const min = Math.round(sec / 60);
       if (Math.abs(min) < 60) return rtf.format(-min, 'minute');
       const hr = Math.round(min / 60);
       if (Math.abs(hr) < 24) return rtf.format(-hr, 'hour');
       const day = Math.round(hr / 24);
       if (Math.abs(day) < 30) return rtf.format(-day, 'day');
     } catch {
       /* fallthrough to absolute date */
     }
     try {
       return new Date(ts).toLocaleDateString(intlMap[locale] ?? 'en');
     } catch {
       return fallback ?? '';
     }
   }
   ```
   - **使用 `Intl.RelativeTimeFormat`**：现代 API，自动产出「3 分钟前 / 3 minutes ago / yesterday / 上周」等本地化字符串。
   - `numeric: 'auto'` 让系统决定何时使用「yesterday / 昨天」等惯用词。

2. **i18n 增量**（接口 L2 `common`、en L2726、zh-CN L5478）：
   ```ts
   common: {
     ...
     relativeTime: { justNow: string };
   };
   // en
   relativeTime: { justNow: 'Just now' },
   // zh-CN
   relativeTime: { justNow: '刚刚' },
   ```
   只补一个 `justNow` key——其它分级交给 `Intl.RelativeTimeFormat` 处理。

3. **替换调用点**：
   - `src/components/video/projects/ProjectCard.tsx`
     - 删除 L26–43 的 `formatRelative` 内联函数。
     - 在组件体内（`useLocale()` 后）调用：
       ```tsx
       const { t, locale } = useLocale();
       ...
       <div className="text-[11px] text-muted-foreground/80">
         {t.videoProjects.lastOpened}{t.common.colon}{' '}
         {formatRelativeTime(
           project.last_opened_at || project.updated_at,
           locale,
           t,
           t.videoProjects.neverOpened,
         )}
       </div>
       ```
     - **冒号本地化**：在 `common` 新增 `colon: ':'` (en) / `colon: '：'` (zh-CN)，避免新建 `lastOpenedWithValue` 这种复合键（原方案重复定义已有的 `lastOpened`）。改这一处即可全局复用。
   - `src/components/chat/ChatTypeSelectionModal.tsx`
     - 删除 L12–30 `relativeTimeEN` 内联函数。
     - L367 改为 `formatRelativeTime(workflow.updated_at || workflow.created_at, locale, t, '')`，`locale` 通过 `useLocale()` 拿。
   - `src/components/AdminSettings/UserManagement.tsx:51` `formatRelativeTime` 函数同源问题。**本轮顺手做（5 行替换、风险低）**：替换为公共工具调用，避免管理页面继续输出 `5m / 3h`。

4. **`useLocale` 当前是否暴露 `locale`**：需要核实 `LocaleContext.tsx`。如果只暴露 `t` 不暴露 `locale`，则补一行：将 `locale` 也从 context 透出（应已暴露；若未，则在改造时一并补全）。**步骤 4 实施时第一步必须先验证此点**。

### 风险与注意事项

- `Intl.RelativeTimeFormat` 在 Chromium / Firefox / Safari / Node 14+ 全支持，与项目浏览器目标兼容（Next.js 15 + React 19 已是现代 baseline）。
- `numeric: 'auto'` 在 zh-CN 下输出「3 分钟前 / 1 小时前 / 今天 / 昨天」；在 en 下输出 `3 minutes ago / 1 hour ago / yesterday / today`——与 bug 报告期望一致。
- 既有快照若包含 `22d ago` 字面量，需同步更新（步骤 4 中执行 `npm run test` 验证）。

### 测试建议

- Vitest 新增 `src/lib/__tests__/relativeTime.test.ts`：mock `Date.now`，覆盖 30s / 5min / 3h / 7d / 35d 五档，每档断言 en / zh-CN 输出语言一致且符合预期。
- Vitest（jsdom）：渲染 ProjectCard 在 zh-CN，注入 `last_opened_at` 为 5 分钟前的 ISO，断言 DOM 文本包含「上次打开：5 分钟前」。

---

## Bug #4 — 项目操作菜单缺 ARIA `menu` / `menuitem`

**状态**：**翻转推荐方案**：原方案推荐 Option A（Radix DropdownMenu），但项目零 Radix 依赖（已核对 `package.json`）。本轮采用**手写 ARIA 增强**。

### 修正方案（采用原 Option B，并加键盘导航与焦点恢复）

1. `src/components/video/projects/ProjectCard.tsx`：在 `menuOpen` 容器与子按钮上添加 ARIA。
2. 完整改造（替换原 L98–152）：
   ```tsx
   const menuRef = useRef<HTMLDivElement>(null);
   const triggerRef = useRef<HTMLButtonElement>(null);
   const itemRefs = useRef<HTMLButtonElement[]>([]);

   // Esc / outside-click 关闭 + 还原焦点
   useEffect(() => {
     if (!menuOpen) return;
     const onKey = (e: KeyboardEvent) => {
       if (e.key === 'Escape') {
         e.preventDefault();
         setMenuOpen(false);
         triggerRef.current?.focus();
       }
     };
     document.addEventListener('keydown', onKey);
     return () => document.removeEventListener('keydown', onKey);
   }, [menuOpen]);

   // 打开后聚焦首项
   useEffect(() => {
     if (menuOpen && itemRefs.current[0]) itemRefs.current[0].focus();
   }, [menuOpen]);

   const onItemKeyDown = (e: React.KeyboardEvent, idx: number) => {
     if (e.key === 'ArrowDown') { e.preventDefault(); itemRefs.current[(idx + 1) % itemRefs.current.length]?.focus(); }
     if (e.key === 'ArrowUp')   { e.preventDefault(); itemRefs.current[(idx - 1 + itemRefs.current.length) % itemRefs.current.length]?.focus(); }
     if (e.key === 'Tab')       { setMenuOpen(false); /* 让 Tab 自然走出 */ }
   };
   ```
   ```tsx
   <button
     ref={triggerRef}
     type="button"
     aria-label={t.videoProjects.projectActions}
     aria-haspopup="menu"
     aria-expanded={menuOpen}
     onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}
     ...
   >...</button>

   {menuOpen && (
     <>
       <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); triggerRef.current?.focus(); }} />
       <div
         ref={menuRef}
         role="menu"
         aria-label={t.videoProjects.projectActions}
         className="absolute right-0 top-full mt-1 z-20 min-w-[140px] bg-popover border border-border rounded-md shadow-lg py-1"
         onClick={(e) => e.stopPropagation()}
       >
         <button ref={el => { if (el) itemRefs.current[0] = el; }} role="menuitem" type="button"
           onKeyDown={(e) => onItemKeyDown(e, 0)}
           onClick={() => { setMenuOpen(false); onRename(); }}
           className="w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent focus:bg-accent focus:outline-none"
         >{t.videoProjects.rename}</button>
         <button ref={el => { if (el) itemRefs.current[1] = el; }} role="menuitem" type="button"
           onKeyDown={(e) => onItemKeyDown(e, 1)}
           onClick={() => { setMenuOpen(false); onDelete(); }}
           className="w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-accent focus:bg-accent focus:outline-none"
         >{t.videoProjects.delete}</button>
       </div>
     </>
   )}
   ```
3. **测试同步**：`ProjectCard.test.tsx:45` 已在 Bug #2 改造，新增 a11y 断言：菜单展开后 `getByRole('menu')` / `getAllByRole('menuitem')` 各 1 / 2 命中；按 ArrowDown 后第二项被 focused。

### 风险与注意事项（修正）

- 不依赖 Radix Portal：菜单位置仍由现有 `absolute right-0 top-full` 控制；项目卡 `menuOpen ? z-30 : ''` 的 z-index 提升保留（确保覆盖兄弟卡片）。
- 手写 dropdown 不支持「碰撞感知翻转」（菜单溢出视口下边时不会自动向上）；评估当前「位于卡片右上角，菜单 ~80px 高」场景下风险极低，**本轮接受**；若后续投诉再考虑接入 `@floating-ui/react` 这种轻依赖（非本轮范围）。

### 测试建议

- a11y Vitest（jsdom + @testing-library）：点击触发器 → `findByRole('menu')` 命中；`getAllByRole('menuitem').length === 2`；`fireEvent.keyDown(item0, { key: 'ArrowDown' })` → `expect(item1).toHaveFocus()`；`fireEvent.keyDown(menu, { key: 'Escape' })` → trigger 重新获得焦点。

---

## Bug #5 — 「新建分类/项目」Modal 不是 ARIA dialog

**状态**：保留原方案 1（封装公共 Modal 组件），明确**不引入新依赖**。

### 修正方案

1. **新建 `src/components/ui/Modal.tsx`**（无新依赖、纯手写）：
   ```tsx
   'use client';

   import React, { useEffect, useRef } from 'react';

   interface ModalProps {
     isOpen: boolean;
     onClose: () => void;
     labelledBy: string;          // 必填：调用方负责给标题元素加 id
     describedBy?: string;
     children: React.ReactNode;
     className?: string;          // 给 backdrop 容器，定位/居中样式
     contentClassName?: string;   // 给内容容器
     closeOnBackdrop?: boolean;   // 默认 true
   }

   export const Modal: React.FC<ModalProps> = ({
     isOpen, onClose, labelledBy, describedBy, children, className, contentClassName, closeOnBackdrop = true,
   }) => {
     const dialogRef = useRef<HTMLDivElement>(null);
     const previouslyFocused = useRef<Element | null>(null);

     useEffect(() => {
       if (!isOpen) return;
       previouslyFocused.current = document.activeElement;
       // 进入时焦点：让浏览器自然处理 autoFocus；若没有 autoFocus 则聚焦容器
       const root = dialogRef.current;
       if (root && !root.contains(document.activeElement)) root.focus();

       const onKey = (e: KeyboardEvent) => {
         if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
         if (e.key === 'Tab' && root) {
           const focusables = root.querySelectorAll<HTMLElement>(
             'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
           );
           if (focusables.length === 0) return;
           const first = focusables[0];
           const last = focusables[focusables.length - 1];
           if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
           else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
         }
       };
       document.addEventListener('keydown', onKey);
       return () => {
         document.removeEventListener('keydown', onKey);
         (previouslyFocused.current as HTMLElement | null)?.focus?.();
       };
     }, [isOpen, onClose]);

     if (!isOpen) return null;

     return (
       <div
         className={className ?? 'fixed inset-0 z-modal flex items-center justify-center p-4 bg-black/60'}
         onClick={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}
       >
         <div
           ref={dialogRef}
           role="dialog"
           aria-modal="true"
           aria-labelledby={labelledBy}
           aria-describedby={describedBy}
           tabIndex={-1}
           className={contentClassName}
         >
           {children}
         </div>
       </div>
     );
   };

   export default Modal;
   ```

2. **改造 `ProjectFormDialog.tsx`**（替换 L62–146 整个返回 JSX）：
   ```tsx
   return (
     <Modal isOpen={isOpen} onClose={onCancel} labelledBy="project-form-title">
       <form onSubmit={handleSubmit} className="bg-card rounded-md shadow-xl border border-border w-full max-w-md">
         <div className="px-6 pt-6 pb-2">
           <h3 id="project-form-title" className="text-lg font-semibold text-foreground">
             {mode === 'create' ? t.videoProjects.newProject : t.videoProjects.rename}
           </h3>
         </div>
         {/* ... 原有 form body 不动 ... */}
       </form>
     </Modal>
   );
   ```

3. **改造 `CategoryFormDialog.tsx`**（同上模式，labelledBy="category-form-title"）。

4. **本轮 scope 限定这两个 dialog**；后续可渐进迁移 `StoryboardScriptTab` deleteConfirm 等。

### 风险与注意事项（修正）

- **焦点陷阱**：使用上面的 `Tab/Shift+Tab` 手写循环，无需 `focus-trap-react` 依赖。
- **`autoFocus` input 共存**：原 `ProjectFormDialog`/`CategoryFormDialog` 的 input 已带 `autoFocus`，`Modal.useEffect` 中「root 未含 activeElement 时才聚焦容器」的判断会让出焦点权给 input。
- **历史快照**：`projectHydration.test.tsx` / `projectPersistence.integration.test.tsx` 不依赖 dialog DOM 结构，无回归风险（已确认这些测试只读 LS 与 hook 行为，不渲染 dialog）。

### 测试建议

- 新增 `src/components/ui/__tests__/Modal.test.tsx`：覆盖 (a) 渲染时 `getByRole('dialog')`、`aria-modal=true`；(b) Esc 触发 onClose；(c) backdrop 点击触发 onClose；(d) 关闭后焦点还原至 `previouslyFocused`。
- 手动：屏幕阅读器朗读「项目名称对话框」，输入 → Tab 在 form 内循环、Esc 关闭。

---

## Bug #6 — 「AI 分镜」空态提示方向错误

**状态**：保留原方案。文案修改属于纯 i18n。

### 代码定位（核对）

- `src/lib/i18n.ts:7131`（zh-CN）确认存在 `selectStoryboardPackHint: '在上方下拉菜单中选择已生成的分镜包'`。
- `src/lib/i18n.ts:4379`（en）确认存在 `selectStoryboardPackHint: 'Select a generated storyboard pack from the dropdown above'`。
- 消费点 `StoryboardScriptTab.tsx:197` 已确认。

### 修正方案

- zh-CN：`'请在下方下拉菜单中选择已生成的分镜包'`
- en：`'Select a generated storyboard pack from the dropdown below'`
- **不做**「追加跳转链接」增强项（保持本轮 scope 收敛）。

### 风险

- 已用 `Grep` 验证：`docs/diagnoses/...` 之外，`src/__tests__` 与 `src/components/**/__tests__` 中无任何快照命中旧文案。安全替换。

---

## Bug #7 — AI 混剪 Modal 无选中态语义

**状态**：保留原方案，**降低范围**：不修改 footer 按钮文案、不引入 `tabIndex` 漫游策略（只用最简的 radiogroup ARIA）。

### 修正方案

1. `AIMixingModeSelectionModal.tsx` 修改 L115–217 两个卡片 `<div onClick>`：
   ```tsx
   <div role="radiogroup" aria-labelledby="ai-mixing-mode-title" className="px-6 py-6 space-y-4">
     <div
       role="radio"
       tabIndex={selectedMode === 'quick' ? 0 : -1}
       aria-checked={selectedMode === 'quick'}
       onClick={() => setSelectedMode('quick')}
       onKeyDown={(e) => {
         if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setSelectedMode('quick'); }
         if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setSelectedMode('professional'); }
       }}
       className={`relative p-4 rounded-md border-2 cursor-pointer transition-all duration-200 ${selectedMode === 'quick' ? 'border-primary bg-primary/10' : 'border-border hover:border-border hover:bg-muted'}`}
     >
       {/* 既有 quick 卡内容不动 */}
     </div>

     <div
       role="radio"
       tabIndex={selectedMode === 'professional' ? 0 : -1}
       aria-checked={selectedMode === 'professional'}
       onClick={() => setSelectedMode('professional')}
       onKeyDown={(e) => {
         if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setSelectedMode('professional'); }
         if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setSelectedMode('quick'); }
       }}
       className={`relative p-4 rounded-md border-2 cursor-pointer transition-all duration-200 ${selectedMode === 'professional' ? 'border-primary bg-primary/10' : 'border-border hover:border-border hover:bg-muted'}`}
     >
       {/* 既有 professional 卡内容不动 */}
     </div>
   </div>
   ```

2. **roving tabindex** 实施：仅当前选中的卡 `tabIndex=0`，未选 `-1`。`setSelectedMode` 改变后 React 重渲染时 tabIndex 自动同步；用户用方向键切换后，浏览器仍保持焦点在原 DOM 元素，**需要在 keyDown 后将焦点显式移到新选中卡**。简化处理：
   ```tsx
   const quickRef = useRef<HTMLDivElement>(null);
   const proRef   = useRef<HTMLDivElement>(null);
   useEffect(() => {
     if (selectedMode === 'quick') quickRef.current?.focus();
     else proRef.current?.focus();
   }, [selectedMode]);
   ```
   并把 `ref={quickRef}` / `ref={proRef}` 绑到对应卡片。**注意**：要避免 modal 打开时 effect 自动抢焦点（应只在键盘切换后才 refocus），可加 ref 标记位 `keyboardChangedRef.current`，或改为只在 `onKeyDown` 内显式 `quickRef.current?.focus()`。**步骤 4 实施时按后者更简洁**：
   ```tsx
   onKeyDown={(e) => {
     if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
       e.preventDefault(); setSelectedMode('professional'); proRef.current?.focus();
     }
   }}
   ```

3. **不修改 footer 按钮文案**（原方案 #3 加模式名称建议）—— 范围收敛、避免改动 i18n。

4. **保留默认 `'quick'`**（不强制 `null + disabled`），原方案在这一点上正确。

### 风险与注意事项

- 原 modal 已有 `aria-modal=true / role=dialog`（L75–78），radiogroup 是其子节点，结构合规。
- `id="ai-mixing-mode-title"` 已存在于 L91，可直接被 radiogroup 引用为 `aria-labelledby`。
- 卡片内含 input（professional 选中后渲染 frame interval 输入框）、点击其 input 不应被卡片 onClick 截走切换 `quick`：当前 input 在 `selectedMode === 'professional'` 子树内，本就不会触发 quick 切换；但 `<input>` 上点击会冒泡到外层 `role=radio` 卡片的 `onClick`，会再次 `setSelectedMode('professional')`（幂等），不影响功能。**接受**。

### 测试建议

- Vitest（jsdom）：渲染 modal，断言 `getByRole('radiogroup')` 命中、第一项 `aria-checked='true'`；`fireEvent.keyDown(quick, { key: 'ArrowDown' })` → 第二项 `aria-checked='true'`。

---

## Bug #8 — 「新对话」Modal Close 按钮 `aria-label="Close"`

**状态**：保留原方案，**精确化文件清单**。

### 修正方案

`t.common.close = '关闭'`（已存在 zh-CN L5488 + en L12）。新增 `t.common.closePanel`：

1. **i18n 增量**：
   - 接口 L2（`common`）追加：`closePanel: string;`
   - en L2726：`closePanel: 'Close panel',`
   - zh-CN L5478：`closePanel: '关闭面板',`

2. **本轮替换清单**（已经过 Grep 确认的全部源码命中点，不含 docs / dist）：

   | 文件 | 行 | 旧值 | 新值 |
   |---|---|---|---|
   | `src/components/chat/ChatTypeSelectionModal.tsx` | 193 | `aria-label="Close"` | `aria-label={t.common.close}` |
   | `src/components/chat/WorkflowSelectionModal.tsx` | 122 | `aria-label="Close"` | `aria-label={t.common.close}` |
   | `src/components/video/components/AiVideoModal/AiVideoModal.tsx` | 247 | `aria-label="Close"` | `aria-label={t.common.close}` |
   | `src/components/video/components/AiImageModal/AiImageModal.tsx` | 217 | `aria-label="Close"` | `aria-label={t.common.close}` |
   | `src/components/video/components/WorkflowConfigModal/WorkflowConfigModal.tsx` | 376 | `aria-label="Close"` | `aria-label={t.common.close}` |
   | `src/components/video/components/MyMaterialsModal/MyMaterialsModal.tsx` | 219 | `aria-label="Close"` | `aria-label={t.common.close}` |
   | `src/components/video/components/MaterialsPanel/GridPackModal.tsx` | 45 | `aria-label="Close"` | `aria-label={t.common.close}` |
   | `src/components/workflow/ChatLLMConfigPanel.tsx` | 115 | `aria-label="Close panel"` | `aria-label={t.common.closePanel}` |
   | `src/components/workflow/StartNodeConfigPanel.tsx` | 100 | `aria-label="Close panel"` | `aria-label={t.common.closePanel}` |
   | `src/components/workflow/ToArrayConfigPanel.tsx` | 180 | `aria-label="Close panel"` | `aria-label={t.common.closePanel}` |
   | `src/components/workflow/ResultsCombineConfigPanel.tsx` | 146 | `aria-label="Close panel"` | `aria-label={t.common.closePanel}` |
   | `src/components/workflow/TextInputConfigPanel.tsx` | 102 | `aria-label="Close panel"` | `aria-label={t.common.closePanel}` |
   | `src/components/workflow/VolcanoTTSConfigPanel.tsx` | 196 | `aria-label="Close panel"` | `aria-label={t.common.closePanel}` |

   **每个文件需确认**：(a) 已 `import { useLocale }` 或 `const { t } = useLocale()`；workflow 配置面板大多已用 i18n，应直接可改；(b) 修改后 ESLint / type-check 通过。

3. **不**接入 ESLint `no-restricted-syntax` 规则（YAGNI；当前 codebase 内已无残留即可）。

### 测试建议

- Vitest：渲染 `ChatTypeSelectionModal` 在 zh-CN，`getByRole('button', { name: '关闭' })` 命中。
- 命令行验证：`grep -rn 'aria-label="Close"\|aria-label="Close panel"' src/` 在合并前必须 0 命中。

---

## Bug #9 — `ImageOverlay` 控制台刷屏

**状态**：保留原方案，按以下修正实施。

### 修正方案

#### 9.1 让 `logger.warn` 加 production gate

`src/components/video/utils/logger.ts:69–84` 改为：
```ts
warn(action: string, data?: Record<string, any>) {
  if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_VIDEO_EDIT_DEBUG) {
    return;
  }
  const logEntry: LogEntry = { timestamp: new Date().toISOString(), level: 'WARN', taskId: this.config.taskId, component: this.config.component, action, data };
  console.warn(`[${this.config.component}] ${action}`, { taskId: this.config.taskId, ...data, timestamp: logEntry.timestamp });
}
```

#### 9.2 删除首帧无意义 warning（`ImageOverlay.tsx`）

- L177–180 改为：
  ```tsx
  if (containerWidth === 0 || containerHeight === 0) return null;
  ```
  （移除 `overlayLogger.warn('container-zero', ...)`）
- L182–185 改为：
  ```tsx
  if (pixelPosition.width === 0 || pixelPosition.height === 0) return null;
  ```
  （移除 `overlayLogger.warn('pixel-position-zero', ...)`，**不**降级为 debug——首帧零尺寸是正常态，无诊断价值）

#### 9.3 `VideoPlayerPanel.tsx` 删除冗余 warning 与 URL-leaking debug

- L2150–2152：删除 `if (containerDimensions.width === 0 ...) { logger.warn(...) }` 整段。
- L2139–2148 `logger.debug('render image overlays', { ... overlays: overlays.map(o => ({ id, url, position })) })`：把 payload 中的 `url` 字段去掉，保留 `id` 与 `position`。
- L2205 同样改造（preview 模式那次 debug）。

#### 9.4 删除 `ImageOverlay.tsx` 主体的 render-period debug

- L43–52 整段 `overlayLogger.debug('render', { ... imageUrl ... })` **直接删除**。
- 保留的 debug 调用：`drag-start / drag-update / drag-end / resize-start / resize-update / image-loaded`（事件型，单次触发可控）；`image-load-failed` 仍走 `error` 级（保留）。

### 风险与注意事项（修正）

- `logger.warn` 全局 gate 的连带影响：扫一遍仓库其他 `logger.warn` 调用（无需在本任务中文档化逐条），确认在 prod 静默是合理行为；如某 warn 在 prod 必须可见，应升级为 `error`。**步骤 4 实施时执行 `grep -rn "logger.warn\|.warn(" src/components/video` 完成评审**：当前 video 模块的 warn 调用主要在 `ImageOverlay`（已删）、`VideoPlayerPanel`（已删）、各种异常恢复路径（应升 `error`），暂不强制处理，本轮 scope 限定 ImageOverlay/VideoPlayerPanel。
- 测试 `logger.test.ts` 若已存在断言 warn 在 prod 也输出，需要更新。

### 测试建议

- 新增 `src/components/video/utils/__tests__/logger.test.ts`：mock `process.env.NODE_ENV`，断言 production 下 `logger.warn(...)` 不调用 `console.warn`；`NEXT_PUBLIC_VIDEO_EDIT_DEBUG='1'` 时调用一次。
- 手动：dev 加图片素材到时间轴，Console 应：(a) 不再刷屏 `[ImageOverlay] render`；(b) 不再有 `container-zero` / `pixel-position-zero` warn；(c) 拖拽时仍有 `drag-*` debug 输出（可关）。

---

## 修复执行顺序（修正后）

> 删除原方案的「PR 拆分」描述（本轮单次提交），保留依赖关系排序：

1. **底层 i18n 扩展**（步骤 4 第一步）：
   - `src/lib/i18n.ts` 接口扩展（一次性）：`common.relativeTime / common.closePanel / common.colon`、`tasks.types / tasks.defaultPageTitle`、`videoProjects.projectActions / videoProjects.closeMenu`、修正 `selectStoryboardPackHint` 文案。
   - 验证 TS 编译通过（接口 + en + zh-CN 三处对称）。

2. **基础工具新建**：
   - `src/lib/relativeTime.ts`（Bug #3）。
   - `src/components/ui/Modal.tsx`（Bug #5）。
   - 其单测同步落地。

3. **组件改造（按文件维度，并行无依赖）**：
   - `useTasks.ts`（Bug #1）+ `useTasks.persistence.test.ts` 同步。
   - `ProjectCard.tsx`（Bug #2/#3/#4）+ `ProjectCard.test.tsx` 同步。
   - `ProjectFormDialog.tsx` / `CategoryFormDialog.tsx` 接入 `Modal`（Bug #5）。
   - `ChatTypeSelectionModal.tsx`（Bug #3 时间 + Bug #8 close）。
   - `AIMixingModeSelectionModal.tsx`（Bug #7 radiogroup）。
   - 13 个 close/closePanel 替换（Bug #8 清单）。
   - `UserManagement.tsx` 时间格式（Bug #3 顺手项）。

4. **i18n 文案修正**：`selectStoryboardPackHint` 上方→下方（Bug #6）。

5. **log hygiene**（Bug #9）：`logger.ts` warn gate；`ImageOverlay.tsx` 删 render debug 与首帧 warn；`VideoPlayerPanel.tsx` 删 url 字段与 zero-dim warn。

6. **验证**：
   - `npm run type-check`
   - `npm run lint`
   - `npm run test`
   - 手动 dev：依清单逐项验收。

---

## 全局风险（修正后）

- **i18n 双 locale 同步**：每次给接口加字段必须同步给 `en` 与 `zh-CN` 两个对象——否则 `t.foo.bar === undefined` 在另一个 locale 下显式抛 runtime undefined。建议用 IDE 的 "show interface implementation" 一并修改。
- **`useTasks` LS 迁移幂等性**：迁移逻辑只在 hydration 阶段命中 canonical 英文清单时重写，重写后 title 不再属于清单成员，下次 hydration 不会再触发——安全。
- **不引入新依赖**：本轮所有 a11y 改造（dialog / dropdown / radiogroup / modal）使用纯手写 + ARIA 属性，不新增 `@radix-ui/*` 或 `focus-trap-react`。
- **`Intl.RelativeTimeFormat` 兼容性**：现代浏览器全支持，Node 14+ 全支持，与 Next.js 15 / React 19 baseline 兼容。
- **测试快照**：步骤 4 实施过程中执行 `npm run test`，对快照失败逐个评审（多数应为旧字面量 → 新 i18n 引用的预期变化，逐条更新）。

---

## 完工验收清单（步骤 4 必须全过）

- [ ] `npm run type-check` 全绿（关键：i18n 接口扩展后 TS 严格模式通过）
- [ ] `npm run lint` 全绿
- [ ] `npm run test` 全绿；新增 vitest 覆盖：`Modal.test.tsx`、`relativeTime.test.ts`、`logger.test.ts`、`useTasks.persistence.test.ts` 更新
- [ ] zh-CN 进入项目编辑器：`document.title === '视频编辑 · Ecliptrix'`
- [ ] 项目卡 ⋯ 触发器 accessible name = `项目操作`；展开后 `role=menu` / `role=menuitem`，方向键导航 + Esc 还原焦点
- [ ] 「新建项目/分类」Modal：`role=dialog` `aria-modal=true`，Esc 关闭，Tab 在容器内循环
- [ ] 项目列表显示 `上次打开：5 分钟前`（zh-CN）/ `Last opened: 5 minutes ago`（en），无 `Xd / Xm` 残留
- [ ] AI 分镜空态文案为「请在下方下拉菜单中选择已生成的分镜包」
- [ ] AI 混剪模式 Modal：`role=radiogroup`，初始 quick `aria-checked=true`，键盘可切换
- [ ] 新对话 Modal Close accessible name = `关闭`；其他 12 个 close/closePanel 命中点全部本地化
- [ ] dev 控制台进入 video editor 后，无 `[ImageOverlay] render` 每帧 LOG、无 `container-zero` / `pixel-position-zero` warn；error 级保留可见
- [ ] 命令行验证：`grep -rn 'aria-label="Close"\|aria-label="Close panel"' src/` 0 命中

---

## 与原方案的差异一览（供对照）

| 位置 | 原方案 | 修正后 | 原因 |
|---|---|---|---|
| 全局 | 三种 locale 同步（en/zh-CN/zh-TW/ja） | 仅 en + zh-CN | 项目只有 2 个 locale |
| Bug #1 | `tasks.types` 含 5 键（含 `content`） | 4 键 | TaskType 仅 4 类型 |
| Bug #2 | 引入 `projectActionsFor: '{name} 的操作'` | 简化为 `projectActions` | YAGNI，本轮收敛 scope |
| Bug #3 | 新增 `lastOpenedWithValue` 复合键 | 改为 `common.colon: ':'/'：'` | 避免重复定义已有 `lastOpened` |
| Bug #3 | UserManagement 顺手项标为「不阻塞」 | 纳入本轮（5 行替换） | 收益 / 风险比明显 |
| Bug #4 | 推荐 Radix DropdownMenu | 手写 ARIA + 键盘导航 | 项目无 Radix 依赖，禁止本轮新增 |
| Bug #5 | 提议复用 shadcn `dialog.tsx` | 自实现 `src/components/ui/Modal.tsx` | 项目无 shadcn dialog 组件文件 |
| Bug #5 | 焦点陷阱备注「可用 `focus-trap-react`」 | 手写 Tab/Shift+Tab 循环 | 不新增依赖 |
| Bug #7 | 新增 footer 按钮显示模式名 | 不改 footer | 收敛 scope，专注 a11y |
| Bug #9 9.2 | `pixel-position-zero` 降级为 debug | 直接 return null（移除日志） | 首帧零尺寸不是诊断信息 |

---

## 结论

修正后的方案已：
- ✅ 移除所有不存在的依赖假设（Radix / shadcn / focus-trap-react / 第三 locale）
- ✅ 修正 TaskType 字段不一致问题
- ✅ 精确化每处替换的文件 + 行号 + 旧值 → 新值
- ✅ 给出与项目无新依赖约束兼容的实现路线
- ✅ 验收清单可逐条机械验证

**步骤 4 可直接据此实施**，无需再做额外探索。
