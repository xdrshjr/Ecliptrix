# Iter9 Bug Fix Plan — A11y / i18n / Log Hygiene

> 配套 Bug 报告：`docs/diagnoses/iter9-bug-report-20260509/bug-report.md`
> 编写时间：2026-05-09
> 适用 Subtask：#3（修复实施）/ #4（代码评审）

本文档把 9 个 Bug 拆成最小可落地的代码改动，标注精确的文件 + 行号、根因、修复策略、改动 diff（伪/实代码）、风险与回归测试建议。改动范围**仅限前端**，无 backend / DB / 配置变更。

---

## 优先级与依赖关系

| 阶段 | Bugs | 依赖 |
|---|---|---|
| Phase A — i18n 字典扩展 | #4, #6 (key 新增) | 无 |
| Phase B — Component 修复 | #1, #2, #3, #5, #6, #7 | A 提供的新 i18n key |
| Phase C — 日志卫生 | #8, #9 | 无（与 A/B 互不影响） |

A 必须先做（B/C 可并行）。**所有 9 个 Bug 都可在同一个 PR 里完成**，因为相互不冲突且改动量小。

---

## 通用约定

- **新增 i18n key** 必须同时写入 `en` 与 `zh-CN` 字典；位置紧跟同一命名空间已有 key（保持字母 / 语义聚类）。
- 涉及 ARIA 的修改**不要修改可见样式**——所有 className 保留原值。
- 日志改动只删除 / 包裹，不改业务行为。
- 需要 `useRef`、`useId`、`useEffect` 等 React Hook 时优先复用 `react` 已 import 的列表。
- 所有 `<button>` 默认加 `type="button"`，避免在表单里被识别为隐式 submit。

---

## Bug #1 — LoginModal 缺失 dialog ARIA 语义

### 文件 / 位置
- `src/components/LoginModal.tsx`
- 容器根：第 100 行 `<div className="fixed inset-0 z-[9999] ...">`
- backdrop：第 102-105 行 `<div className="absolute inset-0 bg-black/60" onClick={onClose} />`
- 关闭按钮：第 110-117 行 `<button onClick={onClose} ...>`
- 标题：第 124-126 行 `<h2 ... >{t.auth.welcomeBack}</h2>`

### 根因
- 根容器是普通 `<div>`，AT 看不到 dialog 语义。
- 关闭按钮内只有 SVG，缺 `aria-label`。
- backdrop 是可点击 `<div>`，AT 解析为可激活节点，混淆焦点决策。

### 修复策略
1. 在 `LoginModal` 顶层用 `useId()` 生成稳定的 `titleId`。
2. **modal 容器（line 108 的"relative w-full max-w-4xl..."）** 加 `role="dialog"`、`aria-modal="true"`、`aria-labelledby={titleId}`。注意：z-9999 那个外层 wrapper 仅做定位，把 dialog 角色放到真正的 modal 容器（`<div className="relative w-full max-w-4xl ...">`）上更合 ARIA 语义。
3. h2 加 `id={titleId}`。
4. 关闭按钮加 `aria-label={t.common.close}`、`type="button"`；内部 SVG 加 `aria-hidden="true"`。
5. backdrop 加 `aria-hidden="true"` 与 `tabIndex={-1}`，并保持其 onClick 关闭行为不变。

### 改动伪代码
```tsx
import React, { useEffect, useId, useRef, useState } from 'react';
// ...
const titleId = useId();

return (
  <div className="fixed inset-0 z-[9999] flex items-center justify-center">
    <div
      className="absolute inset-0 bg-black/60"
      aria-hidden="true"
      onClick={onClose}
    />
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="relative w-full max-w-4xl mx-4 bg-card rounded-md border border-border shadow-xl overflow-hidden"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t.common.close}
        className="absolute top-4 right-4 ..."
      >
        <svg aria-hidden="true" ...>...</svg>
      </button>
      ...
      <h2 id={titleId} className="text-2xl font-semibold text-foreground mb-2">
        {t.auth.welcomeBack}
      </h2>
      ...
```

