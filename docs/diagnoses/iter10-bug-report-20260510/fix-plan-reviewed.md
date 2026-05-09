# Iter10 Bug 修复方案（审查与修正版）

- **日期**: 2026-05-10
- **来源**: `docs/diagnoses/iter10-bug-report-20260510/fix-plan.md` (Step 2 输出)
- **审查阶段**: Step 3 (check and fix issues)
- **目标 Bug**: 5 个 (1×P0, 1×P1, 2×P2, 1×P3)
- **执行时机**: 本文件已确认可直接交付 Step 4 实施。原 fix-plan.md 保留作历史。

---

## 审查结论速览

对 Step 2 的 fix-plan.md 做逐 Bug 代码核对（grep + Read），发现 **3 处必须修正**、**4 处需补强**，原方案技术方向正确但存在以下偏差：

| 序号 | 类别 | 原方案 | 修正后 |
|------|------|--------|--------|
| C-1 | 范围不全 | Bug#1 渲染兜底清单遗漏 `ChatWindow.tsx:280` | **新增** ChatWindow.tsx 到改动清单 |
| C-2 | 重复造轮子 | Bug#2 提议新增 4 个 `t.account.preferences*` i18n key | **改为复用** 已存在的 `t.profile.{savingNote,savedNote,saveErrorNote,autoSaveNote}`（i18n.ts:2908-2911 / 5729-5732） |
| C-3 | 路径错误 | Bug#5 写 `app/routers/video_projects.py` | **实际文件**: `app/routers/video_project_router.py` |
| R-1 | 风险补强 | Bug#2 描述「UI 文案永远不变」 | 实际 OtherSettingsPanel.tsx:234-241 已根据 `status` 切换 4 态文案；**真正缺失**仅是 (a) Bearer 注入 (b) 错误时的 toast |
| R-2 | 健壮性 | Bug#5 collate 失败的 try/except 每次查询都 catch | 改为应用启动时一次性 `SELECT collname FROM pg_collation` 缓存，避免热路径异常 |
| R-3 | 分页一致性 | Bug#5 sort=name 无 tiebreaker | 增加 `VideoProject.id.asc()` 作 secondary order 确保分页稳定 |
| R-4 | 误删兜底 | Bug#4 `replace('{name}', ...)` 仅替换首次出现 | 文案模板中 `{name}` 出现 1 次，OK；但若 i18n 翻译者在 zh-CN 写两处也需替换 — 改用 `replaceAll` 或 `split/join` |

---

## 修复优先级与依赖（沿用）

| 顺序 | Bug | 严重 | 依赖 | 风险 |
|------|------|------|------|------|
| 1 | #1 持久化时间戳 | Critical/P0 | — | 用户每次打开站点即崩溃，必须先修 |
| 2 | #2 偏好设置 401 silent loss | High/P1 | http-client 增加 PATCH | 影响所有偏好/通知/隐私设置 |
| 3 | #3 TTS 跨字段校验 | Medium/P2 | — | 静默 clamp，UX 误导 |
| 4 | #4 删除项目对话框未显示项目名 | Medium/P2-P3 | — | 误删风险 |
| 5 | #5 项目按名称排序 i18n | Medium/P3 | — | 只在 EN locale 下感知，但破坏直觉 |

---

## Bug #1 修复方案 — localStorage 时间戳反序列化（已修正）

### 代码定位（核对后清单）

| 文件 | 行号 | 角色 | 修改类型 |
|------|------|------|----------|
| `src/hooks/useTasks.ts` | 21–29 (`reviveState`) | 顶层 revive 不递归 conversations | 主修复（递归 revive） |
| `src/types/index.ts` | 124-135, 63-88 | `Conversation`/`ChatMessage` 类型 | 不变 |
| `src/components/Container.tsx` | 308 | `activeTask.createdAt.toLocaleDateString()` | 兜底 (formatDate) |
| `src/components/chat/ConversationList.tsx` | 133 | `conversation.updatedAt.toLocaleDateString()` (爆炸点) | 兜底 (formatDate) |
| **`src/components/chat/ChatWindow.tsx`** | **280** | **`conversation.updatedAt.toLocaleTimeString()`（C-1 新发现）** | **兜底 (formatTime)** |
| `src/components/chat/MessageBubble.tsx` | 258 | `message.timestamp.toLocaleTimeString` | 兜底 (formatTime) |
| `src/components/video/components/VideoChatWindow/AgentMessageBubble.tsx` | 84 | 同上 | 兜底 (formatTime) |
| `src/components/video/components/CreativeBrainstormingModal/components/ChatInterface.tsx` | 74 | 同上 | 兜底 (formatTime) |
| `src/components/video/components/CreativeBrainstormingModal/components/ExpertMessage.tsx` | 23, 52 | 同上 | 兜底 (formatTime) |

