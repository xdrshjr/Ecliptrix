# Iter9 Bug Fix Plan — REVIEWED & EXECUTABLE

> 配套 Bug 报告：`docs/diagnoses/iter9-bug-report-20260509/bug-report.md`
> 原始方案：`docs/diagnoses/iter9-bug-report-20260509/fix-plan.md`
> 评审时间：2026-05-09
> 适用 Subtask：#4（修复实施）

本文档是对原 `fix-plan.md` 的全面评审，采用**整体可执行版本**形式：所有原方案中的技术决策、伪代码、风险已逐条核对源码，问题修正后内联到本文。下一步执行者**只读本文件即可**。

---

## 评审过程概览

我对 `fix-plan.md` 的每条修复方案逐一验证了：
- ① 文件 / 行号是否准确（对照源文件实读）
- ② 命名空间 / API 是否真实存在（grep 关键词）
- ③ 测试基础设施是否匹配（`vitest.config.ts` + 既有测试样本）
- ④ 与项目既有约定（i18n 接口、组件模式、错误处理）是否一致

**评审结论**：原方案技术方向正确，9 个 Bug 全部可落地；存在以下需要修正的细节：

| # | 原方案问题 | 修正 |
|---|---|---|
| R1 | 测试文件路径 `__tests__/components/...`（项目根级 __tests__ 目录） | 修正为 `src/components/__tests__/...`（colocated 模式，与既有 99 个测试文件一致） |
| R2 | 默认推荐 RTL 渲染断言 | 增补：项目中**多数组件测试使用 source-level regex（`@vitest-environment node` + `readFileSync`）**，理由是早期 Next.js JSX preserve 配置无法挂载。新增 `.test.tsx` 时**优先采用 source-level regex 模式**保证一致性；如必须 RTL，参考 `MaterialCacheBadge.test.tsx` / `UserInfoPanel.test.tsx` |
| R3 | Bug #1 backdrop 加 `tabIndex={-1}` | 删除该建议；非交互 `<div>` 不需要 `tabIndex`，仅 `aria-hidden="true"` 即可 |
| R4 | Bug #2 keydown handler 与既有 escape useEffect 重复 | 明确：**替换** `LoginModal.tsx:35-44` 的 escape useEffect，不要保留两个监听器 |
| R5 | Bug #6 type-check 风险未提示 | 同 Bug #4：`CommonStrings` 接口（i18n.ts:2）需同步加 `closeTab: string;` |
| R6 | Bug #7 `selectTab` 重构最终结构未给完整代码 | 给出完整改动 diff，包含 onClick 与 onKeyDown 的最终形态 |
| R7 | Bug #9 仅修复 `validateSession` catch；漏审 `loadAuthState` catch (line 186) | 评估：line 186 catch 主要是 JSON.parse / localStorage 错误，**保持原 console.error**，不属于网络抖动。明确写入"out of scope"避免执行者误改 |
| R8 | 估时表合计偏低（5h），未包含 type-check + 启动验证 | 调整为 ~5.5h，新增 0.5h "lint + type-check + dev server smoke"。 |

代码侧的核心结论已逐条核验：
- ✅ `LoginModal.tsx:99-117/56-89/165-169` 行号准确（精确到字符）
- ✅ `LandingPage.tsx:134-156` 即原方案 `126-158`（同一段 map block）
- ✅ `VerticalTaskbar.tsx:160-183` 行号准确，含 close button 172-179
- ✅ `Taskbar.tsx:133` & `VerticalTaskbar.tsx:136` 硬编码字面量已确认
- ✅ `AuthContext.tsx:144-147` 准确；`resetSessionExpiryFlag` 已 import
- ✅ `ApiError` / `TimeoutError` 已从 `@/lib/api/http-client` 导出（line 83 / 102）；`code === 'NETWORK_ERROR'` 是 http-client 实际在 fetch 失败时使用的字符串（line 395 / 476 / 585）
- ✅ `Translations.common`（line 12-13）含 `close` 与 `closePanel`；en `close: 'Close'`、zh-CN `close: '关闭'` 已就位
- ✅ `Translations.auth`（line 65）含 `requiredFields`；en `'Username and password are required'`
- ✅ `useId` 在项目其它组件已使用，React 19 原生支持
- ✅ Vitest 4 + RTL 16 已 in devDependencies；`vitest.config.ts` 默认 environment=jsdom

