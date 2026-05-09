# Iter10 网页 Bug 探索报告

- **日期**: 2026-05-10
- **环境**: dev 服务器 http://192.168.1.123:3010, msedge persistent profile, admin 账号
- **后端**: 192.168.1.123:8000 (PostgreSQL ecliptrix 数据库)
- **测试方法**: web-superuse 技能 + playwright-cli 探索
- **覆盖范围**: 前 9 轮未深入触及的 4 个区域 — Tab 持久化与 AI 对话/任务列表渲染、账号"其他设置"持久化、TTS 管理员设置数值校验、视频项目删除确认对话框、项目列表"按名称排序"

> 本轮探索过程中还发现 dev 后端因 alembic 缺漏迁移（009_add_user_preferences）无法启动，但已现场修复（手动 `ALTER TABLE users ADD COLUMN preferences JSON; alembic stamp head`）使后端恢复 200，仅作为环境记录，不计入产品 Bug。

---

## Summary

| # | 标题 | 严重程度 | 优先级 | 数据丢失? |
|---|------|----------|--------|------------|
| 1 | localStorage 任务/对话时间戳未反序列化为 Date，导致整页 React 异常 | Critical | P0 | 否 (UI 无法继续使用) |
| 2 | 账号"其他设置"401 静默失败，UI 谎报"更改会自动保存" | High | P1 | 是 (用户更改全部丢弃) |
| 3 | TTS 设置允许"并发线程数 > 最大并发线程数"，无校验提示 | Medium | P2 | 否 |
| 4 | 删除项目确认对话框只有泛标题"删除"，未显示项目名 | Medium (UX) | P2-P3 | 误删风险 |
| 5 | "按名称排序"使用数据库默认排序（zh_CN pinyin），英文 locale 下出现违反直觉的顺序 | Medium | P3 | 否 |

---

## Bug #1 — `TypeError: e.updatedAt.toLocaleDateString is not a function` 拖垮整页

**严重程度**: Critical
**优先级**: P0
**类型**: JS Runtime Error / 数据反序列化缺陷
**复现率**: 100% — 任何老用户重开浏览器后第一次切换 nav 即触发

### 复现步骤

1. 以 admin 登录 http://192.168.1.123:3010/
2. 进入 AI 对话 (`?tab=ai-chat`) 发送任意消息（用于在 localStorage 写入对话记录）
3. 关闭浏览器或刷新页面
4. 重新打开 http://192.168.1.123:3010/?tab=brainstorm
5. 点击顶部 Sidebar 上的 **AI 对话** 或 **视频编辑** tab
6. 整页变为 React 错误页：
   > Application error: a client-side exception has occurred while loading 192.168.1.123 (see the browser console for more information).

### 实际行为

控制台:

```
TypeError: e.updatedAt.toLocaleDateString is not a function
    at http://192.168.1.123:3010/_next/static/chunks/app/page-eee9080477d61a98.js:1:321713
    at Array.map (<anonymous>)
    at er (...:318675)
    at l9 (.../4bd1b696-cc729d47eba2cee4.js:1:51107)
```

通过查看 `localStorage.getItem('ecliptrix-tasks-state-v1')`：

```json
{
  "tasks": [{
    "id": "task-...-chat-...",
    "title": "AI Chat",
    "createdAt": "2026-05-09T12:06:00.045Z",  // ← 字符串
    "updatedAt": "2026-05-09T13:48:14.290Z",  // ← 字符串
    "content": {
      "conversations": [{
        "id": "conv-1778334454337",
        "title": "聊天机器人",
        "messages": [...],
        "createdAt": "2026-05-09T13:47:34.337Z",  // ← 字符串
        "updatedAt": "2026-05-09T13:48:14.290Z"  // ← 字符串
      }]
    }
  }]
}
```

`JSON.parse` 后 `createdAt`/`updatedAt` 仍是字符串，没有 `revive` 步骤把它们转回 `Date`，所以这两处都会爆炸：

- `src/components/Container.tsx:308` — `Created {activeTask.createdAt.toLocaleDateString()} • Last updated {activeTask.updatedAt.toLocaleDateString()}`
- `src/components/chat/ConversationList.tsx:133` — `{conversation.updatedAt.toLocaleDateString()}`

### 预期行为

任务/会话从 localStorage 读出后应保持 `Date` 类型（或调用方使用兼容字符串/Date 的格式化函数）。整页不应因渲染历史 chat 列表而崩溃。

### 修复建议（任务 #1 阶段产出）

1. 在加载持久化状态时，对 `tasks[*].createdAt/updatedAt` 与 `tasks[*].content.conversations[*].{createdAt,updatedAt,messages[*].timestamp}` 调用 `new Date(...)` 反序列化；或
2. 把 `Container.tsx:308` 与 `ConversationList.tsx:133` 改为容错的格式化函数（接受 `Date | string | number`），并对所有时间戳渲染统一封装。

