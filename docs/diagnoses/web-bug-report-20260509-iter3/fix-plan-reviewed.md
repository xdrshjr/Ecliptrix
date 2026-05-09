# Web Bug 修复方案 (审查版) — iter3 step 3

**HEAD 验证基线**: `6100984`
**审查时间**: 2026-05-09
**输入**: [`fix-plan.md`](./fix-plan.md) · [`bug-report.md`](./bug-report.md)
**输出**: 本文件 — 经审查并修正后的最终修复方案，可直接交付 step 4 落地。

---

## 0. Verification snapshot（与当前 HEAD 对齐）

下表为针对 `fix-plan.md` 中各 Bug 关键代码点位的二次核验。所有行号已与 HEAD `6100984` 复核。

| Bug | 文件 | 关键行 (验证后) | 备注 |
|-----|-----|----------------|------|
| #1 | `src/hooks/useTasks.ts` | 7-13（initial state）、169-175（closeAllTabs）、103-107、140-146（mutators） | `createInitialState` 是组件内函数；`useState(() => createInitialState())` 已用 lazy initializer，**不能改成 `useState(createInitialState)`**（fix-plan 的伪代码这么写过，必须保持调用形式以便每次仅初始化一次）。`closeAllTabs` 写成 `setAppState({ tasks: [], tabs: [], activeTabId: null })`。 |
| #1 | `src/app/page.tsx` | 42、62 | `showLandingPage = tabs.length === 0`；`handleReturnHome` 调 `closeAllTabs`。Persistence 必须让 closeAllTabs 也清掉 LS — fix-plan 的"等 effect 把空 state 写回"思路成立，无需手动 `removeItem`。 |
| #2 | `src/contexts/LocaleContext.tsx` | 18-29（mount effect）、31-38（setLocale） | OK — 私有 helper 抽取方案可行。`SupportedLocale`、`defaultLocale` 已在 line 4 导入。 |
| #3 | `src/components/AdminSettings/ModelSettingsPanel.tsx` | 911-1148（providerForm 整段）、984-996（API key input）、1115-1121（测试连接）、1122-1130（获取模型）、1133-1138（取消）、1139-1145（保存） | `<form>` 在整个 Panel 中 0 出现（已 `grep -n "<form\|</form>"` 验证）。"Save" 按钮当前是 `<button onClick={handleSaveProvider}>`（默认 type=submit 一旦包入 form）。 |
| #4 | `src/components/chat/ChatTypeSelectionModal.tsx` | 35（state）、319-374（卡片）、443-446（计数） | `WorkflowRecord.updated_at: string`（`src/lib/api/workflow.ts:31`）— 类型确认存在。`workflow.nodes` 类型为 `WorkflowNode[]`（**非可选**），但运行时仍要做 `?.length || 0` 防御，与现有 366 行写法一致。 |
| #4 | `src/lib/i18n.ts` | 1959-1992（interface）、4651-4684（EN）、7348-7381（ZH） | 现有 `workflowsAvailable` 已存在；本轮新增 4 个 key 必须**三处全加**。 |
| #5 | `src/components/HomePage/LandingPage.tsx` | 35-76（features）、125-138（render） | 当前 `<div onClick=...>`（非 button）— 含 `pointer-events-none` 当 `isAuthLoading` 时。`features` 数组无 `comingSoon` 字段，需在 inline 类型上扩展（TS 推断会自动接受）。 |
| #5 | `src/components/Container.tsx` | 268-283 | 当前 brainstorm 兜底死胡同，仅有标题 + "功能开发中..." 一行。 |
| #6 | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | 1979-2027 | `Track.items: TimelineItem[]`（**非可选**，`src/types/index.ts:909`），所以 `?.length` 仅作防御。无需新增导入。 |
| #6 | `src/lib/i18n.ts` | 1101-1105（interface）、3778-3782（EN）、6475-6479（ZH） | export 已含 `exportVideo / exporting / exportingProgress` 三个 key，新增 `emptyTimeline` 须三处全加。 |

