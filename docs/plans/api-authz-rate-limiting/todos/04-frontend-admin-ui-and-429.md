# TODO 04 — 前端后台 UI 与 429 处理

> Spec: [`specs/04-frontend-admin-ui-and-429.md`](../specs/04-frontend-admin-ui-and-429.md)

## Dependencies

- `depends_on: [02, 03]` —— 表单字段对应 03 的 `GET /config` schema;429 行为对应 02 中间件返回。
- `blocks: [06]` —— 06 前端冒烟验证本任务产出。
- `parallel_group: C` —— 单独阶段(待 02/03 完成)。
- WHY: 前端是配置/限流的消费端,需后端 API 与限流行为定型后实现,避免契约漂移。

## Tasks

### A. 现状核对
- [ ] Read `src/components/AdminSettings/AdminSettingsPage.tsx`、`SettingsSidebar.tsx`:菜单项/`renderContent` 约定。
- [ ] Read `src/lib/api/http-client.ts:411-435`:401 全局处理 + 既有 `ForbiddenError`(403)模式。
- [ ] Read `src/contexts/AuthContext.tsx`(`canManageUsers=isAdmin`,line ~346)、`NotificationContext.tsx`、`src/lib/i18n.ts`(`t.adminSettings.*` EN ~120 / ZH ~5655)。

### B. API client + 代理路由
- [ ] `src/lib/api/rateLimitSettings.ts`:`getConfig()`/`updateConfig()`/`resetConfig()`/`getStatus()`(走 http-client,自动注入 Bearer)。
- [ ] 代理路由 `src/app/api/rate-limit/config/route.ts`(GET/PUT)、`reset/route.ts`(POST)、`status/route.ts`(GET);经 `backend-proxy` 助手或显式转发 `Authorization`+`x-session-token`。

### C. 后台配置页
- [ ] 组件 `RateLimitSettings`(`src/components/AdminSettings/`):全局开关 + 各类别额度(普通用户/匿名/AI/登录/媒体)+ `window_seconds`;min/max 取自 `GET /config` 的 meta。
- [ ] 保存(PUT)/重置(POST/reset)按钮;保存成功 toast「已保存,数秒内生效」。
- [ ] 只读状态区:`active_keys`/`total_checked`/`total_blocked`/`enabled`;开关关闭时额度项灰显。
- [ ] 菜单接线三处:`SettingsSidebar` 的 `SettingsMenuItem` union + `menuItems` 增 `apiSecurity`;`AdminSettingsPage.renderContent` 加 `case 'apiSecurity'`;id 与 Mermaid 一致。页面继承面板级 admin 门控(无需额外前端检查),后端 `require_admin` 兜底。

### D. 429 全局处理(http-client)
- [ ] 新增 `RateLimitError extends ApiError`(带 `retryAfter`)。
- [ ] 检测 `status===429`,读 `Retry-After`,dispatch `ecliptrix:rate-limited` 事件;**不自动重试**。
- [ ] 在全局监听处(参照 AuthContext 监听 `session-expired`)经 `NotificationContext.showWarning` 弹「请求过于频繁,N 秒后重试」。
- [ ] 去抖用**时间窗口节流**(参照 `NETWORK_WARN_THROTTLE_MS`),**勿**用 401 的永久 latch(否则永久静音 429)。

### E. i18n
- [ ] 在 `t.adminSettings.*` 增中英文案(菜单名、页面标题/说明、字段标签/提示、保存/重置、状态标签、429 toast);EN 与 ZH 块同步,保证 `Translations` 类型匹配。

### F. 自检
- [ ] admin 打开「接口安全/限流」可读改存,后端生效;非 admin 看不到菜单且直连被 403。
- [ ] 触发 429 弹一次友好 toast 含倒计时,不自动重试;开关关闭 UI 反映「已停用」。
- [ ] `npm run type-check` 通过;写执行摘要供 06。