### 风险 / 注意
- `useId()` 是 React 18+ API，已在项目其它文件中使用，无新增依赖。
- 不要给 z-9999 外层 wrapper 同时加 `role="dialog"`，否则 AT 会遇到嵌套对话框。
- backdrop 使用 `aria-hidden` 可能让某些 AT 跳过它，但因为它没有可读文本且功能是关闭，符合预期。

### 测试建议
- Vitest / RTL：渲染 LoginModal 并断言 `getByRole('dialog')` 存在、`accessibleName === t.auth.welcomeBack`、`getByRole('button', { name: t.common.close })` 存在。
- Playwright：a11y 快照应显示 `dialog "Welcome Back"` 与 `button "Close"`。

---

## Bug #2 — LoginModal 焦点不进入对话框且无 focus trap

### 文件 / 位置
- `src/components/LoginModal.tsx:13-44`（hooks 段）
- 影响 username `<input>` (line 138)、password `<input>` (line 154)、submit `<button>` (line 171)、close `<button>` (line 110)。

### 根因
- 没有 `useEffect` 在 `isOpen` 变 true 时把焦点移入；没有 keydown 监听对 Tab 做循环。
- 关闭后未把焦点归还触发元素。

### 修复策略
1. `useRef<HTMLInputElement>(null)` 绑定 username `<input>`。
2. 新增 `useRef<HTMLDivElement>(null)` 绑定 dialog 容器（用于查询可聚焦子元素）。
3. 用 `useRef<HTMLElement | null>(null)` 保存"打开前的 activeElement"。
4. 当 `isOpen` 由 false 变 true：
   - 保存 `previouslyFocusedRef.current = document.activeElement as HTMLElement | null`
   - 下一帧 `usernameInputRef.current?.focus({ preventScroll: true })`
5. 当 `isOpen` 由 true 变 false：恢复 `previouslyFocusedRef.current?.focus()`（可在 cleanup 中处理）。
6. 在 modal 容器加 `onKeyDown`：监听 `Tab` / `Shift+Tab`，若当前焦点是 first focusable，且按 Shift+Tab → 跳到 last；若是 last，且按 Tab → 跳到 first；其它情况不拦截。可写一个轻量 helper：
   ```ts
   function getFocusable(root: HTMLElement) {
     return Array.from(root.querySelectorAll<HTMLElement>(
       'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
     )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
   }
   ```
7. 把 `useEffect`（escape 监听）扩展为 `Tab` 也在内（共用一个 listener，开销低）。

### 改动伪代码
```tsx
const dialogRef = useRef<HTMLDivElement>(null);
const usernameInputRef = useRef<HTMLInputElement>(null);
const previouslyFocusedRef = useRef<HTMLElement | null>(null);

useEffect(() => {
  if (!isOpen) return;
  previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
  // 等下一帧让 modal 渲染完
  const id = window.requestAnimationFrame(() => {
    usernameInputRef.current?.focus({ preventScroll: true });
  });
  return () => {
    window.cancelAnimationFrame(id);
    // 关闭时恢复焦点
    previouslyFocusedRef.current?.focus?.();
  };
}, [isOpen]);

useEffect(() => {
  if (!isOpen) return;
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const list = getFocusable(dialogRef.current);
    if (list.length === 0) return;
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    else if (active && !dialogRef.current.contains(active)) {
      // 焦点穿透回 modal
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, [isOpen, onClose]);

// JSX:
<div ref={dialogRef} role="dialog" ...>
  <input ref={usernameInputRef} ... />
```

