# Spec 04：路径穿越与文件上传加固

> 覆盖 master-plan §3.4

## 1. 范围

- `storage_service._validate_path()` 与 `_sanitize_filename()` 的完整性
- `storage_router.py` 上传端点（form 参数 `bucket_path`、`filename`）
- 其他上传 router：`image_pack`、`frame_pack`、`voice_clone` 等
- MIME / 扩展名校验（防止 HTML/JS 文件上传后被浏览器以错误 MIME 渲染）
- 上传到的最终落盘路径是否可被覆盖（race / symlink）

**不包含：**
- 上传速率限制（master-plan §2 已排除 DoS）
- 文件大小硬上限（保留现有 `upload-config.yaml` 配置，不再加严）
- 内容安全扫描（AV、敏感词）

## 2. 已识别的具体威胁点

### V04-A：`storage_router.upload_file(bucket_path)` 路径注入

- **位置：** `app/routers/storage_router.py:34-150`、`app/services/storage_service.py:45-194`
- **机制：**
  - form 参数 `bucket_path: str` 与 `filename: str` 由用户直接控制
  - 拼接成 `relative_path = f"{bucket_path}/{filename}"` 后交 `_validate_path()`
  - `_validate_path()` 实际逻辑需 Read 确认：是否仅做字符串前缀检查 vs Path.resolve()
- **CVSS v3.1：** 8.8 修复前 — `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:L`；spec/01 修复后需登录，重估 8.0 — `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:L`，仍属高危（RCE 风险）。
- **PoC：** `POST /api/storage/upload-audio` form `bucket_path=../../../etc/cron.daily` `filename=foo.sh`（带恶意 shell）→ 若校验绕过 → cron 执行。

### V04-B：上传文件 MIME / 扩展名混淆

- **位置：** 同上 + `_sanitize_filename` 是否剔除可执行后缀
- **机制：** 用户上传 `evil.html` 或 `evil.svg`（带 inline `<script>`），靠 `/api/storage/files/...` 公开访问 → 用户访问该 URL → 在 ecliptrix.example.com 域下执行 JS → 获取 localStorage 中的 session token。
- **CVSS v3.1：** 8.3 — `CVSS:3.1/AV:N/AC:L/PR:L/UI:R/S:C/C:H/I:H/A:N`（stored XSS via uploaded file，可窃取 session token）
- 与 spec/02 的 `X-Content-Type-Options: nosniff` 联动可显著减轻；本 spec 仍需独立修复（白名单 + 强制 attachment）。

### V04-C：filename / bucket_path Unicode normalization & null byte

- **机制：** 文件系统对 NULL 字节、Unicode 同形字符（如 `..` 的全角变体）处理不一致 → 绕过字符串过滤
- **CVSS v3.1：** 5.5 — `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N`（中危，记录附录，**不必本次专门修**，但 `_sanitize_filename` 的 fix 顺便覆盖即可）

### V04-D：其他上传 router 同类问题

- 列出所有接受 `UploadFile` 或类似的 router/endpoint：
  - `image_pack_router`、`frame_pack_router`、`voice_clone_router`、`material_router.ingest`、`tts_*` 缓存写入等
- 每个都需核验是否使用 `storage_service.upload_file` 或自己拼路径

## 3. 修复方案

### 3.1 `_validate_path` 健壮化

```pseudo
# storage_service.py（重构）：

def _validate_path(relative: str | Path) -> Path:
    """
    严格校验 relative 必须在 STORAGE_ROOT 下。
    防御：
    - 拒绝绝对路径（startswith / 或 Windows drive 前缀）
    - 拒绝 None 字节 \x00
    - 拒绝过长路径（> 4096 字节）
    - 用 Path.resolve() 解析后再用 is_relative_to(STORAGE_ROOT)
    - 解析符号链接：禁止落入 STORAGE_ROOT 外
    """
    if not relative: raise ValueError("empty path")
    relative = str(relative)
    if "\x00" in relative: raise ValueError("null byte")
    if len(relative.encode()) > 4096: raise ValueError("path too long")
    # 阻断绝对路径与 URI scheme
    if relative.startswith(("/", "\\")) or ":" in relative.split("/")[0]:
        raise ValueError("absolute path not allowed")
    candidate = (STORAGE_ROOT / relative).resolve(strict=False)
    if not candidate.is_relative_to(STORAGE_ROOT.resolve()):
        raise ValueError("path escapes STORAGE_ROOT")
    # 进一步：写入前不允许目标已是 symlink（防 TOCTOU 攻击）
    if candidate.exists() and candidate.is_symlink():
        raise ValueError("symlink target not allowed")
    return candidate

def _sanitize_filename(name: str) -> str:
    """
    清理 filename：
    - 仅保留 [a-zA-Z0-9._-]，其他替换为 _
    - 限长 200
    - 强制小写扩展名
    - 黑名单可执行扩展：.html .htm .svg .xml .js .mjs .cjs .php .py .sh .bat .ps1 .exe
      → 若上传，强制改写为 .txt 或拒绝
    - 显式拒绝 .. 与 / 出现在 filename 中
    """
```