---

## 优先级与依赖（不变）

| 阶段 | Bugs | 依赖 |
|---|---|---|
| Phase A — i18n 字典扩展 | #4 (`auth.loginRequiredForTasks`)、#6 (`common.closeTab`) | 无 |
| Phase B — Component 修复 | #1, #2, #3, #5, #6, #7 | A |
| Phase C — 日志卫生 | #8, #9 | 无 |

A 必须先于 B；B 与 C 可并行。**全部 9 个 Bug 在同一个 PR 提交**。

---

## 通用约定（不变）

- 新增 i18n key 必须**同时**写入 `Translations` 接口、`en` 字典、`zh-CN` 字典；写入位置紧邻同命名空间已有 key。
- 涉及 ARIA 修改**绝不修改 className**——所有视觉样式保留。
- 日志改动只删除 / 包裹，不改业务行为。
- 所有新增 `<button>` 默认加 `type="button"`，避免在 form 内被识别为隐式 submit。

---

## Bug #1 — LoginModal 缺失 dialog ARIA 语义

### 文件 / 位置
- `src/components/LoginModal.tsx`
- 外层 wrapper（line 100）：`<div className="fixed inset-0 z-[9999] flex items-center justify-center">`
- backdrop（line 102-105）：`<div className="absolute inset-0 bg-black/60" onClick={onClose} />`
- modal 容器（line 108）：`<div className="relative w-full max-w-4xl mx-4 bg-card rounded-md ...">`
- 关闭按钮（line 110-117）：`<button onClick={onClose} ...><svg .../></button>`
- 标题（line 124-126）：`<h2 className="text-2xl font-semibold ...">{t.auth.welcomeBack}</h2>`

### 修复
1. `import React, { useState, useEffect, useId, useRef } from 'react';`（同时为 Bug #2/#5 复用）。
2. 在组件顶部声明：`const titleId = useId();`
3. **modal 容器（line 108）** 加 `role="dialog"` `aria-modal="true"` `aria-labelledby={titleId}`。
4. 标题 `<h2>`（line 124）加 `id={titleId}`。
5. 关闭按钮（line 110）加 `type="button"` `aria-label={t.common.close}`；其内 svg 加 `aria-hidden="true"`。
6. backdrop（line 102）加 `aria-hidden="true"`（**不要加 tabIndex**——非交互元素无需）。

### 改动 diff（最终形态）
```tsx
// Imports
import React, { useState, useEffect, useId, useRef } from 'react';

// Inside component
const titleId = useId();
const errorId = useId();              // for Bug #5
const dialogRef = useRef<HTMLDivElement>(null);          // for Bug #2
const usernameInputRef = useRef<HTMLInputElement>(null); // for Bug #2
const previouslyFocusedRef = useRef<HTMLElement | null>(null); // for Bug #2

// JSX
return (
  <div className="fixed inset-0 z-[9999] flex items-center justify-center">
    <div
      className="absolute inset-0 bg-black/60"
      aria-hidden="true"
      onClick={onClose}
    />
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="relative w-full max-w-4xl mx-4 bg-card rounded-md border border-border shadow-xl overflow-hidden"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t.common.close}
        className="absolute top-4 right-4 z-10 w-8 h-8 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors"
      >
        <svg aria-hidden="true" className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      ...
      <h2 id={titleId} className="text-2xl font-semibold text-foreground mb-2">
        {t.auth.welcomeBack}
      </h2>
```

### 风险 / 注意
- `useId()` 已在项目其它文件使用，无新增依赖。
- 不要在外层 z-9999 wrapper 上加 `role="dialog"`，避免嵌套对话框语义。
- 共用 `dialogRef` 给 Bug #2 的 focus trap 使用——避免重复定义。

---

## Bug #2 — LoginModal 焦点不进入对话框且无 focus trap