---

## 1. 修正项汇总（**必须采纳**）

下面 6 项是相对 `fix-plan.md` 的修正，请在 step 4 严格遵循。

### 修正 1（Bug #5，**Critical**）：`pointer-events-none` 与 `title` tooltip 互斥

`fix-plan.md` 在 LandingPage 卡片上同时使用 `pointer-events-none` 与 `title=` —— 由于 `pointer-events-none` 会**屏蔽 `:hover`**，浏览器不会触发原生 `title` tooltip，"Coming Soon" 提示在 hover 时不会出现，仅角标可见。

**修正方案**：comingSoon 卡片**不要加 `pointer-events-none`**；用 `cursor-not-allowed` + `onClick` 守卫即可阻止激活，同时保留 hover tooltip。`isAuthLoading` 的卡片仍可使用 `pointer-events-none`（它本就不需要 tooltip，且 isAuthLoading 是短暂状态）。

```tsx
{features.map((feature, index) => {
  const isComingSoon = feature.comingSoon === true;
  const isLoadingDisabled = isAuthLoading && !isComingSoon;

  const stateClass = isComingSoon
    ? 'opacity-60 cursor-not-allowed'                     // ✅ 保留 hover → title 可显示
    : isLoadingDisabled
      ? 'opacity-60 cursor-wait pointer-events-none'      // 短暂状态，可保留
      : '';

  return (
    <div
      key={index}
      className={`landing-feature-card relative ${stateClass}`}
      onClick={() => {
        if (isComingSoon || isAuthLoading) return;
        handleGetStarted(feature.type);
      }}
      role={isComingSoon ? 'button' : undefined}
      aria-disabled={isComingSoon || undefined}
      title={isComingSoon ? t.landing.comingSoonHint : undefined}
    >
      <div className="landing-feature-icon bg-primary/10 text-primary">{feature.icon}</div>
      <h3 className="landing-feature-title">{feature.title}</h3>
      <p className="landing-feature-description">{feature.description}</p>
      {isComingSoon && (
        <span className="absolute top-2 right-2 px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200/60 pointer-events-none">
          {t.landing.comingSoonBadge}
        </span>
      )}
    </div>
  );
})}
```

> 角标 (`<span>`) 自身可继续 `pointer-events-none`，因为它只是装饰，不需要交互。父容器禁止 hover 屏蔽就行。

### 修正 2（Bug #3）：Save 按钮提交路径必须**单一**

`fix-plan.md` 的伪代码把 Save 按钮改成 `type="submit"` 但**没明确删除 `onClick={handleSaveProvider}`**。如果两者都保留，点击 Save 时 onClick 与 form onSubmit 都会触发 `handleSaveProvider` —— 在 `savingProvider` 为 false 的瞬间被调两次（即使 disabled 守卫也是一致），造成两次 API 调用 / 两次 toast。

**修正方案**：保留 onClick **或** 改 type=submit + onSubmit，但**只保留其中一条触发链**。推荐：

```tsx
<form
  noValidate
  onSubmit={(e) => {
    e.preventDefault();
    if (savingProvider || !providerForm.name || !providerForm.api_url) return;
    handleSaveProvider();
  }}
  className="mt-4 p-4 rounded-lg border border-primary/30 bg-card space-y-4"
>
  {/* ... */}
  <button
    type="submit"          // 用表单提交触发
    /* 移除 onClick={handleSaveProvider}，改由 onSubmit 处理 */
    disabled={savingProvider || !providerForm.name || !providerForm.api_url}
    className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
  >
    {savingProvider ? t.adminSettings.modelSaving : t.adminSettings.modelSave}
  </button>
</form>
```

其它三个按钮（`测试连接` / `获取模型` / `取消`）必须显式 `type="button"`，否则在 `<form>` 内会被默认当作 submit。

