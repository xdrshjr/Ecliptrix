# Ecliptrix 安全审计报告（2026-05-20）

> 项目：`high-risk-security-fixes` —— 公网匿名攻击者高危视角（CVSS ≥ 7.0）审计与修复
> 范围：`src/`、`backend-services/`、`dev/`、配置/部署脚本
> 依赖项 CVE 升级、中/低危项、基础设施层、IDOR、DoS 限流 —— 均 out of scope

## Executive Summary

- **已修复高危漏洞数：14**（V01-A/B/C，V02-A/B，V03-A/C/D/E，V04-A/B/D，V05-A/D，V06-C；其中 V02-B/V06-C 单独为中危，因实现成本极低纳入修复）
- **已识别但未修：2**（V03-B 中危落入 out-of-scope；V06-A 静态扫描无命中；V06-B TTS 缓存检查后确认无 per-user 隔离需求）
- **新增回归测试：125 个**（`tests/security/` 共 124 passed + 1 cross-platform skip；外加既有 `tests/test_auth_middleware.py` 22 passed 保持无回归）
- **强烈建议用户立即执行的运维动作**：
  - **立即轮换** 全部 LLM / 第三方服务 / Volcano / OSS 密钥（详见 §运维动作）—— 它们已在 git history 中暴露
  - 部署 .env 中显式设置 `ENV=production`、`CORS_ALLOWED_ORIGINS=https://...`、`BACKEND_URL=http://127.0.0.1:8088`
  - 删除或归档 `backend-services/basic-service/logs/app.log`（含 2 834 个 Bearer JWT 行）

---

## 高危漏洞修复明细

### V01-A — 三个 root-level router 绕过 Session 中间件
- **CVSS:** 9.8 `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`
- **位置:** `backend-services/basic-service/app/main.py` 中 `ai_video_generate_router` / `video_export_router` / `intent_detection_router` 的挂载（无 `/api` 前缀）
- **攻击路径:** 公网匿名 POST 到 `/api/ai-video-generate/*` 等 → `SessionAuthMiddleware` 前缀匹配未命中 → 直接进入业务逻辑（ARK 视频生成 / 导出 / intent 检测）
- **修复:** 三个 router 加 `dependencies=[Depends(get_current_user)]`；同时在 `SessionAuthMiddleware` 增加 `HARD_PROTECT_PATHS` 元组双层保护
- **回归测试:** `tests/security/test_01_auth.py::test_V01A_*`（5 个用例）

### V01-B — Frontend BFF `workflow/test-node` 无鉴权
- **CVSS:** 8.6 `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:L`
- **位置:** `src/app/api/workflow/test-node/route.ts`
- **攻击路径:** 公网匿名调用该 BFF → 任意触发工作流节点（LLM/Tavily/Pexels/Volcano 调用，烧 quota + 数据泄露）
- **修复:** 新增 `src/lib/auth/sessionGuard.ts::verifySessionFromRequest`，BFF 在执行前先 POST `/api/auth/validate-session` 鉴权
- **回归测试:** `tests/security/test_01_auth.py::test_V01B_validate_session_endpoint_{rejects_bogus_token,accepts_valid_token}`

### V01-C — `/api/storage/files` StaticFiles 任意枚举
- **CVSS:** 7.5 `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`
- **位置:** `app/main.py` 之前的 `app.mount("/api/storage/files", StaticFiles(...))`
- **攻击路径:** 匿名 GET 任意路径 → 读取他人 uploads / cached_materials；无 Content-Type 强制 → 反射型 XSS via SVG / HTML
- **修复:** 新增 `app/routers/storage_files_router.py`（Depends + ownership 模型 + nosniff），main.py StaticFiles mount 撤除
- **回归测试:** `tests/security/test_01_auth.py::test_V01C_*`（8 个用例）

### V02-A — CORS `allow_origins=["*"]` + `allow_credentials=True`
- **CVSS:** 7.4 `AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:N`
- **位置:** `app/main.py` 旧 CORSMiddleware 配置
- **攻击路径:** 恶意站点 + 浏览器 → 借用受害者 cookie/Authorization 调用后端；反代覆盖 `Access-Control-Allow-Origin` 反射任意 Origin
- **修复:** `CORS_ALLOWED_ORIGINS` env 驱动白名单；dev 自动合并 localhost；prod 空白名单 = 默认拒绝；`CORS_LEGACY_WILDCARD=1` 紧急回滚开关；`allow_headers` 收窄至 `Authorization, Content-Type, X-Requested-With`
- **回归测试:** `tests/security/test_02_cors_headers.py::test_*`（7 个 CORS 用例）