### 文件 / 位置
- `src/components/LoginModal.tsx:13-44`（hooks 段）
- 影响 username `<input>` (line 137-146)、close `<button>` (line 110)、submit `<button>` (line 171-196)。

### 修复
1. 复用 Bug #1 引入的 `dialogRef`、`usernameInputRef`、`previouslyFocusedRef`、`useId`。
2. 在 `<input id="username" ... ref={usernameInputRef}>`（line 137）添加 ref。
3. 新增 useEffect（focus on open + restore on close）。
4. **替换** 既有 escape useEffect（line 35-44）为合并的 keydown 监听器，处理 `Escape` 与 `Tab`/`Shift+Tab`。
5. 新增 helper `getFocusable`（**模块级私有函数**，不导出，避免抽 Hook 文件）。

### 改动 diff（最终形态）
```ts
// 模块顶部（component 外，import 之下）
function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => el.offsetParent !== null);
}

// component 内 — 新增 useEffect（focus on open + restore on close）
useEffect(() => {
  if (!isOpen) return;
  previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
  const id = window.requestAnimationFrame(() => {
    usernameInputRef.current?.focus({ preventScroll: true });
  });
  return () => {
    window.cancelAnimationFrame(id);
    previouslyFocusedRef.current?.focus?.();
  };
}, [isOpen]);

// component 内 — 替换 line 35-44 既有 escape useEffect
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
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (active && !dialogRef.current.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, [isOpen, onClose]);

// JSX
<input
  id="username"
  name="username"
  type="text"
  autoComplete="username"
  ref={usernameInputRef}
  ...
/>
```

### 风险 / 注意
- `requestAnimationFrame` 规避 ref 尚未挂载的边缘情况。
- 必须**删除** `LoginModal.tsx:35-44` 的旧 escape useEffect，避免双重监听 → 重复 `onClose`。
- `previouslyFocusedRef.current?.focus?.()` 用可选链兜底节点已 unmount 的场景。
- 不抽 `useFocusTrap` Hook 文件——本轮仅 LoginModal 用。

---

## Bug #3 — Landing Page Feature 卡片不可键盘操作

### 文件 / 位置
- `src/components/HomePage/LandingPage.tsx:134-156`（map 内卡片渲染；原 fix-plan 标 126-158 即本段含上下文）

### 修复
- 保留 `<div>`（避免视觉回归），始终添加 `role="button"` `tabIndex` `aria-disabled` `aria-label` `onKeyDown`。
- `aria-label` 使用 `${feature.title} — ${feature.description}` 改善 AT。
- 抽出 `handleActivate` 内联回调避免 onClick 与 onKeyDown 重复逻辑。

### 改动 diff（最终形态）
```tsx
{features.map((feature, index) => {
  const isComingSoon = feature.comingSoon === true;
  const isLoadingDisabled = isAuthLoading && !isComingSoon;
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
      {/* 卡片内部保持不变 */}
    </div>
  );
})}
```

### 风险 / 注意
- 原 disabled 卡片仅 `role="button"` 默认 tabIndex（不可聚焦），新代码显式 `tabIndex={-1}`，行为等价。
- aria-disabled 卡片仍可获得焦点 (tabIndex=0 当 isLoadingDisabled)，符合 ARIA 规范。
- 不会改变样式 / 布局。

---

## Bug #4 — 任务栏未登录提示硬编码中文

### 文件 / 位置
- `src/components/Taskbar.tsx:133` `showWarning('请先登录后再使用任务功能', 4000)`
- `src/components/VerticalTaskbar.tsx:136` 同字面量
- `src/lib/i18n.ts`（接口 line 46-69 / en line 2840 区域 / zh-CN line 5675 区域）

### 修复
1. 在 `Translations.auth` 接口（line 46-69）紧跟 `requiredFields: string;`（line 65）后**新增** `loginRequiredForTasks: string;`。
2. 在 en 字典（line 2856 后）添加 `loginRequiredForTasks: 'Please sign in to use task features',`。
3. 在 zh-CN 字典（line ~5675 后）添加 `loginRequiredForTasks: '请先登录后再使用任务功能',`。
4. `Taskbar.tsx:133` 与 `VerticalTaskbar.tsx:136` 改成 `showWarning(t.auth.loginRequiredForTasks, 4000);`。