> 同时给 API Key input 加 `autoComplete="new-password"`（与 iter2 UserManagement 修复一致）。

### 修正 3（Bug #1）：lazy initializer 写法 + URL 在加载时优先级正确

`fix-plan.md` 的伪代码写了 `useState<AppState>(createInitialState)`（缺少 IIFE 圆括号），**不要改这一行**。当前 `useState<AppState>(() => createInitialState())` 已经是正确的 lazy initializer 调用，保持不变。

URL 优先级：fix-plan 在 hydration effect 中先读 LS，再用 URL 的 `taskParam` 切到匹配 tab。**这里有一个风险**：如果 LS 为空但 URL 有 `?task=<id>`，结果是 LS 解析失败（无 raw）→ 直接 finally 设 hydrated=true，URL 中的 task 被无视。改正后逻辑：

```ts
useEffect(() => {
  let nextState: AppState | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      nextState = reviveState(JSON.parse(raw) as PersistedState);
    }
  } catch (e) {
    console.warn('[useTasks] Failed to restore state, starting fresh:', e);
  }

  if (nextState) {
    try {
      const search = new URLSearchParams(window.location.search);
      const taskParam = search.get('task');
      if (taskParam) {
        const tab = nextState.tabs.find(t => t.taskId === taskParam);
        if (tab) {
          nextState = {
            ...nextState,
            tabs: nextState.tabs.map(t => ({ ...t, isActive: t.id === tab.id })),
            activeTabId: tab.id,
          };
        }
      }
    } catch { /* search 解析失败不阻塞恢复 */ }
    setAppState(nextState);
  }
  setHydrated(true);
}, []);
```

> 当 URL `?task=` 在 LS 中找不到对应 tab，保留 LS 状态（不强行切换），不报错 — 与 fix-plan 描述的 "降级到 LS" 一致。

### 修正 4（Bug #1）：closeAllTabs 后立刻同步 URL — 不要让旧 URL 滞留至下次点击

`closeAllTabs` 把 state 清空 → persist effect 触发 → URL 删除 `tab/task` 查询串。这条链路在 fix-plan 中已成立，但要注意：`handleReturnHome` 在调用 `closeAllTabs` 后还会同步设置 `setIsSettingsOpen/setIsProfileOpen`（page.tsx:60-67）。这两个 state 的渲染先于 useTasks 的 persist effect 重新计算 URL — 但 `replaceState` 是同步的、立即生效；只要 React 在该 commit 的 layout/effect 阶段执行 persist effect 即可。**不需要额外手动 `replaceState`**。

但需添加一处保护：**hydrated=false 期间不要写 LS 也不要 replaceState**（否则会用初始空 state 把 LS 清掉）。fix-plan 已经有 `if (!hydrated) return;` 守卫，必须严格保留。

### 修正 5（Bug #4）：i18n key 同时需要修改 interface（type-check 关）+ workflow_id 防御

fix-plan 的 i18n 表已正确列出新增 key 与位置，但**特别强调**：interface 块 (line 1959-1992) 是 TS schema，**漏改会导致 type-check 失败、CI 流水线红**。step 4 必须按以下顺序：

1. 修改 `interface chatTypeModal { ... }`（line 1959-1992）：在 `workflowsAvailable: string;` 后追加四个新字段：
   ```ts
   emptyWorkflowHint: string;
   idLabel: string;
   updatedAt: string;
   workflowsAvailableWithEmpty: string;
   ```
2. 修改 `interface videoPlayerPanel.export { ... }`（line 1101-1105）：追加 `emptyTimeline: string;`
3. 修改 `interface landing { ... }`（line 26-39）：追加 `comingSoonBadge: string; comingSoonHint: string; brainstormingDescPreview: string;`
4. EN（line 4651-4684、3778-3782、2703-2716）与 ZH（line 7348-7381、6475-6479、5400-5413）按对应位置补全。