### 风险 / 注意
- `requestAnimationFrame` 是为了规避 React 渲染顺序导致 ref 还没挂上的边缘情况。
- 若 `previouslyFocusedRef.current` 是已被卸载的节点，调 `.focus()` 会抛错；用可选链 `?.focus?.()` 兜底。
- focus trap 与 Bug #1 的 `aria-modal="true"` 是互补关系；现代屏幕阅读器（NVDA / VoiceOver）依赖 `aria-modal` 进入"虚拟模态"状态，但键盘 trap 仍是必需的（否则 Tab 仍会泄漏）。
- 不要把这个逻辑抽离成单独 Hook 文件——本轮只服务 LoginModal，过度抽象会增加 diff 面与测试工作量。

### 测试建议
- Vitest / RTL：
  - 渲染时 `expect(document.activeElement).toBe(input[name=username])`。
  - 模拟 Tab 到 close 按钮后再 Tab → 焦点回到 username。
  - 关闭后焦点回到原触发元素（用 `userEvent.tab()` 模拟）。
- Playwright：可用 `page.keyboard.press('Tab')` 循环并断言 `evaluate(() => document.activeElement)` 始终在 modal 内。

---

## Bug #3 — Landing Page Feature 卡片不可键盘操作

### 文件 / 位置
- `src/components/HomePage/LandingPage.tsx:126-158`（map 内卡片渲染）

### 根因
代码只在 `isComingSoon === true` 时设置 `role="button"` / `aria-disabled`，其余 active 卡片没有任何 `role`、`tabIndex` 或键盘事件。

### 修复策略
- 卡片始终是可聚焦的语义按钮。
- 用 `<button type="button">` 替代 `<div>` 是最干净的方案——但卡片内部已有 `<h3>` 和 `<p>`，把这些放在 `<button>` 内部 HTML 是合法的（按钮可包含 phrasing+flow content 在 HTML5 中是被允许的，只是不能再嵌可交互元素）；当前内部仅有 `<svg>`/`<h3>`/`<p>`/`<span>`，全部为非交互节点，**安全**。
- 但要保留原有 `landing-feature-card` 样式：`<button>` 默认会有 user-agent 样式（圆角、padding、字号），需在 className 重置或者让现有 CSS 覆盖。最简单的：保留 `<div>` 并加 `role="button"` `tabIndex={0}` `onKeyDown` 处理 Enter / Space。
- **决定**：保留 `<div>`（避免视觉回归），始终加上无障碍属性。

### 改动伪代码
```tsx
{features.map((feature, index) => {
  const isComingSoon = feature.comingSoon === true;
  const isLoadingDisabled = isAuthLoading && !isComingSoon;
  const interactive = !isComingSoon; // 是否当作可激活按钮
  const stateClass = isComingSoon
    ? 'opacity-60 cursor-not-allowed'
    : isLoadingDisabled
      ? 'opacity-60 cursor-wait pointer-events-none'
      : '';

  const handleActivate = () => {
    if (isComingSoon || isAuthLoading) return;
    handleGetStarted(feature.type);
  };

  return (
    <div
      key={index}
      className={`landing-feature-card relative ${stateClass}`}
      role="button"
      tabIndex={isComingSoon ? -1 : 0}
      aria-disabled={isComingSoon || isLoadingDisabled || undefined}
      aria-label={`${feature.title} — ${feature.description}`}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleActivate();
        }
      }}
      title={isComingSoon ? t.landing.comingSoonHint : undefined}
    >
      ...
```

### 风险 / 注意
- 原代码 disabled 卡片是 `role="button"` `tabIndex` 默认（即不可聚焦），新代码把它显式设成 `tabIndex={-1}`，行为一致——AT 仍能识别 `aria-disabled` 状态。
- `aria-label` 同时给出 title + description 改善 AT 体验，但要确保翻译串里没有 HTML 实体（已 review，纯文本）。
- 不会改变样式 / 布局；只是新增 a11y 属性 + 键盘处理。

### 测试建议
- Vitest：每个 active feature 卡片 `getByRole('button', { name: /Video Editing/i })` 可拿到，且 `tabIndex === 0`。
- 触发 `userEvent.keyboard('{Enter}')` 或 `' '` 应调用 `onCreateTask`。
- Playwright：`page.keyboard.press('Tab')` 至卡片后按 Enter，应路由到对应任务。

