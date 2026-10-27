# Web Bug 修复方案 — 第 3 轮（2026-05-09 / iter3）

## 概要

本文件针对 [`bug-report.md`](./bug-report.md) 中记录的 6 个 Bug 给出可直接落地的修复方案。每个 Bug 含：

1. 当前 HEAD 验证后的代码定位（文件 + 行号 + 函数）
2. 根因解析（含与 iter1/iter2 修复风格的对齐）
3. 具体代码片段（diff / 伪代码）
4. 风险与边界
5. 测试建议（Vitest / 手动）

| # | 标题 | 严重度 | 主要文件 | 推荐 PR 分组 |
|---|------|-------|---------|-------------|
| 1 | 项目编辑器无路由 — reload 即丢失 | High / P1 | `useTasks.ts`, `page.tsx` | PR-A 应用初始化 |
| 2 | `<html lang>` 挂载时不同步 | High / P1 | `LocaleContext.tsx` | PR-A 应用初始化 |
| 3 | ModelSettingsPanel API Key 不在 form 中 | Medium / P2 | `ModelSettingsPanel.tsx` | PR-B a11y 表单语义 |
| 4 | ChatTypeSelectionModal 无法区分 + 0 节点可选 | Medium / P2 | `ChatTypeSelectionModal.tsx` | PR-C UX 收紧 |
| 5 | Brainstorm 卡进入"功能开发中" | Medium / P2 | `LandingPage.tsx`, `Container.tsx` | PR-C UX 收紧 |
| 6 | 空时间轴导出按钮可点 | Low / P3 | `VideoPlayerPanel.tsx`, `i18n.ts` | PR-D 防御性 disable |

> **执行顺序**：i18n 增量 → PR-A → PR-B → PR-C → PR-D。每个 PR 自带 vitest，最后统一 `npm run type-check && npm run test`，再做手动回归。

---

## 共同前置：i18n schema 增量

`src/lib/i18n.ts` 为单文件 i18n（interface + EN + ZH 三段）。本轮新增 4 组 key，**必须在三处全部添加**，否则 type-check 失败。

| 路径 | 用途 | EN | ZH |
|------|------|----|----|
| `aiChat.chatTypeModal.emptyWorkflowHint` | Bug#4 — 空工作流卡 disabled tooltip | `Add nodes to this workflow before using it` | `请先在工作流编辑器中为该工作流添加节点` |
| `aiChat.chatTypeModal.idLabel` | Bug#4 — 工作流 ID 缩写前缀 | `ID` | `编号` |
| `aiChat.chatTypeModal.updatedAt` | Bug#4 — 时间标签 | `Updated {time}` | `更新于 {time}` |
| `aiChat.chatTypeModal.workflowsAvailableWithEmpty` | Bug#4 — 含空工作流计数 | `{count} workflow(s) available · {empty} empty` | `{count} 个工作流可用 · {empty} 个为空` |
| `videoPlayerPanel.export.emptyTimeline` | Bug#6 — 导出按钮 disabled tooltip | `Add video, image, or audio materials to the timeline before exporting` | `请先添加视频/图片/音频素材到时间轴后再导出` |
| `landing.comingSoonBadge` | Bug#5 — Coming Soon 角标 | `Coming Soon` | `即将推出` |
| `landing.comingSoonHint` | Bug#5 — 卡片 tooltip | `This feature is in development. Stay tuned!` | `该功能正在开发中，敬请期待。` |
| `landing.brainstormingDescPreview` | Bug#5 — 副本调整为"预告" | `Coming soon — a creative ideation workshop for sparking new project concepts` | `即将推出 · 创意构思灵感工坊，为项目激发全新概念` |

落地位置：

- interface（行 ≈ 1959 ~ 1992 的 `chatTypeModal` 块、行 ≈ 1101 的 `videoPlayerPanel.export`、行 ≈ 同区的 `landing` 块）
- EN（行 ≈ 4651 ~ 4684、行 ≈ 3778 ~ 3782、行 ≈ landing 段）
- ZH（行 ≈ 7348 ~ 7381、行 ≈ 6475 ~ 6479、行 ≈ landing 段）

---

## Bug #1 — 项目编辑器无路由：reload / 分享 URL 即丢失

### 代码定位

| 文件 | 函数 / 行号 | 备注 |
|------|------------|------|
| `src/hooks/useTasks.ts` | `useTasks` 行 13 — `useState(() => createInitialState())` | 状态完全在内存中 |
| `src/hooks/useTasks.ts` | `createTask`/`selectTab`/`closeTab`/`closeAllTabs`/`updateTask` | 所有 mutator 都没有持久化副作用 |
| `src/app/page.tsx` | 行 15-148（整体）| SPA 入口，无 `usePathname`/`useSearchParams`，title 也是静态 |
| `src/app/` 目录 | — | 仅 `api/`、`login/`、`page.tsx`、`layout.tsx`，**无 `projects/[id]`** |