`workflow_id` 防御：fix-plan 的 `workflow.workflow_id.replace(/-/g, '').slice(-6)` 在 `workflow_id` 为 `''` 时返回 `''` → 渲染 "·#"。要求加守卫：

```ts
const idShort = (workflow.workflow_id ?? '').replace(/-/g, '').slice(-6);
// 渲染时仅 idShort 非空才显示
{idShort && (
  <div className="flex items-center space-x-1" aria-label={`${t.aiChat.chatTypeModal.idLabel} ${idShort}`}>
    <span className="font-mono opacity-70">·#{idShort}</span>
  </div>
)}
```

### 修正 6（Bug #6）：disabled 按钮 tabIndex 应让浏览器默认处理

fix-plan 在 disabled 状态下仍保留 `tabIndex={0}`，这会让键盘焦点停在不可激活的按钮上。**`disabled` 已使按钮自动从 Tab 序列中移除**，不需要显式 `tabIndex`。

修正：去掉硬编码的 `tabIndex={0}`，让浏览器默认行为处理（disabled → tab 跳过；非 disabled → 焦点正常）。aria-label 与 title 仍需根据 `hasAnyExportableItem` 切换。

```tsx
<button
  onClick={handleVideoExport}
  disabled={videoExport.isExporting || !hasAnyExportableItem}
  title={
    !hasAnyExportableItem && !videoExport.isExporting
      ? t.videoPlayerPanel.export.emptyTimeline
      : undefined
  }
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
  className={`
    flex items-center space-x-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed
    ${videoExport.isExporting
      ? 'bg-muted text-muted-foreground cursor-not-allowed'
      : 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80'
    }
  `}
>
  {/* 内部 SVG / 文案不变 */}
</button>
```

`hasAnyExportableItem` useMemo 实现保持不变：

```ts
const hasAnyExportableItem = useMemo(
  () => (timelineState?.tracks ?? []).some(track => (track.items?.length ?? 0) > 0),
  [timelineState],
);
```

---

## 2. 各 Bug 落地清单（最终版，可直接执行）

### Bug #1 — 项目编辑器无路由

**改动文件**:
- `src/hooks/useTasks.ts` — 实现 LS 镜像 + URL replaceState + document.title
- 新建 `src/hooks/__tests__/useTasks.persistence.test.ts`

**关键决策**:
- 不改 `createInitialState` 的位置（保留组件内）。
- `useState<AppState>(() => createInitialState())` 调用形式不变。
- 新增 `STORAGE_KEY = 'ecliptrix-tasks-state-v1'`。
- 新增 `hydrated` state，用 mount-only effect 加载，**严格 if (!hydrated) return** 保护持久化 effect。
- Persist effect 同时写 LS、`history.replaceState`、`document.title`。
- 接受首屏短暂 landing flash（hydrated 之前 1-2 帧）— 不引入 SSR 风险。

**测试**（Vitest）:
1. mount → createTask('chat') → LS 含序列化结果，URL 含 `?tab=chat&task=...`，title 改写。
2. LS 预填后 mount → 状态恢复；URL 含 `?task=<id>` 触发对应 tab 激活；URL 含 `?task=<unknown>` 仍显示 LS 状态（不报错）。
3. closeAllTabs → LS 中 tabs/tasks 为空数组，URL `?tab` / `?task` 被删，title 回 "Ecliptrix - Where light and shadow collide"。
4. JSON.parse 失败 → 不抛、保持空状态 + console.warn。
5. localStorage.setItem 抛 quota 异常 → 不影响 state（在 try/catch 内吞）。

**手动验证**:
- 登录 → 进编辑器 → URL 应含 `?tab=video&task=...` → F5 应保留项目；复制 URL 到无痕窗口 → 登录后跳到对应项目；浏览器返回键不再退站；点 Header logo 返回首页 → URL 清空、显示 landing。