---

## Bug #4 — 任务栏未登录提示硬编码中文

### 文件 / 位置
- `src/components/Taskbar.tsx:133` `showWarning('请先登录后再使用任务功能', 4000)`
- `src/components/VerticalTaskbar.tsx:136` 同字面量
- `src/lib/i18n.ts` `auth` 命名空间（en: line ~2840-2860；zh-CN: line ~5660-5680）

### 根因
toast 文案绕过 i18n，仅有中文字面量。

### 修复策略
1. 在 `auth` 命名空间新增 key `loginRequiredForTasks`：
   - en: `'Please sign in to use task features'`
   - zh-CN: `'请先登录后再使用任务功能'`
2. 两个组件改成 `showWarning(t.auth.loginRequiredForTasks, 4000)`。
3. **不要**把这个 key 放进 `common`，因为它是 auth 域语义。

### 改动伪代码
```ts
// i18n.ts (en, near line 2856)
auth: {
  ...
  requiredFields: 'Username and password are required',
  loginRequiredForTasks: 'Please sign in to use task features',
  ...
}

// i18n.ts (zh-CN, near line 5675)
auth: {
  ...
  requiredFields: '用户名和密码为必填项',
  loginRequiredForTasks: '请先登录后再使用任务功能',
  ...
}
```
```tsx
// Taskbar.tsx:133 & VerticalTaskbar.tsx:136
showWarning(t.auth.loginRequiredForTasks, 4000);
```

### 风险 / 注意
- `t.auth` 类型从 `i18n.ts` 顶部的 interface 推断。**必须同步在两个 interface（en 和 zh-CN 描述类型）添加 key**，否则 tsc 报错。需要在 `LoginRegisterStrings` 或 `AuthStrings` 接口（i18n.ts 第 ~63 行）也加 `loginRequiredForTasks: string;`。
- 添加新 key 后 `npm run type-check` 必跑。

### 测试建议
- Vitest：mock locale 为 en，渲染 VerticalTaskbar，未登录态下点 tab，断言 `showWarning` 被以英文文案调用。

---

## Bug #5 — LoginModal 错误段落非 alert region

### 文件 / 位置
- `src/components/LoginModal.tsx:165-169`

### 根因
错误容器是普通 `<div>` / `<p>`，无 live region 语义。

### 修复策略
1. 容器 `<div role="alert" aria-live="assertive" aria-atomic="true">`。
2. 同时给 username / password input 加 `aria-invalid={!!error || undefined}` 与 `aria-describedby={error ? errorId : undefined}`，errorId 用 `useId()`。

### 改动伪代码
```tsx
const errorId = useId();
// ...
<input
  id="username"
  aria-invalid={!!error || undefined}
  aria-describedby={error ? errorId : undefined}
  ...
/>
<input
  id="password"
  aria-invalid={!!error || undefined}
  aria-describedby={error ? errorId : undefined}
  ...
/>
{error && (
  <div
    id={errorId}
    role="alert"
    aria-live="assertive"
    aria-atomic="true"
    className="p-3 bg-destructive/10 border border-destructive/20 rounded-md"
  >
    <p className="text-sm text-destructive">{error}</p>
  </div>
)}
```

### 风险 / 注意
- `role="alert"` 隐式 `aria-live="assertive"`，再加显式 attr 是冗余但更稳。一些旧 AT 仅响应显式 attr。
- 不要把 `aria-live` 放到永远存在的容器上——条件渲染时 AT 才会朗读"出现的内容"。

### 测试建议
- Vitest：触发 submit 空表单，错误出现后 `getByRole('alert')` 文案匹配 `t.auth.requiredFields`。

---

## Bug #6 — VerticalTaskbar 关闭按钮无可访问名

