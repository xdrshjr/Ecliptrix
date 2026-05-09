# Iter10 Bug 修复方案

- **日期**: 2026-05-10
- **来源 Bug 报告**: `docs/diagnoses/iter10-bug-report-20260510/bug-report.md`
- **修复阶段**: Step 2 (代码探索 + 修复方案)
- **目标 Bug**: 5 个 (1×P0, 1×P1, 2×P2, 1×P3)

## 修复优先级与依赖

| 顺序 | Bug | 严重 | 依赖 | 风险 |
|------|------|------|------|------|
| 1 | #1 持久化时间戳 | Critical/P0 | — | 用户每次打开站点即崩溃，必须先修 |
| 2 | #2 偏好设置 401 silent loss | High/P1 | http-client 增加 PATCH | 影响所有偏好/通知/隐私设置 |
| 3 | #3 TTS 跨字段校验 | Medium/P2 | — | 静默 clamp，UX 误导 |
| 4 | #4 删除项目对话框未显示项目名 | Medium/P2-P3 | — | 误删风险 |
| 5 | #5 项目按名称排序 i18n | Medium/P3 | — | 只在 EN locale 下感知，但破坏直觉 |

5 个 Bug 之间无相互依赖，可并行修复。建议提交顺序按上述严重程度递减以利于 review。

---

## Bug #1 修复方案 — localStorage 时间戳反序列化

### 代码定位

| 文件 | 行号 | 角色 |
|------|------|------|
| `src/hooks/useTasks.ts` | 21–29 (`reviveState`) | 持久化恢复入口；只 revive 顶层 `tasks[*].createdAt/updatedAt`，不递归到 `content.conversations[*]` 与 `messages[*]` |
| `src/types/index.ts` | 124–135 (`Conversation`) | 标注 `createdAt: Date`、`updatedAt: Date` |
| `src/types/index.ts` | 63–80 (`ChatMessage`) | 标注 `timestamp: Date` |
| `src/components/Container.tsx` | 308 | `activeTask.createdAt.toLocaleDateString()` (顶层任务，已 revive，但仍要防御) |
| `src/components/chat/ConversationList.tsx` | 133 | `conversation.updatedAt.toLocaleDateString()` (未 revive，**爆炸点**) |
| `src/components/chat/MessageBubble.tsx` | 258 | `message.timestamp.toLocaleTimeString(...)` (未 revive，潜在爆炸点) |
| `src/components/video/components/VideoChatWindow/AgentMessageBubble.tsx` | 84 | 同上 |
| `src/components/video/components/CreativeBrainstormingModal/components/ChatInterface.tsx` | 74 | 同上 |
| `src/components/video/components/CreativeBrainstormingModal/components/ExpertMessage.tsx` | 23, 52 | 同上 |

### 根因

`useTasks.ts:21-29` 仅对 `tasks[*].createdAt/updatedAt` 做 `new Date(...)` 转换：

```ts
const reviveState = (raw: PersistedState): AppState => ({
  tasks: (raw.tasks ?? []).map(t => ({
    ...t,
    createdAt: new Date(t.createdAt),
    updatedAt: new Date(t.updatedAt),
  })) as Task[],
  ...
});
```

但 `Task.content` 对于 `chat` 类型实际是 `ChatTaskContent`，包含 `conversations: Conversation[]`，每个 conversation 又含 `messages: ChatMessage[]`，三个地方都有 `Date` 字段。`JSON.parse` 把它们反序列化为字符串，调用方直接 `.toLocaleDateString()` / `.toLocaleTimeString()` 就抛 `TypeError`，被 React 沿组件树冒泡为整页 Application Error。

### 修复策略（双层防御）

**Layer 1 (主修复)**: 在 `useTasks.reviveState` 中递归 revive `content.conversations` 与 `messages.timestamp`。

**Layer 2 (深度防御)**: 引入 `src/lib/utils/dateFormat.ts` 工具，所有渲染时间戳的位置改用容错 `formatDate()` / `formatTime()`，保证未来若再有未 revive 的 Date 字段也不会崩溃。