### Bug #2 — `<html lang>` 挂载时不同步

**改动文件**:
- `src/contexts/LocaleContext.tsx` — 抽 `applyLocaleToDom` 私有 helper
- 新建 `src/contexts/__tests__/LocaleContext.test.tsx`

**关键决策**:
- helper 内部 `if (typeof document !== 'undefined')` 防御 SSR 阶段调用。
- mount effect：savedLocale 命中 → setLocaleState + setTranslations + applyLocaleToDom；未命中 → 仅 applyLocaleToDom(defaultLocale)（防御性同步）。
- `setLocale` 调 helper 替换原 inline。

**测试**（Vitest）:
1. localStorage 预置 `ecliptrix-locale=zh-CN` → mount → `document.documentElement.lang === 'zh-CN'`。
2. localStorage 为空 → mount → `document.documentElement.lang === 'en'`。
3. setLocale('zh-CN') → 切换后 lang 同步。

**手动验证**:
- 选 zh-CN → reload → DevTools 检查 `<html lang>` = `zh-CN`；Edge 翻译插件不再误判中文页为英文。

### Bug #3 — ModelSettingsPanel API Key 不在 form 中

**改动文件**:
- `src/components/AdminSettings/ModelSettingsPanel.tsx`（行 911-1148 整段包入 `<form>`）
- 新建 `src/components/AdminSettings/__tests__/ModelSettingsPanel.form.test.tsx`

**关键决策**（含修正 2）:
- 用 `<form noValidate onSubmit={...}>` 包裹 providerForm 整段。
- onSubmit 内部含 disabled 同等的守卫（`if (savingProvider || !providerForm.name || !providerForm.api_url) return;`），避免回车键绕过 disabled。
- "保存"按钮 type=submit，**移除 onClick={handleSaveProvider}** — 仅由 onSubmit 触发。
- "测试连接"、"获取模型"、"取消"按钮显式 `type="button"`。
- API Key input 加 `autoComplete="new-password"`。

**测试**（Vitest）:
1. 渲染 Add 模式 → 找到 API Key 占位符的 input → `closest('form')` 不为 null。
2. 渲染 Edit 模式（placeholder=`••••••••`）→ 同上。
3. "测试连接"按钮 type === 'button'，不触发表单提交。
4. "保存"按钮 type === 'submit'。
5. fireEvent.submit(form) 时 `handleSaveProvider` 被调一次（mock）；点击 Save 按钮 + dispatchEvent submit 总计仅一次（验证修正 2）。

**手动验证**:
- 打开 Add/Edit Provider 对话框，DevTools 控制台不再出现 `Password field is not contained in a form`；连续点 Save 不会同时打两次保存请求（Network 面板）。

### Bug #4 — ChatTypeSelectionModal 同名工作流 + 0 节点

**改动文件**:
- `src/components/chat/ChatTypeSelectionModal.tsx`（卡片渲染 + 计数 + 排序 + relativeTime helper）
- `src/lib/i18n.ts`（4 个新 key × 三处）
- 新建 `src/components/chat/__tests__/ChatTypeSelectionModal.test.tsx`

**关键决策**（含修正 5）:
- `sortedWorkflows = useMemo(...)` 按 `updated_at desc` 排序，`updated_at` 缺失则用 `created_at`。
- 卡片改 `<button disabled={isEmpty} aria-disabled={isEmpty} title={isEmpty ? hint : undefined}>`，禁用时 className 加 `opacity-50 cursor-not-allowed border-dashed`。
- ID 短缀：`(workflow.workflow_id ?? '').replace(/-/g, '').slice(-6)`，仅当非空才渲染。
- relativeTime helper：英文版（"just now / Nm ago / Nh ago / Nd ago / locale date"），返回 null 时不渲染时间行。
- 计数文案：`emptyCount > 0` 时使用 `workflowsAvailableWithEmpty`。

