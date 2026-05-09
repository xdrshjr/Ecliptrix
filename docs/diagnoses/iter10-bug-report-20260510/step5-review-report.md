# Iter10 Step 5 — Code Review & Commit Report

> 评审范围：iter10 全部 5 个 Bug 修复（参见 `bug-report.md` / `fix-plan-reviewed.md`）
> 评审时间：2026-05-10
> 评审者：iter10 Subtask #5 执行者

---

## 1. 代码 Review 结果

### 1.1 与 fix-plan-reviewed.md 对齐度核对（逐 Bug 验证）

| Bug | 严重度 | 计划要点 | 代码现状 | 对齐 |
|---|---|---|---|---|
| #1 | P0 | `dateFormat.ts` 工具 + `useTasks.reviveState` 递归 revive `content.conversations[*]` 与 `messages[*].timestamp` + 7 处渲染兜底（含 C-1 新增 ChatWindow.tsx） | `src/lib/utils/dateFormat.ts` 含 `toDate/formatDate/formatTime`；`useTasks.ts:21-36` 新增 `reviveConversation`/`reviveTaskContent` 并接入 `reviveState`；`Container.tsx:308`、`ConversationList.tsx:134`、`ChatWindow.tsx:281`、`MessageBubble.tsx:259`、`AgentMessageBubble.tsx:84`、`ChatInterface.tsx:74`、`ExpertMessage.tsx:23/52` 全部改为 `formatDate/formatTime` | ✅ |
| #2 | P1 | `http-client.ts` 加 `'PATCH'` + `http.patch`；`userPreferences.ts` 改 `http.patch/get` 享受 Bearer 注入；`useUserPreferencesMutation({onError})` + `OtherSettingsPanel` 接入 `useNotification.showError(t.profile.saveErrorNote)`；**复用** 既有 i18n（不新增 `t.account.preferences*`） | `http-client.ts:281` 类型扩 PATCH，`:722-724` 新增 `http.patch`；`userPreferences.ts:1-7` 引入 `http`、`:31-33` `UseUserPreferencesMutationOpts.onError`、`:47-78` flush 改 `http.patch` 并在 catch 调用 `onError(err)`；`fetchUserPreferences` 改 `http.get`；`OtherSettingsPanel.tsx:5/62-65` 引入 `useNotification` 并将 `onError: () => showError(t.profile.saveErrorNote)` 传入 hook | ✅ |
| #3 | P2 | `TTSSettingsPanel.tsx` 跨字段不变量 `concurrent_threads ≤ max_concurrent_threads`；inline error + Save 按钮 disabled；新增 i18n key `adminSettings.ttsConcurrencyInvariantError` (EN+zh-CN) | `TTSSettingsPanel.tsx:64-69` 计算 `concurrencyInvariantViolated`；`:91` Save 按钮 `disabled` 表达式叠加；`:102-108` 在 `concurrent_threads` 字段下条件渲染 `<p role="alert">`；`i18n.ts` 接口 + EN + zh-CN 三处加 `ttsConcurrencyInvariantError` | ✅ |
| #4 | P2-P3 | `VideoProjectListView.handleDeleteProject` 用 `split('{name}').join(safeName)` 替换 `replace`，60 字符 truncate，空名 fallback 到 `t.videoProjects.untitled`；i18n 新增 `deleteConfirmTitle` 模板，`deleteConfirm` 改为含 `{name}` 模板（EN+zh-CN） | `VideoProjectListView.tsx:205-212` `TRUNCATE_AT=60` + `interpolate(template) = template.split('{name}').join(safeName)`，title/message 都通过 interpolate；`i18n.ts` 接口 `deleteConfirmTitle`、EN/zh-CN 模板都含 `"{name}"`；空名走 `untitled` | ✅ |
| #5 | P3 | 后端 `video_project_service.py` 加白名单 `_LOCALE_COLLATIONS`、启动期 `pg_collation` 缓存、`_resolve_locale_to_prefix` + `_resolve_collation`，`list_projects(locale=...)` 用 `collate(VideoProject.name, coll).asc()` + `id.asc()` tiebreaker；路径修正为 `video_project_router.py`，加 `Accept-Language` Header 解析；前端 `videoProjects.ts` list 注入 `Accept-Language`，BFF `route.ts` 用 `forwardHeaders: ['accept-language']` | `video_project_service.py:34-117` 注入完整 helper（含 SQLite 兼容的 `except Exception`）；`:331-369` sort 分支均加 `id.asc()` tiebreaker；`video_project_router.py:13/139/152` `Header(..., alias="Accept-Language")` + 透传 `locale=`；`videoProjects.ts:101-114/130-132` 读 `localStorage.ecliptrix-locale` 注入 `Accept-Language`；`app/api/video-projects/route.ts:5-7` 加 `forwardHeaders: ['accept-language']` | ✅ |

