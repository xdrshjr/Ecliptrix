# Spec 02：CORS 加固与安全响应头

> 覆盖 master-plan §3.2 与 §3.7（CORS + 安全响应头）

## 1. 范围

- FastAPI `CORSMiddleware` 配置中的 `allow_origins=["*"]` + `allow_credentials=True` 反模式
- 缺失的安全响应头（`X-Content-Type-Options`、`X-Frame-Options` / CSP `frame-ancestors`、`Referrer-Policy`、`Strict-Transport-Security` 在 prod、`Permissions-Policy`）
- 同步前端：dev 环境下确保跨域调用仍工作

**不包含：** 完整 CSP 策略（含 script-src 等）—— 那是大工程，与本次"高危修复且不破坏功能"目标冲突，仅加 frame-ancestors。

## 2. 已识别的具体威胁点

### V02-A：CORS 通配符 + credentials

- **位置：** `backend-services/basic-service/app/main.py:195-201`
- **现状（伪示意）：**
  ```pseudo
  CORSMiddleware(
      allow_origins=["*"],
      allow_credentials=True,
      allow_methods=["*"],
      allow_headers=["*"],
  )
  ```
- **机制：** FastAPI 在 `allow_origins=["*"]` + `allow_credentials=True` 时，会在响应中回显请求 Origin（而非返回 `*`），从而绕过浏览器的安全限制。任意网站可在用户已登录 Ecliptrix 的状态下发起带 cookie 的跨域请求，读取响应（含会话 token、用户数据）。
- **CVSS v3.1：** 7.6 — `CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:L/A:N`
  - 需诱使用户访问恶意网站（UI:R），但配合现存的 `localStorage` token 失窃路径，可在浏览器同源域外读取受害者会话数据（S:C 范围变化）。
- **PoC 思路：** 攻击者控制的 `evil.com` JS 发起 `fetch('http://victim-prod-host/api/auth/me', { credentials: 'include' })` → 浏览器允许并返回响应。

### V02-B：缺失的安全响应头

- **位置：** `app/main.py` 全局无 `SecurityHeadersMiddleware`，所有响应均无：
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY` 或 CSP `frame-ancestors 'none'`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`（按需）
- **机制：** 无 `X-Frame-Options` → 可被恶意页面 iframe，结合 V02-A 实现 clickjacking 接管会话。无 `nosniff` → 上传的伪装文件可能被浏览器按 HTML/JS 渲染（攻击放大）。
- **CVSS v3.1：** 单独评估各项均 < 7.0（典型为 5.4 `CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N`）；**组合**与 V02-A、spec/04 文件上传同时存在时，攻击链整体达到高危阈值（≥ 7.0），故纳入本次修复以阻断放大路径。

## 3. 修复方案

### V02-A：白名单 + 环境感知

```pseudo
# 1. config.py 增加字段：
class Settings(BaseSettings):
    cors_allowed_origins: list[str] = []  # 由环境变量 CORS_ALLOWED_ORIGINS（逗号分隔）填充
    cors_allow_credentials: bool = True
    env: str = "production"  # 已存在或新增

# 2. main.py CORSMiddleware 改造（伪码）：
origins = settings.cors_allowed_origins
if settings.env in ("development", "dev"):
    # 开发环境允许 localhost 端口集合
    origins = origins + ["http://localhost:3000", "http://localhost:3010", "http://127.0.0.1:3000"]

if not origins:
    # 生产未配置 → 安全失败：拒绝跨域
    origins = []   # 空列表 → CORSMiddleware 默认行为不会回显任意 Origin

CORSMiddleware(
    allow_origins=origins,                    # 关闭通配符
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)

# 3. env.template 增加：
#    CORS_ALLOWED_ORIGINS=https://your-frontend.example.com,https://staging.example.com
```

**部署提醒：** 由于 `.env` 是 git 跟踪的（项目记忆），部署后必须手工填写 `CORS_ALLOWED_ORIGINS`。

### V02-B：新建 SecurityHeadersMiddleware

```pseudo
# app/middleware/security_headers.py（新建）：

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        # 始终
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        # 仅 prod
        if settings.env == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

# main.py 注册：
app.add_middleware(SecurityHeadersMiddleware)
```

**例外：** `/docs`、`/redoc` 在 dev 可能需要内嵌资源 → 用前缀豁免（middleware 内判断 path）。

## 4. 接口与行为变化

| 项 | 变更前 | 变更后（prod） |
|---|---|---|
| `Access-Control-Allow-Origin` | `*`（或反射 Origin） | 仅白名单中的 origin |
| `Access-Control-Allow-Credentials` | `true` | `true`（白名单内才回应） |
| `X-Frame-Options` | 缺失 | `DENY` |
| `X-Content-Type-Options` | 缺失 | `nosniff` |
| `Referrer-Policy` | 缺失 | `strict-origin-when-cross-origin` |
| `Strict-Transport-Security` | 缺失 | `max-age=31536000`（prod-only） |

dev 环境（`env=development`）保留宽松 origins，行为不变。

## 5. 验证策略

`backend-services/basic-service/tests/security/test_02_cors_headers.py`：

- **正向：**
  - dev 环境 `localhost:3000` Origin → preflight `OPTIONS` 200 + 正确 `Access-Control-Allow-Origin: http://localhost:3000`
  - prod 配置白名单 `https://app.example.com` → 该 origin 请求 OK
  - 所有响应包含 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`
- **攻击向量：**
  - prod 环境，未授权 origin `evil.com` 发起带 credentials 请求 → 响应不含 `Access-Control-Allow-Origin: evil.com`，浏览器侧会拒绝
  - 无任何 origin（同源）→ 正常 200，行为不变
  - 默认（未配置 origins） → 不回响 ACAO 头

## 6. 依赖关系

- **depends_on:** 无
- **blocks:** 无（独立完成即可）
- **parallel_group:** A

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| prod 部署后 `.env` 没填 `CORS_ALLOWED_ORIGINS` → 前端 503 | 在 README/REPORT 中明确警告；提供回滚开关（env 变量 `CORS_LEGACY_WILDCARD=1` 临时恢复，**不推荐**） |
| `X-Frame-Options: DENY` 影响某些 embed 场景 | 全仓 grep `iframe` / `embed`，未发现自嵌入用法 |
| HSTS 改为 prod-only 但部分用户跨 staging/prod | 通过 `settings.env` 控制；改动小，回滚容易 |