### 文件 / 位置
- `src/components/VerticalTaskbar.tsx:172-179`
- `src/lib/i18n.ts` `common` 命名空间（en: 2803, zh-CN: 5622 已经有 `close` 与 `closePanel`）

### 根因
按钮内只有 SVG，无文本/aria-label/title。

### 修复策略
1. 新增 i18n key `common.closeTab`：
   - en: `'Close tab {title}'`
   - zh-CN: `'关闭标签 {title}'`
2. 简单的字符串替换：`t.common.closeTab.replace('{title}', getTaskLabel(tab.type))`。
3. SVG 加 `aria-hidden="true"`。
4. 按钮加 `type="button"`、`aria-label`、`title`。

### 改动伪代码
```tsx
// i18n.ts common (en) near line 2804
closePanel: 'Close panel',
closeTab: 'Close tab {title}',

// i18n.ts common (zh-CN) near 5623
closePanel: '关闭面板',
closeTab: '关闭标签 {title}',

// VerticalTaskbar.tsx 内部
const closeLabel = t.common.closeTab.replace('{title}', getTaskLabel(tab.type));
<button
  type="button"
  onClick={(e) => handleTabClose(e, tab.id)}
  aria-label={closeLabel}
  title={closeLabel}
  className="tab-close"
>
  <svg aria-hidden="true" className="w-3 h-3" ...>...</svg>
</button>
```

### 风险 / 注意
- 接口 `CommonStrings` 必须同步加 `closeTab: string;`。
- 模板用 `{title}` 而不是模板字面量是为了与现有 i18n 风格一致（grep 项目里多处使用 `{xxx}` 占位）。

### 测试建议
- Vitest：渲染包含 tab 的 VerticalTaskbar，断言 `getByRole('button', { name: /Close tab/i })` 数量等于 tab 数量。

---

## Bug #7 — VerticalTaskbar 标签 div+onClick 不支持键盘

### 文件 / 位置
- `src/components/VerticalTaskbar.tsx:161-183`

### 根因
外层 `<div>` 无 role / tabIndex / onKeyDown。

### 修复策略
- 与 Bug #3 同模式：保留 `<div>`（避免大幅改样式），添加 `role="tab"` 模式或 `role="button"`。考虑到 VerticalTaskbar 不是严格 ARIA tab pattern（没有可见 tabpanel 切换），用 `role="button"` + `aria-pressed={tab.isActive}` 或 `aria-current="page"` 更准确，比强行 tablist 更符合实际语义。
- 加 `tabIndex={0}`、`onKeyDown` 处理 Enter / Space。
- 但 `<div>` 内部嵌了一个 `<button>`（关闭按钮）。**HTML 不允许 button 嵌 button，但允许 `[role="button"]` 嵌 `<button>`** —— 不会触发嵌套交互冲突，因为 div 的 onKeyDown 处理 Enter/Space，关闭按钮自带键盘行为；点击事件已通过 `e.stopPropagation()` 隔离（line 127）。

### 改动伪代码
```tsx
<div
  key={tab.id}
  role="button"
  tabIndex={0}
  aria-current={tab.isActive ? 'page' : undefined}
  aria-label={getTaskLabel(tab.type)}
  className={`taskbar-tab ${tab.isActive ? 'active' : ''}`}
  onClick={(e) => handleTabClick(e, tab)}
  onKeyDown={(e) => {
    // 当焦点正好在这个 div 自身时才响应（关闭按钮自己处理）
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleTabClick(e as unknown as React.MouseEvent, tab);
    }
  }}
  title={!isExpanded ? getTaskLabel(tab.type) : undefined}
>
  ...
```

