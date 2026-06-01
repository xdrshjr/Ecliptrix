# Phase 3 Digest

## Completed Tasks
| Task | Dev Agent | Review Verdict | Test Verdict | Key Output |
|------|-----------|---------------|-------------|------------|
| todo-04 前端后台UI与429 | google-dev-03 | PASS WITH FIXES | ALL PASS (10/10 + tsc) | 限流配置页 + API client + 3 代理路由 + http-client 429 + i18n |

## Key Decisions
- 严格对接后端契约:client 读 `res.config`/`res.status`,表单 1:1 绑定 5 个扁平 limits 键 + enabled + window_seconds,min/max 取自 `config.meta`(无硬编码),PUT 发顶层子集(匹配 `extra="forbid"`)。
- 429:`RateLimitError extends ApiError`(带 retryAfter),`parseRetryAfter` 支持 delta-seconds 与 HTTP-date;429 分支置于通用 4xx 之前(`request` 与 `streamRequest` 双路径);**无自动重试**;AuthContext 用**时间窗节流**(非 401 永久 latch)。
- 菜单接线三处;i18n 31 键 ×3(interface+EN+ZH)。

## Issues Resolved (Reviewer 修复)
- **真实用户可见 bug**:`backend-proxy.ts:345-350` 在 JSON 4xx 响应上只转发 Content-Type、**丢弃 `Retry-After` 头** → 所有经代理的限流请求倒计时恒显 5s 默认。Reviewer 修复:header 缺失时回退读 body `error_details.retry_after`(header 仍优先)。Tester 10/10 harness 独立验证(body retry_after=42 → 显示 42)。

## Interfaces Established
- 前端消费 `/api/rate-limit/{config,reset,status}`(经 `createPassthroughRoute` 转发 auth);429 全局 UX(`ecliptrix:rate-limited` 事件 + NotificationContext warning)。

## Context for Next Phase (TODO 06 测试与验收)
TODO 06(dev-04)把前三阶段 tester 的定向 harness 固化为正式 `tests/` 套件并跑通,覆盖:鉴权中间件(既有 `test_auth_middleware.py` 已更新,核对/补充)、限流内核(`rate_limiter`)、类别解析(`resolve_category`,含 `/api/audio/generated/`→media、`/api/ai-mixed-editing`→ai)、`get_client_ip`、配置 Provider(TTL/invalidate/降级)、后台 API 集成(GET/PUT 422/reset/status/审计/非 admin 403)、429 行为(`error_code="rate_limit.exceeded"` + Retry-After)。**环境坑必处理**:`db_models` postgresql.UUID → `@compiles(...,'sqlite')→CHAR(36)` shim;`app/services/__init__` 急加载 cv2 → 按文件路径直接 import。前端冒烟:dev-03 在 `summaries/phase-3/dev--google-dev-03--todo-04.md` 留了 FE smoke 清单(429 真实倒计时经代理、爆发→单 toast、后续→再 toast、tsc)。填 master-plan §8 traceability。遗留 `/api/user/health`(flag-on 401)由 06 决定是否建议 ops allowlist。

详见 `summaries/phase-3/`。