### 根因（无变化）

`useTasks.ts:21-29` 仅 revive 顶层 `tasks[*].createdAt/updatedAt`，未递归到 `content.conversations[*].{createdAt,updatedAt,messages[*].timestamp}`。`JSON.parse` 把它们留作字符串，调用 `.toLocaleDateString()` / `.toLocaleTimeString()` 抛 `TypeError`，被 React 整页冒泡。

### 修复策略（双层防御）

**Layer 1 (主修复)**: 在 `useTasks.reviveState` 中递归 revive `content.conversations` 与 `messages.timestamp`。

**Layer 2 (深度防御)**: 引入 `src/lib/utils/dateFormat.ts` 工具，所有时间戳渲染位置改用 `formatDate()`/`formatTime()`，对 invalid 输入返回 fallback 字符串而非崩溃。

### 具体修改

#### 1. 新建 `src/lib/utils/dateFormat.ts`

```ts
export const toDate = (
  v: Date | string | number | null | undefined,
): Date | null => {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};

export const formatDate = (
  v: Date | string | number | null | undefined,
  locales?: string | string[],
  options?: Intl.DateTimeFormatOptions,
  fallback = '',
): string => {
  const d = toDate(v);
  return d ? d.toLocaleDateString(locales, options) : fallback;
};

export const formatTime = (
  v: Date | string | number | null | undefined,
  locales?: string | string[],
  options?: Intl.DateTimeFormatOptions,
  fallback = '',
): string => {
  const d = toDate(v);
  return d ? d.toLocaleTimeString(locales, options) : fallback;
};
```

#### 2. 修复 `src/hooks/useTasks.ts:reviveState`（递归 revive）

```ts
const reviveConversation = (c: any) => ({
  ...c,
  createdAt: new Date(c.createdAt),
  updatedAt: new Date(c.updatedAt),
  messages: Array.isArray(c.messages)
    ? c.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
    : [],
});

const reviveTaskContent = (type: TaskType, raw: any): any => {
  if (!raw) return raw;
  if (type === 'chat' && Array.isArray(raw.conversations)) {
    return { ...raw, conversations: raw.conversations.map(reviveConversation) };
  }
  return raw;
};

const reviveState = (raw: PersistedState): AppState => ({
  tasks: (raw.tasks ?? []).map(t => ({
    ...t,
    createdAt: new Date(t.createdAt),
    updatedAt: new Date(t.updatedAt),
    content: reviveTaskContent(t.type, t.content),
  })) as Task[],
  tabs: raw.tabs ?? [],
  activeTabId: raw.activeTabId ?? null,
});
```

> ⚠ 必须保留 `...c` 在前，避免覆盖未来新加字段（如 `chatType`）。

#### 3. 渲染处兜底（每处统一改成 formatDate/formatTime）

```diff
- {conversation.updatedAt.toLocaleDateString()}
+ {formatDate(conversation.updatedAt)}
```

```diff
- {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
+ {formatTime(message.timestamp, undefined, { hour: '2-digit', minute: '2-digit' })}
```

涉及文件：`Container.tsx:308`、`ConversationList.tsx:133`、**`ChatWindow.tsx:280` (C-1 新增)**、`MessageBubble.tsx:258`、`AgentMessageBubble.tsx:84`、`ChatInterface.tsx:74`、`ExpertMessage.tsx:23,52`。

> 注：`WorkflowExecutionMessage.tsx:257` 用的是运行时 `executionState.endTime`（非持久化路径），保持不动。

### 风险与注意事项

- 类型保持不变：`Conversation.createdAt: Date`，下游 TS 不会扩散为 `Date | string`。
- 旧 LS 数据可能缺 `messages` 字段，用 `Array.isArray()` 兜底。
- `formatDate` / `formatTime` 必须**显式接受可选 locales**（避免 SSR 与浏览器不一致），但因 `useTasks` 是 `'use client'` hook，无 SSR 风险。

