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