### 具体修改

#### 1. 新建 `src/lib/utils/dateFormat.ts`

```ts
// Tolerant Date|string|number → Date adapter; never throws on bad input.
export const toDate = (v: Date | string | number | null | undefined): Date | null => {
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
import type { ChatTaskContent, Conversation, ChatMessage, Task } from '@/types';

const reviveConversation = (c: any): Conversation => ({
  ...c,
  createdAt: new Date(c.createdAt),
  updatedAt: new Date(c.updatedAt),
  messages: Array.isArray(c.messages)
    ? c.messages.map((m: any) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      }))
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

注意：旧 LS 数据可能缺 `chatType` 等字段，revive 必须保留 `...c` spread 顺序在前，避免覆盖新字段。

#### 3. 渲染处兜底

为防御未来其他持久化路径（例如直接读 LS 字符串）再出问题，所有时间戳渲染用兜底工具：

```diff
- {conversation.updatedAt.toLocaleDateString()}
+ {formatDate(conversation.updatedAt)}
```

涉及文件：`Container.tsx:308`、`ConversationList.tsx:133`、`MessageBubble.tsx:258`、`AgentMessageBubble.tsx:84`、`ChatInterface.tsx:74`、`ExpertMessage.tsx:23,52`。

### 风险与注意事项

- **类型保持不变**：`Conversation.createdAt` 仍是 `Date`，无需修改 `types/index.ts`。这样下游 TS 类型不会扩散到 `Date | string`。
- **空消息数组**：旧数据可能没有 `messages` 字段，用 `Array.isArray()` 兜底。
- **WorkflowChatInterface.tsx:392/516** 已经主动 `new Date(message.timestamp)`，无需改动 — 但保留作为我们方案"渲染处兜底"的先例。

### 测试建议

1. **单元测试** (`src/hooks/__tests__/useTasks.persistence.test.ts` 已有持久化测试，扩展)：
   - 写入含 `chat` 任务的 LS（含至少 1 条 conversation + 1 条 message）
   - mount `useTasks`，断言 `tasks[0].content.conversations[0].updatedAt instanceof Date`
   - 断言 `tasks[0].content.conversations[0].messages[0].timestamp instanceof Date`
2. **单元测试** `src/lib/utils/__tests__/dateFormat.test.ts`：验证 `formatDate/formatTime` 接受 Date / 字符串 / 数字 / null，对 invalid 返回 fallback。
3. **手测（dev 服务器）**: 复现报告中的步骤 2-5，确认不再出现 Application Error。

---

## Bug #2 修复方案 — 偏好设置 401 静默失败

### 代码定位

| 文件 | 行号 | 角色 |
|------|------|------|
| `src/lib/api/userPreferences.ts` | 56-62 | `flush()` 用裸 `fetch` + `credentials: 'include'`，未注入 Bearer |
| `src/lib/api/userPreferences.ts` | 96-99 | `fetchUserPreferences` 同样问题 |
| `src/lib/api/userPreferences.ts` | 66-73 | `catch` 块不抛 toast，只 setStatus('error') 短暂 4 秒 |
| `src/lib/api/http-client.ts` | 712-731 (`http`) | 仅有 `get/post/put/del/upload`，无 `patch` |
| `src/lib/api/http-client.ts` | 281, 283-330 | `request<T>` 已支持任意 HttpMethod 风格的处理，但 `HttpMethod` 类型未含 `'PATCH'` |

### 根因

后端通过 `Authorization: Bearer <token>` 鉴权（token 存于 `localStorage.ecliptrix-session-token`），`http-client.ts:328-330` 已正确注入。`userPreferences.ts` 使用裸 `fetch()` 完全绕过这套机制，仅传 `credentials: 'include'` —— 但 Ecliptrix 不依赖 cookie，这导致请求始终 401。错误处理只在内部状态里 setStatus('error') 并在 4 秒后回到 'idle'，**UI 文案 "更改会自动保存。" 永远不变**，是典型的 silent data loss。

### 修复策略

1. 在 `http-client.ts` 增加 `patch` 方法，扩展 `HttpMethod` 类型（最小代码改动，集中复用现有 401 / 重定向 / Bearer 注入逻辑）。
2. 在 `userPreferences.ts` 改用 `http.patch` / `http.get`，让其享受统一鉴权。
3. PATCH 失败时通过 `useNotification.showError` toast 显式告知用户「保存失败」。
4. 在状态文案中区分 `idle/saving/saved/error` 四种状态（错误时显示「保存失败 — 已恢复上次设置」而非「更改会自动保存」）。

### 具体修改

#### 1. `src/lib/api/http-client.ts`

```diff
- type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
+ type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
```

```ts
// inside `request()` body normalization branch — same logic for PATCH as POST/PUT
} else if (method === 'GET' || method === 'DELETE') {
  serializedBody = undefined;
} else { // POST | PUT | PATCH
  ...
}
```

补充 `http` 出口：

```ts
export const http = {
  get<T>(path, opts?) { return request<T>('GET', path, undefined, opts); },
  post<T>(path, body?, opts?) { return request<T>('POST', path, body, opts); },
  put<T>(path, body?, opts?) { return request<T>('PUT', path, body, opts); },
  patch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>('PATCH', path, body, opts);
  },
  del<T>(path, opts?) { return request<T>('DELETE', path, undefined, opts); },
  upload<T>(...) { ... },
  stream(...) { ... },
};
```

#### 2. `src/lib/api/userPreferences.ts`

```ts
import { http, ApiError } from './http-client';

