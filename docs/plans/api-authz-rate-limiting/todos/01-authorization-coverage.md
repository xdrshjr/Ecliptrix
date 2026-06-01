# TODO 01 — 鉴权覆盖

> Spec: [`specs/01-authorization-coverage.md`](../specs/01-authorization-coverage.md)

## Dependencies

- `depends_on: []` —— 无前置;可与 02 并行起步。
- `blocks: [05, 06]` —— 05 前端 token 审计/上线需 01 的白名单与默认拒绝开关定型;06 测试需 01 行为定型。
- `parallel_group: A` —— 与 TODO 02 同组并行(均无依赖)。
- WHY: 鉴权骨架(默认拒绝中间件)已存在于 `5473c7a`,本任务以「核对收敛 + 补角色守卫」为主,产出物(白名单、error_code、默认拒绝开关)是 05/06 的输入。

## Tasks

### A. 现状核对(必做第一步)
- [ ] Read `app/middleware/auth_middleware.py`:厘清 `_is_allowlisted` 判定顺序、`ALLOWLIST_EXACT`/`ALLOWLIST_PREFIX`/`HARD_PROTECT_PATHS` 内容、非白名单无 token 时的真实行为(是否已 401)、实际 error_code(`UNAUTHORIZED`/`ACCOUNT_DISABLED`)。
- [ ] Read `app/dependencies/auth.py`:`get_current_user`/`require_admin`/`require_root` 签名与异常;确认 `request.state.user` 快路径。
- [ ] Read `app/main.py`:38 处 `include_router` 的 prefix 与根挂载项;`StaticFiles` 挂载点。
- [ ] 产出「路由 → 当前鉴权状态 → 目标状态(public/authed/admin/root)」对照表,并标注既有 `ALLOWLIST_*` 与 spec §3.2 目标白名单的差异项。

### B. 公开白名单收敛
- [ ] 按 spec §3.2 逐项比对,补齐缺失白名单项(评审 `/api/`、`/api/config/` 等「待补」项是否真的放行);确认 `/api/auth/logout`、`/api/auth/me` 不在白名单。
- [ ] 确认 OPTIONS 预检放行;确认 `HARD_PROTECT_PATHS` 保留不弱化。

### C. 管理类角色守卫
- [ ] 给 `model_settings_router` 补 `require_admin`(R8,含 API 密钥,优先级最高)。
- [ ] 核对 `system_settings_router` / `admin_playback_router` 已有 `require_admin`,保持。
- [ ] `user_router` 管理端点(创建/删除/改角色)加 `require_admin`,改 admin 角色用 `require_root`;普通用户自身资料端点保持 `get_current_user`。
- [ ] 优先用 `APIRouter(dependencies=[Depends(require_admin)])` 组级依赖;混合路由按端点加。

### D. 默认拒绝开关(与 05 联动)
- [ ] 确认/实现默认拒绝的最终启用受开关/环境变量控制(`AUTH_ENFORCE_DEFAULT_DENY`,默认 `false`),供 05 灰度上线;中间件能力已具备,只需确保可分批放开。

### E. 自检
- [ ] 本地核对:匿名打 `/api/model-settings/*` → 401;非 admin 打管理端点 → 403;白名单端点匿名可达;带 token 正常请求无变化。
- [ ] error_code 取值保持既有(`UNAUTHORIZED`/`FORBIDDEN`/`ACCOUNT_DISABLED`),勿改名。
- [ ] 写执行摘要(files changed + 对照表 + 白名单差异结论)供 05/06。