### 测试

1. **新建** `src/lib/utils/__tests__/dateFormat.test.ts`（≥6 用例）：
   - Date / ISO 字符串 / unix ms 数字 / `null` / `undefined` / 非法字符串 → 期望对应 fallback。
2. **扩展** `src/hooks/__tests__/useTasks.persistence.test.ts`：
   - 写入含 1 chat 任务（含 1 conversation + 1 message）的 LS。
   - mount，断言 `tasks[0].content.conversations[0].updatedAt instanceof Date`、`messages[0].timestamp instanceof Date`。
3. **手测**: 复现 bug-report 步骤 2-5，确认无 Application Error。

---

## Bug #2 修复方案 — 偏好设置 401 静默失败（已修正：复用已有 i18n + UI 文案）

### 代码定位（核对后清单）

| 文件 | 行号 | 角色 | 修改 |
|------|------|------|------|
| `src/lib/api/userPreferences.ts` | 56-62 | `flush()` 用裸 `fetch` + `credentials:'include'` | 改 `http.patch` |
| `src/lib/api/userPreferences.ts` | 94-106 | `fetchUserPreferences` 同样问题 | 改 `http.get` |
| `src/lib/api/userPreferences.ts` | 42 | `useUserPreferencesMutation()` 无 onError | 增加 `{ onError?: (err) => void }` 参数 |
| `src/lib/api/http-client.ts` | 281 | `HttpMethod` 类型缺 `'PATCH'` | 扩 `'PATCH'` |
| `src/lib/api/http-client.ts` | 712-731 | `http` 出口缺 `patch` | 新增 `patch<T>(path, body?, opts?)` |
| `src/components/UserProfile/OtherSettingsPanel.tsx` | 61, 234-241 | 已有 4 态 noteText 切换；**缺**：错误时 toast | `useNotification.showError` + 把 `onError` 传给 hook |

### 根因（更新）

后端通过 `Authorization: Bearer <token>` 鉴权（token 存于 `localStorage.ecliptrix-session-token`），`http-client.ts:328-330` 已注入。`userPreferences.ts` 用裸 `fetch()` + `credentials: 'include'` —— Ecliptrix 不依赖 cookie，请求始终 401，所有偏好被丢弃。

**注：** 原 fix-plan 描述 "UI 文案 永远不变" 不准确：OtherSettingsPanel.tsx:234-241 已正确按 `status` 切换 `savingNote/savedNote/saveErrorNote/autoSaveNote`，但 4 秒后回到 idle，且**没有醒目 toast**，因此用户在快速切换时仍可能错过失败。

### 修复策略

1. **`http-client.ts` 增加 PATCH 支持**（最小改动）。
2. **`userPreferences.ts`** 改用 `http.patch` / `http.get` 享受统一 Bearer 注入和 401 处理。
3. **`useUserPreferencesMutation({ onError })`** 接受可选回调，flush 失败时调用，由 panel 决定如何 toast。
4. **`OtherSettingsPanel.tsx`** 引入 `useNotification`，把 `onError` 传给 hook 弹出 `showError(t.profile.saveErrorNote)`。
5. **复用现有 i18n**：不新增 `t.account.preferences*`；用已存在的 `t.profile.{savingNote,savedNote,saveErrorNote,autoSaveNote}`（i18n.ts:2908-2911 EN, 5729-5732 zh-CN）。

### 具体修改

#### 1. `src/lib/api/http-client.ts`

```diff
- type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
+ type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
```

```diff
  if (method === 'GET' || method === 'DELETE') {
    serializedBody = undefined;
  } else if (bodyIsFormData) {
    serializedBody = body as FormData;
-  } else {
+  } else { // POST | PUT | PATCH
    const effectiveBody = body === undefined ? {} : body;
    serializedBody = JSON.stringify(effectiveBody);
```

```diff
  put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>('PUT', path, body, opts);
  },
+ patch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
+   return request<T>('PATCH', path, body, opts);
+ },
  del<T>(path: string, opts?: RequestOptions): Promise<T> {
```

#### 2. `src/lib/api/userPreferences.ts`

