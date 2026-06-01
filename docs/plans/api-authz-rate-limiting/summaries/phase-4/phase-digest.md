# Phase 4 Digest (Final)

## Completed Tasks
| Task | Dev Agent | Review Verdict | Test Verdict | Key Output |
|------|-----------|---------------|-------------|------------|
| todo-06 测试与验收 | google-dev-04 | PASS | ALL PASS — ACCEPTED (137/0) | 7 个正式 pytest 文件 + conftest 可运行性修复 + 验收报告 |

## Key Decisions
- **conftest 可运行性修复**(`tests/conftest.py`):方言隔离 `@compiles(postgresql.UUID,'sqlite')→CHAR(36)` + `JSONB→JSON`(仅 SQLite,生产原生不受影响);**守卫式 cv2 stub**(先试真实 import,失败才装 sys.modules stub,且被真正调用时响亮报错)。net 改进:全套 passed 491→825,**零真实回归**。
- 集成测试驱动**真实** middleware/router/dependencies(生产 LIFO 序 Auth→RateLimit),非重实现。
- 两处「测试编写修正」均为真实行为映射(provider degrade:TTL 过期保留 last-good vs invalidate→defaults;root fixture `is_admin=True` 对齐 `app/database.py` seeding),非掩盖 bug。

## Test Results (real run)
`137 passed, 0 failed, 0 skipped in 10.64s` — rate_limiter_core 20 / category_resolver 37 / client_ip 8 / config_provider 13 / admin_api 14 / integration 9 / authz_integration 9 / auth_middleware 27。安全套件隔离 122 passed/4 failed(3× 缺 oss2、1× 既有断言形状 bug,均非本项目)。

## Acceptance (master-plan §8)
全部 7 条验收标准映射到通过的测试(§8.5/§8.6 标注 backend PASS / FE MANUAL,含 §4 实栈冒烟清单)。R3(单进程)/R7(TTL)记为已知限制(R7 invalidate 路径有测试)。遗留 `/api/user/health`(flag-on 401)记建议,无 200 断言。详见 `acceptance-report.md`。

## Product bugs found
无。

## Context for Downstream (上线)
功能完整、可运行、已验收。上线序见 `audit/frontend-token-audit.md` §7:① 合并代码、`AUTH_ENFORCE_DEFAULT_DENY=false`(行为不变)② 跑迁移 `012`(seed rate_limiting)③ 测试环境置 flag=true + 跑 §4 FE 冒烟(test-node 扇出、媒体经白名单、后台限流页、经代理 429 真实倒计时)④ 生产置 true。限流 `RateLimitConfig.enabled` 默认 true 且额度宽松,后台 `/api/rate-limit` 可热调(数秒生效)。
