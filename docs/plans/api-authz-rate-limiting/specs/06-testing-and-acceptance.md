# Spec 06 — 测试与验收 (Testing & Acceptance)

> 对应 master-plan §8、§2(目标 8)
> 模块边界: 后端 `tests/`(pytest + SQLite 内存库);前端手动/脚本冒烟
> 测试范围决策:中间件单测 + 关键接口集成测试 + 429 行为测试(非全路由回归)

## 1. 目标

验证鉴权覆盖、限流内核、配置热加载、后台 API 与前端 429 行为符合 spec 01-05 契约,并形成验收 traceability。沿用项目既有 pytest + SQLite 内存库测试基建。

## 2. 测试设计

### 2.1 单元测试(中间件 / 内核)

| 测试文件(建议) | 覆盖 | 关键用例 |
|---|---|---|
| `tests/test_rate_limiter_core.py` | spec 02 `RateLimiter` | 窗口内放行/超限拒绝;窗口滚动恢复;`retry_after` 计算;并发(asyncio.gather)下计数正确;GC 不丢错 |
| `tests/test_category_resolver.py` | spec 02 `resolve_category` | 各类别路径正确分流;`/api/audio/generated/` 归 media 而非 ai(顺序正确);默认归 normal |
| `tests/test_client_ip.py` | spec 02 `get_client_ip` | X-Forwarded-For 多段取首段;缺失回退 request.client |
| `tests/test_auth_middleware.py`(**已存在,核对/补充而非新建**) | spec 01 默认拒绝 | 白名单匿名放行;非白名单匿名 401;有效 token 注入 user;停用账号 403;OPTIONS 放行 |
| `tests/test_rate_limit_config_provider.py` | spec 03 Provider | TTL 内命中缓存(无 DB);过期刷新;invalidate 立即失效;DB 缺键回退默认;`window_seconds` 等键解析正确 |

> ⚠️ **`test_auth_middleware.py` 已落地**:spec 01 的认证中间件已实现(`app/middleware/auth_middleware.py`),且该测试文件已存在并覆盖 T1–T18 + 分支用例。本 spec 对 spec 01 的职责是**核对现有用例是否仍满足「默认拒绝」契约并按需补充**(如新增受保护端点的匿名 401 用例),而非重写。注意现有实现导出的常量为 `ALLOWLIST_EXACT` / `ALLOWLIST_PREFIX`(非 `PUBLIC_ALLOWLIST`),错误码为 `UNAUTHORIZED` / `ACCOUNT_DISABLED` / `FORBIDDEN`(非 `auth.*` 点分形式);编写断言时以实际实现为准。

### 2.2 集成测试(关键接口,FastAPI TestClient/httpx)

| 测试文件 | 覆盖 | 关键用例 |
|---|---|---|
| `tests/test_authz_integration.py` | spec 01 | 代表性受保护端点(workflow / tts / model-settings)匿名→401;普通用户→200;管理端点非 admin→403、admin→200;白名单端点匿名→200 |
| `tests/test_rate_limit_integration.py` | spec 02+03 | 连续请求触发 429 + `Retry-After`;`ai_generation` 比 `normal` 更早触发;`auth` 按 IP;`enabled=false` 不限流;媒体高额度不被打断 |
| `tests/test_rate_limit_admin_api.py` | spec 03 | `GET /config` 含 meta;`PUT` 越界 422(含 `window_seconds` 超 10–3600);`PUT` 改值 + invalidate 后即时生效;`POST /reset` 复位默认;审计写入;`/status` 字段;非 admin 403 |

### 2.3 429 行为测试

并入 `test_rate_limit_integration.py`:断言状态码 429、`Retry-After` 头存在且为正整数、响应体 `error_code="rate_limit.exceeded"`、统一 `ErrorResponse` 形状。

### 2.4 前端冒烟(手动 + 可选脚本)

