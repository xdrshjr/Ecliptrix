# TODO 06 — 测试与验收

> Spec: [`specs/06-testing-and-acceptance.md`](../specs/06-testing-and-acceptance.md)

## Dependencies

- `depends_on: [01, 02, 03, 04, 05]` —— 测试覆盖全部前序产出的契约与验收点。
- `blocks: []` —— 终点任务。
- `parallel_group: D` —— 独占收尾阶段。
- WHY: 必须在所有实现稳定后做集成与验收,验证跨模块契约(中间件顺序、配置热加载、429 行为、默认拒绝无回归)。

## Tasks

### A. 现状核实
- [ ] Read `tests/conftest.py` 与既有 `tests/test_auth_middleware.py`、`tests/test_settings_services.py`、`tests/test_media_proxy.py`:确认 SQLite 内存库夹具、JSONB→JSON 兼容做法、是否有全局 TestClient(多数自建 minimal app + monkeypatch `async_session_factory`)。
- [ ] 注意 `test_auth_middleware.py` 已存在(20+ 用例)→ **核对/补充而非重建**。

### B. 单元测试
- [ ] `test_rate_limiter_core.py`:窗口内放行/超限拒绝;窗口滚动恢复;`retry_after` 计算;asyncio 并发计数正确;GC 不丢错;`reset()` 隔离。
- [ ] `test_category_resolver.py`:各类别正确分流;`/api/audio/generated/` 归 media 而非 ai(顺序);默认归 normal。
- [ ] `test_client_ip.py`:X-Forwarded-For 多段取首;缺失回退 `request.client`。
- [ ] `test_rate_limit_config_provider.py`:TTL 命中无 DB;过期刷新;`invalidate` 即时失效;缺键回退默认;`window_seconds` 解析;JSONB→JSON 兼容夹具。
- [ ] (核对/补充)`test_auth_middleware.py`:默认拒绝白名单匿名放行/非白名单匿名 401/有效 token 注入/停用 403/OPTIONS 放行;断言真实 error_code(`UNAUTHORIZED`/`ACCOUNT_DISABLED`)与导出名(`ALLOWLIST_EXACT`/`ALLOWLIST_PREFIX`)。

### C. 集成测试
- [ ] `test_authz_integration.py`:workflow/tts/model-settings 匿名→401;普通用户→200;管理端点非 admin→403、admin→200;白名单匿名→200。
- [ ] `test_rate_limit_integration.py`:连续请求触发 429+`Retry-After`;`ai_generation` 比 `normal` 更早触发;`auth` 按 IP;`enabled=false` 不限流;media 高额度不被打断。用低额度配置夹具(如 normal=3/min)快速触发。
- [ ] `test_rate_limit_admin_api.py`:`GET /config` 含 meta;`PUT` 越界 422;`PUT`+invalidate 即时生效;`window_seconds` 越界 422;`POST /reset`;审计写入;`/status` 字段;非 admin 403。

### D. 429 行为
- [ ] 并入集成测试:断言 429、`Retry-After` 正整数、`error_code="rate_limit.exceeded"`、统一 `ErrorResponse` 形状。

### E. 前端冒烟(手动 + 可选脚本)
- [ ] `AUTH_ENFORCE_DEFAULT_DENY=true` 下:登录/视频编辑/TTS/工作流/媒体播放无回归。
- [ ] 后台「接口安全/限流」页读/改/重置/状态正常;429 toast 正常。
- [ ] (可选)e2e 冒烟脚本:命中 1 受保护接口 + 1 限流接口验证 401/200/429。

### F. 验收与收尾
- [ ] `pytest tests/ -v` 全绿;(可选)`pytest tests/ --cov=app`。
- [ ] 填 master-plan §8 traceability 表:每行有对应通过的测试/冒烟记录。
- [ ] 写最终验收报告(测试结果 + traceability + 已知限制如 R3 单进程)。
