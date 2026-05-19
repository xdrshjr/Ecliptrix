# TODO 05：凭据与配置泄露

> 对应 spec：[`specs/05-secrets-and-config-exposure.md`](../specs/05-secrets-and-config-exposure.md)

## Dependencies

- **depends_on:** 无
- **blocks:** 无
- **parallel_group:** A

**依赖原因**：本任务多为文件层（.env / .gitignore）与日志层操作，不冲突任何 spec。

## 任务清单

### 阶段 A：核验 `.env*` 实际内容（决定是否高危）

- [ ] A1 — `Glob backend-services/basic-service/.env*`、`Glob env-config/**/.env*`、`Glob .env*` 列出全部文件
- [ ] A2 — Read 每个文件，标注：
  - 是占位符模板（`<your-key>`、`changeme`、`""`）？
  - 还是真实凭据（含 `sk-...`、长 base64、url with token）？
- [ ] A3 — 跑 `git ls-files | rg "\.env"` 确认哪些被 git 跟踪
- [ ] A4 — 若发现真实凭据被跟踪 → 在 REPORT.md 中列出待轮换清单（不输出实际 key 值）

### 阶段 B：从 git 移除被跟踪的 `.env*`（不重写历史）

- [ ] B1 — 对每个含真实凭据的 `.env*`：
  - `git rm --cached <file>`（保留本地）
  - 在本地添加备份注释（如 `.env.bak.local`）
- [ ] B2 — 不处理 `env.template`、`.env.example`（保留模板）

### 阶段 C：增强 `.gitignore`

- [ ] C1 — Read 现有 `.gitignore`
- [ ] C2 — 追加：
  ```
  # Secrets
  .env
  .env.*
  !.env.example
  !env.template

  # Python
  __pycache__/
  *.pyc
  *.pyo
  *.pyd

  # Next.js / Node
  .next/
  out/
  *.tsbuildinfo

  # Editors
  .idea/
  .vscode/

  # Logs
  *.log
  backend-services/basic-service/logs/

  # Cached materials
  backend-services/basic-service/static/cached_materials/
  ```
- [ ] C3 — 确认 `git status` 后没新增本应被忽略的脏文件

### 阶段 D：env.template 占位符规范化

- [ ] D1 — Read `backend-services/basic-service/env.template` 与根目录 `env.template`、`.env.example`
- [ ] D2 — 对每行 `KEY=VALUE`：若 VALUE 不属于显式占位（`<replace-me>`、`your-...`、`changeme`、`""`）→ 改为 `<your-KEY-here>` 形式
- [ ] D3 — 在文件开头加 banner 注释提醒"部署前必须填实际值"

### 阶段 E：前端 `process.env.LLM_API_KEY` fallback 加固

- [ ] E1 — Read `src/app/api/chat/route.ts` 全文，定位 fallback 路径
- [ ] E2 — 检查 `next.config.js`：确认 `env`、`publicRuntimeConfig` 与 webpack DefinePlugin 未将 `LLM_API_KEY` 暴露给客户端 bundle
- [ ] E3 — 在 fallback 路径加 `console.warn`（脱敏，不打印 key 本身），便于运维观察
- [ ] E4 — 跑 `npm run build` → `grep -r "sk-" .next/static/` 或类似命令验证产物不含密钥
- [ ] E5 — 若发现 bundle 中泄露 → 改为强制走后端 resolve（去掉 fallback），后端失败时返回 503

### 阶段 F：日志脱敏

- [ ] F1 — 新建 `backend-services/basic-service/app/security/log_redact.py`（或放在 `app/utils/`）
  - `SENSITIVE_HEADERS = {"authorization", "cookie", "x-session-token", "x-api-key"}`
  - `SENSITIVE_BODY_KEYS = {"password", "token", "secret", "api_key", "session_token", "active_session_token"}`
  - `redact_headers(headers)` 与 `redact_body(body)`
- [ ] F2 — `Grep -rn "logger.*headers\|log.*headers\|logger.*request" backend-services/basic-service/app/` 找出所有日志中可能记录 header 的位置
- [ ] F3 — 替换为 `logger.info(redact_headers(request.headers))` 等
- [ ] F4 — 同样处理 body：替换 `logger.info(body)` → `logger.info(redact_body(body))`
- [ ] F5 — Read `backend-services/basic-service/logs/app.log`（如存在，且文件不大），抽样 grep `Bearer` / `session` 看历史是否泄露（不修改历史日志，仅用于报告）

### 阶段 G：测试

- [ ] G1 — 新建 `backend-services/basic-service/tests/security/test_05_secrets.py`
- [ ] G2 — 测试 `redact_headers`：
  - `{"Authorization": "Bearer xyz", "Content-Type": "json"}` → Authorization 变 `***REDACTED***`
- [ ] G3 — 测试 `redact_body`：
  - `{"password": "abc", "user": "u"}` → password 变 `***REDACTED***`
- [ ] G4 — 静态测试（subprocess 跑命令）：
  - `git ls-files` 输出不含 `.env`（除 example/template）
  - `git ls-files` 输出不含 `__pycache__`
- [ ] G5 — 跑 `pytest backend-services/basic-service/tests/security/test_05_secrets.py -v`

### 阶段 H：报告补充

- [ ] H1 — 在 REPORT.md 的"运维动作"部分追加：
  - 立即轮换的密钥清单（按 env.template 中所有 KEY，标注高危）
  - 提醒：git 历史中泄露的密钥即使 git rm 也仍在历史中
  - 可选：建议执行 `git filter-repo` 或 `bfg-repo-cleaner` 重写历史（**仅在用户同意时执行**）

## 完成准则

- [ ] V05-A 被跟踪的 `.env*` 已 git rm --cached
- [ ] V05-B `.gitignore` 已扩充
- [ ] V05-C 前端 bundle 验证不含密钥（或已修复）
- [ ] V05-D 日志中间件已脱敏
- [ ] V05-E env.template 已规范化
- [ ] REPORT.md 含密钥轮换建议清单
- [ ] 测试套 100% 绿
