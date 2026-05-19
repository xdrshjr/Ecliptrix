# Spec 03：外部进程与 SSRF 防护

> 覆盖 master-plan §3.3（yt-dlp / FFmpeg / preview_proxy / media_proxy）

## 1. 范围

- yt-dlp：用户传入 URL/query 直入 `YoutubeDL.extract_info` 与 `ytsearch{N}:{query}`
- FFmpeg via `preview_proxy_service.py`：用户控制的 upstream URL 进入 FFmpeg
- `media_proxy_router`：HTTP 代理是否做 SSRF 防护
- 视频合成时 timeline JSON 中 `source_path` / `file_path` 是否过滤本地路径前缀（防止 ffmpeg 读取 `/etc/passwd`、`\\?\C:\Windows\...` 等）

**不包含：**
- FFmpeg 自身 CVE（依赖层，user 已排除）
- yt-dlp 自身的认证 cookie 文件管理

## 2. 已识别的具体威胁点

### V03-A：yt-dlp URL 未验证（SSRF + 任意下载）

- **位置：**
  - `backend-services/basic-service/app/services/youtube_service.py:270` — `get_video_info(request.url)`
  - 同文件 `:401, :550, :570` — 下载/转换路径
- **机制：** yt-dlp 默认支持 800+ 站点提取器，包括 `http://localhost`、`file://`、`http://169.254.169.254`（AWS metadata）等。攻击者传入 `http://localhost:8000/api/admin/...`（带凭据反射）、`http://169.254.169.254/latest/meta-data/`（云元数据），yt-dlp 会发起请求并返回内容。
- **CVSS v3.1：** 9.3 修复前（`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:N/A:L`）；spec/01 修复落地后，攻击者需登录，按 PR:L 重估为 8.2（`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:N/A:L`），仍属高危。本 spec 以 8.2 为基准评估修复优先级。
- **PoC：** `POST /api/youtube/info { url: "http://169.254.169.254/latest/meta-data/iam/security-credentials/" }` → 拿到云凭据。

### V03-B：yt-dlp search query 注入

- **位置：** `youtube_service.py` search 接口将 `request.query` 拼成 `ytsearch{limit}:{query}`
- **机制：** yt-dlp 的 search query 中若含 `--` 或特殊片段（如换行），可能改变行为；同时 query 过长可触发 ReDoS / DoS。
- **CVSS v3.1：** 5.3 — `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:L`（中危，不在本次范围；仅记录附录）

### V03-C：preview_proxy_service FFmpeg 远程 URL

- **位置：** `backend-services/basic-service/app/services/preview_proxy_service.py`（FFmpeg 调用点）
- **机制：** 路由 `/api/preview-proxy` 或 `/api/media-proxy` 接收 `upstream_url`，作为 FFmpeg 输入 URL。FFmpeg 可直接读 `file://`、`http://localhost`、`rtsp://` 等协议。
- **CVSS v3.1：** 8.1 修复前 — `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:N/A:N`；spec/01 修复后按 PR:L 重估 7.1。同上类型 SSRF，加上 FFmpeg 可触达本地文件 (`file:///etc/passwd`)。
- **PoC：** `POST /api/preview-proxy { upstream_url: "file:///etc/passwd" }` → 文件内容被 FFmpeg "转码" 后通过流接口返回。

### V03-D：媒体代理 router 验证

- **位置：** `app/routers/media_proxy_router.py`、`preview_proxy_router.py`
- 需通过 Read 确认：
  - 输入 URL 是否走白名单校验
  - 是否仅允许 https://、blocked private IP ranges（10.0.0.0/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7）
  - 是否检测 redirect chain 中含私网 IP

### V03-E：FFmpeg 本地路径攻击（视频合成）