```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { http } from './http-client';

// ... unchanged types ...

interface UseUserPreferencesMutationOpts {
  onError?: (err: unknown) => void;
}

export function useUserPreferencesMutation(opts: UseUserPreferencesMutationOpts = {}) {
  const { onError } = opts;
  const queue = useRef<Partial<UserPreferences>>({});
  const rollbacks = useRef<Array<() => void>>([]);
  const timer = useRef<number | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');

  const flush = useCallback(async () => {
    timer.current = null;
    if (Object.keys(queue.current).length === 0) return;
    setStatus('saving');
    const delta = queue.current;
    const cbs = rollbacks.current;
    queue.current = {};
    rollbacks.current = [];
    try {
      await http.patch('/api/user/me/preferences', delta);
      setStatus('saved');
      window.setTimeout(() => setStatus('idle'), STATUS_FLASH_MS);
    } catch (err) {
      setStatus('error');
      for (let i = cbs.length - 1; i >= 0; i--) {
        try { cbs[i](); } catch { /* ignore */ }
      }
      try { onError?.(err); } catch { /* ignore */ }
      window.setTimeout(() => setStatus('idle'), ERROR_FLASH_MS);
    }
  }, [onError]);

  // ... patch / cleanup unchanged ...
  return { patch, status };
}

export async function fetchUserPreferences(): Promise<UserPreferences | null> {
  try {
    const data = await http.get<{ success?: boolean; preferences?: UserPreferences }>(
      '/api/user/me/preferences',
    );
    return (data?.preferences as UserPreferences) ?? null;
  } catch {
    return null;
  }
}
```

> ⚠ `http.patch` / `http.get` 在未登录时会抛 `MissingAuthError`（不是 HTTP 401）。`flush()` 的 `catch (err)` 已无差别捕获，行为正确。

#### 3. `src/components/UserProfile/OtherSettingsPanel.tsx`

```diff
+ import { useNotification } from '@/contexts/NotificationContext';
  ...
  const { t, locale, setLocale } = useLocale();
+ const { showError } = useNotification();
- const { patch, status } = useUserPreferencesMutation();
+ const { patch, status } = useUserPreferencesMutation({
+   onError: () => showError(t.profile.saveErrorNote),
+ });
```

> 已有的 `noteText`（234-241）继续工作；**不新增 i18n key**。

### 风险与注意事项

- **`MissingAuthError`**：未登录用户切换 toggle 仍会触发请求并抛错，flush 会 setStatus('error') + showError。可接受（提示用户登录），但若发现退出登录后弹 toast 干扰，可在 `onError` 内判断 `err instanceof MissingAuthError` 并静默。
- **并发**：debounce 合并后单次 flush；rollbacks LIFO 顺序仍正确。
- **请求体**：`http.patch` 内部 `JSON.stringify`，与原 `body = JSON.stringify(queue.current)` 等价。
- **fetchUserPreferences 401**：用 `http.get` 时未登录会抛 `MissingAuthError`，被 `catch` 吞掉返回 `null`，与原行为一致。

### 测试

1. **新建** `src/lib/api/__tests__/userPreferences.test.ts`：
   - mock `http.patch` resolve → 断言 `setStatus('saved')`、`onError` 不调用。
   - mock `http.patch` reject → 断言 `setStatus('error')`、rollbacks LIFO 调用、`onError` 调用 1 次。
   - mock `http.get` 抛错 → 断言 `fetchUserPreferences()` 返回 `null`。
2. **手测**：登录态切换通知 → DevTools 应见 `Authorization: Bearer ...` 头 + PATCH 200，noteText 闪现「已保存」后回 idle。
3. **手测**：清空 LS token → 切换 toggle → 应见 `Failed to save — will retry` toast + noteText 显示错误态。

---

## Bug #3 修复方案 — TTS 并发线程数跨字段校验（沿用 Path A，补充小修正）

### 代码定位

| 文件 | 行号 | 角色 |
|------|------|------|
| `src/components/AdminSettings/TTSSettingsPanel.tsx` | 95-96 | `concurrent_threads` (max=10) 与 `max_concurrent_threads` (max=20) 单字段 clamp 无关联 |
| `src/components/AdminSettings/components/SettingsFieldHelpers.tsx` | 26-39 | `commit` 单字段 clamp |
| 后端 PUT `/api/admin/settings/tts` | TBD | 静默 clamp（暂不动；本轮仅前端拦截） |

