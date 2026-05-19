# TODO 03：外部进程与 SSRF 防护

> 对应 spec：[`specs/03-external-process-injection.md`](../specs/03-external-process-injection.md)

## Dependencies

- **depends_on:** 无（新模块 `app/security/url_guard.py` 是新建）
- **blocks:** 无（spec/04 的 path 校验思想相近但独立实现）
- **parallel_group:** A

**依赖原因**：`url_guard.py` 是新建模块，不冲突任何现有文件；其他 spec 引用它的地方都在各自任务内部插入。

## 任务清单

### 阶段 A：盘点

- [ ] A1 — Read `backend-services/basic-service/app/services/youtube_service.py` 全文，列出所有 `yt_dlp` / `YoutubeDL` 调用点
- [ ] A2 — Read `backend-services/basic-service/app/services/preview_proxy_service.py` 与 `app/routers/preview_proxy_router.py`、`media_proxy_router.py`
- [ ] A3 — Read `backend-services/basic-service/app/services/video_composition_service.py` 中所有 `subprocess.run([...])` 调用，标注每个的命令参数来源
- [ ] A4 — 确认 `settings.storage_root`、`settings.cached_materials_dir`、`settings.temp_dir` 在 config.py 中的实际字段名

### 阶段 B：新建 `app/security/url_guard.py`

- [ ] B1 — 创建目录 `backend-services/basic-service/app/security/`（含 `__init__.py`）
- [ ] B2 — 实现 `validate_external_url(url, *, allow_redirects_resolved=True)`：
  - scheme 白名单 `{http, https}`
  - 拒绝 `user:pass@` 形式
  - DNS 解析所有 A/AAAA → 拒绝 private/loopback/link-local/reserved
  - 拒绝 BLOCKED_HOSTS（localhost、metadata.*）
  - 返回规范化 URL；失败抛 `URLGuardError`
- [ ] B3 — 实现 `validate_local_path_for_ffmpeg(path, allowed_roots)`：
  - 拒绝 `file://`、`http://` 前缀
  - `Path(path).resolve()` + `is_relative_to(root.resolve())` 双层校验
  - 拒绝符号链接落到 allowed_roots 外
  - 返回规范化 `Path`；失败抛 `URLGuardError`
- [ ] B4 — 提供环境开关：`URL_GUARD_ALLOW_PRIVATE` 仅 dev 启用，prod 强制拒绝

### 阶段 C：接入 yt-dlp（V03-A）

- [ ] C1 — 在 `youtube_service.py` 每个 yt-dlp 调用前：`url = validate_external_url(request.url)`，失败 → router 层返回 400
- [ ] C2 — `ydl_opts["socket_timeout"] = 15`
- [ ] C3 — `ydl_opts["nocheckcertificate"] = False`（确保证书校验开启）
- [ ] C4 — 评估是否引入 `allowed_extractors` 白名单（视业务确认）

### 阶段 D：接入 preview_proxy / media_proxy（V03-C/D）

- [ ] D1 — 在 `preview_proxy_service.py` / 对应 router 的入口校验 `upstream_url = validate_external_url(payload.upstream_url)`
- [ ] D2 — FFmpeg 命令统一加 `["-protocol_whitelist", "http,https,tcp,tls,crypto"]`（**不**含 `file`）
- [ ] D3 — `media_proxy_router.py` 同样接入 URL 校验

### 阶段 E：接入视频合成本地路径校验（V03-E）

- [ ] E1 — 在 `video_composition_service.py` 接收 timeline / source path 的入口加：
  - `clip.source_path = str(validate_local_path_for_ffmpeg(clip.source_path, ALLOWED_ROOTS))`
  - `clip.source_url = validate_external_url(clip.source_url)`（如存在）
- [ ] E2 — 本地合成场景的 FFmpeg 命令显式 `-protocol_whitelist file,crypto,pipe`（**不**含 http/https）
- [ ] E3 — 严禁同一条 ffmpeg 命令同时启用 `file` + 网络协议

### 阶段 F：测试

- [ ] F1 — 新建 `backend-services/basic-service/tests/security/test_03_url_guard.py`
- [ ] F2 — 单元测试：
  - 正向：合法 https URL → 通过；合法本地相对路径 → 通过
  - 攻击向量：`file://`、`http://localhost`、`http://169.254.169.254`、`http://user:pass@host`、绝对路径、`../../etc/passwd`
- [ ] F3 — 集成测试：
  - `POST /api/youtube/info { url: "file:///etc/passwd" }` → 400
  - `POST /api/preview-proxy { upstream_url: "http://127.0.0.1:8000/x" }` → 400
- [ ] F4 — 跑 `pytest backend-services/basic-service/tests/security/test_03_url_guard.py -v`

### 阶段 G：回归

- [ ] G1 — `pytest backend-services/basic-service/tests/ -v` 全绿
- [ ] G2 — 用真实合法 YouTube URL 烟测一次 `/api/youtube/info` 仍能返回视频信息

## 完成准则

- [ ] V03-A/C/D/E 均有补丁（V03-B 中危记入附录不修）
- [ ] `url_guard.py` 单元测试覆盖 ≥ 10 个用例
- [ ] FFmpeg 调用全部接入 `-protocol_whitelist`
- [ ] 测试套 100% 绿；合法 YouTube/Pexels URL 仍可用