// fetchUserPreferences
export async function fetchUserPreferences(): Promise<UserPreferences | null> {
  try {
    const data = await http.get<{ success?: boolean; preferences?: UserPreferences }>(
      '/api/user/me/preferences',
    );
    return data?.preferences ?? null;
  } catch {
    return null;
  }
}

// flush() PATCH
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
    onError?.(err); // ← 新增 callback，由调用方 toast
    window.setTimeout(() => setStatus('idle'), ERROR_FLASH_MS);
  }
}, [onError]);
```

新增 hook 参数：`useUserPreferencesMutation({ onError })`，让 `OtherSettingsPanel` 在错误时调用 `showError`：

```ts
const { showError } = useNotification();
const { patch, status } = useUserPreferencesMutation({
  onError: () => showError(t.account.preferencesSaveError),
});
```

#### 3. UI 状态文案分支

`OtherSettingsPanel.tsx`（或对应的 status 字幕渲染处）：

```tsx
{status === 'error'
  ? t.account.preferencesSaveError    // 「保存失败 — 已恢复上次设置」
  : status === 'saving'
  ? t.account.preferencesSaving       // 「保存中…」
  : status === 'saved'
  ? t.account.preferencesSaved        // 「已保存」
  : t.account.preferencesAutoSave}    // 「更改会自动保存。」
