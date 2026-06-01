# Global Execution Context: api-authz-rate-limiting

Accumulated context from all execution phases. Each agent MUST read this
file before starting work to understand the full project history.

---

## Phase 1 — completed

**完成**:todo-01 鉴权覆盖(dev-01,PASS/ALL PASS)、todo-02 限流内核(dev-02,PASS/ALL PASS)。集成验证通过(双中间件真实链路端到端)。

**关键产出与契约**:
- 既有默认拒绝中间件已无条件强制 → 新增 `AUTH_ENFORCE_DEFAULT_DENY`(默认 **false**)门控;登录态零回归;`HARD_PROTECT_PATHS` 恒强制。白名单加 `/api/config/`。error_code 保持 `UNAUTHORIZED`/`FORBIDDEN`/`ACCOUNT_DISABLED`。
- `model_settings_router` 已加路由级 `require_admin`(R8 闭环)。
- 限流:`app/services/rate_limiter.py`(单例 `rate_limiter`,`async check()`,`stats()`,`reset()`)、`resolve_category`(顺序 auth→media_serving→ai_generation→normal)、`get_client_ip`、`app/middleware/rate_limit_middleware.py`;在 main.py 先于 SessionAuth 注册 → 执行序 `Auth→RateLimit`(R5 验证)。
- **config-provider seam(TODO 03 必须沿用)**:`app/services/rate_limit_config.py` 单例 `rate_limit_config_provider`,`async get_config()->RateLimitConfig`(`.limits.{normal_user,normal_ip,ai_generation,auth_ip,media_serving}`+`enabled`+`window_seconds`)+`invalidate()`;7 键经 `SYSTEM_SETTING_KEY_MAP` 映射;现有 `_FallbackConfigProvider` 持默认 300/300/30/10/6000,window60。
- **429 契约(TODO 04 沿用)**:429 + `Retry-After` + `X-RateLimit-*` + `ErrorResponse(error_code="rate_limit.exceeded", error_details={retry_after,limit})`。

**环境坑(所有后续 agent 注意)**:① `db_models` 用 `postgresql.UUID`,SQLite 测试须加 `@compiles(postgresql.UUID,'sqlite')→CHAR(36)` shim(pre-existing,非缺陷);② `app/services/__init__.py` 急加载 cv2(本机坏),测试时按文件路径直接 import 目标模块。

**遗留待决**:`/api/user/health`(flag-on 会 401)、`/api/ai-mixed-editing`(归 normal 而非 ai_generation)— TODO 03/05/06 决定是否调整。

详见 `summaries/phase-1/phase-digest.md`。

---

## Phase 2 — completed

**完成**:todo-03 配置与后台 API(dev-02,PASS/ALL PASS 49+10)、todo-05 前端审计与上线(dev-03,PASS/ALL PASS)。集成验证通过(provider seam 保持 → 中间件零改动;前端修复跨执行器验证)。

**关键产出与契约**:
- **后台 API**(`app/routers/rate_limit_settings_router.py`,`prefix="/api/rate-limit"`,`require_admin`):`GET /config` → `{config:{enabled,window_seconds,limits:{5 扁平键},meta:{每键 default/type/min/max/description}}}`;`PUT /config` 接受 7 键任意子集(顶层),越界/未知键 → 422 不写,成功后 invalidate;`POST /reset` 重置;`GET /status` → `{status:{enabled,active_keys,total_checked,total_blocked}}`。
- **Provider**(`app/services/rate_limit_config.py`):TTL 5s 缓存 DB 读 + invalidate 即时 + DB 错误降级默认;**seam 接口零改动**(单例名/方法/dataclass 不变)。`app/config.py` 的 `RATE_LIMIT_DEFAULTS`/`RATE_LIMIT_META` 是默认+校验+meta 的单一真源。迁移 `012`(down_revision 011,idempotent,downgrade 限 category)。
- **前端审计**(`audit/frontend-token-audit.md`):118 路由,103 经 helper 转发 auth,15 逃生通道(14 合规、1 已修)。修复 `workflow/test-node` 扇出未带 token。`/api/ai-mixed-editing` 归 ai_generation。**灰度 checklist 在 audit §7**:`AUTH_ENFORCE_DEFAULT_DENY`(auth)与 `RateLimitConfig.enabled`(限流)两开关独立。

**Phase 3 须知(TODO 04 前端 UI)**:严格对接上面的 `GET /config` JSON 与 PUT/reset/status 语义 + 429 契约;菜单接线三处(SettingsSidebar union+menuItems、AdminSettingsPage `case 'apiSecurity'`);429 去抖用时间窗口节流(非 401 永久 latch);i18n EN(~120)+ ZH(~5655)`t.adminSettings.*` 同步。

详见 `summaries/phase-2/phase-digest.md`。

---

## Phase 3 — completed

**完成**:todo-04 前端后台 UI 与 429(dev-03,PASS WITH FIXES/ALL PASS)。集成验证通过。

**关键产出**:
- 限流配置页 + API client(`src/lib/api/rateLimitSettings.ts`)+ 3 个代理路由(`src/app/api/rate-limit/*`,`createPassthroughRoute`)。
- http-client 429:`RateLimitError`(retryAfter)+ `parseRetryAfter`(delta/HTTP-date)+ 429 分支置于通用 4xx 前(`request` 与 `streamRequest`)+ 无自动重试;AuthContext 时间窗节流弹友好 toast。i18n 31 键 ×3。
- **Reviewer 修复的真实 bug**:`backend-proxy` 在 JSON 4xx 丢弃 `Retry-After` 头 → 改为 header 缺失时回退 body `error_details.retry_after`(已被 tester 10/10 验证)。

**Phase 4 须知(TODO 06)**:固化正式 `tests/` 套件覆盖全部模块 + 跑通 + 填 §8 traceability;**必处理环境坑**(UUID→CHAR(36) shim、cv2 按路径 import);前端冒烟清单见 dev-03 phase-3 摘要。

详见 `summaries/phase-3/phase-digest.md`。

---

## Phase 4 — completed (FINAL)

**完成**:todo-06 测试与验收(dev-04,PASS/ALL PASS-ACCEPTED)。集成验证通过。

- 7 个正式 pytest 文件 + `conftest.py` 可运行性修复(方言隔离 UUID/JSONB shim + 守卫式 cv2 stub,生产不受影响,零真实回归)。
- 实跑 **137 passed / 0 failed**。master-plan §8 全部 7 条验收标准映射到通过测试(FE 部分为手动冒烟)。无产品 bug。
- 上线序见 `audit/frontend-token-audit.md` §7 + `acceptance-report.md`。

**项目状态:Phases 1–4 全部 PASS,功能完整、已验收,待上线灰度。**

详见 `summaries/phase-4/phase-digest.md`、`acceptance-report.md`。

---