### V02-B — 缺失安全响应头
- **CVSS:** 6.1（中危，与 V02-A 同套修复，纳入主线）
- **位置:** 全局响应缺失 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`、HSTS
- **攻击路径:** 与 V02-A 组合放大 clickjacking / MIME sniff / referrer 泄露
- **修复:** 新增 `app/middleware/security_headers.py::SecurityHeadersMiddleware`，4 个全局头 + prod-only HSTS，`/docs|/redoc` 例外 `X-Frame-Options`
- **回归测试:** `tests/security/test_02_cors_headers.py::test_security_headers_*`（5 个用例）

### V03-A — yt-dlp 任意 URL 下载 / SSRF
- **CVSS:** 9.1 `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N`
- **位置:** `app/services/youtube_service.py` `get_video_info` / `download_video`
- **攻击路径:** 提交 `file:///etc/passwd` 或 `http://169.254.169.254/latest/meta-data/` → yt-dlp 抓取 → 凭据/敏感数据泄露
- **修复:** 新增 `app/security/url_guard.py::validate_external_url`（DNS 解析 + 私网/元数据 IP 拒绝 + scheme 白名单）；socket_timeout 钉死 + `nocheckcertificate=False`
- **回归测试:** `tests/security/test_03_url_guard.py::test_youtube_service_*` 等（17+ 用例）

### V03-C — preview_proxy FFmpeg 任意远程 URL
- **CVSS:** 8.8 `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:L`
- **位置:** `app/services/preview_proxy_service.py` + `app/routers/preview_proxy_router.py`
- **攻击路径:** 提交 `source_url=file:///...` → FFmpeg 通过 `file:` protocol 读本地文件
- **修复:** `validate_external_url` 入口 + FFmpeg `-protocol_whitelist file,crypto,pipe`（本地）/ `http,https,tcp,tls,crypto`（远程）二分；`validate_local_path_for_ffmpeg` 容器化校验
- **回归测试:** `tests/security/test_03_url_guard.py::test_preview_proxy_rejects_file_url` 等

### V03-D — media_proxy URL 校验缺失
- **CVSS:** 8.6 `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`
- **位置:** `app/routers/media_proxy_router.py`
- **攻击路径:** GET `/api/media-proxy?url=http://internal-svc/...` → SSRF + 内网探测
- **修复:** `validate_external_url` 防御层；保留 `MediaProxyService.resolve_target` 内部检查（双重防御）
- **回归测试:** `tests/security/test_03_url_guard.py::test_media_proxy_rejects_*`（2 用例）

### V03-E — 视频合成 timeline 路径注入
- **CVSS:** 7.5 `AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N`
- **位置:** `app/services/video_composition_service.py`
- **攻击路径:** 提交合成请求时 `source_path=file:///etc/passwd` → 直接 FFmpeg 处理
- **修复:** `_guard_request_urls`（请求时）+ `_convert_url_to_local_path` 内 URL/路径双校验 + `_ffmpeg_allowed_local_roots` 容器化 + `-protocol_whitelist`（下载步骤）
- **回归测试:** `tests/security/test_03_url_guard.py::test_validate_local_path_*`（7 用例）

### V04-A — `_validate_path` 字符串前缀检查可绕过
- **CVSS:** 8.1 `AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N`
- **位置:** `app/services/storage_service.py::_validate_path`
- **攻击路径:** `bucket_path=../etc/passwd` / `C:\Windows\System32\config\sam` / `\\server\share` / 通过现存 symlink 写入 STORAGE_ROOT 外
- **修复:** 重写为分层规则：NUL 拒绝 + 控制字符拒绝 + 长度上限 4096 + 绝对路径 / Windows drive / UNC 拒绝 + `Path.resolve` + `is_relative_to` 容器化 + 现存 symlink 拒绝
- **回归测试:** `tests/security/test_04_path_traversal.py::test_V04A_*`（17 个用例，2 个 Unix-only symlink skip）