**i18n 增量**（必须三处全加）:
| 路径 | EN | ZH |
|------|----|----|
| `aiChat.chatTypeModal.emptyWorkflowHint` | `Add nodes to this workflow before using it` | `请先在工作流编辑器中为该工作流添加节点` |
| `aiChat.chatTypeModal.idLabel` | `ID` | `编号` |
| `aiChat.chatTypeModal.updatedAt` | `Updated {time}` | `更新于 {time}` |
| `aiChat.chatTypeModal.workflowsAvailableWithEmpty` | `{count} workflow(s) available · {empty} empty` | `{count} 个工作流可用 · {empty} 个为空` |

**测试**（Vitest）:
1. 给定 3 个工作流（2 个 0 节点 + 1 个 5 节点）：空节点卡片 disabled + aria-disabled。
2. 点击空节点卡片 → onSelectWorkflow mock 不被调用。
3. 点击非空卡片 → 正常调用且参数正确。
4. updated_at 较新者排在前。
5. emptyCount > 0 → 计数文案使用 `workflowsAvailableWithEmpty`。
6. workflow_id 为 `''` → ID 行不渲染（修正 5 守卫验证）。

**手动验证**:
- 在 Workflow 标签创建 3 个空草稿 + 1 个真实工作流；新对话 → 工作流 → 空草稿应灰显且不可点；卡片底部应显示 "·#xxxxxx" + "更新于 X 分钟前"；底部计数为 "{count} 个工作流可用 · {empty} 个为空"。

### Bug #5 — Brainstorm "功能开发中"

**改动文件**:
- `src/components/HomePage/LandingPage.tsx`（features 数组加 comingSoon + 渲染加角标 + 修正 1）
- `src/components/Container.tsx`（行 268-283 brainstorm 兜底加 comingSoonHint 段）
- `src/lib/i18n.ts`（3 个新 key × 三处）
- 新建 `src/components/HomePage/__tests__/LandingPage.brainstorm.test.tsx`

**关键决策**（含修正 1）:
- features 数组中 `brainstorm` 项加 `comingSoon: true` 字段；其余三项隐式 `comingSoon: undefined`。
- 描述用 `t.landing.brainstormingDescPreview` 替代 `t.landing.brainstormingDesc`。
- 卡片 className：`comingSoon` → `opacity-60 cursor-not-allowed`（**不加 pointer-events-none**），`isAuthLoading` → `opacity-60 cursor-wait pointer-events-none`。
- onClick 内部守卫 `if (isComingSoon || isAuthLoading) return;`，不再触发 `handleGetStarted`。
- 角标 `<span>` 自身 `pointer-events-none` 防止它截胡父容器的事件。
- Container.tsx brainstorm 兜底追加一段 `<p className="text-sm text-muted-foreground/80">{t.landing.comingSoonHint}</p>`，不增加跨组件返回按钮（保持轻量；用户用 VerticalTaskbar 关 tab 即可）。

**i18n 增量**（必须三处全加）:
| 路径 | EN | ZH |
|------|----|----|
| `landing.comingSoonBadge` | `Coming Soon` | `即将推出` |
| `landing.comingSoonHint` | `This feature is in development. Stay tuned!` | `该功能正在开发中，敬请期待。` |
| `landing.brainstormingDescPreview` | `Coming soon — a creative ideation workshop for sparking new project concepts` | `即将推出 · 创意构思灵感工坊，为项目激发全新概念` |

**测试**（Vitest）:
1. 渲染 → brainstorm 卡片含 "Coming Soon" 角标文本。
2. 点击 brainstorm 卡片 → onCreateTask mock 不被调用、onLoginRequired 也不被调用。
3. 点击 video 卡片（未登录态）→ onLoginRequired mock 调用一次。
4. brainstorm 卡片含 `aria-disabled="true"` 与 `title` 属性。