### 根因

整套应用是一个无路由 SPA：

- `useTasks` 用 `useState` 持有 `tasks/tabs/activeTabId`，**不写 URL 也不写 localStorage**
- `src/app/page.tsx` 只渲染 `<Container>`，无 `searchParams` 同步
- 因此：F5 / 直链 / 浏览器返回键全部丢失上下文

iter1/iter2 没有触及该模块；这是 SPA 模型本身的缺陷。

### 修复策略

采用**最小改动方案**：在 `useTasks` 内部完成"localStorage 镜像 + URL replaceState"，**不引入 Next.js 路由段**（那需要拆解 `Container.tsx` 的全部子组件，规模过大且伴随 SSR 风险）。

#### 设计要点

1. **Storage key**：`ecliptrix-tasks-state-v1`，存放 `{ tasks, tabs, activeTabId }`（`Date` 字段序列化为 ISO 字符串，反序列化时还原）。
2. **URL 同步**：每当 `activeTabId` 变化时，通过 `window.history.replaceState({}, '', queryString)` 写入 `?tab=<type>&task=<taskId>`。**不使用 `pushState`** 以避免污染浏览器历史栈。
3. **加载顺序**：mount effect 中按 `URL > localStorage > 空状态` 逐级回退；URL 中 `?task=<id>` 若存在但 LS 中找不到对应任务，则降级到 LS（不报错）。
4. **document.title**：在 `useTasks` 内增加新副作用，按 `activeTask?.title || 'Ecliptrix'` 写入 `document.title`，配合"BugTest – Ecliptrix"模式。
5. **SSR 安全**：所有 `localStorage` / `window` 访问必须在 `useEffect` 中（`use client` 已生效，但 hydrate 阶段仍会触发渲染）。初始 state 仍为空，避免 hydration mismatch。

#### 代码骨架

```ts
// src/hooks/useTasks.ts
const STORAGE_KEY = 'ecliptrix-tasks-state-v1';

interface PersistedState {
  tasks: Array<Omit<Task, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string }>;
  tabs: Tab[];
  activeTabId: string | null;
}

const reviveState = (raw: PersistedState): AppState => ({
  ...raw,
  tasks: raw.tasks.map(t => ({
    ...t,
    createdAt: new Date(t.createdAt),
    updatedAt: new Date(t.updatedAt),
  })) as Task[],
});

const dehydrateState = (s: AppState): PersistedState => ({
  ...s,
  tasks: s.tasks.map(t => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  })),
});

export const useTasks = () => {
  const [appState, setAppState] = useState<AppState>(createInitialState);
  const [hydrated, setHydrated] = useState(false);

  // —— 1) Hydration: URL > localStorage > empty
  useEffect(() => {
    try {
      const search = new URLSearchParams(window.location.search);
      const taskParam = search.get('task');

      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedState;
        const restored = reviveState(parsed);
        // If URL points at a known task, switch active tab to that task
        if (taskParam) {
          const tab = restored.tabs.find(t => t.taskId === taskParam);
          if (tab) {
            restored.tabs = restored.tabs.map(t => ({ ...t, isActive: t.id === tab.id }));
            restored.activeTabId = tab.id;
          }
        }
        setAppState(restored);
      }
    } catch (e) {
      // Corrupted LS — start fresh
      console.warn('[useTasks] Failed to restore state, starting fresh:', e);
    } finally {
      setHydrated(true);
    }
  }, []);

  // —— 2) Persist + URL sync (only after hydration to avoid clobbering)
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dehydrateState(appState)));
    } catch (e) {
      // Quota exceeded etc. — non-fatal
    }

    const activeTab = appState.tabs.find(t => t.id === appState.activeTabId);
    const activeTask = activeTab && appState.tasks.find(t => t.id === activeTab.taskId);
    const url = new URL(window.location.href);
    if (activeTask) {
      url.searchParams.set('tab', activeTab.type);
      url.searchParams.set('task', activeTask.id);
      document.title = `${activeTask.title} – Ecliptrix`;
    } else {
      url.searchParams.delete('tab');
      url.searchParams.delete('task');
      document.title = 'Ecliptrix - Where light and shadow collide';
    }
    window.history.replaceState({}, '', url.pathname + (url.search ? url.search : '') + url.hash);
  }, [appState, hydrated]);

  // ... rest unchanged ...
};
```