### 证据
- 截图: `.web-debugger/screenshots/iter10-bug1-app-error.png`
- 快照: `.web-debugger/snapshots/iter10-after-aichat-click.yaml`
- localStorage dump: 见上 JSON 片段

---

## Bug #2 — 账号"其他设置"401 静默失败，UI 谎报"更改会自动保存"

**严重程度**: High
**优先级**: P1
**类型**: 鉴权 / 数据丢失 / UX 误导
**复现率**: 100%

### 复现步骤

1. admin 登录后点右上角头像 → **账号设置**
2. 切到 **其他设置** 子页
3. 切换任意一个 switch（例如「推送通知」）或调整「语言」/「主题」下拉
4. 状态条显示 **更改会自动保存。**

### 实际行为

- 页面打开时 `[GET] /api/user/me/preferences` → **401 Unauthorized**
- 任何更改触发 `[PATCH] /api/user/me/preferences` → **401 Unauthorized**
- 状态条始终是 **更改会自动保存。**（从来不变成「保存失败」）
- 重新打开账号设置面板 — 之前的所有更改都没有持久化（楔形回滚）

控制台:

```
[ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized) @ http://192.168.1.123:3010/api/user/me/preferences:0
[GET]   /api/user/me/preferences => [401] Unauthorized
[PATCH] /api/user/me/preferences => [401] Unauthorized
```

直接用 `fetch` + `Authorization: Bearer <token>` 调同一接口可以拿到 200：
```json
{"success": true, "preferences": { "notifications": {...}, "privacy": {...}, "language":"zh-CN", "theme":"dark" }}
```
说明问题不在后端鉴权，而在前端调用方。

### 根因（已定位）

`src/lib/api/userPreferences.ts:57-61, 96-99` 用裸 `fetch()` + `credentials: 'include'`：

```ts
const r = await fetch('/api/user/me/preferences', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body,
  credentials: 'include',  // ← Ecliptrix 用 Bearer 而非 cookie
});
```

但 Ecliptrix 的会话 token 存在 `localStorage.ecliptrix-session-token`，BFF 代理（`backend-proxy.ts`）需要 `Authorization: Bearer <token>` 头。同仓库的 `src/lib/api/http-client.ts:329` 已实现该注入。`userPreferences.ts` 完全绕过了 http-client 包装。

更糟的是，PATCH 失败时 `flush` catch 里调用 rollbacks，`setStatus('error')` 只持续 `ERROR_FLASH_MS` 后回到 `idle`，**没有 toast、没有 alert，UI 文案永远停留在「更改会自动保存」**——典型的 silent data loss。

### 预期行为

- `userPreferences.ts` 应通过 http-client（或手动注入 `Authorization: Bearer <token>`）调用接口；
- 当 PATCH 失败时应显式提示用户「保存失败」；
- 状态文案不应在错误期间仍显示「更改会自动保存」。

### 证据
- 截图: `.web-debugger/screenshots/iter10-final.png`（其他设置面板）
- 快照: `.web-debugger/snapshots/iter10-account-settings.yaml`
- 网络: `[401] Unauthorized` × 2 (GET + PATCH)
- 直接 fetch+Bearer 验证: 200，preferences 正常返回

---

## Bug #3 — TTS 设置允许"并发线程数 > 最大并发线程数"，无校验/提示

**严重程度**: Medium
**优先级**: P2
**类型**: 跨字段校验缺失 / 服务端静默截断

### 复现步骤

1. 管理员设置 → **TTS 设置**
2. 把「并发线程数」改成 999（默认 3，「最大并发线程数」上限是 10）
3. Tab 出输入框使「保存」按钮启用
4. 点击「保存」

### 实际行为

- 前端无任何「数值超过最大并发线程数」的校验提示
- 后端 `[PUT] /api/system-settings/tts` → **200 OK**
- 重载页面，「并发线程数」字段被自动改成 10（即和「最大并发线程数」相等）——服务端做了静默 clamp
- 用户既得不到「值非法」的反馈，也不知道自己设的值被改写了

控制台/网络:
```
[PUT] http://192.168.1.123:3010/api/system-settings/tts => [200] OK
```

### 预期行为

至少满足以下之一：
1. 前端在保存按钮启用时就阻止 `concurrency > max_concurrency` 的提交（红色 hint）；
2. 后端 422 + 明确错误码（`MAX_CONCURRENCY_VIOLATION`），并由前端 toast 显示；
3. 若坚持服务端 clamp，必须返回 200 但带 warning 字段（`warnings: ["concurrency clamped from 999 to 10"]`），由前端 toast 提示。

### 证据
- 快照: `.web-debugger/snapshots/iter10-tts-settings.yaml`
- 网络: `[PUT] /api/system-settings/tts => [200] OK`

---

## Bug #4 — 删除项目确认对话框未显示项目名

