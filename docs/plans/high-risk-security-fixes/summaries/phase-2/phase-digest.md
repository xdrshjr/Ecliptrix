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