### 风险 / 注意
- 必须同步 3 处（接口 + en + zh-CN），缺一即触发 tsc 报错。
- 不要把 key 放进 `common`——属于 auth 域语义。

---

## Bug #5 — LoginModal 错误段落非 alert region

### 文件 / 位置
- `src/components/LoginModal.tsx:165-169`
- 涉及 username (line 137-146) / password (line 153-162) input

### 修复
1. 复用 Bug #1 引入的 `errorId`（`useId()`）。
2. 错误容器（line 165-169）改为 `<div role="alert" aria-live="assertive" aria-atomic="true" id={errorId}>`。
3. 两个 input 加 `aria-invalid={!!error || undefined}` 与 `aria-describedby={error ? errorId : undefined}`。

### 改动 diff（最终形态）
```tsx
<input
  id="username"
  name="username"
  type="text"
  autoComplete="username"
  ref={usernameInputRef}
  aria-invalid={!!error || undefined}
  aria-describedby={error ? errorId : undefined}
  ...
/>
<input
  id="password"
  name="password"
  type="password"
  autoComplete="current-password"
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
- `role="alert"` 隐式 `aria-live="assertive"`，加显式 attr 是稳定性保险。
- `aria-live` 只放在条件渲染容器上，AT 才会朗读"出现的内容"。

---

## Bug #6 — VerticalTaskbar 关闭按钮无可访问名

### 文件 / 位置
- `src/components/VerticalTaskbar.tsx:172-179`
- `src/lib/i18n.ts` `Translations.common` 接口（line 13）/ en (line 2804) / zh-CN (line 5623)，`closePanel` 已存在

### 修复
1. 在 `Translations.common` 接口紧跟 `closePanel: string;` 后新增 `closeTab: string;`。
2. 在 en 字典（line 2804 后）：`closeTab: 'Close tab {title}',`。
3. 在 zh-CN 字典（line 5623 后）：`closeTab: '关闭标签 {title}',`。
4. `VerticalTaskbar.tsx:172-179` 修改：

```tsx
<button
  type="button"
  onClick={(e) => handleTabClose(e, tab.id)}
  aria-label={t.common.closeTab.replace('{title}', getTaskLabel(tab.type))}
  title={t.common.closeTab.replace('{title}', getTaskLabel(tab.type))}
  className="tab-close"
>
  <svg aria-hidden="true" className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
</button>
```

### 风险 / 注意
- 接口 `Translations.common`（i18n.ts:2-19）必须同步加 `closeTab: string;`，否则 tsc 报错。
- 模板用 `{title}` 占位 + `String.replace` 与项目其它 i18n 模板风格一致。

---

## Bug #7 — VerticalTaskbar 标签 div+onClick 不支持键盘

### 文件 / 位置
- `src/components/VerticalTaskbar.tsx:131-145`（`handleTabClick` 函数）
- `src/components/VerticalTaskbar.tsx:160-183`（map 渲染段）

### 修复
1. 重构：把 `handleTabClick` 的纯业务逻辑（鉴权 / 展开 / selectTab）抽成 `selectTab(tab: Tab)`，**不接收 event**。
2. 外层 `<div>`：加 `role="button"`、`tabIndex={0}`、`aria-current`、`aria-label`、`onKeyDown`。
3. onClick 与 onKeyDown 共用 `selectTab(tab)`；onClick 仍调 `e.stopPropagation()` 阻止冒泡到 taskbar 根（防止意外切换 expand）。
4. onKeyDown 用 `e.target !== e.currentTarget` 守卫——焦点在内部关闭按钮时不响应 Enter/Space（关闭按钮自己处理）。

### 改动 diff（最终形态）
```tsx
// VerticalTaskbar.tsx:131-145 替换为
const selectTab = (tab: Tab) => {
  if (!isAuthenticated) {
    showWarning(t.auth.loginRequiredForTasks, 4000);
    return;
  }
  if (!isExpanded) {
    setIsExpanded(true);
  }
  onSelectTab(tab.id);
};

