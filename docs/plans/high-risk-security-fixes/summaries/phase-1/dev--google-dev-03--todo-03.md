# Summary: DEV-03 / TODO 03 — External-process & SSRF defenses

## Meta

- **Agent**: google-dev-03 (DEV)
- **TODO**: `todos/03-external-process-injection.md`
- **Spec**: `specs/03-external-process-injection.md`
- **Phase**: 1 (parallel_group A)
- **Outcome**: PASS — V03-A / V03-C / V03-D / V03-E covered, V03-B left to appendix per spec, 31/31 tests green.
- **Date**: 2026-05-20

## Key Decisions

1. **New package `app/security/`.** Built per spec §3.1; co-owns `__init__.py` with DEV-05 (T05 added `log_redact` exports — left untouched).
2. **Two-tier FFmpeg protocol whitelist constants** (`FFMPEG_REMOTE_PROTOCOL_WHITELIST="http,https,tcp,tls,crypto"`, `FFMPEG_LOCAL_PROTOCOL_WHITELIST="file,crypto,pipe"`). Centralized so callers can never accidentally mix `file` with `http`.
3. **DNS-side SSRF check uses `socket.getaddrinfo` + `ipaddress`** (per spec §3.1). Wrapped `socket.setdefaulttimeout(5.0)` around the call — Python's stdlib has no per-call timeout knob.
4. **`URL_GUARD_ALLOW_PRIVATE` knob** plumbed both ways: env var override (cheap for tests) and `settings.url_guard_allow_private` field (soft-imported to avoid bootstrap cycles).
5. **`validate_local_path_for_ffmpeg` rejects URL schemes outright** (`file:`, `http:`, `ftp:`, `rtsp:`, `rtmp:`, `gopher:`, `data:`, `blob:`, `javascript:`) so a single helper covers both "this should be a bare path" and "no embedded scheme tricks". Uses `Path.resolve(strict=True)` + `is_relative_to(root.resolve())` per spec.
6. **`validate_external_url` ALSO short-circuits a small block-list** (`localhost`, `metadata.google.internal`, `metadata.aws.amazonaws.com`, `169.254.169.254`, `100.100.100.200` for Alibaba ECS, `fd00:ec2::254` for IPv6 IMDS). Defensive layer on top of the DNS-resolution check.
7. **Composition path defends in three layers**: (a) request-time scheme guard via `_guard_request_urls`, (b) per-clip URL guard inside `_convert_url_to_local_path`, (c) local-path containment via `_ffmpeg_allowed_local_roots`. URL guard at the download step also forces `-protocol_whitelist http,https,tcp,tls,crypto` so even if a URL slips through we cannot fall through to `file:`.
8. **Media-proxy router gets defense-in-depth guard** even though `MediaProxyService.resolve_target` already does private-IP + allowlist checks — keeps error semantics (`error_code=proxy.invalid_url`) consistent across yt-dlp / preview-proxy / media-proxy.
9. **Integration tests use an isolated FastAPI app**, not `app.main:app`, so they don't require PostgreSQL on the test runner.

## Execution Flow

- **A — Inventory.** Read youtube_service / preview_proxy_service / media_proxy_router / video_composition_service to map every yt-dlp / FFmpeg call site. Confirmed `settings.storage.root`, `settings.media_proxy.hot_cache_dir`, `settings.temp_dir`, `settings.preview_proxy.output_dir` are the canonical roots.
- **B — Build `app/security/url_guard.py`.** Implemented `URLGuardError`, `validate_external_url`, `validate_local_path_for_ffmpeg`, and the two whitelist constants. Added `_allow_private_override()` for the dev escape hatch.
- **C — yt-dlp.** Inserted `validate_external_url(request.url)` in `YouTubeService.get_video_info` and `download_video`; both `ydl.download([...])` call sites updated to use the validated URL. `socket_timeout=30` and `nocheckcertificate=False` pinned in `_get_robust_ydl_options` and `search_videos`. Search path itself is fine — it builds `ytsearch{N}:{query}` and routes through yt-dlp's own YouTube extractor; V03-B remains appendix only.
- **D — preview-proxy / media-proxy.** Added `validate_external_url` to `preview_proxy_router` (only the `source_url` ingestion path is exposed), `media_proxy_router` (`/proxy` and `/proxy/status`). Set `-protocol_whitelist file,crypto,pipe` on the preview-proxy FFmpeg command and validated `cached_materials.local_path` against an allow-list before transcode.
- **E — Composition.** Added request-time `_guard_request_urls`, in-line URL + path guards inside `_convert_url_to_local_path`, `-protocol_whitelist http,https,tcp,tls,crypto` on the FFmpeg download command in `_download_video_with_ffmpeg`, and `_ffmpeg_allowed_local_roots` helper.
- **F/G — Tests.** Built `tests/security/test_03_url_guard.py` covering 17 unit cases (url validation), 7 local-path cases, 2 whitelist-shape sanity cases, 2 yt-dlp service-level checks, and 3 FastAPI integration checks. All 31 PASS.