**手动验证**:
- 访问首页 → brainstorm 卡显示角标且无法点击；hover **能看到 tooltip "该功能正在开发中..."**（修正 1 验收点）；副本为 "即将推出 · 创意构思灵感工坊"；如果 LS 中已有 brainstorm task（iter1/iter2 用户），编辑器仍显示死胡同但底部有 hint 段。

### Bug #6 — 空时间轴上"导出视频"按钮可点

**改动文件**:
- `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx`（新增 useMemo + button 改造）
- `src/lib/i18n.ts`（1 个新 key × 三处）
- 新建 `src/components/video/components/VideoPlayerPanel/__tests__/exportButton.test.tsx`

**关键决策**（含修正 6）:
- 新增 `hasAnyExportableItem` useMemo 紧邻其他 useMemo 声明。
- button `disabled={videoExport.isExporting || !hasAnyExportableItem}`。
- `title` / `aria-label` 切换；onKeyDown 守卫加 `&& hasAnyExportableItem`。
- **去掉硬编码的 `tabIndex={0}`**（修正 6）— 让 disabled 按钮自动从 Tab 序列移除。

**i18n 增量**:
| 路径 | EN | ZH |
|------|----|----|
| `videoPlayerPanel.export.emptyTimeline` | `Add video, image, or audio materials to the timeline before exporting` | `请先添加视频/图片/音频素材到时间轴后再导出` |

**测试**（Vitest）:
1. 5 条空轨道 → 按钮 disabled。
2. 1 条轨道 + 1 个 item → 按钮启用。
3. `isExporting=true` 即使有 item 也 disabled。
4. Enter 键在空时间轴下不触发 handleVideoExport（mock）。
5. 按钮 disabled 时 `title` 含 emptyTimeline 文案。

**手动验证**:
- 新建项目 → 不加素材 → 顶栏导出按钮置灰 + tooltip；添加一段视频后按钮恢复正常。

---

## 3. 落地顺序与提交建议

```bash
# 0) i18n 增量（共 8 个 key × 三处）— 单独提交，type-check 必须先绿
git add src/lib/i18n.ts
git commit -m "fix(i18n): add iter3 keys for empty-state hints, coming-soon, workflow id (iter3 prep)"

# 1) PR-A 应用初始化（Bug#1 + Bug#2）
git add src/hooks/useTasks.ts src/hooks/__tests__/useTasks.persistence.test.ts \
        src/contexts/LocaleContext.tsx src/contexts/__tests__/LocaleContext.test.tsx
git commit -m "fix(app): persist task state to URL+localStorage and sync html lang on mount (iter3 PR-A)"

# 2) PR-B 表单语义（Bug#3）
git add src/components/AdminSettings/ModelSettingsPanel.tsx \
        src/components/AdminSettings/__tests__/ModelSettingsPanel.form.test.tsx
git commit -m "fix(admin): wrap ModelSettingsPanel provider editor in <form noValidate> (iter3 PR-B)"

# 3) PR-C UX 收紧（Bug#4 + Bug#5）
git add src/components/chat/ChatTypeSelectionModal.tsx \
        src/components/chat/__tests__/ChatTypeSelectionModal.test.tsx \
        src/components/HomePage/LandingPage.tsx \
        src/components/HomePage/__tests__/LandingPage.brainstorm.test.tsx \
        src/components/Container.tsx
git commit -m "fix(chat,landing): differentiate workflows in chat-type modal, gate brainstorm coming-soon (iter3 PR-C)"

# 4) PR-D 防御性 disable（Bug#6）
git add src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx \
        src/components/video/components/VideoPlayerPanel/__tests__/exportButton.test.tsx
git commit -m "fix(video): disable export button on empty timeline with i18n tooltip (iter3 PR-D)"
```

> 与 iter1/iter2 一致，可在 step 4 末尾压成单 commit。**前置条件**：每个 commit 落地后必须跑 `npm run type-check` 和 `npm run test`，全绿才进入下一组。

---