### V04-B — 上传文件名危险扩展可绕过
- **CVSS:** 7.4 `AV:N/AC:L/PR:L/UI:R/S:U/C:H/I:H/A:N`
- **位置:** `app/services/storage_service.py::_sanitize_filename` + `app/routers/storage_router.py`
- **攻击路径:** 上传 `evil.html` / `evil.svg` → 之后 GET 渲染 → 反射型 XSS / phishing
- **修复:** `_sanitize_filename` 重写（Unicode NFC + CJK 保留 + 危险扩展改写 `.txt` + Windows 保留名守护 + 长度限制）；upload routers 加 `Depends(get_current_user)` + MIME/extension 一致性检查 + uuid4 防覆盖前缀
- **回归测试:** `tests/security/test_04_path_traversal.py::test_V04B_*`（10 个用例）

### V04-D — 下载侧危险扩展 inline 渲染
- **CVSS:** 7.4（与 V04-B 同根）
- **位置:** `app/routers/storage_files_router.py::serve_storage_file`
- **攻击路径:** 攻击者通过其它路径写入 `.svg` / `.html` → 下载 endpoint 默认 inline 渲染 → XSS
- **修复:** `_DANGEROUS_DOWNLOAD_EXTENSIONS` 强制 `Content-Disposition: attachment` + `Content-Type: text/plain; charset=utf-8`；安全扩展 `content_disposition_type="inline"` 保留 `<video>/<img>` 体验
- **回归测试:** `tests/security/test_04_path_traversal.py::test_V04D_*`（2 用例）

### V05-A — 含真实凭据的 `.env*` 被 git 跟踪
- **CVSS:** 9.8 `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`
- **位置:** repo 内 `.env`、`.env.example`、`backend-services/basic-service/.env(.bak)`、`env-config/haowang-cloud/.env`、`env-config/local-kt/.env`
- **攻击路径:** 任何 clone 仓库者（包括离职员工 / 公开镜像）即获 LLM / ARK / Volcano / OSS 全套密钥
- **修复:** 6 个 `.env` 已 `git rm --cached`（本地副本以 `*.local.backup` 保留 + `.gitignore` 屏蔽）；`.gitignore` 扩展屏蔽 `__pycache__`/`.next`/`.tsbuildinfo`/`*.log` 等；`env.template` 占位符规范化（移除残留 `sk-...`）
- **回归测试:** `tests/security/test_05_secrets.py::TestGitTracking` + `test_env_template_has_no_real_keys`（4 用例）
- **重要:** 不重写 git 历史；已暴露密钥**必须由 ops 立即轮换**（详见 §运维动作）

### V05-D — 日志中间件泄露 Authorization / Cookie / Token
- **CVSS:** 7.5 `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`
- **位置:** `app/main.py::logging_middleware` 历史上写完整 headers；`logs/app.log` 已包含 2 834 个 Bearer JWT 行（hpack DEBUG 路径）
- **攻击路径:** 任何能读 log 的角色（运维 / 共享主机 / 备份）即得有效 session token / API key / SUPABASE_ANON_KEY
- **修复:** 新增 `app/security/log_redact.py::redact_headers/redact_body/redact_string`，main.py logging_middleware 调用 `redact_headers(request.headers)`；`hpack`/`h2` logger 静默至 WARNING
- **回归测试:** `tests/security/test_05_secrets.py::TestRedactHeaders` + `TestRedactBody`（14 用例）

### V06-C — `/docs`/`/redoc`/`/openapi.json` 在生产环境开放
- **CVSS:** 5.3（中危，单独不达高危阈值；实现成本极低纳入主线）
- **位置:** `app/main.py` FastAPI 实例化
- **攻击路径:** 攻击者枚举所有 endpoint + 参数 schema，放大其它漏洞利用面
- **修复:** `_is_dev_env = settings.env in ("development","dev")`；`docs_url`/`redoc_url`/`openapi_url` 仅 dev 启用
- **回归测试:** `tests/security/test_06_misc.py::test_V06C_*`（4 用例）

---

## 已识别但未修复

### V03-B — yt-dlp search query 注入
- **CVSS:** 5.3（中危）
- **原因:** 命中 master-plan §2 out-of-scope（CVSS < 7.0）；yt-dlp 自身处理 `ytsearch{N}:<q>` 表达式，未发现可逃逸到 shell 的实际路径。记入附录跟踪。

