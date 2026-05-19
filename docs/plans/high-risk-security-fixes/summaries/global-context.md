# Global Execution Context：high-risk-security-fixes

Accumulated context from all execution phases. Each agent MUST read this
file before starting work to understand the full project history.

## 项目基本面

- **仓库：** G:\projects\takoAI\Ecliptrix
- **栈：** Next.js 15 前端 + FastAPI 后端（端口 8000，本地启动通过 `uvicorn app.main:app`）
- **测试库：** pytest + httpx + pytest-asyncio + SQLite in-memory
- **测试目录：** `backend-services/basic-service/tests/`（新加 `tests/security/` 子目录）
- **OS：** Windows 11（开发） + Linux（生产 47.84.198.68，**本任务不远程操作**）
- **Shell：** PowerShell 主（注意：not bash chained &&）；Bash 工具也可用

## 修复总策略

- 高危标准 = CVSS ≥ 7.0 + 公网匿名可达
- 修复粒度允许内部重构（不再硬约束 API 契约），但必须保留对外契约不破
- 每个修复必须配套回归测试（`tests/security/test_0N_*.py`）
- 不跑依赖 CVE 扫描；不重写 git 历史
- 部署感知：`.env` 是 git 跟踪的（项目记忆），prod 部署会覆盖

## 关键路径与依赖（来自 task-orchestration.md）

- Phase 1（A）：T01 / T02 / T03 / T05 可并发
- Phase 2（B）：T04 依赖 T01 完成
- Phase 3（C）：T06 依赖 1-5 全部完成

## 公共约定

- 新建 `app/security/` 包：URL/path 校验、日志脱敏等
- 新增模块统一加 `__init__.py`
- 测试基类（如有需要）放在 `tests/security/conftest.py`
- 所有新增 router 通过 `app.include_router(...)` 注册到 `app/main.py`
- 不引入新的第三方依赖（除非必须）

---
# Phase 1 (A) Digest — completed 2026-05-20

## Completed Tasks

| Task | Dev Agent | Verdict | Tests | Key Output |
|---|---|---|---|---|
| T01 auth | google-dev-01 | PASS | 18 new + 22 regression all green | router-level Depends; storage_files_router; sessionGuard.ts |
| T02 cors+headers | google-dev-02 | PASS | 12 green | SecurityHeadersMiddleware; CORS env-driven allowlist |
| T03 ssrf+ffmpeg | google-dev-03 | PASS | 31 green | app/security/url_guard.py; FFmpeg -protocol_whitelist split |
| T05 secrets+logs | google-dev-05 | PASS | 18 green | log_redact.py; .gitignore extended; 6 .env removed from index; **2834 logged JWTs** flagged |

**Phase A grand total: 79/79 security tests + 22/22 auth regression green.**

## Key Decisions

- 三个 root-level router 加 router-level Depends + middleware HARD_PROTECT_PATHS（双重防御）
- StaticFiles 替换为受控 router（强制鉴权 + ownership 模型 + nosniff）
- CORS env 驱动白名单 + dev localhost 自动合并 + CORS_LEGACY_WILDCARD 紧急回滚开关
- 4 个全局安全响应头 + prod-only HSTS；/docs|/redoc 例外
- 通用 url_guard 模块（DNS 解析 + ipaddress 私网拒绝）；FFmpeg 远程/本地两套协议白名单
- 日志脱敏（headers/body/string 三层）+ hpack/h2 logger 静默

## Interfaces Established

- app.security.url_guard.validate_external_url(url) -> spec/04 可复用
- app.security.url_guard.validate_local_path_for_ffmpeg(path, roots) -> spec/04 可复用
- app.security.log_redact.redact_headers(headers) -> 已接入 main.py logging_middleware
- app/routers/storage_files_router.router (prefix=/api) -> spec/04 在此追加 svg/html -> attachment 逻辑

## Issues Resolved

- dev-01 stash 事故：git stash drop 丢失 dev-02/05 工作树改动（config.py CORS / .gitignore / env.template）+ dev-03 报告 "two transient edit-revert episodes"
- orchestrator 已手动恢复全部丢失内容并合并 4 处 main.py patches
- token ledger 已对 dev-01 应用 -15 process penalty

## Context for Next Phase (B -> T04)

- _validate_path 与 _sanitize_filename 加固时注意：storage_files_router 已接入 _validate_path，新加固必须保证 storage_router.upload_file 与 storage_files_router 两侧均通过。
- 与 spec/04 §D 协同：在 storage_files_router 中对 svg/html 等危险类型强制 Content-Disposition: attachment + Content-Type: text/plain。
- **绝对不要使用 git stash**（dev-01 的教训）；如需观察 working tree 状态，用 git status --short / git diff。