## 4. 手动 smoke 验证清单（dev 服务器 192.168.1.123:3010）

- [ ] **首屏**：localStorage `ecliptrix-locale=zh-CN` → reload → `<html lang>` 为 `zh-CN`（Bug#2）。
- [ ] **首屏**：brainstorm 卡显示 "即将推出" 角标，**hover 能看见 tooltip "该功能正在开发中..."**（修正 1 验收点），点击无效（Bug#5）。
- [ ] **视频编辑**：进入项目 → URL 应含 `?tab=video&task=...` → F5 应保留 BugTest（Bug#1）。
- [ ] **视频编辑**：复制 URL 到无痕窗口 → 登录后跳到对应项目；按 Home logo → URL 清空、回 landing；返回键不退站（Bug#1）。
- [ ] **视频编辑器顶栏**：未加素材时导出按钮置灰 + 鼠标 hover 显示 tooltip；加素材后按钮恢复正常（Bug#6）。
- [ ] **AI 对话**：新对话 → 工作流，多个空草稿应灰显且不可点；卡片应显示 "·#xxxxxx" + "更新于 X" 标签；底部计数为 "{count} 个工作流可用 · {empty} 个为空"（Bug#4）。
- [ ] **管理员设置 → 模型设置 → 添加供应商**：DevTools 控制台无 `Password field is not contained in a form` 警告；连续点 Save 不会同时打两次保存请求（修正 2 验收点，Bug#3）。
- [ ] **回归**：iter1（视频封面 WYSIWYG / a11y / 颜色 hex 校验）、iter2（401 / TTS 校验 / Pydantic / dlog / ProjectCard / dev hint / UserManagement form）一并目视验证，无回归。

---

## 5. 风险与注意事项

| 风险 | 影响 | 缓解 |
|------|-----|-----|
| LS 中存有 v0 schema 数据（实际无此版本） | useTasks 反序列化失败 | try/catch fallback 到空状态 + console.warn；STORAGE_KEY 含 `-v1` 前缀，未来升级直接换 KEY。 |
| URL replaceState 频率高 | 浏览器历史栈无影响（replace 而非 push） | 严格使用 `replaceState`，不污染历史。 |
| `<html lang>` 由 DOM API 修改 | 不触发 React hydration warning | 在 useEffect 中同步，post-hydration。 |
| Provider 表单 onSubmit 误触 | 用户敲 Enter 提交意外保存 | 测试连接 / 取消 / 获取模型按钮均显式 type="button"；onSubmit 内复用 disabled 守卫。 |
| Save 按钮被 onClick + onSubmit 双触发 | 后端创建两次 provider | **修正 2**：移除 onClick，仅由 onSubmit 触发。 |
| 工作流 updated_at 缺失 | 时间标签显示异常 | helper 返回 null 时不渲染。 |
| comingSoon 跳过登录引导 | 未登录用户失去转化机会 | brainstorm 上线前可接受；产品上线时移除 comingSoon 字段。 |
| pointer-events-none 屏蔽 hover tooltip | "Coming Soon" hover tooltip 不显示 | **修正 1**：comingSoon 卡片不加 pointer-events-none，仅靠 onClick 守卫。 |
| 导出按钮门控误差 | items 字段命名变化 | Track.items 已确认为 `TimelineItem[]`（types/index.ts:909）；保留 `?.length` 防御。 |
| useTasks hydration 短暂 flash | F5 后 1-2 帧显示空 landing | 接受；引入 SSR 路由段成本过高。如未来要消除，可改为读取 cookie/header 在 SSR 完成。 |
| LS quota 超限 | 无法持久化 | try/catch 吞掉异常，体验降级到 in-memory。后续可加 task 数量上限（保留最近 50）。 |

---

> **审查人**：Claude（iter3 step 3）
> **完成时间**：2026-05-09
> **HEAD 验证**：6100984
> **下游**：apply（step 4）→ review/commit（step 5）