```

i18n 增加 4 个 key（中英双语）。

### 风险与注意事项

- **MissingAuthError**：`http.patch` 在未登录时会抛 `MissingAuthError` 而不是 `HTTP 401`。`flush()` 的 `catch (err)` 已经 catch any，所以无影响。
- **并发**：调用方多次 `patch(opts)` 会被 debounce 合并，行为不变。
- **请求体**：`http.patch` 接受 unknown body 然后 `JSON.stringify`，与原 `body = JSON.stringify(queue.current)` 等价。
- **测试 fixtures**：现有 `__tests__/userPreferences.test.ts`（如果有）需要把 `fetch` mock 替换为 `http` mock。

### 测试建议

1. 单元测试：mock `http.patch` 抛错，断言 `setStatus('error')` 被调用且 `onError` 被触发。
2. 单元测试：mock `http.get` 返回 200 数据，断言返回值正确解构。
3. 手测：登录后切换通知 switch，DevTools Network 应见 `Authorization: Bearer ...` 头，PATCH 200，状态条应短暂显示「已保存」后回到 idle。
4. 手测：手动清空 localStorage 中 token，触发 PATCH，应看到错误 toast 与「保存失败」文案。

---

## Bug #3 修复方案 — TTS 并发线程数跨字段校验

### 代码定位

| 文件 | 行号 | 角色 |
|------|------|------|
| `src/components/AdminSettings/TTSSettingsPanel.tsx` | 95-96 | `concurrent_threads` (max=10) 与 `max_concurrent_threads` (max=20) 用同一 `NumberField` 但无关联校验 |
| `src/components/AdminSettings/components/SettingsFieldHelpers.tsx` | 26-39 (`commit`) | 单字段 clamp，无跨字段意识 |
| `backend-services/basic-service/app/routers/system_settings.py` (TTS PUT 端点) | TBD | 静默 clamp（待二次验证；UI 修复后此项变为 defense-in-depth） |

### 根因

UI 仅做单字段 `min/max` clamp，不感知 `concurrent_threads ≤ max_concurrent_threads` 这条业务约束。即使 `NumberField` 把输入 999 clamp 到 10，用户仍能将 `max_concurrent_threads` 调到 5 同时保留 `concurrent_threads=10`，使 PUT 后端时违反约束。后端目前是静默 clamp + 200 OK，前端没有任何反馈。

### 修复策略

**前端立即拦截 + 服务端 warning 透传** 双层方案：

1. **前端**：在 `TTSSettingsPanel` 内派生 `concurrentExceedsMax = concurrent_threads > max_concurrent_threads`：
   - 在 `concurrent_threads` 字段下展示红色错误 hint（i18n key `ttsConcurrencyInvariantError`）
   - 禁用「保存」按钮直至修复
   - 联动：调高 `max_concurrent_threads` 时若 `concurrent_threads > max`，要么 disable，要么提示
2. **服务端**：保留 clamp 行为（兼容旧客户端），但响应体增加 `warnings: string[]` 字段。前端 `useSettingsPanel.saveSettings` 检测 warnings 并 toast。
   - 注意：服务端改动可能影响其他 settings 端点的响应 shape；如果要降低风险，本轮可仅做前端拦截，服务端透传留 follow-up（推荐 **Path A：仅前端拦截**）。

### 具体修改（Path A — 仅前端）

`TTSSettingsPanel.tsx`：

```tsx
const concurrent = concurrency.concurrent_threads as number;
const maxConcurrent = concurrency.max_concurrent_threads as number;
const concurrencyInvariantViolated =
  Number.isFinite(concurrent) &&
  Number.isFinite(maxConcurrent) &&
  concurrent > maxConcurrent;

// In Section 1, render hint under concurrent_threads
<NumberField label={t.adminSettings.ttsConcurrentThreads} ... />
{concurrencyInvariantViolated && (
  <p className="text-xs text-destructive ml-auto">
    {t.adminSettings.ttsConcurrencyInvariantError}
  </p>
)}