> **不要**修改 `closeAllTabs` 的逻辑：它只清空当前 state，等 effect 把空 state 写回 LS 即可，无需手动 `removeItem`。

### 风险

- **SSR hydration mismatch**：通过 mount-only effect + 初始空 state 规避；不会影响首屏 SSR HTML。
- **多标签页同步**：暂不处理（同 iter2 设计），多个浏览器标签会各自覆盖 LS——可接受，未来如需可加 `storage` 事件订阅。
- **CloseTab 后 URL 短暂保留旧 task**：useEffect 依赖 `appState`，state 变化即同步，无延迟问题。
- **Storage quota**：用户若有数十个任务/项目可能超限；序列化前可截断 `tasks`（保留最近 50）作为防御，但本轮不强制。
- **Hydration 期间 `window.location.search` 为空字符串**：客户端入口 `'use client'` 已保证仅在浏览器中执行 mount effect。
- **localStorage 被禁用**：包在 try/catch 中即可，体验降级回 iter2 行为。

### 测试

- **Vitest**（新增 `src/hooks/__tests__/useTasks.persistence.test.ts`）：
  1. mount → 创建任务 → 检查 `localStorage.getItem(STORAGE_KEY)` 包含序列化结果
  2. mount → 写入 LS → re-mount → 状态恢复
  3. URL 含 `?task=<id>` 且 LS 有匹配 tab → activeTabId 正确指向该 tab
  4. `closeAllTabs` → LS 中 tabs 为空数组 / activeTabId 为 null
  5. JSON.parse 失败 → 不抛、状态保持空 + console.warn
- **手动**：登录 → 进编辑器 → F5 → 应保留在 BugTest；复制 URL 到无痕窗口 → 登录后跳到对应项目；浏览器返回键不再退站

---

## Bug #2 — `<html lang>` 挂载时不同步

### 代码定位

`src/contexts/LocaleContext.tsx`：

- 行 23-29：mount effect，仅 `setLocaleState` + `setTranslations`，**未写 `document.documentElement.lang`**
- 行 31-38：`setLocale`，已正确写 `document.documentElement.lang`

### 根因

挂载副作用与用户切换路径走的是两套代码——前者漏掉了 DOM 同步。属于"双路径漂移"。

### 修复策略

抽取私有函数 `applyLocaleToDom`，挂载 effect 与 `setLocale` 共用：

```tsx
// src/contexts/LocaleContext.tsx
const applyLocaleToDom = (locale: SupportedLocale) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'zh-CN' ? 'zh-CN' : 'en';
  }
};

useEffect(() => {
  const savedLocale = localStorage.getItem('ecliptrix-locale') as SupportedLocale;
  if (savedLocale && (savedLocale === 'en' || savedLocale === 'zh-CN')) {
    setLocaleState(savedLocale);
    setTranslations(getTranslations(savedLocale));
    applyLocaleToDom(savedLocale);            // ← 新增
  } else {
    applyLocaleToDom(defaultLocale);          // ← 显式 sync 默认值，避免 SSR 缺省 "en" 与中文用户的偏好下次回写时漂移
  }
}, []);

const setLocale = (newLocale: SupportedLocale) => {
  setLocaleState(newLocale);
  setTranslations(getTranslations(newLocale));
  localStorage.setItem('ecliptrix-locale', newLocale);
  applyLocaleToDom(newLocale);                // ← 替换原 inline
};
```

### 风险

- **SSR 与客户端短暂不一致**：SSR 输出 `<html lang="en">`，挂载后立即被改为 `zh-CN`。React 不会因 `<html>` 属性变化触发 hydration warning（attribute set via DOM API，非 React-managed），影响最小。
- **空字符串 / 异常值 fallback**：当前 `getItem` 读到非预期值会被 if 拦截，`applyLocaleToDom(defaultLocale)` 兜底，保证 lang 始终有值。

### 测试

- **Vitest**（新增 `src/contexts/__tests__/LocaleContext.test.tsx`）：
  1. localStorage 预置 `ecliptrix-locale=zh-CN` → mount → `document.documentElement.lang === 'zh-CN'`
  2. localStorage 为空 → mount → `document.documentElement.lang === 'en'`
  3. setLocale('zh-CN') → 切换后 lang 同步
- **手动**：选 zh-CN → reload → DevTools 检查 `<html lang>` = `zh-CN`；NVDA 朗读应使用普通话音素

---

## Bug #3 — ModelSettingsPanel API Key 不在 `<form>` 内

### 代码定位

`src/components/AdminSettings/ModelSettingsPanel.tsx`：