### 修复策略（Path A：仅前端）

UI 立即拦截，避免后端 silent clamp 被触发。

### 具体修改

`TTSSettingsPanel.tsx`：

```tsx
const concurrentThreads = concurrency.concurrent_threads as number;
const maxConcurrentThreads = concurrency.max_concurrent_threads as number;
const concurrencyInvariantViolated =
  Number.isFinite(concurrentThreads) &&
  Number.isFinite(maxConcurrentThreads) &&
  concurrentThreads > maxConcurrentThreads;
```

```tsx
{/* In Section 1, render hint under concurrent_threads field */}
<div className="space-y-2">
  <NumberField
    label={t.adminSettings.ttsConcurrentThreads}
    value={concurrentThreads}
    onChange={(v) => updateNested('concurrency', 'concurrent_threads', v)}
    min={1}
    max={10}
  />
  {concurrencyInvariantViolated && (
    <p className="text-xs text-destructive">
      {t.adminSettings.ttsConcurrencyInvariantError}
    </p>
  )}
</div>
```

```diff
  <button
    onClick={handleSave}
-   disabled={!isDirty || saving}
+   disabled={!isDirty || saving || concurrencyInvariantViolated}
    className="..."
  >
```

i18n 新增：

```ts
// EN
ttsConcurrencyInvariantError: 'Concurrent threads cannot exceed max concurrent threads.',
// zh-CN
ttsConcurrencyInvariantError: '并发线程数不能超过最大并发线程数。',
```

> 接口 `LocaleStrings.adminSettings.ttsConcurrencyInvariantError: string` 必须同步加入。

### 风险与注意事项

- 不改 `NumberField` 的 max（10/20 维持），因为单字段上限是业务硬限。跨字段约束放在 panel 层。
- 用户可能调低 max 后未改 concurrent → 保存按钮 disabled，错误提示引导用户。**不自动 clamp**（避免误改）。
- 渲染层级：错误 hint 紧贴字段，不阻塞页面交互。

### 测试

1. **新建** `src/components/AdminSettings/__tests__/TTSSettingsPanel.invariant.test.tsx`：
   - render with `concurrent=10, max=5` → 断言 hint 出现、Save 按钮 disabled。
   - render with `concurrent=3, max=10` → 断言 hint 不出现、Save 按钮 enabled (假设 isDirty=true)。
2. **手测**：复现 bug-report 步骤；前端阻止保存。

---

## Bug #4 修复方案 — 删除项目对话框显示项目名（小修正：用 split/join 防重复 placeholder）

### 代码定位

| 文件 | 行号 | 角色 |
|------|------|------|
| `src/components/video/projects/VideoProjectListView.tsx` | 204-219 (`handleDeleteProject`) | 当前 title=`t.videoProjects.delete`、message=`t.videoProjects.deleteConfirm` 无插值 |
| `src/lib/i18n.ts` | 552 (interface) / 3345 (EN) / 6166 (zh-CN) | 静态文案 |
| `src/lib/i18n.ts` | 561 (interface) / 3354 (EN) / 6175 (zh-CN) | `untitled: string` 已存在，可作 fallback |

### 修复策略

i18n 改成带 `{name}` 占位符的模板；JS 端做 60 字符 truncate（防超长名撑爆对话框），用 `split('{name}').join(safeName)` 替代 `replace('{name}', safeName)`，确保翻译者写多处 `{name}` 时全替换；React 自动 escape，无 XSS 风险。

### 具体修改

#### 1. `src/lib/i18n.ts`

接口：

```diff
  /** Confirmation message template (expects "{name}" placeholder). */
  deleteConfirm: string;
+ /** Confirmation dialog title template (expects "{name}" placeholder). */
+ deleteConfirmTitle: string;
```

EN：

```ts
delete: 'Delete',
deleteConfirmTitle: 'Delete "{name}"?',
deleteConfirm: 'You are about to delete project "{name}". This cannot be undone.',
```

zh-CN：

```ts
delete: '删除',
deleteConfirmTitle: '删除 "{name}"？',
deleteConfirm: '即将删除项目 "{name}"，此操作不可撤销。',
```

#### 2. `VideoProjectListView.tsx:204-219`