### 风险 / 注意
- `e.target !== e.currentTarget` 的守卫很重要——避免在内部关闭按钮上按 Enter 时 div 的 onKeyDown 又触发 selectTab（会把已关闭的 tab 选中）。
- `handleTabClick` 形参是 `React.MouseEvent`，里面只用 `stopPropagation`；keyboard 路径下传一个 mock event：
  ```ts
  const fakeEvent = { stopPropagation: () => {} } as React.MouseEvent;
  handleTabClick(fakeEvent, tab);
  ```
  或更干净地把 `handleTabClick` 重构为接受 `Tab` 单参数 + 内部不做 stopPropagation（当前 stopPropagation 是为了阻止 taskbar root 的 click 切换展开/折叠；keyboard 路径下我们也希望 stopPropagation 等效——key 事件不会冒泡到 onClick，所以无需调）。**实际方案**：把 stopPropagation 行为重构为单独函数：
  ```ts
  const selectTab = (tab: Tab) => {
    if (!isAuthenticated) { showWarning(t.auth.loginRequiredForTasks, 4000); return; }
    if (!isExpanded) setIsExpanded(true);
    onSelectTab(tab.id);
  };
  ```
  然后 onClick / onKeyDown 都调 `selectTab(tab)`。onClick 仍单独 `e.stopPropagation()`。

### 测试建议
- Vitest：`userEvent.tab()` 至 tab，按 Enter，断言 `onSelectTab` 调用了。
- 鼠标点击关闭按钮不会触发 `onSelectTab`（之前的回归基线）。

---

## Bug #8 — LoginModal 生产构建打 username 到 console

### 文件 / 位置
- `src/components/LoginModal.tsx:56-61` (validation warn)
- `src/components/LoginModal.tsx:75-79` (login failed warn)
- `src/components/LoginModal.tsx:85-89` (catch error log)

### 根因
直接 `console.warn/error`，无生产环境守卫，且 payload 里带 username。

### 修复策略
- **直接删除 3 处 console.\***，因为：
  - 错误已通过 `setError` 与 `notification.showError` 反馈给用户。
  - 业务上没有需要 dev 看 stack trace 的场景（这里只是表单校验或 backend 返回 4xx）。
  - 项目已用 Sentry 时这些日志会被自动收集到 breadcrumb，含 username 是合规风险。

### 改动伪代码
```ts
// 删除：
console.warn('[LoginModal] Login validation failed:', { ... });
console.warn('[LoginModal] Login failed:', { username: ..., ... });
console.error('[LoginModal] Login error occurred:', { username: ..., ... });
```

### 风险 / 注意
- 删除前确认无其它脚本依赖这些日志格式（grep `[LoginModal]` 项目内仅这 3 处）。
- 若评审反馈"必须保留 dev 日志"，备选方案：
  ```ts
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[LoginModal] Login validation failed', {
      hasUsername: !!formData.username,
      hasPassword: !!formData.password,
    });
  }
  ```
  注意 **绝不要带上 username 字段本身**。

### 测试建议
- Vitest：`vi.spyOn(console, 'warn')` / `'error'`，触发 3 个分支后断言 `not.toHaveBeenCalled()`。

---

## Bug #9 — AuthContext 网络错误打全栈 error

### 文件 / 位置
- `src/contexts/AuthContext.tsx:144-147`

### 根因
任何 catch 全部走 `console.error(stack)`，包括 backend 不可达的 `ApiError(0, 'NETWORK_ERROR', ...)`。

### 修复策略
1. import `ApiError` 与 `TimeoutError` 自 `@/lib/api/http-client`（已 import `resetSessionExpiryFlag`，新增即可）。
2. 区分错误类型：
   - `ApiError` 且 `code === 'NETWORK_ERROR'`（status === 0）→ `console.warn('[AuthContext] Session validation skipped (network unreachable)')` —— 单行，不打 stack。
   - `TimeoutError` → 同 warn 单行。
   - 其它 → 保留 `console.error`。
3. 加节流：模块级 `let lastNetworkWarnAt = 0`；同类网络错误 30s 内只打一次。