- 行 911-1148：Provider Add/Edit 表单整体（`{providerForm && (...)}` 块）
- 行 985-996：API Key `<input type="password">`（无 form 祖先）
- 行 1115-1121：测试连接按钮（无 type，默认 type="submit"）
- 行 1133-1138、1139-1145：取消 / 保存按钮（同上）

### 根因

iter2 已经修复了 `LoginModal` 与 `UserManagement` 的密码框 form 包裹问题，但 `ModelSettingsPanel.tsx` 当时不在清单中。**整个 Panel 内 0 个 `<form>`**（已用 grep 验证）。

### 修复策略

参照 iter2 风格：把 Provider 表单整段包进 `<form noValidate onSubmit>`，按钮显式声明 type：

```tsx
{providerForm && (
  <form
    noValidate
    onSubmit={(e) => { e.preventDefault(); handleSaveProvider(); }}
    className="mt-4 p-4 rounded-lg border border-primary/30 bg-card space-y-4"
  >
    <h3 className="text-sm font-medium text-foreground">
      {providerForm.id ? t.adminSettings.modelEditProvider : t.adminSettings.modelAddProvider}
    </h3>

    {/* Provider Name / Type / API URL — 不变 */}

    {/* API Key */}
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">
        {t.adminSettings.modelApiKey}
      </label>
      <div className="relative">
        <input
          type={showApiKey ? 'text' : 'password'}
          autoComplete="new-password"  // 阻止浏览器自动填充其他凭据
          value={providerForm.api_key_changed ? providerForm.api_key : ''}
          onChange={...}
          onFocus={...}
          placeholder={...}
          className="..."
        />
        <button
          type="button"  // 已经是 type=button，保持
          onClick={() => setShowApiKey(!showApiKey)}
          ...
        >
          ...
        </button>
      </div>
    </div>

    {/* API Format / Models / TestResult — 不变 */}

    {/* Form Actions */}
    <div className="flex items-center justify-between pt-2">
      <div className="flex items-center gap-2">
        <button
          type="button"   // ← 显式：避免被表单提交触发
          onClick={() => handleTestProviderConnection(providerForm.id || 'new')}
          ...
        >
          {testingProvider ? t.adminSettings.modelTesting : t.adminSettings.modelTestConnection}
        </button>
        {... fetch models button (type="button") ...}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"   // ← 显式
          onClick={() => { setProviderForm(null); setProviderTestResult(null); }}
          ...
        >
          {t.adminSettings.cancel}
        </button>
        <button
          type="submit"   // ← 改为 submit；onSubmit 已绑定 handleSaveProvider
          disabled={savingProvider || !providerForm.name || !providerForm.api_url}
          ...
        >
          {savingProvider ? t.adminSettings.modelSaving : t.adminSettings.modelSave}
        </button>
      </div>
    </div>
  </form>
)}
```

> 不要给"测试连接"和"获取模型"加 onSubmit，它们与保存解耦。`onSubmit` 仅触发保存。

### 风险

- **回车键现在会触发保存**：通常这是预期行为（与 LoginModal 一致），但需要确认任何带 `<input>` 的字段在用户敲 Enter 时不会误保存——这正是 `noValidate` + 显式 `type="button"` 的目的。`<select>` 不会触发 submit。
- **API Key 自动填充**：`autoComplete="new-password"` 防止浏览器把 admin 登录密码塞进来。
- **Edit 模式 placeholder `••••••••`**：维持原行为；input 仍位于 form 中。

### 测试

- **Vitest**（新增 `src/components/AdminSettings/__tests__/ModelSettingsPanel.form.test.tsx`，使用 testing-library）：
  1. 渲染 Add 模式 → `screen.getByPlaceholderText(zh placeholder).closest('form')` 不为 null
  2. 渲染 Edit 模式 → 同上（placeholder 为 `••••••••`）
  3. 测试连接按钮 type === 'button'
  4. 保存按钮 type === 'submit'
  5. 表单提交事件触发 `handleSaveProvider`（mock prop）
- **手动**：打开 Add/Edit Provider 对话框，DevTools 控制台不再出现 `Password field is not contained in a form`

---

## Bug #4 — ChatTypeSelectionModal 无法区分同名工作流 + 0 节点可选

### 代码定位

`src/components/chat/ChatTypeSelectionModal.tsx`：

- 行 35：`workflows` state（来自 `loadAgentWorkflows`，类型 `WorkflowRecord` 含 `workflow_id/version/updated_at/created_at`）
- 行 318-375：工作流卡片渲染
- 行 444：`workflowsAvailable` 计数