```ts
const TRUNCATE_AT = 60;
const truncate = (s: string) =>
  s.length > TRUNCATE_AT ? s.slice(0, TRUNCATE_AT) + '…' : s;

// Replace ALL occurrences of {name} (defensive against translator edits).
const interpolate = (template: string, name: string) =>
  template.split('{name}').join(name);

const handleDeleteProject = (project: VideoProjectListItem) => {
  const safeName = truncate(project.name?.trim() || t.videoProjects.untitled);
  setConfirmation({
    title: interpolate(t.videoProjects.deleteConfirmTitle, safeName),
    message: interpolate(t.videoProjects.deleteConfirm, safeName),
    onConfirm: async () => {
      try {
        await deleteVideoProject(project.id);
        setConfirmation(null);
        void fetchProjects();
      } catch (err) {
        console.error('[VideoProjectListView] Delete project failed', err);
        showError(t.videoProjects.saveError);
      }
    },
  });
};
```

### 风险与注意事项

- **React XSS**：React 默认 escape 文本节点，`<img onerror>` 等危险名作纯字符串渲染，无注入。
- **空白名 / 全空格**：用 `project.name?.trim() || untitled` 兜底。
- **i18n 类型**：必须更新 `LocaleStrings.videoProjects` 接口、EN 与 zh-CN 两个对象，type-check 才能过。
- **类似删除流（deleteCategoryConfirm）**：报告未要求；本轮不顺手做，避免范围蔓延。

### 测试

1. **新建** `src/components/video/projects/__tests__/VideoProjectListView.delete.test.tsx`：
   - 渲染列表 + 触发 delete，断言 confirmation message 包含项目名。
   - 项目名 200 字符 → 断言 message 中名字被 truncate 至 60 + `…`。
   - 项目名为空字符串 → 断言显示 `untitled` 占位。
2. **手测**：EN/zh-CN 双 locale 各确认一次。

---

## Bug #5 修复方案 — 项目按名称排序的 i18n collation（已修正：路径 + 启动期 collation 缓存 + tiebreaker）

### 代码定位（修正后）

| 文件 | 行号 | 角色 |
|------|------|------|
| `backend-services/basic-service/app/services/video_project_service.py` | 251-253 | `VideoProject.name.asc()` 用默认 PG collation (`zh_CN.UTF-8`) |
| **`backend-services/basic-service/app/routers/video_project_router.py`** | **132-160** (C-3 路径修正) | `list_video_projects` 端点；缺 `Accept-Language` 解析 |
| `src/lib/api/videoProjects.ts` | TBD | list 调用未注入 locale |

### 修复策略（Path B：按 locale 切换 collation；启动期缓存避免热路径异常）

| 方案 | 原因 |
|------|------|
| ✅ Path B（按 locale 切换 + 白名单） | Ecliptrix 已有前端 locale；Ubuntu 24.04 默认装 `en_US.utf8`/`zh_CN.utf8`；分页/排序仍在 SQL 层；缺失 collation 时回 `"C"` 兜底 |
| ⚠ Path A（统一 `"C"`） | 简单但失去本地化排序，仅作 fallback |
| ❌ Path C（Python 二次排序） | 破坏 SQL 分页 |

### 具体修改

#### 1. `app/services/video_project_service.py`

```python
import logging
from sqlalchemy import collate, text
from sqlalchemy.exc import DBAPIError

logger = logging.getLogger(__name__)

# Whitelist mapping locale prefix → PostgreSQL collation name.
_LOCALE_COLLATIONS: dict[str, str] = {
    "en": "en_US.utf8",
    "zh": "zh_CN.utf8",
}
_FALLBACK_COLLATION = "C"

# Cache populated on first list-with-locale call; avoids per-request try/except.
_available_collations: set[str] | None = None


async def _ensure_collation_cache(db) -> set[str]:
    global _available_collations
    if _available_collations is not None:
        return _available_collations
    try:
        result = await db.execute(text("SELECT collname FROM pg_collation"))
        names = {row[0] for row in result.fetchall()}
    except DBAPIError as err:
        logger.warning("Failed to enumerate pg_collation, falling back to %s only: %s", _FALLBACK_COLLATION, err)
        names = {_FALLBACK_COLLATION}
    _available_collations = names | {_FALLBACK_COLLATION}
    return _available_collations


def _resolve_locale_to_prefix(locale: str | None) -> str | None:
    if not locale:
        return None
    return locale.split(",")[0].split(";")[0].split("-")[0].split("_")[0].strip().lower() or None


async def _resolve_collation(db, locale: str | None) -> str:
    prefix = _resolve_locale_to_prefix(locale)
    desired = _LOCALE_COLLATIONS.get(prefix or "", _FALLBACK_COLLATION)
    available = await _ensure_collation_cache(db)
    return desired if desired in available else _FALLBACK_COLLATION
```