// Save button disabled when violated
<button onClick={handleSave} disabled={!isDirty || saving || concurrencyInvariantViolated} ...>
```

i18n 新增（中英）：

```ts
ttsConcurrencyInvariantError: 'Concurrent threads cannot exceed max concurrent threads.',
ttsConcurrencyInvariantError: '并发线程数不能超过最大并发线程数。',
```

### 风险与注意事项

- **不要在 `NumberField` 改 max**：单字段 max 应保留为 10/20，因为「max_concurrent_threads」业务上限是 20，「concurrent_threads」业务上限取决于另一字段。把校验放在 panel 层级而不是组件层级。
- **若用户先调低 max 再保存**：当前流程下，调低 max 时 concurrent 没自动跟随。修复方案应允许用户手动改任一字段使约束成立 (而非自动 clamp，避免误改)。

### 测试建议

1. 单元测试 `TTSSettingsPanel`: 设置 concurrent=10, max=5, 断言保存按钮 disabled、错误提示出现。
2. 单元测试: 设置 concurrent=3, max=10, 断言保存按钮 enabled、错误提示不出现。
3. 手测：复现报告步骤；前端应阻止保存。

---

## Bug #4 修复方案 — 删除项目对话框显示项目名

### 代码定位

| 文件 | 行号 | 角色 |
|------|------|------|
| `src/components/video/projects/VideoProjectListView.tsx` | 204-219 (`handleDeleteProject`) | 当前 title=`t.videoProjects.delete`、message=`t.videoProjects.deleteConfirm`，无项目名插值 |
| `src/lib/i18n.ts` | 3344-3345 / 6166 | 静态文案「Delete this project? This cannot be undone.」/「确认删除该项目？此操作不可撤销。」 |
| `src/lib/i18n.ts` | 552 (interface) | `deleteConfirm: string;` |

### 根因

UI 直接传静态字符串，未做模板插值，对话框是模态遮蔽底部卡片。

### 修复策略

把 `deleteConfirm` 改为带占位符的模板，传入项目名时做 truncate（防止超长名/特殊字符把对话框撑爆），并对名做 React 的自动 escape（无需额外 sanitize，React 默认安全）。

### 具体修改

#### 1. `src/lib/i18n.ts`（接口）

```diff
- deleteConfirm: string;
+ deleteConfirm: string;          // template, expects "{name}" placeholder
+ deleteConfirmTitle: string;     // e.g. 'Delete "{name}"?'
```

实现（EN）：

```ts
delete: 'Delete',
deleteConfirmTitle: 'Delete "{name}"?',
deleteConfirm: 'You are about to delete project "{name}". This cannot be undone.',
```

实现（zh-CN）：

```ts
delete: '删除',
deleteConfirmTitle: '删除"{name}"？',
deleteConfirm: '即将删除项目"{name}"，此操作不可撤销。',
```

#### 2. `VideoProjectListView.tsx:204-219`

```ts
const TRUNCATE_AT = 60;
const truncate = (s: string) =>
  s.length > TRUNCATE_AT ? s.slice(0, TRUNCATE_AT) + '…' : s;

const handleDeleteProject = (project: VideoProjectListItem) => {
  const safeName = truncate(project.name || t.videoProjects.untitled);
  setConfirmation({
    title: t.videoProjects.deleteConfirmTitle.replace('{name}', safeName),
    message: t.videoProjects.deleteConfirm.replace('{name}', safeName),
    onConfirm: async () => { ... },
  });
};
```

### 风险与注意事项

- **JSX/React escape**：React 自动 escape 文本节点，所以 XSS 名（如 `<img onerror>`）会作为字符串渲染，不会触发 XSS。无需 `dangerouslySetInnerHTML`。
- **空白名**：`project.name` 为空时回退 `untitled`。
- **i18n 双语**：必须同步更新 `LocaleStrings` interface 与两个语言对象，否则 type-check 会爆。
- **类似删除流（deleteCategoryConfirm 同样泛化）**：可在同一 PR 一并修复，但报告未要求；建议本轮专注 project 删除。

### 测试建议

1. 单元测试：渲染 `VideoProjectListView`，trigger delete，断言 confirmation message 包含项目名。
2. 单元测试：项目名超长（200 字符），断言 message 中名字被 truncate 至 60 + `…`。
3. 手测：确认 EN/zh-CN 两 locale 下文案均正确插值。

---

## Bug #5 修复方案 — 项目按名称排序的 i18n collation

### 代码定位

| 文件 | 行号 | 角色 |
|------|------|------|
| `backend-services/basic-service/app/services/video_project_service.py` | 251-253 | `VideoProject.name.asc()` 落到 PostgreSQL 默认 collation (`zh_CN.UTF-8`) |

### 根因

PostgreSQL 列默认按数据库 collation 排序，dev/prod 数据库均为 `zh_CN.UTF-8`，导致 pinyin 顺序 + ASCII 落在 CJK 之后。EN locale 用户无法理解为什么 BugTest 在最后。

### 修复策略

需要权衡三种方案：

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. 在 SQL 用 `COLLATE "C"` (codepoint) | 行为可预测、跨 locale 一致 | EN/zh 用户都失去本地化排序 |
| B. 按请求 `Accept-Language` / 显式 `locale` 参数切换 collation (`COLLATE "en_US.utf8"` / `"zh_CN.utf8"`) | 行为最贴近用户预期 | 增加端到端 i18n 链路、依赖 OS locale 安装 |
| C. SQL 取出后 Python `localeCompare` 风格二次排序（`PyICU` 或 `locale.strxfrm`） | 不依赖数据库 collation 安装 | 分页正确性受影响（必须在 SQL 层 LIMIT 之前完成排序） |

**推荐 Path B（按 locale 切换 collation）**，回退 Path A 兜底。理由：
- Ecliptrix 已有 `Accept-Language` / 前端 `language` 偏好，数据库收得到。
- 生产/dev 数据库通常已安装 `en_US.utf8` 与 `zh_CN.utf8` (Ubuntu 24.04 默认)。
- 分页与排序仍在 SQL，性能/正确性最佳。
- 若运行环境 collation 缺失，回落 `"C"` 兜底可避免崩溃。

### 具体修改

#### 1. 端点接受 `accept_language` / `locale`

`backend-services/basic-service/app/routers/video_projects.py` 的 list 端点新增 `Header(alias="Accept-Language")` 解析（或前端 `?locale=en` 查询参数），传递给 service。

#### 2. `video_project_service.py`

```python
from sqlalchemy import collate