// VerticalTaskbar.tsx:160-183 替换为
{tabs.map((tab) => (
  <div
    key={tab.id}
    role="button"
    tabIndex={0}
    aria-current={tab.isActive ? 'page' : undefined}
    aria-label={getTaskLabel(tab.type)}
    className={`taskbar-tab ${tab.isActive ? 'active' : ''}`}
    onClick={(e) => {
      e.stopPropagation();
      selectTab(tab);
    }}
    onKeyDown={(e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectTab(tab);
      }
    }}
    title={!isExpanded ? getTaskLabel(tab.type) : undefined}
  >
    <div className="tab-icon">
      {getTaskIcon(tab.type)}
    </div>
    <div className={`tab-content ${isExpanded ? 'visible' : 'hidden'}`}>
      <span className="tab-title">{getTaskLabel(tab.type)}</span>
      <button
        type="button"
        onClick={(e) => handleTabClose(e, tab.id)}
        aria-label={t.common.closeTab.replace('{title}', getTaskLabel(tab.type))}
        title={t.common.closeTab.replace('{title}', getTaskLabel(tab.type))}
        className="tab-close"
      >
        <svg aria-hidden="true" className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
))}
```

### 风险 / 注意
- `e.target !== e.currentTarget` 守卫：焦点在 close 按钮时按 Enter，不会重新触发 selectTab（否则被关闭的 tab 会被立刻 select）。
- 鼠标点击关闭按钮已通过 `handleTabClose` 内 `e.stopPropagation()` 阻止冒泡到 div onClick → 行为不变。
- 不再需要原 `handleTabClick` 函数（被 selectTab 替代），可一并删除。
- `Tab` 类型导入已存在（line 4），无需新增 import。

---

## Bug #8 — LoginModal 生产构建打 username 到 console

### 文件 / 位置
- `src/components/LoginModal.tsx:56-61` (validation warn)
- `src/components/LoginModal.tsx:75-79` (login failed warn — 含明文 username)
- `src/components/LoginModal.tsx:85-89` (catch error log — 含明文 username)

### 修复
**直接删除三处 `console.warn/error` 调用**。理由：
- 错误已经通过 `setError` + `notification.showError` 反馈给用户。
- 业务上无需 dev 看 stack（仅前端表单校验或 backend 4xx）。
- 隐私：明文 username 写到 console / Sentry breadcrumb。

### 改动 diff
- 删除 `LoginModal.tsx:56-61`（保留 `setError(t.auth.requiredFields); return;`）。
- 删除 `LoginModal.tsx:75-79`（保留 `const errorMessage = result.error || t.auth.loginFailed; setError(errorMessage); notification.showError(errorMessage, 4000);`）。
- 删除 `LoginModal.tsx:85-89`（保留 `setError(t.auth.loginFailed); notification.showError(t.auth.loginFailed, 4000);`）。

### 风险 / 注意
- grep `[LoginModal]` 已确认项目内仅这 3 处依赖该日志格式，无外部脚本会受影响。
- 若评审反对完全删除，备选：用 `if (process.env.NODE_ENV !== 'production')` 包裹，且**绝不**带 username 字段。

---

## Bug #9 — AuthContext 网络错误打全栈 error

### 文件 / 位置
- `src/contexts/AuthContext.tsx:144-147`（`validateSession` 的 catch）

### Out-of-scope 提示
- `loadAuthState`（line 186）的 `console.error('[AuthContext] Error loading auth state:', error)` **不动**。该 catch 主要捕获 `JSON.parse` / localStorage 异常，与本次"网络抖动噪声"主题无关。

### 修复
1. import `ApiError, TimeoutError` 自 `@/lib/api/http-client`（与既有 `resetSessionExpiryFlag` 同行）。
2. 模块顶层（component 外）声明节流变量。
3. 替换 `validateSession` 的 catch 块。

### 改动 diff（最终形态）
```ts
// import 行（line 12 修改）
import {
  ApiError,
  TimeoutError,
  resetSessionExpiryFlag,
} from '@/lib/api/http-client';