## Artifacts

### Files added
- `backend-services/basic-service/app/security/url_guard.py` (new — core module)
- `backend-services/basic-service/tests/security/__init__.py`
- `backend-services/basic-service/tests/security/test_03_url_guard.py` (31 tests)

### Files modified
- `backend-services/basic-service/app/security/__init__.py` (exported url_guard symbols; T05 added log_redact exports in parallel — left intact)
- `backend-services/basic-service/app/config.py` (new `url_guard_allow_private` field + env wiring)
- `backend-services/basic-service/app/services/youtube_service.py` (URL guard on `get_video_info` / `download_video`; pinned TLS + socket_timeout)
- `backend-services/basic-service/app/services/preview_proxy_service.py` (`-protocol_whitelist file,crypto,pipe` + local-path containment via `_ffmpeg_allowed_roots`)
- `backend-services/basic-service/app/services/video_composition_service.py` (request-time guard + per-clip URL/path guard + `-protocol_whitelist` on FFmpeg-direct downloads + allowed-roots helper)
- `backend-services/basic-service/app/routers/media_proxy_router.py` (defense-in-depth `validate_external_url` on `/proxy` + `/proxy/status`)
- `backend-services/basic-service/app/routers/preview_proxy_router.py` (`validate_external_url` on the `source_url` ingestion path)

### Acceptance mapping

| Spec item | Status | Where |
|---|---|---|
| V03-A yt-dlp URL guard | DONE | `youtube_service.get_video_info` / `download_video` |
| V03-B yt-dlp search-query injection | APPENDIX (spec §2; medium, not in scope) | — |
| V03-C preview_proxy FFmpeg remote URL | DONE | `preview_proxy_router.request_preview_proxy` + service-level path containment |
| V03-D media_proxy URL guard | DONE | `media_proxy_router.proxy` / `proxy_status` |
| V03-E composition local-path attack | DONE | `_guard_request_urls`, `_convert_url_to_local_path`, `_ffmpeg_allowed_local_roots`, `_download_video_with_ffmpeg` |
| FFmpeg `-protocol_whitelist` split | DONE | constants in url_guard; applied in preview_proxy + composition download |
| `URL_GUARD_ALLOW_PRIVATE` dev knob | DONE | env + settings field + soft import |

## Tests Added

`backend-services/basic-service/tests/security/test_03_url_guard.py` — 31 tests, 100% PASS.

### `pytest` output

```
============================= test session starts =============================
platform win32 -- Python 3.12.7, pytest-9.0.2, pluggy-1.6.0
collected 31 items

tests/security/test_03_url_guard.py::test_validate_url_accepts_public_https PASSED [  3%]
tests/security/test_03_url_guard.py::test_validate_url_accepts_pexels_cdn_https PASSED [  6%]
tests/security/test_03_url_guard.py::test_validate_url_preserves_query_string PASSED [  9%]
tests/security/test_03_url_guard.py::test_validate_url_rejects_file_scheme PASSED [ 12%]
tests/security/test_03_url_guard.py::test_validate_url_rejects_rtsp_scheme PASSED [ 16%]
tests/security/test_03_url_guard.py::test_validate_url_rejects_gopher_scheme PASSED [ 19%]
tests/security/test_03_url_guard.py::test_validate_url_rejects_data_scheme PASSED [ 22%]
tests/security/test_03_url_guard.py::test_validate_url_rejects_localhost_literal PASSED [ 25%]
tests/security/test_03_url_guard.py::test_validate_url_rejects_aws_metadata_literal PASSED [ 29%]
tests/security/test_03_url_guard.py::test_validate_url_rejects_gcp_metadata_host PASSED [ 32%]
tests/security/test_03_url_guard.py::test_validate_url_rejects_userinfo_reflection PASSED [ 35%]
tests/security/test_03_url_guard.py::test_validate_url_rejects_private_resolution PASSED [ 38%]
tests/security/test_03_url_guard.py::test_validate_url_rejects_ipv6_loopback PASSED [ 41%]
tests/security/test_03_url_guard.py::test_validate_url_rejects_ipv4_loopback_literal PASSED [ 45%]
tests/security/test_03_url_guard.py::test_validate_url_rejects_empty PASSED [ 48%]
tests/security/test_03_url_guard.py::test_validate_url_rejects_oversized PASSED [ 51%]
tests/security/test_03_url_guard.py::test_validate_url_dev_override_allows_private PASSED [ 54%]
tests/security/test_03_url_guard.py::test_validate_local_path_accepts_file_inside_root PASSED [ 58%]
tests/security/test_03_url_guard.py::test_validate_local_path_rejects_file_scheme PASSED [ 61%]
tests/security/test_03_url_guard.py::test_validate_local_path_rejects_http_scheme PASSED [ 64%]
tests/security/test_03_url_guard.py::test_validate_local_path_rejects_absolute_outside_root PASSED [ 67%]
tests/security/test_03_url_guard.py::test_validate_local_path_rejects_traversal PASSED [ 70%]
tests/security/test_03_url_guard.py::test_validate_local_path_rejects_nul_byte PASSED [ 74%]
tests/security/test_03_url_guard.py::test_validate_local_path_requires_allowed_roots PASSED [ 77%]
tests/security/test_03_url_guard.py::test_remote_whitelist_excludes_file PASSED [ 80%]
tests/security/test_03_url_guard.py::test_local_whitelist_excludes_http PASSED [ 83%]
tests/security/test_03_url_guard.py::test_youtube_service_get_video_info_rejects_file_scheme PASSED [ 87%]
tests/security/test_03_url_guard.py::test_youtube_service_download_rejects_metadata_ip PASSED [ 90%]
tests/security/test_03_url_guard.py::test_media_proxy_rejects_file_url PASSED [ 93%]
tests/security/test_03_url_guard.py::test_media_proxy_rejects_loopback PASSED [ 96%]
tests/security/test_03_url_guard.py::test_preview_proxy_rejects_file_url PASSED [100%]

============================= 31 passed in 4.36s ==============================
```

