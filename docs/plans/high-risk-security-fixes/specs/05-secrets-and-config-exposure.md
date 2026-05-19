# Spec 05：凭据与配置泄露

> 覆盖 master-plan §3.5

## 1. 范围

- Git 仓库中跟踪的 `.env*` 文件（含 `.env.bak`、`env-config/*/.env`、`.env.example`）
- `.gitignore` 缺失敏感模式（`.env`、`__pycache__/`、`*.pyc`、`.next/`、`.idea/` 等）
- 前端代码中 fallback 读取 `process.env.LLM_API_KEY` 等服务器端机密
- 后端日志泄露：`app/main.py` 启动期或请求中间件是否打印完整 headers（Authorization / Cookie / session token）
- `env.template` 是否将示例值留作能被误用的"真实样貌"

**不包含：**
- Git 历史重写（rebase / filter-repo）—— 用户未要求；本 spec 仅 git rm + .gitignore，并强烈建议密钥轮换
- 第三方密钥泄露后的实际撤销与轮换 —— 这是用户运维责任，本 spec 仅在报告中提示

## 2. 已识别的具体威胁点

### V05-A：跟踪进 Git 的 `.env*` 文件

- **位置（来自 Phase 1 盘点）：**
  - `backend-services/basic-service/.env.bak`（**疑似** 含真实凭据备份）
  - `env-config/haowang-cloud/.env`（**疑似** 生产环境真实凭据）
  - `env-config/local-kt/.env`（开发凭据）
  - `env.template`（模板，但需确认是否含实际密钥而非占位符）
  - `.env.example`（示例文件，需确认）
- **机制：** 任何能访问 Git 仓库（GitHub、镜像、克隆）的人即获得密钥；公开仓库 → 公网匿名可达（满足攻击模型）。
- **CVSS v3.1：** 9.8 — `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`（如果包含 prod 凭据；需 Phase 4 DEV agent 实测确认是否为占位符）
- **PoC：** `git clone <repo>; cat env-config/haowang-cloud/.env`

### V05-B：`.gitignore` 严重不全

- **位置：** `.gitignore`（来自 CLAUDE.md：仅含 `/node_modules/`, `static/uploads/`, `venv/`, `backend-services/basic-service/data/`）
- **机制：** 缺失 `.env`、`.env.*`、`__pycache__/`、`*.pyc`、`.next/`、`.idea/`、`tsconfig.tsbuildinfo`、`*.log` 等模式。未来开发者一不小心又会提交 `.env`。
- **CVSS v3.1：** 5.0 — `CVSS:3.1/AV:L/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`（无直接远程攻击路径，但与 V05-A 复合 → 修复方案绑定）

### V05-C：前端 `process.env.LLM_API_KEY` fallback

- **位置：** `src/app/api/chat/route.ts:55-70`（fallback 路径）
- **机制：** 当后端 `/api/model-settings/resolve/chat` 失败时，BFF 在服务端直接读环境变量并向 LLM 发起请求。`LLM_API_KEY` 无 `NEXT_PUBLIC_` 前缀，正常情况下 Next.js 不会把它编进 client bundle；但需要核验以下两点：
  - `next.config.js` 中无 `publicRuntimeConfig` / `env` / `webpack DefinePlugin` 把该变量显式暴露到 client
  - fallback 触发时日志中间件是否会记录请求头或上游响应（潜在敏感字段泄露）
- **CVSS v3.1：** 视实际编译产物决定 —— 若 bundle 中**无**密钥则 5.5（`CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N`，中危）；若 bundle 中**有**则升级为 9.8（`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`）
- **需 Phase 4 DEV agent 实际跑 `next build` 验证产物**。

### V05-D：日志中的敏感数据

- **位置：** `app/main.py` 中间件、`logger.info(request.headers)` 等
- **机制：** 若中间件打印完整 headers，则 Authorization / Cookie / session token 进入日志文件。配合 `logs/` 目录被错误 mount 或备份外泄 → 泄露。
- **CVSS v3.1：** 7.5 — `CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N`（需打到日志 + 日志可读，链路较长，故 AC:H）
- **PoC：** 查看 `backend-services/basic-service/logs/app.log` 是否含 token 模式

### V05-E：`env.template` 的"看起来真实"占位符

- **位置：** `backend-services/basic-service/env.template`、`env.template`
- **机制：** 部分模板中可能填了`sk-xxxxxxx`这种半真实的格式 → 误以为是真值 → 部署时直接使用。需确保所有占位符显式标注 `<replace-me>` 或 `your-key-here`。
- **CVSS v3.1：** N/A（不直接构成漏洞，但纳入修复以防误用）

## 3. 修复方案

### 3.1 .env 文件清理（V05-A）

```pseudo
# 操作顺序（DEV agent 执行）：
1. Read 每个嫌疑 .env 文件，确认是否含真实密钥（非占位符）
2. 对于含真实密钥的：
   a. git rm --cached <file>（保留本地副本但取消跟踪）
   b. echo "<file>" >> .gitignore
   c. 在 REPORT.md 中显式标注："以下密钥已暴露，建议立即轮换：<list>"
3. 对于纯占位符模板（env.template / .env.example）：
   a. 保留跟踪，但检查内容确为占位符
   b. 不在 .gitignore 中屏蔽

# 注意：本次不重写 Git 历史。已暴露的 commit 仍可通过 git log 访问；
#       修复仅阻断未来再次推送。
```