```python
# in list_projects(...):
if sort == "name":
    coll = await _resolve_collation(db, locale)
    # Tiebreaker: id.asc() guarantees stable pagination across calls.
    order = (collate(VideoProject.name, coll).asc(), VideoProject.id.asc())
elif sort == "created":
    order = (VideoProject.created_at.desc(), VideoProject.id.asc())
else:
    order = (
        VideoProject.last_opened_at.desc().nullslast()
        if hasattr(VideoProject.last_opened_at.desc(), "nullslast")
        else VideoProject.last_opened_at.desc(),
        VideoProject.updated_at.desc(),
        VideoProject.id.asc(),
    )
```

> `list_projects` 签名新增 `locale: str | None = None`。

#### 2. `app/routers/video_project_router.py`

```python
from fastapi import Header

@router.get("", response_model=VideoProjectListResponse)
async def list_video_projects(
    category_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort: str = Query("recent", pattern="^(recent|created|name)$"),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    accept_language: Optional[str] = Header(None, alias="Accept-Language"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VideoProjectListResponse:
    user_id = str(current_user.id)
    items, total = await video_project_service.list_projects(
        db=db,
        user_id=user_id,
        category_id=category_id,
        search=search,
        sort=sort,
        limit=limit,
        offset=offset,
        locale=accept_language,
    )
    ...
```

#### 3. `src/lib/api/videoProjects.ts`

list 调用注入 `Accept-Language`；优先级：

1. 已有 `getDefaultHeaders()` → 若现存 helper 设置 Accept-Language，则无需改动。
2. 否则在 list fetch 处加：`headers: { 'Accept-Language': locale === 'zh-CN' ? 'zh-CN' : 'en' }`。

> 后端 `_resolve_locale_to_prefix` 兼容 `'en'`、`'en-US'`、`'zh-CN'`、`'zh-CN,zh;q=0.9'` 等格式。

### 风险与注意事项

- **collation 不存在**：启动期缓存可避免每请求异常；缺失则回 `"C"`，行为退化但不崩溃。
- **分页一致性**：增加 `id.asc()` tiebreaker 保证 (limit/offset) 跨请求稳定。
- **SQL 注入**：collation 名来自 `_LOCALE_COLLATIONS` 白名单 + 启动期 `pg_collation` 校验，**不接受用户原始字符串**。
- **SQLite tests**：单元层只测 `_resolve_locale_to_prefix` / `_resolve_collation` 的逻辑（mock pg_collation）；collate 行为留给 PostgreSQL 集成测试，**不强求** SQLite 跑通。
- **缓存失效**：`_available_collations` 缓存仅在进程生命周期内有效；DB 层 collation 重启后会重新枚举，符合期望。

### 测试

1. **新建** `backend-services/basic-service/tests/test_video_project_service_collation.py`：
   - `_resolve_locale_to_prefix('en') == 'en'`
   - `_resolve_locale_to_prefix('zh-CN,zh;q=0.9') == 'zh'`
   - `_resolve_locale_to_prefix(None) is None`、`_resolve_locale_to_prefix('') is None`
   - `_resolve_locale_to_prefix('fr') == 'fr'`（但 `_resolve_collation` 会落 `'C'`）
   - mock `_ensure_collation_cache` 返回 `{'C'}` → `_resolve_collation` 任意 locale 都返回 `'C'`
   - mock `{'C', 'en_US.utf8', 'zh_CN.utf8'}` → en→en_US.utf8, zh→zh_CN.utf8, fr→C
2. **手测（PostgreSQL）**：种子 `['BugTest', 'PaddedName', '华强', '小狗', '撒地方']`：
   - `Accept-Language: en` → 期望 `BugTest, PaddedName, 华强, 小狗, 撒地方`（ASCII 在前）
   - `Accept-Language: zh-CN` → 期望 pinyin 序（`华强, 撒地方, 小狗`）