- **位置：** `video_composition_service.py`（多处 subprocess 调用）
- **机制：** timeline JSON 中 `source_path` 在合成端被 FFmpeg 打开。若 timeline 来自用户上传或工作流生成，攻击者可注入 `file:///etc/passwd` 或绝对路径 `/etc/passwd`。
- **CVSS v3.1：** 7.5 — `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N`（条件：能上传或注入 timeline → spec/01 修复后需登录，故 PR:L）
- **PoC：** 创建 timeline 项目，添加 video clip，将 `source_path` 改为 `/etc/passwd`，触发合成 → FFmpeg 读取系统文件并写入输出视频文件。

## 3. 修复方案

### 3.1 通用 URL Guard（共享模块）

```pseudo
# app/security/url_guard.py（新建）：

class URLGuardError(ValueError): ...

ALLOWED_SCHEMES = frozenset({"http", "https"})
BLOCKED_NET_PREFIXES = [
    "10.", "172.16.", ..., "172.31.", "192.168.",
    "127.", "169.254.", "0.",
]
BLOCKED_HOSTS = {"localhost", "metadata.google.internal", "metadata"}

def validate_external_url(url: str, *, allow_redirects_resolved: bool = True) -> str:
    """
    校验 URL 安全可外发：
    - scheme 必须在 ALLOWED_SCHEMES
    - host 不能解析到私网/loopback/link-local
    - 不允许 file://, rtsp://, gopher://, data:, blob:
    - 不允许凭据 user:pass@host
    返回规范化的 URL，否则抛 URLGuardError
    """
    parsed = urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES: raise ...
    if "@" in parsed.netloc: raise ...
    host = parsed.hostname
    if host in BLOCKED_HOSTS: raise ...
    if any(host.startswith(p) for p in BLOCKED_NET_PREFIXES): raise ...
    # DNS 解析 + 检查所有 A/AAAA 记录是否在私网范围
    addrs = socket.getaddrinfo(host, parsed.port or 80)
    for fam, _, _, _, sockaddr in addrs:
        ip = sockaddr[0]
        if ipaddress.ip_address(ip).is_private: raise ...
        if ipaddress.ip_address(ip).is_loopback: raise ...
        if ipaddress.ip_address(ip).is_link_local: raise ...
        if ipaddress.ip_address(ip).is_reserved: raise ...
    return url

def validate_local_path_for_ffmpeg(path: str, allowed_roots: list[Path]) -> Path:
    """
    校验 path 是本地文件，且在 allowed_roots 中之一下。
    - 不允许 file://、http://、绝对路径除非在 allowed_roots
    - 用 Path.resolve() + is_relative_to(root) 双层
    """
    resolved = Path(path).resolve()
    if not any(resolved.is_relative_to(r.resolve()) for r in allowed_roots):
        raise URLGuardError(...)
    return resolved
```

### 3.2 yt-dlp 调用前置校验

```pseudo
# youtube_service.py 各调用点统一加：
from app.security.url_guard import validate_external_url

def download_video(request):
    url = validate_external_url(request.url)  # 抛错则路由层 400
    # 同时给 yt-dlp 加 socket_timeout 避免长时间挂起
    ydl_opts["socket_timeout"] = 15
    ydl_opts["nocheckcertificate"] = False
    # 限制 yt-dlp 仅允许特定 extractor（可选）
    ydl_opts["allowed_extractors"] = ["youtube", "youtube:tab", ...]
```

### 3.3 preview_proxy / media_proxy 加 URL Guard

```pseudo
# 在 router 或 service 入口：
upstream_url = validate_external_url(payload.upstream_url)
# 同时 FFmpeg 命令显式禁用本地协议：
ffmpeg_cmd = [
    "ffmpeg",
    "-protocol_whitelist", "http,https,tcp,tls",  # 关键：禁掉 file/rtsp/concat
    "-i", upstream_url,
    ...
]
```

### 3.4 FFmpeg 本地路径白名单（视频合成）