### 3.2 上传 router 接入

```pseudo
# storage_router.py 所有 upload_* endpoints 统一：
@router.post("/upload-audio")
async def upload_audio(
    file: UploadFile,
    bucket_path: str = Form(""),  # 可选，受 _validate_path 校验
    current_user = Depends(get_current_user),  # 强制鉴权（与 spec/01 协同）
):
    safe_name = _sanitize_filename(file.filename or "upload.bin")
    if bucket_path:
        target_dir = _validate_path(bucket_path)
    else:
        # 默认路径，按 user_id 隔离
        target_dir = STORAGE_ROOT / "audio" / str(current_user.id)
    target_dir.mkdir(parents=True, exist_ok=True)
    # 加随机后缀防覆盖
    target = target_dir / f"{uuid4().hex}_{safe_name}"
    # MIME 校验
    if not _is_allowed_mime(file.content_type, target.suffix):
        raise HTTPException(415, "unsupported media type")
    # 写入
    async with aiofiles.open(target, "wb") as f:
        ...
```

### 3.3 MIME 白名单

```pseudo
# 按上传类别：
ALLOWED_AUDIO_MIME = {"audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/ogg"}
ALLOWED_VIDEO_MIME = {"video/mp4", "video/webm", "video/x-matroska", "video/quicktime"}
ALLOWED_IMAGE_MIME = {"image/png", "image/jpeg", "image/webp", "image/gif"}
ALLOWED_DOCUMENT_MIME = {"application/pdf", "text/plain", "text/markdown"}

def _is_allowed_mime(content_type: str, extension: str) -> bool:
    """既检查声明的 content_type，也校验 extension 与 content_type 一致。"""
```

### 3.4 公共下载路径（与 spec/01 V01-C 协同）

- 若 spec/01 已用 router 替代 StaticFiles 挂载：
  - 在 FileResponse 中强制 `Content-Disposition: attachment` 对未知/危险类型
  - 加 `X-Content-Type-Options: nosniff`（spec/02 已全局加）
  - 用户上传的 svg/html 强制按 `text/plain` 返回（避免渲染）

## 4. 接口与行为变化

| 端点 | 变更 |
|---|---|
| 所有 `POST /api/storage/upload-*` | 强制 `Depends(get_current_user)`（与 spec/01 协同）；目标路径若试图越出 STORAGE_ROOT 返回 400 |
| filename 含 `..`、`/`、null byte 或可执行扩展 | sanitize 或拒绝 |
| 上传 MIME 与扩展名不匹配 | 415 |
| 文件落盘命名 | 加 `uuid4` 前缀，避免覆盖 |
| 下载 svg/html 等危险类型 | 强制 `Content-Disposition: attachment` + `Content-Type: text/plain` |

## 5. 验证策略

`backend-services/basic-service/tests/security/test_04_path_traversal.py`：

- **正向：**
  - 上传 `foo.mp3` → 200，落盘到 `STORAGE_ROOT/audio/<user_id>/<uuid>_foo.mp3`
  - 上传时 `bucket_path=user_files/2026` → 落盘到 `STORAGE_ROOT/user_files/2026/...`
- **攻击向量：**
  - `bucket_path=../../../etc` → 400
  - `bucket_path=/etc` → 400（绝对路径）
  - `bucket_path=C:\Windows`（Windows）→ 400
  - `bucket_path=foo\x00bar` → 400
  - `filename=../evil.sh` → sanitize 为 `_evil.sh` 或拒绝
  - 上传 `evil.html` 声称 image/png → 415（mime 与 ext 不符）
  - 上传 svg 后 GET → 响应 `Content-Type: text/plain` + `Content-Disposition: attachment`
- **race / symlink：**
  - 预先在 `STORAGE_ROOT/<user>/audio` 下放符号链接指向 `/etc/passwd`，上传同名文件 → 拒绝（_validate_path 检测 symlink）

## 6. 依赖关系

- **depends_on:** spec/01（需要 `Depends(get_current_user)` 已存在）
- **blocks:** 无
- **parallel_group:** B（在 A 完成后启动）

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| sanitize_filename 过严，正常用户文件名（中文、空格）被改 | sanitize 时保留 Unicode 字母数字，仅替换危险字符；附测试覆盖中文名 |
| MIME 白名单遗漏合法类型 → 用户上传失败 | 白名单来源于现有 `upload-config.yaml` 中已经使用的类型，全仓 grep 现存上传调用确认 |
| 已存在的旧文件（在 STORAGE_ROOT 下）若是 symlink 会被新的校验拒绝 | 一次性扫描 STORAGE_ROOT 下 symlink 并清理（运维操作，非代码修复） |