**结论**：5 个 Bug 全部按 `fix-plan-reviewed.md` 的最终形态落地，无偏差；C-1/C-2/C-3 三处审查修正与 R-1~R-4 四处补强亦体现在代码中。

### 1.2 代码风格 & 规范

- **TypeScript**：`npm run type-check` 0 错误。`Translations` 接口同步新增 `videoProjects.deleteConfirmTitle`、`adminSettings.ttsConcurrencyInvariantError` 两个 key（EN + zh-CN 全部填充）。
- **ESLint 基线**：iter10 改动未引入新告警，与 iter8/iter9 基线一致。
- **i18n 一致性**：3 处（接口 + en + zh-CN）同步；命名空间归属（`videoProjects.*`、`adminSettings.*`）符合既有约定。
- **Hook 顺序与依赖数组**：`useUserPreferencesMutation` 的 `flush` 依赖 `[onError]` 正确（onError 由 panel 传入会在父级稳定）；`OtherSettingsPanel` 中 `onError: () => showError(t.profile.saveErrorNote)` 是行内闭包，不引发额外 re-render（hook 内部仅在 flush 时读取最新引用）。
- **模块级缓存**：后端 `_available_collations` 是模块级单例 + 启动期填充，避免热路径 try/except，符合 R-2 补强意图。
- **测试覆盖**：每个 Bug 新增 ≥1 单元测试文件，遵循项目既有 vitest / pytest 模式。

### 1.3 调试代码 / 临时文件检查

- ✅ 无 `console.log` / `debugger` / `TODO: remove` 残留。
- ✅ Bug #2 `flush` catch 块改为 `catch (err)` 并把 `err` 传给 `onError?.(err)`，无吞错。
- ✅ Bug #5 `_ensure_collation_cache` 含 SQLite/非 PG 兜底分支，避免 SQLite 测试初始化时抛 `OperationalError`。
- ⚠️ `backend-services/basic-service/logs/app.log`（+6451 行）是 dev backend 运行期日志，与 iter10 修复**无关**，**本次提交不包含**。
- ⚠️ `backend-services/basic-service/static/audio/generated/*.mp3` 与 `static/uploads/audio/2026/05/` 是运行期产物，**本次提交不包含**。
- ⚠️ `.agentmesh/`、`.claude/scheduled_tasks.lock`、`docs/diagnoses/{video-cover-put-422-validation,video-frame-extraction-tab}/`、`dev/*_20260420.py` 都与 iter10 无关，**本次提交不包含**。

---

## 2. 测试结果

### 2.1 类型检查
```bash
$ npm run type-check
> tsc --noEmit
# 0 errors
```

### 2.2 iter10 相关 Vitest 套件
```bash
$ npx vitest run \
    src/lib/utils/__tests__/dateFormat.test.ts \
    src/hooks/__tests__/useTasks.persistence.test.ts \
    src/lib/api/__tests__/userPreferences.test.ts \
    src/lib/api/__tests__/videoProjects.test.ts \
    src/components/AdminSettings/__tests__/TTSSettingsPanel.invariant.test.tsx \
    src/components/video/projects/__tests__/VideoProjectListView.delete.test.tsx

Test Files  6 passed (6)
     Tests  50 passed (50)
```

- **新增 5 个测试文件**（dateFormat / userPreferences / TTSSettingsPanel.invariant / VideoProjectListView.delete / video_project_service_collation）。
- **扩展 2 个既有测试**（`useTasks.persistence.test.ts` 增加 chat conversation/message timestamp revive 用例；`videoProjects.test.ts` 增加 list 注入 `Accept-Language` 用例）。

### 2.3 iter10 相关 Pytest 套件
```bash
$ python -m pytest tests/test_video_project_service_collation.py tests/test_video_project_service.py -v
============================ 29 passed, 23 warnings ============================
```

