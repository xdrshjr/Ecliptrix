# Phase 1 Digest

## Completed Tasks
| Task | Dev Agent | Review Verdict | Test Verdict | Key Output |
|------|-----------|---------------|-------------|------------|
| todo-01 鉴权覆盖 | google-dev-01 | PASS (D10) | ALL PASS | `AUTH_ENFORCE_DEFAULT_DENY` 开关 + `/api/config/` 白名单 + `model_settings_router` require_admin (R8) |
| todo-02 限流内核 | google-dev-02 | PASS (D10) | ALL PASS | `rate_limiter` / `resolve_category` / `get_client_ip` / `RateLimitMiddleware` + config-provider seam |

## Key Decisions
- 既有 `SessionAuthMiddleware` 已**无条件**强制默认拒绝(5473c7a)。dev-01 新增 `AUTH_ENFORCE_DEFAULT_DENY`(默认 **false**)门控四个拒绝分支;**有效 token 解析 + `request.state.user` 注入保持无条件** → 登录态行为零变化(R1 安全)。`HARD_PROTECT_PATHS` 永远强制。
- `model_settings_router` 加路由级 `require_admin`(R8,与开关无关恒生效)。`system_settings_router`/`admin_playback_router`/`user_router` 管理端点经核查**已合规**,未改。
- 限流中间件在 `app/main.py` **先于** `SessionAuthMiddleware` 注册 → LIFO 执行序 `CORS→SessionAuth→RateLimit→router`,限流可读 `request.state.user`(R5 验证通过)。
- `resolve_category` 顺序 `auth→media_serving→ai_generation→normal`;`/api/audio/generated/`、`/api/audio/subtitles/` 在 `/api/audio/` 之前归 media。`ai_generation` 前缀集已对照真实路由核定(真实 chat 为 `/api/video-editing-chat`,理解为 `/api/video-understanding-script`+`/api/convert-to-script`)。

## Interfaces Established
- **config-provider seam**(关键,供 TODO 03):`app/services/rate_limit_config.py` 暴露单例 `rate_limit_config_provider`,`async get_config() -> RateLimitConfig` + `invalidate()`;`RateLimitConfig.limits.{normal_user, normal_ip, ai_generation, auth_ip, media_serving}` + `enabled` + `window_seconds`;7 个 SystemSetting 键经 `SYSTEM_SETTING_KEY_MAP` 映射;现有 `_FallbackConfigProvider` 持 spec 默认(300/300/30/10/6000,window 60)。**TODO 03 只需保留单例名 + get_config()/invalidate() 接口,把实现换成 TTL 缓存的 SystemSetting 读取器**。
- **rate_limiter.stats()**(供 TODO 03 `/status`):`total_checked`/`total_blocked`/`active_keys`。
- **429 契约**(供 TODO 04):`429` + `Retry-After`(int≥1)+ `X-RateLimit-Limit`/`X-RateLimit-Remaining` + 标准 `ErrorResponse`(`error_code="rate_limit.exceeded"`、`error_details={retry_after, limit}`)。
- **auth 开关 + 白名单**(供 TODO 05):`AUTH_ENFORCE_DEFAULT_DENY`(默认 false);白名单含 `/api/config/`;error_code 保持 `UNAUTHORIZED`/`FORBIDDEN`/`ACCOUNT_DISABLED`。

## Issues Resolved
- 默认拒绝一次性强制 → 引入开关分批放开(化解 R1)。
- model_settings 裸奔(R8)→ 已补 require_admin。

## Context for Next Phase
TODO 03(dev-02 续接)实现 TTL 缓存的 `RateLimitConfigProvider`(替换 fallback),配置存 `SystemSetting` 的 `rate_limiting` 类别 + 迁移 `012`(down_revision="011")+ 后台 API + 审计,**必须保持现有 provider 单例名与 `get_config()`/`invalidate()` 接口不变**,`/status` 用 `rate_limiter.stats()`。TODO 05(dev-03)审计前端代理 token 透传(`backend-proxy.ts` 已转发,工作量收窄为核实覆盖面 + 枚举逃生通道)+ 编写灰度上线 checklist(用 `AUTH_ENFORCE_DEFAULT_DENY`)。**环境坑**:`db_models` 用 `postgresql.UUID`(SQLite 测试需 `@compiles(postgresql.UUID,'sqlite')→CHAR(36)` shim);`app/services/__init__.py` 急加载 cv2(测试时按文件路径直接 import 目标模块)。遗留:`/api/user/health` 未入白名单(flag-on 会 401)、`/api/ai-mixed-editing` 归 normal — TODO 03/05/06 决定。