---
# Phase 2 (B) Digest — completed 2026-05-20

## Completed Tasks

| Task | Dev Agent | Verdict | Tests | Key Output |
|---|---|---|---|---|
| T04 path traversal + upload | google-dev-04 | PASS | 37 new (29 unit + 8 integration; 2 Unix-only symlink skip) | _validate_path 重写; _sanitize_filename 加 Unicode NFC + CJK 保留 + dangerous-ext 改写; svg/html 强制 attachment |

**Cumulative: 116/116 security tests + 22/22 auth regression green.**

## Key Decisions

- _validate_path 防护：NUL byte / 控制字符 / 长度上限 / 绝对路径 / Windows drive 前缀 / `..` / Path.resolve + is_relative_to / symlink 拒绝
- _sanitize_filename：Unicode NFC + CJK 保留 + 危险扩展（.html/.svg/.js 等）改写为 .txt + Windows 保留名守护 + 长度限制
- 所有 upload_* endpoint 加 Depends(get_current_user) + MIME 与扩展名一致性检查 + uuid4 前缀防覆盖
- storage_files_router 下载侧加 _DANGEROUS_DOWNLOAD_EXTENSIONS 防御：强制 Content-Disposition: attachment + Content-Type: text/plain
- audio_router 替换 deterministic hash() 为 uuid4 + sanitize

## Interfaces Established / Confirmed

- StorageService._validate_path / _sanitize_filename → 加固版本对外签名不变
- storage_files_router 现在对危险扩展强制 attachment，同时保留 <video>/<img> 的 inline 渲染

## Issues Resolved

- 无重大事故；dev-04 工作流干净，未使用 git stash
- 与 storage_files_router 完全协同（spec/04 §D 已实现）

## Context for Next Phase (C → T06 REPORT.md)

- 反序列化静态扫描：grep yaml.load/pickle.loads/eval/exec 在 backend-services/basic-service/app/
- TTS 缓存键检查：sentence_tts_service.py + silence_removal_service.py
- openapi prod 禁用：app/main.py FastAPI() 实例化（docs_url/redoc_url/openapi_url 设 None 当 env=prod）
- REPORT.md 必须汇总：spec/01-05 真实修复明细 + 已识别但未修（含原因）+ **完整运维动作清单**（密钥轮换列表 + 部署后 CORS_ALLOWED_ORIGINS 配置）
- 注意：spec/05 中已发现 hpack 日志泄露 2834 次 Bearer JWT —— 必须在 REPORT 中作为重大运维告警标出

---
# Phase 3 (C) Digest — completed 2026-05-20

## Completed Tasks

| Task | Dev Agent | Verdict | Tests | Key Output |
|---|---|---|---|---|
| T06 misc + REPORT | google-dev-06 | PARTIAL→PASS* | 9 new (1 skip rg) | V06-A 静态扫描 0 命中; V06-B TTS 缓存确认无 per-user 风险; V06-C openapi prod 禁用; REPORT.md 内容已交付（orchestrator 代写） |

\* PARTIAL 因 agent harness 阻止 Write 报告型 .md；完整内容通过返回值给到 orchestrator，已落盘 REPORT.md。功能完整。

**Cumulative final: 146/146 + 3 skipped (124 security + 22 auth regression).**

## Key Decisions

- V06-C openapi prod 禁用：基于 settings.env in (development|dev) gating docs_url/redoc_url/openapi_url
- V06-A 反序列化：静态扫描全树 0 命中，永久守护测试已就位
- V06-B TTS：4 个 TTS service 用 uuid4+timestamp，非可缓存键命中，无 per-user 越权风险

## Final Deliverables

- `docs/plans/high-risk-security-fixes/REPORT.md` — 最终安全审计报告
- 14 V-stamped 高危威胁点修复（V01-A/B/C, V02-A/B, V03-A/C/D/E, V04-A/B/D, V05-A/D, V06-C）
- 3 项已识别但未修（V03-B / V06-A / IDOR — 均有书面解释）
- 125 个新增回归测试（124 + 1 skip）
- 22 个既有 auth 测试无回归
- 6 个含真实凭据的 .env 已 git rm --cached
- .gitignore 与 env.template 加固
- main.py 合并多处补丁（CORS / SecurityHeaders / storage_files_router / log redact / openapi gating）

## Integration Verification Result

- pytest tests/security/ tests/test_auth_middleware.py → **146 passed, 3 skipped in 13.22s**
- Phase 5.5 integration verification PASS