### 改动伪代码
```ts
import { ApiError, TimeoutError, resetSessionExpiryFlag } from '@/lib/api/http-client';

// 模块顶层（AuthContext.tsx 文件顶部，AuthProvider 之外）：
let lastNetworkWarnAt = 0;
const NETWORK_WARN_THROTTLE_MS = 30_000;

function isNetworkUnreachable(err: unknown): boolean {
  return (err instanceof ApiError && err.code === 'NETWORK_ERROR')
      || err instanceof TimeoutError;
}

// validateSession catch (替换 line 144-147):
} catch (error) {
  if (isNetworkUnreachable(error)) {
    const now = Date.now();
    if (now - lastNetworkWarnAt > NETWORK_WARN_THROTTLE_MS) {
      lastNetworkWarnAt = now;
      const code = error instanceof ApiError ? error.code : 'TIMEOUT';
      console.warn('[AuthContext] Session validation skipped:', code);
    }
    return false;
  }
  console.error('[AuthContext] Session validation error:', error);
  return false;
}
```

### 风险 / 注意
- 节流变量是模块级，所有 AuthProvider 实例共享——刚好实现"全应用一次性提示"。
- 不要把 throttle 状态放进 `useRef`，否则每个 provider 重 mount 会重置。
- 单元测试时 `lastNetworkWarnAt` 跨用例污染——在 test 顶层用 `vi.resetModules()` 或显式重置。

### 测试建议
- Vitest：模拟 `authValidateSession` 抛出 `new ApiError(0, 'NETWORK_ERROR', 'fetch failed')`，断言 `console.warn` 调用 1 次而 `console.error` 未调用；连续抛 5 次仍只 warn 1 次。
- 抛非网络错误（如普通 Error）应走 `console.error`。

---

## 整体回归测试矩阵

| Suite | 覆盖 Bug | 工具 |
|---|---|---|
| `__tests__/components/LoginModal.test.tsx` (新增) | #1, #2, #5, #8 | Vitest + RTL |
| `__tests__/components/LandingPage.test.tsx` (新增 / 扩展) | #3 | Vitest + RTL |
| `__tests__/components/VerticalTaskbar.test.tsx` (新增) | #4, #6, #7 | Vitest + RTL |
| `__tests__/contexts/AuthContext.test.tsx` (新增 / 扩展) | #9 | Vitest |
| `npm run type-check` | 类型回归（i18n key 接口） | tsc |
| Playwright a11y 快照（可选） | 全部 | playwright-cli |

**手工验收清单**：
- [ ] Tab 进入 LoginModal username → password → submit → close → 回到 username（trap 闭环）。
- [ ] Esc 关 modal 后焦点回到触发按钮。
- [ ] 切换 locale 至 en，未登录态点 VerticalTaskbar tab，toast 显示英文。
- [ ] 屏幕阅读器（NVDA / 浏览器朗读）能听到错误"Username and password are required"。
- [ ] DevTools Network → backend 域名 block，控制台只看到一条 warn，不再刷栈。

---

## 提交建议

- **单 PR 提交**，commit message：
  ```
  [fix] iter9 a11y/i18n/log hygiene — LoginModal dialog semantics + focus trap, Landing/Taskbar keyboard reachability, scoped network warnings
  ```
- 在 PR 描述中按 Bug# 列出每条改动 + 引用 `bug-report.md` 的对应章节。

---

## 估时

| Bug | 改动行数（≈） | 测试行数（≈） | 总工时 |
|---|---|---|---|
| #1 | 8 | 30 | 30 min |
| #2 | 50 | 60 | 90 min |
| #3 | 15 | 25 | 30 min |
| #4 | 6 + 4 (i18n) | 15 | 20 min |
| #5 | 12 | 20 | 25 min |
| #6 | 8 + 4 (i18n) | 15 | 25 min |
| #7 | 25 | 30 | 45 min |
| #8 | -15 (delete) | 10 | 15 min |
| #9 | 25 | 30 | 45 min |
| **合计** | ~150 | ~235 | **~5 h** |