- 新增 `test_video_project_service_collation.py`（15 cases，覆盖 `_resolve_locale_to_prefix`、`_resolve_collation` 缓存命中/缺失、SQLite/DBAPIError 回落 `'C'`）。
- 既有 `test_video_project_service.py`（14 cases）回归通过，证明加上 `id.asc()` tiebreaker 后排序行为对既有用例无破坏。

### 2.4 全量回归（继承自 step 4）
- iter10 改动覆盖的 6 个 vitest 套件 50/50 通过；2 个 pytest 套件 29/29 通过；type-check 0 错误。

---

## 3. Commit 信息

### 3.1 提交策略

按 fix-plan-reviewed.md "提交节奏建议" 沿用前几轮 iter 风格，**单次 commit** 承载所有 5 个 Bug 修复 + 测试 + 诊断文档，便于 PR 体量可读、回滚干净。

### 3.2 Commit Message

```
fix: harden persistence revive, prefs auth, TTS invariant, delete dialog, locale collation (iter10)

- Bug #1 (P0): add src/lib/utils/dateFormat.ts and recursively revive chat
  conversations/messages timestamps in useTasks.reviveState; switch 7 render
  sites (Container, ConversationList, ChatWindow, MessageBubble,
  AgentMessageBubble, ChatInterface, ExpertMessage) to formatDate/formatTime
  so legacy localStorage payloads no longer crash with TypeError on cold start.
- Bug #2 (P1): wire userPreferences.ts to http.get/http.patch (Bearer-aware)
  instead of bare fetch+credentials, expose useUserPreferencesMutation({onError}),
  and surface failures via showError(t.profile.saveErrorNote) in
  OtherSettingsPanel; add http.patch + 'PATCH' to HttpMethod.
- Bug #3 (P2): add cross-field invariant in TTSSettingsPanel
  (concurrent_threads <= max_concurrent_threads), inline alert + Save disabled
  + new i18n key adminSettings.ttsConcurrencyInvariantError (EN+zh-CN).
- Bug #4 (P2-P3): show project name in delete confirmation via
  videoProjects.deleteConfirmTitle template + {name}-interpolated deleteConfirm
  message, with 60-char truncate, untitled fallback, and split/join replacement
  to defend against duplicate placeholders.
- Bug #5 (P3): backend video_project_service maps Accept-Language to a
  whitelisted PG collation (en_US.utf8 / zh_CN.utf8) with startup-time
  pg_collation cache and 'C' fallback; sort=name uses collate(name, coll).asc()
  with id.asc() tiebreaker; video_project_router accepts Accept-Language;
  frontend list injects Accept-Language and BFF route forwards it.

Tests: 6 vitest files / 50 cases + 2 pytest files / 29 cases all pass; tsc clean.
```

---

## 4. 提交记录

- **Commit hash**: `90fff47`
- **Branch**: `main`
- **Files changed**: 30（21 modified + 9 created — 含 dateFormat util、5 测试文件、4 诊断文档）
- **LOC**: 2474 insertions / 46 deletions
- **Push**: `main` 当前 ahead origin/main 50+ commits；本轮**未执行 `git push`**，沿用前几轮 iter 的"按需推送"约定（push 由用户根据发布节奏触发）。

---

## 5. 部署 Dev Server

执行 `python dev/deploy_dev_20260420.py`：

- **目标**: 192.168.1.123 (kt-NF5568M4, 用户 `kt`)
- **流程**: SFTP mirror src/public/backend app/alembic/scripts/config/sql + 个别根文件 → `npm run build`（exit 0）→ 重启 uvicorn :8000 → 重启 next start :3010
- **健康检查**:
  - `ss -lntp`: 8000 (uvicorn pid 500420) + 3010 (next-server pid 500841) 监听正常
  - `GET http://127.0.0.1:8000/docs` → `http=200`
  - `GET http://127.0.0.1:3010` → `http=200`
- **结论**: dev server 已加载 iter10 修复。

---

## 6. 评审签字

- 已逐 Bug 核对实现与 `fix-plan-reviewed.md`，**5 个 Bug 全部对齐**。
- 类型检查 0 错误；iter10 新增 / 扩展的测试 50 + 29 = 79 用例全部通过。
- 无调试代码 / 无意外副作用。
- 运行期产物（`logs/app.log`、`static/audio/generated/`、`static/uploads/audio/`）与 iter10 无关的工作树文件（`.agentmesh/`、`dev/*_20260420.py`、其他 diagnoses）**确认排除在本次提交之外**。
- **可直接进入提交阶段**。