`src/lib/api/workflow.ts`：`WorkflowRecord` 在行 19，`updated_at: string` 在行 31

### 根因

卡片仅渲染 `workflow_name + nodes.length + version`，不渲染 `updated_at` / `workflow_id`。同时未对 `nodes.length === 0` 做禁用处理。

### 修复策略

#### 1. 排序：按 `updated_at desc`

```ts
const sortedWorkflows = useMemo(
  () => [...workflows].sort((a, b) => {
    const ta = new Date(a.updated_at || a.created_at || 0).getTime();
    const tb = new Date(b.updated_at || b.created_at || 0).getTime();
    return tb - ta;
  }),
  [workflows],
);
```

> 渲染时遍历 `sortedWorkflows`。如此用户最常编辑的草稿会出现在首位。

#### 2. 卡片改造：禁用空节点 + 增加区分

```tsx
{sortedWorkflows.map((workflow) => {
  const isEmpty = (workflow.nodes?.length || 0) === 0;
  const idShort = workflow.workflow_id.replace(/-/g, '').slice(-6);
  const updatedLabel = formatRelativeTime(workflow.updated_at);  // 新增 helper

  return (
    <button
      key={workflow.workflow_id}
      type="button"
      onClick={() => !isEmpty && handleSelectWorkflow(workflow)}
      aria-disabled={isEmpty}
      title={isEmpty ? t.aiChat.chatTypeModal.emptyWorkflowHint : undefined}
      disabled={isEmpty}  // 视觉 + 行为同时锁定
      className={`
        group relative p-5 bg-card border border-border rounded-md text-left transition-colors duration-200
        ${isEmpty
          ? 'opacity-50 cursor-not-allowed border-dashed'
          : 'hover:border-primary/40'}
      `}
    >
      {/* …icon… */}

      <div className="flex items-start justify-between mb-3">
        <div className="w-12 h-12 ..."> ... </div>
        {workflow.is_active && (
          <span className="px-2 py-1 ...">{t.aiChat.chatTypeModal.active}</span>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-base font-semibold text-foreground line-clamp-1 group-hover:text-primary transition-colors">
          {workflow.workflow_name}
        </h3>
        {workflow.workflow_description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{workflow.workflow_description}</p>
        )}

        <div className="flex items-center space-x-3 text-xs text-muted-foreground pt-2">
          <div className="flex items-center space-x-1">
            <svg ... /> <span>{workflow.nodes?.length || 0} {t.aiChat.chatTypeModal.nodes}</span>
          </div>
          <div className="flex items-center space-x-1">
            <svg ... /> <span>v{workflow.version}</span>
          </div>
          {/* ↓ 新增第三块：ID 后缀 + 更新时间 */}
          <div className="flex items-center space-x-1" aria-label={`${t.aiChat.chatTypeModal.idLabel} ${idShort}`}>
            <span className="font-mono opacity-70">·#{idShort}</span>
          </div>
        </div>

        {updatedLabel && (
          <div className="text-[11px] text-muted-foreground/80 pt-1">
            {t.aiChat.chatTypeModal.updatedAt.replace('{time}', updatedLabel)}
          </div>
        )}
      </div>
    </button>
  );
})}
```

#### 3. 计数文案：含空数

```ts
const emptyCount = sortedWorkflows.filter(w => !(w.nodes?.length)).length;
const usableCount = sortedWorkflows.length;
const countLabel = emptyCount > 0
  ? t.aiChat.chatTypeModal.workflowsAvailableWithEmpty
      .replace('{count}', String(usableCount))
      .replace('{empty}', String(emptyCount))
  : t.aiChat.chatTypeModal.workflowsAvailable.replace('{count}', String(usableCount));
```

> 替换现有行 444 处的字符串。

#### 4. `formatRelativeTime` helper（新建小工具，i18n-aware）

放在 `src/components/chat/ChatTypeSelectionModal.tsx` 同文件内（无需多文件）：

```ts
const formatRelativeTime = (iso?: string): string | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
};
```

> 简易版即可。如有需要后续可改为基于 locale 的 `Intl.RelativeTimeFormat`。

### 风险

- **后端 `updated_at` 字段未必存在**：fallback 到 `created_at`；helper 检测 NaN 时返回 null（卡片不显示时间行）。
- **a11y 与 disabled**：`<button disabled>` 同时移除焦点和 onClick；保留 `title` + `aria-disabled` 提供 SR 提示。
- **i18n 文案中含 `·`**：UTF-8 字符在 i18n.ts 中已有先例（如 "{count} 个节点"），无需特殊处理。

### 测试