- 手动核对(对应 spec 05 上线 checklist):`AUTH_ENFORCE_DEFAULT_DENY=true` 下登录、视频编辑、TTS、工作流、媒体播放无回归。
- 后台「接口安全/限流」页:读/改/重置/状态展示正常;429 toast 正常。
- 可选 e2e 冒烟脚本:命中 1 个受保护接口 + 1 个限流接口验证 401/200/429。

## 3. 测试基建与夹具

- 沿用 `tests/` 既有 conftest:SQLite 内存库(`sqlite+aiosqlite:///:memory:`)、async session(`db_session` fixture)。注意根 `conftest.py` 只提供裸 `db_session`,**不含 TestClient fixture**——既有测试(如 `test_auth_middleware.py`)是在用例内自建最小 FastAPI app + `fastapi.testclient.TestClient` 并 monkeypatch `async_session_factory` 指向内存库;本 spec 的集成测试沿用同一手法,而非依赖一个全局 client fixture。
- **JSONB→JSON 兼容(重要)**:`SystemSetting` / `SettingsAuditLog` 使用 PostgreSQL `JSONB` 列,直接对内存 SQLite 跑 `create_all` 会失败。凡触达这两表的测试(spec 03 Provider / 后台 API,即 `test_rate_limit_config_provider.py`、`test_rate_limit_admin_api.py`)须沿用 `test_settings_services.py` 的 workaround:在 `create_all` 前把 `JSONB` 列类型替换为 `JSON()`(见该文件 fixture),不能直接复用根 conftest 的 `db_session`。
- **配置覆盖**:测试通过 fixture 注入低额度配置(如 normal=3/min)便于快速触发 429,避免真打 300 次;或直接构造 `RateLimitConfig` 注入 Provider(`invalidate` + 桩)——与 spec 03 的 `RateLimitConfigProvider`(`get_config()` / `invalidate()`)契约一致,无需真打 DB。
- **限流状态隔离**:每个测试前重置 `rate_limiter` 内部 `_windows`(避免用例间串扰),提供 `reset()` 钩子或新建实例。
- **认证夹具**:构造 admin / regular / 匿名三种请求上下文(带/不带有效 session token);构造用户行参考 `test_auth_middleware.py` 的 `_create_user`(写入 `active_session_token` 并以 `Authorization: Bearer <token>` 发起请求)。
- 注意单进程内存限流在测试内天然单进程,无 R3 问题。

## 4. 验收 Traceability(对应 master-plan §8)

| 验收标准 | 验证手段 |
|---|---|
| 匿名受保护→401;管理类非 admin→403 | `test_authz_integration.py` |
| 超限 429 + Retry-After;各类别独立 | `test_rate_limit_integration.py` |
| 后台改动数秒/即时热生效 + 审计 | `test_rate_limit_admin_api.py` + `test_rate_limit_config_provider.py` |
| 默认宽松、播放不被误伤 | `test_rate_limit_integration.py`(media 高额度用例) |
| 前端 429 友好提示 | 前端冒烟 |
| 后台新菜单可读写限流配置 | `test_rate_limit_admin_api.py`(后端读写/校验) + 前端冒烟(后台页读/改/重置) |
| 默认拒绝开启后无回归 | spec 05 上线 checklist + 手动回归 |
| 中间件单测 + 集成 + 429 通过 | 全部上述测试 |

## 5. 接口契约 (Interfaces)

- **Consumes**: spec 01-05 全部产出(鉴权中间件、限流内核、配置 Provider、后台 API、前端 UI/429、token 审计与上线开关)。
- **Produces**: 测试套件 + 验收报告(traceability 勾稽)。
- 命令:`pytest tests/ -v`;覆盖率可选 `pytest tests/ --cov=app`。

## 6. 验收点

1. 上述单测 + 集成测试在 `pytest tests/ -v` 下全绿。
2. 429/401/403 行为与 spec 契约一致。
3. traceability 表每行有对应通过的测试或冒烟记录。
4. 关键用户流程手动回归无问题(默认拒绝开启)。
