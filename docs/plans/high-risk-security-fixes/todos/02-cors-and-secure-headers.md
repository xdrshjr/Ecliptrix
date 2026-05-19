# TODO 02：CORS 加固与安全响应头

> 对应 spec：[`specs/02-cors-and-secure-headers.md`](../specs/02-cors-and-secure-headers.md)

## Dependencies

- **depends_on:** 无
- **blocks:** 无
- **parallel_group:** A

**依赖原因**：本任务仅触及全局中间件层，与其他 spec 修改的代码路径无交集，可与 spec/01/03/05 并行。

## 任务清单

### 阶段 A：盘点

- [ ] A1 — Read `backend-services/basic-service/app/main.py:190-220`（CORS 配置段）
- [ ] A2 — Read `backend-services/basic-service/app/config.py`，确认 `settings.env` 字段是否已存在
- [ ] A3 — `Grep -rn "CORS_ALLOWED_ORIGINS\|allow_origins" backend-services/basic-service/` 看现有引用

### 阶段 B：修复 V02-A（CORS 白名单）

- [ ] B1 — 在 `config.py` 的 Settings 类中添加：
  - `cors_allowed_origins: list[str] = Field(default_factory=list)`（从环境变量 `CORS_ALLOWED_ORIGINS` 读取，逗号分隔解析）
  - `env: str = "production"`（若不存在）
- [ ] B2 — 修改 `app/main.py` CORSMiddleware 配置：
  - `allow_origins=[...]` 改为基于 `settings.cors_allowed_origins`
  - dev 环境追加 `localhost:3000`、`localhost:3010`、`127.0.0.1:3000`
  - `allow_methods` 改为显式枚举 `["GET","POST","PUT","DELETE","OPTIONS","PATCH"]`
  - `allow_headers` 改为 `["Authorization","Content-Type","X-Requested-With"]`
- [ ] B3 — 更新 `env.template`：添加 `CORS_ALLOWED_ORIGINS=` 行并加注释说明
- [ ] B4 — 提供 `CORS_LEGACY_WILDCARD=1` 紧急回滚开关（在 main.py 中读，仅 docs 用，**默认关**）

### 阶段 C：修复 V02-B（安全响应头）

- [ ] C1 — 新建 `app/middleware/security_headers.py`：
  - `SecurityHeadersMiddleware(BaseHTTPMiddleware)`
  - `dispatch` 中无条件加 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`
  - prod 模式下加 `Strict-Transport-Security`
  - 路径以 `/docs`、`/redoc` 开头时跳过 `X-Frame-Options`（如有自嵌入需求）
- [ ] C2 — 在 `app/main.py` 注册 `app.add_middleware(SecurityHeadersMiddleware)`，位置：CORS 之后

### 阶段 D：测试

- [ ] D1 — 新建 `backend-services/basic-service/tests/security/test_02_cors_headers.py`
- [ ] D2 — 测试 dev 环境 preflight：`OPTIONS /api/health` with `Origin: http://localhost:3000` → 200 + 正确 ACAO
- [ ] D3 — 测试 prod 环境（mock settings.env）：未授权 origin 请求 → 响应不含 ACAO
- [ ] D4 — 测试所有响应都有 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`
- [ ] D5 — 测试 prod 环境响应含 HSTS；dev 不含
- [ ] D6 — 跑 `pytest backend-services/basic-service/tests/security/test_02_cors_headers.py -v`

### 阶段 E：前端联动核查

- [ ] E1 — Grep 前端 `credentials: 'include'` 或 `withCredentials` 用法，确认前端跨域调用与新 CORS 配置兼容
- [ ] E2 — 本地启动 dev（`npm run dev` + `uvicorn`），手工冒烟一两条登录 + 拉数据请求

### 阶段 F：回归

- [ ] F1 — `pytest backend-services/basic-service/tests/ -v`
- [ ] F2 — `npm run type-check`

## 完成准则

- [ ] V02-A 与 V02-B 均有补丁
- [ ] CORS 在 dev 仍工作，prod 默认拒绝未授权 origin
- [ ] 所有响应携带安全头
- [ ] 测试套 100% 绿