- **Vitest**（新增 `src/components/chat/__tests__/ChatTypeSelectionModal.test.tsx`）：
  1. 给定 3 个工作流（2 个 0 节点 + 1 个 5 节点），渲染后空节点卡片 `aria-disabled="true"` 且 `disabled` 属性存在
  2. 点击空节点卡片，`onSelectWorkflow` mock 不被调用
  3. 点击非空卡片，正常调用
  4. 排序：updated_at 较新者排在前
  5. 计数文案：emptyCount > 0 → 使用 `workflowsAvailableWithEmpty`
- **手动**：在 Workflow 标签创建 3 个空草稿 + 1 个真实工作流；新对话 → 工作流 → 空草稿应灰显，hover 显示提示，真实工作流可选

---

## Bug #5 — 首页 Brainstorm 卡片 → "功能开发中"

### 代码定位

| 文件 | 行 | 备注 |
|------|---|------|
| `src/components/HomePage/LandingPage.tsx` | 66-75 | 第 4 个 feature（brainstorm）与其他三类等价 |
| `src/components/HomePage/LandingPage.tsx` | 125-138 | `features.map` 渲染卡片 |
| `src/components/Container.tsx` | 268-283 | brainstorm 命中后渲染 "功能开发中..." 死胡同 |

### 根因

LandingPage 把未上线功能与已上线功能并列展示且行为一致，进入后无任何返回路径。属于产品诚信 / 首次留存问题，不是技术 Bug，但通过最小代码改动可化解。

### 修复策略（推荐方案 A — 快速门控 + 副本调整）

#### 1. LandingPage：标记 comingSoon + 显示角标 + 阻止 onClick

```tsx
const features = [
  { /* video */ ...                 , comingSoon: false },
  { /* workflow */ ...              , comingSoon: false },
  { /* aiChat */ ...                , comingSoon: false },
  {
    icon: (...),
    title: t.tasks.brainstorming,
    description: t.landing.brainstormingDescPreview,  // ← 改为预告版副本
    type: 'brainstorm' as TaskType,
    comingSoon: true,                                 // ← 新字段
  },
];

// 渲染层：
{features.map((feature, index) => {
  const disabled = feature.comingSoon || isAuthLoading;
  return (
    <div
      key={index}
      className={`landing-feature-card ${disabled ? 'opacity-60 cursor-not-allowed pointer-events-none' : ''} ${feature.comingSoon ? 'relative' : ''}`}
      onClick={() => !disabled && handleGetStarted(feature.type)}
      role={feature.comingSoon ? 'button' : undefined}
      aria-disabled={feature.comingSoon || undefined}
      title={feature.comingSoon ? t.landing.comingSoonHint : undefined}
    >
      <div className="landing-feature-icon bg-primary/10 text-primary">{feature.icon}</div>
      <h3 className="landing-feature-title">{feature.title}</h3>
      <p className="landing-feature-description">{feature.description}</p>
      {feature.comingSoon && (
        <span className="absolute top-2 right-2 px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200/60">
          {t.landing.comingSoonBadge}
        </span>
      )}
    </div>
  );
})}
```

> 注意：原代码 `onClick` 在外层 div，`pointer-events-none` 已经能阻止点击。`role='button'` 只在 comingSoon 时给（普通卡片继承默认 div+onClick 风格，与 iter2 ProjectCard 修复一致）。

#### 2. Container.tsx：兜底处理（防御性）

仍保留 brainstorm task 的渲染逻辑（万一 LS 中有遗留旧任务），但加一个"返回首页"按钮，避免死胡同：

```tsx
if (activeTask.type === 'brainstorm') {
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 ...">...</div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">{t.tasks.brainstorming}</h2>
        <p className="text-muted-foreground mb-4">{t.common.underDevelopment}</p>
        {/* ↓ 新增：让用户可以离开，而不是只能关闭标签 */}
        <p className="text-sm text-muted-foreground/80 mb-6">{t.landing.comingSoonHint}</p>
      </div>
    </div>
  );
}
```

> 不增加返回按钮以避免引入跨组件 prop（VerticalTaskbar 已可关闭 tab）。仅追加 hint，告知用户处于预览状态。

### 风险

- **landing.brainstormingDescPreview** 已存在的 EN/ZH 文案需要同步更新；若运营希望保留原版文案，可不改 `brainstormingDesc`，只新增 `brainstormingDescPreview`。
- **comingSoon 字段类型**：`features` 数组目前是 inline 类型推断，加字段不影响 TS。
- **AuthLoading 与 comingSoon 并存**：`disabled = comingSoon || isAuthLoading` 保证未登录态仍提示登录前已先看到 Coming Soon —— 但 onClick 已被阻断，不会触发登录弹窗。这是预期：未登录用户不应被提示登录到一个未上线功能。