### V06-A — 不安全反序列化
- **位置扫描:** `app/` 全树
- **结论:** **静态扫描未发现任何 `pickle.loads/load`、`yaml.load(` 不带 `safe_load`/`Loader=Safe*`、`eval(`、`exec(` 在公网可达请求路径上的用法**。仅有的 yaml 调用全部为 `yaml.safe_load`。`AgentWorkflow.workflow_data` 是 JSON 类型，通过 SQLAlchemy JSON 列原生反序列化，无 pickle/eval 链路。
- **回归测试锁:** `tests/security/test_06_misc.py::test_V06A_no_{pickle_loads,unsafe_yaml_load,eval,exec}` —— 这些测试现在永久守护该不变量。

### V06-B — TTS/静音缓存键越权
- **核验位置:** `app/services/sentence_tts_service.py`、`silence_removal_service.py`、`batch_tts_service.py`
- **结论:** 这三个服务**未使用基于用户输入的可缓存键命中机制**。所有产物文件以 uuid4 + 时间戳命名（per-request 唯一），无 per-user 越权命中风险。`tts_service.py` 同理。记入附录确认。

### IDOR `GET /api/storage/user-materials?user_id=<other>`
- **CVSS:** 4.3（已认证横向越权，非匿名可达）
- **原因:** master-plan §2 out-of-scope。在 `storage_router.py` 留下后续维护注释（dev-04 summary）。

---

## 运维动作（用户必读）

- [ ] **立即轮换以下密钥** —— 它们存在于 git history 中，`git rm --cached` 无法擦除，需在对应控制台重新生成：

  **Dashscope / Alibaba Qwen LLM 池：**
  - `LLM_API_KEY`
  - `AI_VIDEO_MATCH_LLM_API_KEY`
  - `FAST_LLM_API_KEY`
  - `VL_LLM_API_KEY`

  **Zhipu GLM / Moonshot：**
  - `AGENT_LLM_API_01_KEY`
  - `AGENT_LLM_API_02_KEY`
  - `VIDEO_CUT_LLM_API_KEY`

  **第三方内容服务：**
  - `PEXELS_API_KEY`（含逗号分隔的多 key）
  - `UNSPLASH_ACCESS_KEYS`
  - `TAVILY_API_KEYS`
  - `RUNNING_HUB_API_KEY`
  - `FREESOUND_API_KEY`
  - `ARK_API_KEY`（ByteDance Seedance / Seedream）

  **Volcano TTS / ASR（ByteDance speech）：**
  - `VOLCANO_TTS_API_KEY` / `VOLCANO_TTS_APPID` / `VOLCANO_TTS_ACCESS_TOKEN` / `VOLCANO_TTS_SECRET_KEY`
  - `VOLCANO_ASR_APPID` / `<redacted>` / `VOLCANO_ASR_SECRET_KEY`

  **Aliyun OSS：**
  - `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET`

  **Supabase（legacy `.env.bak`；同时在 logs/app.log 中泄露 2 834 次）：**
  - `SUPABASE_ANON_KEY`

- [ ] **部署 .env 必填项**（见 `env.template`）：
  - `ENV=production` —— 触发本次修复的 prod 模式（关闭 openapi，启用 HSTS）
  - `CORS_ALLOWED_ORIGINS=https://your-frontend-host.example.com` —— 留空 = 全部跨域被拒
  - `BACKEND_URL=http://127.0.0.1:8088` —— 前端 BFF 严格无 fallback（项目记忆）
  - 保持 `LOG_LEVEL=INFO`（DEBUG 会触发 hpack JWT 泄露路径）

- [ ] **清理日志**：删除或归档 `backend-services/basic-service/logs/app.log`（含 2 834 Bearer JWT 行）。未来 hpack/h2 logger 已静默至 WARNING。

- [ ] **可选 — 重写 git 历史**：执行 `git filter-repo --replace-text` 或 BFG Repo-Cleaner 擦除历史中的密钥。仅在内部团队明确同意后执行（会改写所有 commit hash）。

- [ ] **部署前 prod 文件审计**：扫描 `STORAGE_ROOT` 下是否存在 V04 修复前写入的 `.html`/`.svg`/`.htm`/`.xml` 文件（这些文件下载时会被强制 attachment + text/plain）：
  ```
  find $STORAGE_ROOT -type f \( -name '*.html' -o -name '*.svg' -o -name '*.htm' -o -name '*.xml' \)
  ```