### 3.2 .gitignore 增强（V05-B）

```pseudo
# 在现有 .gitignore 后追加：
# === Secrets ===
.env
.env.*
!.env.example
!env.template

# === Python ===
__pycache__/
*.pyc
*.pyo
*.pyd

# === Next.js / Node ===
.next/
out/
*.tsbuildinfo

# === Editors ===
.idea/
.vscode/

# === Logs ===
*.log
backend-services/basic-service/logs/

# === Cached materials (large binaries) ===
backend-services/basic-service/static/cached_materials/
```

### 3.3 前端 LLM_API_KEY fallback（V05-C）

```pseudo
# src/app/api/chat/route.ts：
# 1. 验证 Next.js 配置：next.config.js 中无 publicRuntimeConfig 将 LLM_API_KEY 暴露给客户端
# 2. fallback 路径若真有必要，加日志（脱敏）记录何时被触发，便于后续观察
# 3. 长期方案：去掉 fallback，要求后端 resolve 成功；resolve 失败直接 502

# 临时方案（不破坏现状）：
if (resolveResult.ok) { use resolved config }
else if (process.env.LLM_API_KEY) {
    log.warn("LLM resolver fallback to env-var (this should be rare)")
    // 不打印 key 本身
    use env config
}
else { return 503 }
```

### 3.4 日志脱敏中间件

```pseudo
# app/middleware/logging.py 或现有 logger 中加：

SENSITIVE_HEADERS = {"authorization", "cookie", "x-session-token", "x-api-key"}
SENSITIVE_BODY_KEYS = {"password", "token", "secret", "api_key", "session_token", "active_session_token"}

def redact_headers(headers: dict) -> dict:
    return {k: ("***REDACTED***" if k.lower() in SENSITIVE_HEADERS else v) for k, v in headers.items()}

def redact_body(body: dict | str) -> dict | str:
    if isinstance(body, dict):
        return {k: ("***REDACTED***" if k.lower() in SENSITIVE_BODY_KEYS else v) for k, v in body.items()}
    # 字符串：尝试匹配 bearer / token 模式并替换
    return re.sub(r"(Bearer\s+)[\w\.-]+", r"\1***REDACTED***", body, flags=re.IGNORECASE)

# 在所有 logger.info(headers) / logger.info(body) 调用处替换为：
logger.info(redact_headers(request.headers))
```

### 3.5 env.template 占位符校验

```pseudo
# 操作：
1. Read env.template / .env.example
2. 对每行 KEY=VALUE，若 VALUE 不属于 {<placeholder>, your-..., changeme, EXAMPLE_*, ""}，
   则改为显式占位符 "<your-KEY-here>"
3. 不影响构建（VALUE 由部署时 .env 覆盖）
```

## 4. 接口与行为变化

| 项 | 变更 |
|---|---|
| Git 跟踪文件 | `.env.bak`、`env-config/*/.env` 移出（git rm --cached） |
| `.gitignore` | 新增大量模式（见 3.2） |
| 后端日志 | 敏感 header / body key 替换为 `***REDACTED***` |
| LLM fallback | 不破坏，仅加 warn 日志（脱敏） |
| `env.template` 内容 | 占位符规范化 |

**对运行时无任何破坏性变更。** 仅"文件不再被 git 跟踪"，本地仍可用。

## 5. 验证策略

`backend-services/basic-service/tests/security/test_05_secrets.py`：

- **静态测试（非 pytest）：**
  - 跑 `git ls-files | grep -E '\.env(\.|$)'` → 期望仅匹配 `env.template` 与 `.env.example`
  - 跑 `git ls-files | grep '__pycache__'` → 期望空
- **pytest 测试：**
  - 调用 `redact_headers({"Authorization": "Bearer xyz", "Content-Type": "application/json"})` → 期望 `Authorization` 被替换
  - 调用 `redact_body({"password": "abc", "user": "u"})` → password 被替换
  - 模拟 logger 调用，断言输出不含原始 token
- **手动 / 报告：**
  - 跑 `npm run build` → 检查 `.next/static/chunks/*.js` 不含 `LLM_API_KEY` 等机密字符串
  - 通过 `grep -r "LLM_API_KEY" .next/` 验证为空

## 6. 依赖关系

- **depends_on:** 无
- **blocks:** 无
- **parallel_group:** A

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `git rm --cached` 后本地副本若被 IDE 自动 stash 又提交 | `.gitignore` 屏蔽确保不会再次入库 |
| Git 历史中的密钥仍存在 | 在 REPORT.md 中**强烈建议用户立即轮换全部受影响密钥**；如有需要可后续单独执行 `git filter-repo` |
| 部署 `.env` 被覆盖（项目记忆）→ 修复后的 env.template 在 prod 失效 | env.template 仅影响新部署的初始模板；现存 prod 不受影响 |
| 日志脱敏遗漏某些 sensitive key | 维护 SENSITIVE_* 集合作为可扩展白名单；测试覆盖现有所有已知敏感 key |