### 测试

- **Vitest**（新增 `src/components/HomePage/__tests__/LandingPage.brainstorm.test.tsx`）：
  1. 渲染 → brainstorm 卡片含 "Coming Soon" 文案
  2. 点击 brainstorm 卡片 → `onCreateTask` mock 不被调用
  3. 点击 video 卡片 → `onCreateTask` mock 调用一次（未登录态走 `onLoginRequired`）
- **手动**：访问首页 → brainstorm 卡显示角标且无法点击；hover 显示 tooltip

---

## Bug #6 — 空时间轴上"导出视频"按钮可点

### 代码定位

`src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx`：

- 行 1979：`{timelineState && timelineState.tracks.length > 0 && (...)}`，门控条件不含 items
- 行 1980-2027：button 主体
- 行 1982：`disabled={videoExport.isExporting}`，未含 items 检查

`src/lib/i18n.ts`：行 1101-1105 `videoPlayerPanel.export` interface；行 3778-3782（EN）；行 6475-6479（ZH）—— 新增 `emptyTimeline` key（已在前置 i18n 段列出）

### 根因

新建项目即有 5 条空轨道，故 `tracks.length > 0` 永真。`disabled` 逻辑未感知 items。

### 修复策略

```tsx
// 在组件主体中（紧邻其他 useMemo）：
const hasAnyExportableItem = useMemo(
  () => (timelineState?.tracks ?? []).some(track => (track.items?.length ?? 0) > 0),
  [timelineState],
);

// 渲染层：
{timelineState && timelineState.tracks.length > 0 && (
  <button
    onClick={handleVideoExport}
    disabled={videoExport.isExporting || !hasAnyExportableItem}
    title={
      !hasAnyExportableItem
        ? t.videoPlayerPanel.export.emptyTimeline
        : undefined
    }
    className={`
      flex items-center space-x-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed
      ${videoExport.isExporting
        ? 'bg-muted text-muted-foreground cursor-not-allowed'
        : 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80'
      }
    `}
    tabIndex={0}
    aria-label={
      videoExport.isExporting
        ? `${t.videoPlayerPanel.export.exporting} (${selectedAspectRatio.id})...`
        : !hasAnyExportableItem
          ? t.videoPlayerPanel.export.emptyTimeline
          : `${t.videoPlayerPanel.export.exportVideo} (${selectedAspectRatio.id})`
    }
    onKeyDown={(e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !videoExport.isExporting && hasAnyExportableItem) {
        e.preventDefault();
        handleVideoExport();
      }
    }}
  >
    {/* … 按钮内部不变 … */}
  </button>
)}
```

> 同时把 keyboard handler 也加上 `hasAnyExportableItem` 守卫，避免 Enter/Space 绕过。

### 风险

- **多轨道结构**：检查 `track.items?.length > 0`；若未来 items 字段命名调整需要同步。可考虑加 `track.items?.filter(Boolean).length > 0` 防御 null entries。
- **i18n key 缺失**：在 EN+ZH+interface 三处都要补；type-check 是最后一道关卡。
- **性能**：`useMemo` 依赖 `timelineState`，仅在轨道/items 变化时重算。已有 timelineState 是大对象，但每次 mutation 都会改引用，符合 React 习惯。

### 测试

- **Vitest**（新增 `src/components/video/components/VideoPlayerPanel/__tests__/exportButton.test.tsx`）：
  1. 5 条空轨道 → 按钮 `disabled` 属性存在
  2. 1 条轨道 + 1 个 item → 按钮启用
  3. `isExporting=true` → 即使有 item 也 disabled
  4. Enter 键在空时间轴下不触发 `handleVideoExport`（mock）
- **手动**：新建项目 → 不加素材 → 顶栏导出按钮置灰 + tooltip；添加一段视频后按钮恢复正常

---

## PR 分组与提交建议

按 iter1/iter2 风格统一为单 commit。建议命令：

