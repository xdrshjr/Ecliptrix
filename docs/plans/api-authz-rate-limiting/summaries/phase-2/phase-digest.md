# Phase 2 Digest

## Completed Tasks
| Task | Dev Agent | Review Verdict | Test Verdict | Key Output |
|------|-----------|---------------|-------------|------------|
| todo-03 配置与后台API | google-dev-02 | PASS (D10) | ALL PASS (49/49 + 10/10) | 迁移 012 + `rate_limit_settings_router` + TTL DB Provider(seam 不变) |
| todo-05 前端审计与上线 | google-dev-03 | PASS (D10) | ALL PASS (8/8 + tsc) | 118 路由审计 + 1 处回归修复 + 灰度 checklist |

## Key Decisions
- **Provider seam 严格保持**:仅替换 `rate_limit_config.py` 实现体,单例名 `rate_limit_config_provider` + `async get_config()->RateLimitConfig` + `invalidate()` + dataclass 形状全不变 → `rate_limit_middleware.py` 零改动(验证 import 通过)。
- **配置单一真源**:`app/config.py` 的 `RATE_LIMIT_DEFAULTS`(7 键默认)+ `RATE_LIMIT_META`(type/min/max/description),provider 与后台 API 均引用,杜绝漂移。
- **后台 API**:`PUT /config` 校验全部键后才写(`db.flush()` 顺序保证越界/未知键 422 时零写入,`extra="forbid"`),写 `SystemSetting.updated_by` + `SettingsAuditLog(changed_by=username)` 后 `invalidate()`;`reset` 重置 7 键;`/status` 读 `rate_limiter.stats()`。
- **迁移 012**:`down_revision="011"`,idempotent UPSERT,downgrade 仅删 `category='rate_limiting'`;Postgres 风味,SQLite 路径靠 router UPSERT/create_all 兜底。
- **前端审计**:118 个代理路由,103 经 `backend-proxy` helper(已转发 Authorization+x-session-token),15 个逃生通道(14 已合规,1 真实回归)。修复 `workflow/test-node` 内部扇出 fetch 未带 token(否则 flag-on 后 Pexels/Tavily/TTS 节点测试 401);`/api/ai-mixed-editing` 归入 `ai_generation`。

## Interfaces Established
- **`GET /api/rate-limit/config` JSON(供 TODO 04 表单)**:
  ```jsonc
  { "success": true, "message": "...", "timestamp": "...", "data": null,
    "config": { "enabled": true, "window_seconds": 60,
      "limits": { "default_per_user_per_min":300, "default_per_ip_per_min":300,
                  "ai_generation_per_min":30, "auth_per_ip_per_min":10, "media_serving_per_min":6000 },
      "meta": { "<key>": {"default":..,"type":"boolean|number","min":..|null,"max":..|null,"description":".."} } } }
  ```
  `PUT /config` 接受 7 键的**任意子集**(顶层,非嵌套),未知键/越界 → 422 不写;成功 → 返回新生效配置 + invalidate。`POST /reset` 重置全部。`GET /status` → `{ "status": { enabled, active_keys, total_checked, total_blocked } }`。全部 `require_admin`(非 admin 403)。
- **429 契约**(Phase 1 已定,TODO 04 沿用):429 + `Retry-After` + `X-RateLimit-*` + `ErrorResponse(error_code="rate_limit.exceeded")`。
- **灰度 checklist**:`docs/plans/api-authz-rate-limiting/audit/frontend-token-audit.md` §7(含 grace-logging 模式;`AUTH_ENFORCE_DEFAULT_DENY` 与 `RateLimitConfig.enabled` 两开关独立、存储不同)。

## Issues Resolved
- flag-on 真实回归(test-node 扇出未带 token)→ 已修(化解 R1 关键漏点)。
- 遗留项 #2(ai-mixed-editing 限流类别)→ 已修。

## Context for Next Phase
TODO 04(dev-03 续接,前端)实现后台「接口安全/限流」配置页 + API client + 代理路由 + http-client 429 处理 + i18n。**必须严格对接** 上面的 `GET /config` JSON 形状(`config.limits.*` 扁平键 + `config.meta.*`)与 `PUT`(顶层子集)/`/reset`/`/status` 语义,以及 429 契约。菜单接线三处(SettingsSidebar union+menuItems、AdminSettingsPage renderContent case 'apiSecurity')。429 去抖用时间窗口节流(非 401 的永久 latch)。i18n EN(~120)+ ZH(~5655)`t.adminSettings.*` 同步。遗留 `/api/user/health`(flag-on 401)未处理,留 TODO 06 决定是否 ops 需要。

详见 `summaries/phase-2/phase-digest.md`、`audit/frontend-token-audit.md`。