**严重程度**: Medium（UX/数据风险）
**优先级**: P2-P3
**类型**: UX / Confirmation hygiene

### 复现步骤

1. 视频编辑 → 项目列表（共 9+ 个项目）
2. 任意项目右侧 **项目操作 → 删除**
3. 弹出确认对话框

### 实际行为

对话框完整文案（English locale）：

> **Delete**  
> Delete this project? This cannot be undone.  
> [Cancel] [Delete]

中文 locale 同样泛化（"删除这个项目？无法撤销。"）。**对话框标题、正文、按钮都没有项目名或 ID**，并且对话框是模态的，弹起后用户已经看不到背后的项目卡片，无法确认正在删哪一个。

### 预期行为

- 对话框正文应包含项目名，例如 `Delete project "BugTest"? This cannot be undone.`
- 对话框标题可附加项目名（截断后加省略号）
- 长名/特殊字符要做 HTML escape 与 truncate

### 证据
- 快照: `.web-debugger/snapshots/iter10-after-xss-create.yaml` 后续的删除 dialog
- 网络追踪：连续 `[DELETE] /api/video-projects/<uuid>` 没有第二次确认

---

## Bug #5 — 项目列表"按名称排序"无视 UI locale，固定使用数据库 zh_CN pinyin 排序

**严重程度**: Medium
**优先级**: P3
**类型**: i18n / 排序行为

### 复现步骤

1. 切换 UI 到 English
2. 视频编辑 → 项目列表 → 排序下拉切到 **Name**
3. 观察排序结果

### 实际行为（按出现顺序）

```
123
123
华强        (pinyin: hua, U+534E)
撒地方撒地方  (pinyin: sa, U+6492)
躺平        (pinyin: tang, U+8EBA)
小狗品种     (pinyin: xiao, U+5C0F)  ← 出现在 躺(0x8EBA) 之后
小狗品种为什么这么多
BugTest     (B = U+0042)              ← 全部 ASCII 名落到最后
PaddedName  (P = U+0050)
```

按 Unicode codepoint 升序应是：
- ASCII 字母 (`B`/`P`, 0x42/0x50) 远小于任何 CJK 字符 (>0x4E00)
- CJK 内部按代码点：`华`(21326) < `小`(23567) < `撒`(25746) < `躺`(36538)

观察到的顺序：`华 < 撒 < 躺 < 小`——典型的 **pinyin 排序**（h < s < t < x）；ASCII 在最后——典型的 PostgreSQL `zh_CN.UTF-8` collation 行为。

### 根因（已定位）

`backend-services/basic-service/app/services/video_project_service.py:251-253`：

```python
if sort == "name":
    order = (VideoProject.name.asc(),)
```

`name.asc()` 落到 PostgreSQL，使用列/数据库默认 collation。dev/生产数据库都是 `zh_CN.UTF-8`，于是出现 pinyin + ASCII-after-CJK 的排序。

### 预期行为

- 在英文 locale 下，应使用 `en` collation（ASCII 在前），或使用纯 Unicode codepoint
- 至少要让排序行为可控：要么按 UI locale 切换 collation（`COLLATE "en_US.utf8"` / `COLLATE "zh_CN.utf8"`），要么固定使用 `localeCompare`-like ICU 排序、并在前端按 locale 二次排序

### 证据
- 快照: `.web-debugger/snapshots/iter10-sort-name.yaml`
- 源码定位: `video_project_service.py:251-253`

---

## 测试覆盖与未触及区域

### 本轮覆盖
- Tab/Task 持久化与跨刷新载入 (Bug #1)
- 账号设置 → 其他设置 (Bug #2)
- 管理员设置 → TTS 设置数值校验 (Bug #3)
- 视频项目 CRUD（创建 / XSS 名 / 500 char 长名 / 删除）(Bug #4)
- 项目列表排序与 i18n 交互 (Bug #5)
- 工作流编辑器（空 workflow 保存 200，但 UI 无 toast 反馈—轻微）
- 系统设置占位 (`功能开发中…`)
- 语言切换、TTS 设置数据持久化往返

### 未深入触及（建议后续轮次）
- 视频时间线高级操作（拖拽、剪切、字幕编辑面板的实际渲染）
- 通知中心 (NotificationContext)，没有看到任何通知 UI 入口
- 视频导出导出/导入流程的端到端
- 头脑风暴功能（仍是 "即将推出"）
- 工作流节点拖拽、连线、运行
- 移动端 / 响应式

---

## 元数据

- 浏览器：Microsoft Edge (msedge)
- 浏览器模式：headed + persistent profile (`.web-debugger/profile/iter10/`)
- 服务端：dev 192.168.1.123:8000（uvicorn / postgres ecliptrix）
- BFF：dev 192.168.1.123:3010（Next.js 15）
- 关键证据目录: `.web-debugger/{snapshots,screenshots,logs}/iter10-*`