// 模块顶部（在 const AuthContext = createContext... 之前；line 13 区域）
let lastNetworkWarnAt = 0;
const NETWORK_WARN_THROTTLE_MS = 30_000;

function isNetworkUnreachable(err: unknown): boolean {
  return (err instanceof ApiError && err.code === 'NETWORK_ERROR')
      || err instanceof TimeoutError;
}

// validateSession catch — 替换 line 144-147
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
- 节流变量是模块级 → 全应用单实例，正好实现"网络断开期间只 warn 一次"。
- **不要**把节流放进 `useRef`——provider remount 会重置。
- 单元测试要 `vi.resetModules()` 才能跨用例重置 `lastNetworkWarnAt`。
- ApiError 实际抛出的 fetch failure code 已确认是 `'NETWORK_ERROR'`（http-client.ts:395 / 476 / 585）。

---

## 整体回归测试矩阵

> **测试模式抉择**：项目存在两种范式——
> 1. **source-level regex**（`@vitest-environment node` + `readFileSync` + 正则断言）：用于多数组件测试（LandingPage.brainstorm / Taskbar.brainstorm / ChatTypeSelectionModal）。优点：稳定、无 React 渲染开销；缺点：无法测交互。
> 2. **RTL 渲染**（jsdom 环境 + `@testing-library/react`）：用于少数组件测试（MaterialCacheBadge / UserInfoPanel / LocaleContext）。优点：能测交互行为；缺点：偶发 JSX preserve 报错。
>
> **本轮选用策略**：
> - **静态属性断言**（如 `role="dialog"` / `aria-label` 是否出现在源文件、i18n key 是否存在）→ source-level regex（更稳）。
> - **交互行为**（如 focus trap、Tab 循环、Enter 触发 onClick）→ RTL render，用既有的 `MaterialCacheBadge.test.tsx` 作模板。

| 测试文件（colocated） | 覆盖 Bug | 模式 |
|---|---|---|
| `src/components/__tests__/LoginModal.a11y.test.tsx`（新增） | #1, #5, #8 | source-level regex |
| `src/components/__tests__/LoginModal.focus.test.tsx`（新增） | #2 | RTL render |
| `src/components/HomePage/__tests__/LandingPage.a11y.test.tsx`（新增 / 与既有 brainstorm 文件分开） | #3 | source-level regex |
| `src/components/__tests__/VerticalTaskbar.a11y.test.tsx`（新增） | #4, #6, #7 | source-level regex（覆盖属性 + i18n key 引用）；交互部分仍可补 RTL |
| `src/contexts/__tests__/AuthContext.network.test.ts`（新增） | #9 | 单元测试（mock authValidateSession） |
| `npm run type-check` | i18n 接口（#4 + #6） | tsc |
| `npm run lint` | ESLint 回归 | next lint |
| 手工：`npm run dev` + 浏览器验证 | 全部 | dev server smoke |

### 关键测试断言（参考）

**LoginModal.a11y.test.tsx**（source regex）：
```ts
const src = readFileSync(resolve(__dirname, '..', 'LoginModal.tsx'), 'utf-8');
expect(src).toMatch(/role="dialog"/);
expect(src).toMatch(/aria-modal="true"/);
expect(src).toMatch(/aria-labelledby=\{titleId\}/);
expect(src).toMatch(/aria-label=\{t\.common\.close\}/);
expect(src).toMatch(/role="alert"/);
expect(src).toMatch(/aria-invalid=\{!!error \|\| undefined\}/);
expect(src).not.toMatch(/console\.(warn|error)\([^)]*username/);
```