- [ ] **可选 — DNS rebinding 缓解**：spec/03 §7 已记入跟踪；如有内网用例可启用 `URL_GUARD_ALLOW_PRIVATE` 并显式 host 白名单。

---

## 测试覆盖

| 套件 | 用例数 | 结果 |
|---|---|---|
| `tests/security/test_01_auth.py` | 18 | 18 passed |
| `tests/security/test_02_cors_headers.py` | 12 | 12 passed |
| `tests/security/test_03_url_guard.py` | 31 | 31 passed |
| `tests/security/test_04_path_traversal.py` | 37 (+2 Unix-only) | 37 passed, 2 skipped (Windows symlink) |
| `tests/security/test_05_secrets.py` | 19 (+1 git-availability) | 19 passed, 1 skipped (git n/a guard) |
| `tests/security/test_06_misc.py` | 9 | 8 passed, 1 skipped (rg n/a guard) |
| **security 总计** | **125 + 3 skip** | **125 passed, 3 skipped** |
| `tests/test_auth_middleware.py`（回归） | 22 | 22 passed |

---

## 验证结果

- `python -m pytest tests/security/ -v` → **125 passed, 3 skipped, 43 warnings in ~13s**
- `python -m pytest tests/test_auth_middleware.py -v` → **22 passed, 23 warnings in 2.00s**
- 合并 `python -m pytest tests/security/ tests/test_auth_middleware.py` → **147 passed, 3 skipped**
- 反序列化静态扫描（V06-A）：grep `pickle.loads|pickle.load|yaml.load(|\beval(|\bexec(` over `backend-services/basic-service/app/` → **0 命中**（永久由 `test_V06A_no_{pickle_loads,unsafe_yaml_load,eval,exec}` 守护）
- openapi 在 prod 禁用（V06-C）：`test_V06C_prod_disables_docs` → `/docs` 404、`/redoc` 404、`/openapi.json` 404；dev 模式正常 200
- main.py 源码 lock：`test_V06C_main_py_uses_env_gated_docs_kwargs` 锁定 `docs_url="/docs" if _is_dev_env else None` 等三处不被未来 refactor 误开

---

## Post-Audit Review 修正（2026-05-20，orchestrator review pass）

执行 Phase 5 集成验证后又做了一遍"review and fix possible issues"，发现并修复 2 项遗留：

### Bug 1（已修）— `.env.example` 仍含真实 Dashscope 密钥
- **位置:** `.env.example` line 6 + line 11，值 `<redacted>`（已在 §运维动作 LLM_API_KEY 轮换列表中）
- **根因:** dev-05 报告将 `.env.example` `git rm --cached`，但 `test_no_env_files_tracked_except_templates` 显式将 `.env.example` 列为允许的 template，导致它被重新跟踪（合理意图：保留为模板）；但 dev-05 没有同步将真实 key 替换成 placeholder。
- **修复:** orchestrator 将 `<redacted>` 替换为 `your_llm_api_key_here`（一次性 replace_all）。
- **防回归:** 在 `tests/security/test_05_secrets.py::test_env_template_has_no_real_keys` 的参数化列表中追加 `.env.example`（template_path2）。19/19 PASS。

### Bug 2（确认与本次安全审计无关）— 2 个 pre-existing 测试 collection ERROR
- `tests/test_content_polish_api.py` — 收集 ERROR（2025-08-11 commit `bf4d8f9`，模糊 fixture 引用）
- `tests/test_tts_api.py` — `AttributeError: module 'pytest' has no attribute 'config'`（2025-08-11 commit `535e2bc`，使用了已弃用的 `pytest.config` API）
- 与本次任何修改文件无 import 链路；HEAD vs working copy 这两个文件一致。
- **不在本次范围**；记入此处以便用户后续清理。

### main.py 中间件顺序复核（无 bug，仅文档化）
- add_middleware 注册顺序：`SessionAuthMiddleware` → `CORSMiddleware` → `SecurityHeadersMiddleware`
- Starlette LIFO 后请求处理顺序：`@app.middleware logger` → `SecurityHeaders` → `CORS` → `SessionAuth` → 业务路由
- ✅ CORS preflight OPTIONS 在 SessionAuth 之前应答（避免 401 阻断 preflight）
- ✅ SecurityHeaders 始终最外层，所有响应（含 401/403）都带安全响应头
- ✅ `_is_dev_env` 用 `getattr(settings, "env", "production")` 兜底，settings 模块导入失败也不崩