3. **回归**：未传 `Accept-Language` 头 → 落 `"C"`，与启动期 collation 缺失时同行为。

---

## 跨 Bug 通用注意事项

1. **类型检查**：i18n 接口（`LocaleStrings`）每加 1 key 必须同时在 EN 与 zh-CN 对象中实现，否则 `npm run type-check` 失败。本轮新增：
   - `videoProjects.deleteConfirmTitle`（Bug #4）
   - `adminSettings.ttsConcurrencyInvariantError`（Bug #3）
   - `videoProjects.deleteConfirm` 文案变模板（Bug #4）
2. **不要扩大改动**：本轮严格只修这 5 个 Bug。
3. **commit prefix**：按 CLAUDE.md 用 `[fix]`。
4. **DB 迁移**：本轮不涉及新字段，无需 alembic 新迁移。
5. **测试基线**：每个 Bug ≥ 1 单元/集成测试 + 1 次手测，证据落 `.web-debugger/iter10-step3/` 或 `.web-debugger/iter10-step4/`。

## 提交节奏建议

- **建议合一次 commit**（沿用前几轮 iter 风格 `fix: harden ... iter10`），保持 PR 体量可读。
- 如需拆分：`#1 → #2 → #3+#4 → #5` 顺序。

---

## 输出文件清单（Step 4 实施时使用）

### 新建（5 个）
- `src/lib/utils/dateFormat.ts`
- `src/lib/utils/__tests__/dateFormat.test.ts`
- `src/lib/api/__tests__/userPreferences.test.ts`（Bug #2）
- `src/components/AdminSettings/__tests__/TTSSettingsPanel.invariant.test.tsx`
- `src/components/video/projects/__tests__/VideoProjectListView.delete.test.tsx`
- `backend-services/basic-service/tests/test_video_project_service_collation.py`

### 修改（前端 ~13 个）
- `src/hooks/useTasks.ts` — reviveState 递归
- `src/hooks/__tests__/useTasks.persistence.test.ts` — 扩展测试
- `src/components/Container.tsx` — formatDate
- `src/components/chat/ConversationList.tsx` — formatDate
- `src/components/chat/ChatWindow.tsx` — formatTime（**C-1 新增**）
- `src/components/chat/MessageBubble.tsx` — formatTime
- `src/components/video/components/VideoChatWindow/AgentMessageBubble.tsx`
- `src/components/video/components/CreativeBrainstormingModal/components/ChatInterface.tsx`
- `src/components/video/components/CreativeBrainstormingModal/components/ExpertMessage.tsx`
- `src/lib/api/http-client.ts` — `'PATCH'` + `http.patch`
- `src/lib/api/userPreferences.ts` — `http.patch/get` + onError
- `src/components/UserProfile/OtherSettingsPanel.tsx` — `useNotification` + `onError: showError`
- `src/components/AdminSettings/TTSSettingsPanel.tsx` — cross-field invariant
- `src/components/video/projects/VideoProjectListView.tsx` — interpolate name
- `src/lib/i18n.ts` — `videoProjects.deleteConfirmTitle` + `videoProjects.deleteConfirm` 模板 + `adminSettings.ttsConcurrencyInvariantError`
- `src/lib/api/videoProjects.ts` — list 注入 `Accept-Language`

### 修改（后端 2 个）
- `backend-services/basic-service/app/services/video_project_service.py` — collate + 缓存 + tiebreaker
- `backend-services/basic-service/app/routers/video_project_router.py` — Header 解析

### 总规模估计
- ~14 src 文件修改 / ~5 测试文件新建 / ~2 后端文件修改
- 约 280-380 LOC 修改 / 220 LOC 测试

---

## 审查签字

- 已逐 Bug 核对 fix-plan.md 与实际代码（`useTasks.ts`、`userPreferences.ts`、`http-client.ts`、`OtherSettingsPanel.tsx`、`TTSSettingsPanel.tsx`、`VideoProjectListView.tsx`、`video_project_router.py`、`video_project_service.py`、`i18n.ts`）
- 修正 3 处必须改动（C-1/C-2/C-3）+ 4 处补强（R-1/R-2/R-3/R-4）
- 方案技术正确性、代码质量、副作用、完整性已确认
- **可直接交付 Step 4 实施**
