# TODO 03 — 配置与后台 API

> Spec: [`specs/03-config-and-admin-api.md`](../specs/03-config-and-admin-api.md)

## Dependencies

- `depends_on: [02]` —— Provider 暴露的 `RateLimitConfig`/配置键必须与 02 中间件消费的键完全一致;`/status` 取 02 `rate_limiter` 快照。
- `blocks: [04, 06]` —— 04 前端表单消费 `GET /config` schema;06 测试后台 API 与热加载。
- `parallel_group: B` —— 与 TODO 05 同组并行(03 依赖 02,05 依赖 01,互不依赖)。
- WHY: 配置是限流的数据来源;Provider 契约定型后,前端 UI(04)与中间件(02)才能稳定对接。

## Tasks

### A. 配置存储 + 默认值
- [ ] 在 `app/config.py` 加 `rate_limiting` 默认值 fallback 常量(7 键,见 spec §2.1),复用既有 `per_ip_rate_limit_per_min` 模式。
- [ ] 确认复用 `SystemSetting`(category+key→JSON)+ `SettingsAuditLog`,无需新表。

### B. 种子迁移(Alembic)
- [ ] Read `alembic/versions/004_seed_default_settings.py` 与最新版本(确认当前最新为 `011`)。
- [ ] 新增迁移 `012`(`down_revision="011"`),插入 `rate_limiting` 全部默认键;每行写 `value`/`default_value`/`value_type`/`description` 四列(均 NOT NULL)。
- [ ] 幂等:`INSERT ... ON CONFLICT ON CONSTRAINT uq_system_settings_category_key DO NOTHING`;`downgrade` 仅 `DELETE WHERE category='rate_limiting'`(勿清空整表)。
- [ ] 兼容 alembic+create_all 混合启动。

### C. 热加载 Provider(`app/services/rate_limit_config.py`)
- [ ] 实现 `RateLimitConfigProvider`:TTL(5–10s)缓存 + `asyncio.Lock` 双检;`async get_config() -> RateLimitConfig`(命中缓存无 DB I/O);`invalidate()`。
- [ ] 缺键回退 `config.py` 默认;DB 不可用降级默认(不打挂全站)。
- [ ] 全局单例 `rate_limit_config_provider`;`startup` 预热一次。
- [ ] 与 02 对接:替换 02 的本地 fallback 为本 Provider。

### D. 后台 API(`app/routers/rate_limit_settings_router.py`,`require_admin`)
- [ ] `GET /api/rate-limit/config`:返回 `{enabled, window_seconds, limits:{...}, meta:{<key>:{default,type,min,max,description}}}`(与 spec §3 schema 一致,供 04 表单)。
- [ ] `PUT /api/rate-limit/config`:逐键范围校验,越界 422 不写库;写 `SystemSetting`(`updated_by=current_user.username`)+ `SettingsAuditLog`(`changed_by=current_user.username`、`action='update'`);调 `invalidate()`。
- [ ] `POST /api/rate-limit/reset`:重置全部键为默认 + 审计(`action='reset'`)+ 失效缓存。
- [ ] `GET /api/rate-limit/status`:`enabled`(取自配置)+ `active_keys`/`total_checked`/`total_blocked`(取自 02 快照)。
- [ ] 在 `app/main.py` 注册 `prefix="/api/rate-limit"`;路由组 `require_admin`。

### E. 自检
- [ ] 迁移后 7 键就位且幂等(重复执行不报错)。
- [ ] `GET /config` 含 meta;非 admin → 403。
- [ ] `PUT` 改 `ai_generation_per_min` + invalidate 后,02 中间件即时按新值限流;越界 422。
- [ ] 审计可经既有 `GET /api/system-settings/audit-log?category=rate_limiting` 查到。
- [ ] 写执行摘要(Provider 契约、config schema、迁移号)供 04/06。