**LoginModal.focus.test.tsx**（RTL）：
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// 渲染 LoginModal isOpen 后，document.activeElement 应为 username input；
// 模拟 Shift+Tab 至首元素再 Tab 应回到末元素；
// 关闭后 previouslyFocused 应重新获焦。
```

**AuthContext.network.test.ts**：
```ts
import { ApiError } from '@/lib/api/http-client';
// mock authValidateSession 抛 new ApiError(0, 'NETWORK_ERROR', 'fetch failed');
// 第 1 次 catch → console.warn 调 1 次 + 不调 console.error；
// 短时间内连抛 5 次 → 仍只 warn 1 次（throttle）；
// 抛非网络 Error → console.error 被调用。
```

---

## 手工验收清单

- [ ] 未登录态点 "Login / Register"，焦点立即落在 username input。
- [ ] modal 内 Tab 循环不出 modal；Esc 关闭后焦点回到原触发按钮。
- [ ] modal 留空提交，红色错误出现，屏幕阅读器（NVDA / Edge Read aloud）朗读 "Username and password are required"。
- [ ] LandingPage 仅用键盘 Tab，可依次聚焦 Video Editing / WorkFlow / AI Chat 卡片，按 Enter / Space 进入对应页面。
- [ ] 切换 locale 至 English，未登录态点 VerticalTaskbar tab，toast 显示 "Please sign in to use task features"。
- [ ] VerticalTaskbar 仅用键盘 Tab 可聚焦每个标签，Enter / Space 切换；关闭按钮 AT 朗读 "Close tab AI Chat"。
- [ ] DevTools 关闭 backend 网络（offline）→ 控制台只看到一条 `[AuthContext] Session validation skipped: NETWORK_ERROR`，30 秒内不再刷栈。
- [ ] 提交空表单 → 控制台**不再**出现 `[LoginModal] Login validation failed`。

---

## 提交建议

- **单 PR 提交**，commit message：
  ```
  fix: harden a11y, i18n, and log hygiene for LoginModal/Landing/Taskbar/AuthContext (iter9)

  - LoginModal: dialog ARIA semantics + focus trap + alert region for errors;
    drop console logs leaking username
  - LandingPage: keyboard-reachable feature cards (role/tabindex/onKeyDown)
  - VerticalTaskbar: keyboard-reachable tab buttons + close button accessible name
  - i18n: add auth.loginRequiredForTasks and common.closeTab (en + zh-CN)
  - AuthContext: discriminate network/timeout errors with throttled warn
  ```
- PR 描述按 Bug# 列出每条改动 + 引用 `bug-report.md` 的对应章节。

---

## 估时（修订）

| Bug | 改动行数（≈） | 测试行数（≈） | 总工时 |
|---|---|---|---|
| #1 | 10 | 25 (source regex) | 25 min |
| #2 | 50 | 60 (RTL) | 90 min |
| #3 | 18 | 25 (source regex) | 30 min |
| #4 | 8 + 4 (i18n) | 15 | 20 min |
| #5 | 14 | 15 (source regex) | 20 min |
| #6 | 10 + 4 (i18n) | 15 (source regex) | 25 min |
| #7 | 30 | 30 (source regex) | 45 min |
| #8 | -15 (delete) | 10 (source regex) | 15 min |
| #9 | 28 | 35 | 50 min |
| Lint + type-check + dev smoke | — | — | 30 min |
| **合计** | ~160 | ~230 | **~5.5 h** |

---

## 执行顺序建议

1. **先扩 i18n 字典**（Bug #4 / #6 的 3 处文件改动）→ `npm run type-check` 通过。
2. **改 LoginModal**（Bug #1 / #2 / #5 / #8 一次性完成，因为共享 `useId` / refs / hooks）。
3. **改 LandingPage**（Bug #3，独立）。
4. **改 VerticalTaskbar**（Bug #6 / #7，因为 #6 需要 #7 重构后的位置）。
5. **改 Taskbar.tsx:133**（Bug #4，纯字面量替换）。
6. **改 AuthContext**（Bug #9，独立）。
7. 写 5 个新增测试文件 → `npm test` 全绿。
8. `npm run lint && npm run type-check`。
9. `npm run dev` 浏览器验收清单。
10. Commit + PR。

---

**审查结论**：原 `fix-plan.md` 整体方向**正确且可落地**。本评审版仅修正了测试路径、删除了一个无意义建议（backdrop tabIndex）、明确了 escape useEffect 的"替换"语义、补全了 Bug #7 的最终代码、明确了 Bug #9 的范围边界、加了 lint/type-check/dev smoke 的工时。下一步执行者按本文 §"执行顺序建议"逐条落地即可。