_SAFE_COLLATIONS = {
    'en': 'en_US.utf8',
    'zh': 'zh_CN.utf8',
}

def _resolve_collation(locale: str | None) -> str:
    if not locale:
        return 'C'
    head = locale.split('-')[0].split('_')[0].lower()
    return _SAFE_COLLATIONS.get(head, 'C')

# in list_projects()
if sort == "name":
    coll = _resolve_collation(locale)
    order = (collate(VideoProject.name, coll).asc(),)
```

注意：`collate()` 在 SQLAlchemy 中产生 `name COLLATE "en_US.utf8"`，PostgreSQL 仅支持已安装的 collation；缺失会抛运行时错误。**必须用 try/except 兜底回 `"C"`**：

```python
async def _list_with_safe_collation(self, db, stmt, fallback_stmt):
    try:
        return (await db.execute(stmt)).scalars().all()
    except DBAPIError as err:
        if 'collation' in str(err).lower():
            return (await db.execute(fallback_stmt)).scalars().all()
        raise
```

或更简单：在 service init 时一次性 `SELECT collname FROM pg_collation` 缓存可用 collation，资源用前校验，避免每次 try/except。

#### 3. 前端

list 接口已有 `locale` 上下文，在调用 `videoProjectsApi.list(...)` 时注入 `Accept-Language: <currentLocale>` 头。如果选择 `?locale=en` 形式，在 `src/lib/api/videoProjects.ts` 拼 query。

### 风险与注意事项

- **Collation 不存在**：必须有 fallback。Singapore-01 prod (Ubuntu 24.04) 默认包含 `en_US.utf8`/`zh_CN.utf8`，dev (192.168.1.123) 同上。
- **分页一致性**：locale 不同的两个请求会得到不同顺序，前端切换 locale 后必须重置分页 offset 至 0。
- **SQL 注入**：collation 名来自白名单 `_SAFE_COLLATIONS`，不接受用户原始字符串，安全。
- **测试在 SQLite 内存库不可行**：Bug #5 的测试只能在 PostgreSQL 集成测试中跑；单元测试可只断言 `_resolve_collation('en') == 'en_US.utf8'`、`_resolve_collation(None) == 'C'`。

### 测试建议

1. 单元测试：`_resolve_collation('en') == 'en_US.utf8'`、`_resolve_collation('zh-CN') == 'zh_CN.utf8'`、`_resolve_collation(None) == 'C'`、`_resolve_collation('fr') == 'C'`。
2. 集成测试（PostgreSQL）：种子项目 `['BugTest', '华强', '小狗', 'PaddedName', '撒地方']`，用 locale=en 请求，断言顺序 `BugTest, PaddedName, 华强, 小狗, 撒地方`（ASCII 在前 + CJK codepoint 升序），用 locale=zh 请求 → `BugTest, PaddedName, 华强, 撒地方, 小狗` 或 pinyin 序。
3. 手测：dev 切 EN locale 后访问列表，验证 ASCII 排在前面。

---

## 跨 Bug 通用注意事项

1. **类型检查**：i18n 接口（`LocaleStrings`）必须在 `src/lib/i18n.ts` 同时增加新键，否则 `npm run type-check` 失败；EN 与 zh-CN 两个对象都要更新。
2. **不要扩大改动**：本轮严格只修这 5 个 Bug，不顺手做 cleanup（避免回归）。
3. **commit prefix**：按 CLAUDE.md 约定使用 `[fix]`。
4. **DB 迁移**：本轮不涉及新字段，无需 alembic 新迁移。
5. **后端环境状态**：dev 后端的 alembic stamp 已手动同步（见 bug-report 顶部记录），本轮不涉及 schema 调整。
6. **测试基线**：每个 Bug 至少 1 个单元/集成测试 + 1 次手测，落到证据目录 `.web-debugger/iter10-step3/`。

## 提交节奏建议

- **PR 1**: Bug #1（dateFormat 工具 + reviveState 递归） — 最高优先级，独立提交便于 cherry-pick 到 hotfix 分支
- **PR 2**: Bug #2（http.patch + userPreferences 重写 + toast）
- **PR 3**: Bugs #3 + #4（前端独立 UI 修复，关联度低但都是小改动）
- **PR 4**: Bug #5（后端 collation + 前端 locale 注入）

也可合并为一次 commit（沿用前几轮的 iter 方式），保持「fix: harden ... iter10」commit message style。

---

## 输出文件清单（预期 Step 3 修改）

### 新建
- `src/lib/utils/dateFormat.ts`
- `src/lib/utils/__tests__/dateFormat.test.ts`
- `src/components/AdminSettings/__tests__/TTSSettingsPanel.invariant.test.tsx`
- `src/components/video/projects/__tests__/VideoProjectListView.delete.test.tsx`
- `backend-services/basic-service/tests/test_video_project_service_collation.py`

### 修改
- `src/hooks/useTasks.ts`（reviveState 递归）
- `src/hooks/__tests__/useTasks.persistence.test.ts`（添加 conversation revive 测试）
- `src/components/Container.tsx`（formatDate）
- `src/components/chat/ConversationList.tsx`（formatDate）
- `src/components/chat/MessageBubble.tsx`（formatTime）
- `src/components/video/components/VideoChatWindow/AgentMessageBubble.tsx`（formatTime）
- `src/components/video/components/CreativeBrainstormingModal/components/ChatInterface.tsx`
- `src/components/video/components/CreativeBrainstormingModal/components/ExpertMessage.tsx`
- `src/lib/api/http-client.ts`（加 PATCH + http.patch）
- `src/lib/api/userPreferences.ts`（http.patch + onError）
- 偏好设置面板（toast on error，状态文案）— 待定位 `OtherSettingsPanel`
- `src/components/AdminSettings/TTSSettingsPanel.tsx`（cross-field invariant）
- `src/components/video/projects/VideoProjectListView.tsx`（项目名插值）
- `src/lib/i18n.ts`（4 处 key：account.preferences*, adminSettings.ttsConcurrencyInvariantError, videoProjects.deleteConfirmTitle, videoProjects.deleteConfirm template）
- `backend-services/basic-service/app/services/video_project_service.py`（collate）
- `backend-services/basic-service/app/routers/video_projects.py`（Accept-Language 解析）
- `src/lib/api/videoProjects.ts`（locale 注入）

### 总规模估计
- ~14 src 文件修改 / ~4 测试文件新建 / ~2 后端文件修改
- 约 250-350 LOC 修改 / 200 LOC 测试