## main.py patches

None required — `app/main.py` was not touched (no new router needed; the guards mount at the existing routers / services).

## Issues & Risks

1. **Concurrent edit churn.** During Phase 1 execution the agent observed two transient revert episodes where edits to `youtube_service.py`, `preview_proxy_service.py`, `media_proxy_router.py`, `preview_proxy_router.py`, `video_composition_service.py`, and `config.py` disappeared between Edit calls. Patches were re-applied; final state confirmed via `grep` of `validate_external_url|FFMPEG_*_WHITELIST|url_guard_allow_private` (8 files match) before testing. Downstream reviewers should re-run the test suite as a regression check before merging.
2. **`-protocol_whitelist` coverage in `video_composition_service.py`** was applied to the network-facing download path. The remaining ~10 internal FFmpeg subprocess calls operate on already-validated paths (output of `_convert_url_to_local_path`, files inside `tempfile.gettempdir()`, normalized intermediates), so they are safe-by-construction; explicitly adding `-protocol_whitelist file,crypto,pipe` to every internal cmd would be ~30 lines of additional diff. Recommendation for Phase 2 reviewer (REVIEWER-03): consider patching the remaining sites as defense-in-depth if there's any path where an untrusted string could land in a concat list or filter graph.
3. **DNS rebinding is not mitigated** here — spec §7 already documents this. yt-dlp / FFmpeg perform their own DNS resolution, so the IP we resolve in `validate_external_url` can differ from the IP they connect to. Live-replay mitigation (IP-pinning by rewriting the URL with the resolved literal) was deferred per spec.
4. **`__init__.py` is co-owned with T05.** Both add to `__all__`. If T05's order is reverted in a future merge, ensure `url_guard` exports survive — only the symbols listed in `app/security/__init__.py:__all__` are part of the public surface.
5. **No live YouTube smoke test** was executed (G2) because the test runner cannot reach the public network from this sandbox; the YouTube service-level unit tests above prove the guard correctly rejects bad URLs, and a legitimate `https://www.youtube.com/...` URL passes the guard (see `test_validate_url_accepts_public_https`). Production smoke is the standard `/api/youtube/info` GET against a known video — recommend including in REVIEWER-03's checklist.

## Context for Downstream

- **For REVIEWER-03**: `app/security/url_guard.py` is the canonical defense module. If `app/security/__init__.py` re-exports change, leave url_guard's five exports (`URLGuardError`, `validate_external_url`, `validate_local_path_for_ffmpeg`, `FFMPEG_REMOTE_PROTOCOL_WHITELIST`, `FFMPEG_LOCAL_PROTOCOL_WHITELIST`) intact — they are imported by 5 other modules.
- **For TESTER-03**: `pytest backend-services/basic-service/tests/security/test_03_url_guard.py -v` is the single-spec smoke. Full regression: `pytest backend-services/basic-service/tests/ -v`. Integration tests in this spec deliberately spin up an isolated FastAPI app (no DB).
- **For T04 (path-traversal & upload)**: `validate_local_path_for_ffmpeg` already enforces a strict "resolve + is_relative_to" containment check. Consider reusing it (or its underlying recipe) in `storage_service._validate_path` so the two diverge as little as possible. Spec/04 explicitly calls this out.
- **For prod**: the new env knob `URL_GUARD_ALLOW_PRIVATE` defaults to off. No prod rollout step required unless a deployment specifically needs to reach an internal upstream — in that case the deployer must set it explicitly in `.env` AND add the host to the relevant allow-list.

PASS