```pseudo
# 在 video_composition_service.py 接收 timeline 后，对每个 file_path 做：
from app.security.url_guard import validate_local_path_for_ffmpeg

ALLOWED_ROOTS = [Path(settings.storage_root), Path(settings.cached_materials_dir), Path(settings.temp_dir)]

for clip in timeline.clips:
    if clip.source_path:
        clip.source_path = str(validate_local_path_for_ffmpeg(clip.source_path, ALLOWED_ROOTS))
    if clip.source_url:
        clip.source_url = validate_external_url(clip.source_url)
```

**FFmpeg `-protocol_whitelist` 策略（统一）：**

- 默认（远程/代理类）：`http,https,tcp,tls,crypto` —— **不**包含 `file`。
- 本地合成类（输入为已通过 `validate_local_path_for_ffmpeg` 校验的本地路径）：`file,crypto,pipe`，**不**包含 `http,https`。
- 严禁同时启用 `file` + 网络协议（避免 SSRF 与本地读组合放大）。

## 4. 接口与行为变化

| 端点 | 变更前 | 变更后 |
|---|---|---|
| `/api/youtube/*` | 任意 URL | 仅公网 https/http、非私网 IP |
| `/api/preview-proxy` | 任意 upstream_url | 同上 |
| `/api/media-proxy` | 任意 URL | 同上 |
| 视频合成 timeline | 任意路径 | 仅 STORAGE_ROOT/cached_materials/temp 下的相对路径 |
| 任何 FFmpeg 命令 | 默认协议 | 显式 `-protocol_whitelist` |

对正常用户：
- 提交 YouTube/Vimeo 等真实 URL → 通过
- 上传本地视频（落到 STORAGE_ROOT 后被引用）→ 通过
- 引用 cached_materials/* → 通过

被拒：file://、内网 IP、metadata 服务、用户 home 绝对路径。

## 5. 验证策略

`backend-services/basic-service/tests/security/test_03_url_guard.py`：

- **正向：**
  - `validate_external_url("https://www.youtube.com/watch?v=...")` → 返回
  - `validate_external_url("https://pexels-cdn.example/video.mp4")` → 返回
  - `validate_local_path_for_ffmpeg("static/uploads/audio/foo.mp3", [STORAGE_ROOT])` → 返回
- **攻击向量：**
  - `validate_external_url("file:///etc/passwd")` → URLGuardError
  - `validate_external_url("http://localhost:8000/api/admin/x")` → URLGuardError
  - `validate_external_url("http://169.254.169.254/latest/meta-data/")` → URLGuardError
  - `validate_external_url("http://user:pass@example.com/")` → URLGuardError
  - `validate_local_path_for_ffmpeg("/etc/passwd", [STORAGE_ROOT])` → URLGuardError
  - `validate_local_path_for_ffmpeg("../../../etc/passwd", [STORAGE_ROOT])` → URLGuardError
- **集成测试：**
  - `POST /api/youtube/info { url: "file:///etc/passwd" }` → 400
  - `POST /api/preview-proxy { upstream_url: "http://127.0.0.1:8000/..." }` → 400

## 6. 依赖关系

- **depends_on:** 无（`url_guard.py` 是新模块）
- **blocks:** spec/04（路径校验函数 `validate_local_path_for_ffmpeg` 与 storage 的 `_validate_path` 应统一思想，但可独立完成）
- **parallel_group:** A

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 合法的内网开发预览 URL 被拒 | dev 环境提供 env 开关 `URL_GUARD_ALLOW_PRIVATE=1`，prod 默认禁 |
| yt-dlp 升级后行为变化（如新协议） | `socket_timeout` + `allowed_extractors` 双重防护 |
| 视频合成中 cached_materials 的绝对路径合法但被拒 | 把所有合法根目录都列入 `ALLOWED_ROOTS`，包括 OSS 下载缓存 |
| DNS rebinding 攻击（解析后 IP 改变） | yt-dlp/FFmpeg 自己再解一次 → 风险窗口；缓解：FFmpeg 加 `-rw_timeout` + 在 `validate_external_url` 缓存 IP 并通过 IP 重写 URL（高级方案，本次不做，记入风险） |