```bash
# 步骤 0：在每个 PR 起始前都先做 i18n 增量
# 步骤 1：分支落地，跑 type-check + 全量 vitest
npm run type-check
npm run test  # vitest

# 步骤 2：提交
git add src/lib/i18n.ts                    # 共享 i18n key
git add src/hooks/useTasks.ts src/hooks/__tests__/useTasks.persistence.test.ts \
        src/contexts/LocaleContext.tsx src/contexts/__tests__/LocaleContext.test.tsx
git commit -m "fix: persist task state to URL+localStorage and sync html lang on mount (iter3 PR-A)"

git add src/components/AdminSettings/ModelSettingsPanel.tsx \
        src/components/AdminSettings/__tests__/ModelSettingsPanel.form.test.tsx
git commit -m "fix: wrap ModelSettingsPanel provider editor in <form noValidate> (iter3 PR-B)"

git add src/components/chat/ChatTypeSelectionModal.tsx \
        src/components/chat/__tests__/ChatTypeSelectionModal.test.tsx \
        src/components/HomePage/LandingPage.tsx \
        src/components/HomePage/__tests__/LandingPage.brainstorm.test.tsx \
        src/components/Container.tsx
git commit -m "fix: differentiate workflows in chat-type modal, gate brainstorm coming-soon (iter3 PR-C)"

git add src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx \
        src/components/video/components/VideoPlayerPanel/__tests__/exportButton.test.tsx
git commit -m "fix: disable export button on empty timeline with i18n tooltip (iter3 PR-D)"
```

> 也可一次性合 PR-C/PR-D 进同一 commit；与 iter2 一致风格的话整体压成一个 commit 也能接受（参考 iter2 commit 711ef28）。

## 验证路径汇总（手动 smoke）

完成全部修复并跑通自动化测试后，按如下顺序在 dev 服务器（http://192.168.1.123:3010）手动验证：

1. **首屏**：localStorage `ecliptrix-locale=zh-CN` → `<html lang>` 应显示 `zh-CN`（Bug#2）
2. **首屏**：brainstorm 卡显示 "即将推出" 角标，hover 显示 tooltip，点击无效（Bug#5）
3. **视频编辑**：进入项目 → URL 应包含 `?tab=video&task=...` → F5 应保留项目（Bug#1）
4. **视频编辑器顶栏**：未加素材时导出按钮置灰；加一段素材后恢复（Bug#6）
5. **AI 对话**：新对话 → 工作流，多个空草稿应灰显且不可点；卡片应显示 ID 后缀 + "更新于 X" 标签（Bug#4）
6. **管理员设置 → 模型设置 → 添加供应商**：DevTools 控制台无 `Password field is not contained in a form` 警告（Bug#3）
7. **回归**：iter1（视频封面 WYSIWYG / a11y / 颜色 hex 校验）、iter2（401 / TTS 校验 / Pydantic / dlog / ProjectCard / dev hint / UserManagement form）一并目视验证

## 风险与注意事项总览

| 风险 | 影响 | 缓解 |
|------|-----|-----|
| LS 中存有 v0 schema 数据 | useTasks 反序列化失败 | try/catch fallback 到空状态 + console.warn |
| URL replaceState 频率高 | 浏览器历史栈无影响（replace 而非 push） | 使用 `replaceState`，不污染历史 |
| `<html lang>` 由 DOM API 修改 | 不触发 React hydration warning | 在 useEffect 中同步，post-hydration |
| Provider 表单 onSubmit 误触 | 用户敲 Enter 提交意外保存 | 测试连接 / 取消 / 获取模型按钮均显式 type="button" |
| 工作流 updated_at 缺失 | 时间标签显示异常 | helper 返回 null 时不渲染 |
| comingSoon 跳过登录引导 | 未登录用户失去转化机会 | brainstorm 上线前可接受；产品上线时移除 comingSoon |
| 导出按钮门控误差 | items 字段命名变化 | 使用可选链 + filter Boolean 防御 |

## 下一步（移交 step 3）

step 3（fix-plan-reviewed.md）需要至少检查：

- 与当前 HEAD 的行号是否仍一致（如 LS 落地 / 测试文件路径）
- i18n 三处增量是否都有（interface / EN / ZH）；尤其留意 ZH 段后续多余逗号 / 嵌套层级
- `useTasks` 持久化的 SSR 安全性（建议 step 3 跑一次 `npm run build` 确认）
- ChatTypeSelectionModal 的 `WorkflowRecord.updated_at` 来源是否一致（前端类型 vs 后端实际返回）
- LandingPage `features` 数组类型是否需要显式声明，避免 inline 类型 + comingSoon 字段触发 TS 推断陷阱
- VideoPlayerPanel `track.items` 实际类型字段名（部分 timeline 模型用 `mediaItems`）
- 与 iter2 同步：保留 `noValidate` + autoComplete 命名习惯；保留 `dlog`-style 调试日志

---

> **执行人**：Claude（iter3 step 2）
> **完成时间**：2026-05-09
> **HEAD 验证**：6100984（与 bug-report.md 一致）
> **下游**：fix-plan-reviewed.md（step 3）→ apply（step 4）→ review/commit（step 5）
