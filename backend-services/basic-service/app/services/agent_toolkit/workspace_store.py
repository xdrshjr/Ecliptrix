"""项目工作区：路径安全、原子写、配额、字节分页、列表与删除。

设计基线：docs/plans/agent-general-toolkit/spec.md §3.3.1–§3.3.3。

工作区根与 `web_research/artifact_store.py:37-39` 完全同构
（`Path(settings.storage.root).resolve().parent / "agent_workspace"`），因此桌面端
落在 `<userData>/agent_workspace`，且**不做**静态挂载——只能经
`/api/agent-toolkit/*` 读取。
"""
import asyncio
import hashlib
import os
import re
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.models.agent_toolkit_models import (
    AgentToolkitError,
    normalize_project_id,
)

# 写入类硬上限（与 `web_research/artifact_store.py:80-81` 同口径）。
MAX_WRITE_BODY_BYTES = 2 * 1024 * 1024
# 分页（与 artifact_store.byte_page 同源向量）。
DEFAULT_READ_BYTES = 4000
MAX_READ_BYTES = 8000
# 二进制判定只读前 8 KiB。
BINARY_SNIFF_BYTES = 8 * 1024

WRITE_EXTENSIONS = frozenset({
    ".md", ".txt", ".csv", ".tsv", ".json", ".srt", ".vtt", ".svg",
    ".html", ".py", ".yaml", ".yml", ".xml",
})
MEDIA_EXTENSIONS = frozenset({
    ".mp4", ".mov", ".webm", ".mkv", ".mp3", ".wav", ".m4a", ".aac",
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg",
})
# svg 是文本，读的时候不能被当成二进制。
TEXT_MEDIA_EXTENSIONS = frozenset({".svg"})

_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$")
_FORBIDDEN_CHARS = re.compile(r'[\x00-\x1f<>:"\\|?*]')
_RESERVED = {
    "con", "prn", "aux", "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}
_KIND_BY_EXTENSION = {
    ".md": "text", ".txt": "text", ".json": "text", ".yaml": "text",
    ".yml": "text", ".xml": "text", ".html": "text", ".py": "text",
    ".svg": "image", ".png": "image", ".jpg": "image", ".jpeg": "image",
    ".webp": "image", ".gif": "image",
    ".csv": "csv", ".tsv": "csv",
    ".srt": "text", ".vtt": "text",
    ".mp4": "media", ".mov": "media", ".webm": "media", ".mkv": "media",
    ".mp3": "media", ".wav": "media", ".m4a": "media", ".aac": "media",
}
ALL_KINDS = ("files", "uploads", "extracted", "digest", "out")


def utcnow():
    return datetime.now(timezone.utc)


def toolkit_settings():
    """延迟导入：避免服务层模块加载期的循环依赖。"""
    from app.services.system_settings_service import toolkit_settings as load

    return load()


def workspace_root():
    from app.config import settings

    root = Path(settings.storage.root).resolve().parent / "agent_workspace"
    root.mkdir(parents=True, exist_ok=True)
    return root


def project_directory(project_id, root=None):
    """`project-<sha256(project_id)[:12]>`；空 id 落 `global`。"""
    root = Path(root) if root is not None else workspace_root()
    normalized = normalize_project_id(project_id)
    if normalized is None:
        return root / "global"
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12]
    return root / ("project-" + digest)


def ensure_layout(directory):
    for kind in ALL_KINDS:
        (directory / kind).mkdir(parents=True, exist_ok=True)
    return directory


# ── 路径安全（§3.3.2） ─────────────────────────────────────────────────────


def safe_relative_name(name, root=None, *, for_write=False):
    """按 §3.3.2 的七步顺序校验；任一不通过抛 `invalid_workspace_name`。

    `root` 给出时追加 `resolve()` / `realpath` 双重逃逸复核（防符号链接与
    Windows 8.3 别名）。`for_write=True` 时追加扩展名白名单。
    """
    if not isinstance(name, str):
        raise AgentToolkitError("invalid_workspace_name",
                                message="name must be a string")
    if not 1 <= len(name) <= 180:
        raise AgentToolkitError("invalid_workspace_name",
                                message="name must be 1..180 characters")
    if _FORBIDDEN_CHARS.search(name):
        raise AgentToolkitError(
            "invalid_workspace_name",
            message=r'name must not contain control chars or <>:"\|?*')
    # 步骤 2：统一分隔符，拒绝绝对路径与空段。
    normalized = name.replace("\\", "/")
    if normalized.startswith("/") or normalized.endswith("/") or "//" in normalized:
        raise AgentToolkitError("invalid_workspace_name",
                                message="name must be a relative path without empty segments")
    segments = normalized.split("/")
    # 步骤 3：段数与段字符集。
    if len(segments) > 5:
        raise AgentToolkitError("invalid_workspace_name",
                                message="name must have at most 5 segments")
    for segment in segments:
        if not _SEGMENT.match(segment):
            raise AgentToolkitError(
                "invalid_workspace_name",
                message=f"invalid path segment: {segment}")
        # 步骤 4：相对段、Windows 尾点与保留名（含带扩展名形式）。
        if segment in {".", ".."} or segment.endswith("."):
            raise AgentToolkitError("invalid_workspace_name",
                                    message="name must not contain '.'/'..' or trailing dots")
        stem = segment.split(".")[0].lower()
        if stem in _RESERVED:
            raise AgentToolkitError(
                "invalid_workspace_name",
                message=f"reserved Windows name: {segment}")
        # 步骤 6：UNC / 设备 / 8.3 短名段一律拒绝。
        if "~" in segment:
            raise AgentToolkitError("invalid_workspace_name",
                                    message="8.3 short names are not allowed")
    relative = "/".join(segments)
    # 步骤 7：写入扩展名白名单（媒体只允许导入）。
    if for_write:
        extension = _extension_of(relative)
        if extension not in WRITE_EXTENSIONS:
            raise AgentToolkitError(
                "invalid_workspace_name",
                message=f"extension not allowed for write: {extension or '(none)'}")
    # 步骤 5：解析后复核仍在根内（do 两次：resolve + realpath）。
    if root is not None:
        _assert_inside(Path(root), relative)
    return relative


def _assert_inside(root, relative):
    resolved_root = Path(root).resolve()
    candidate = (resolved_root / relative).resolve()
    if not candidate.is_relative_to(resolved_root):
        raise AgentToolkitError("invalid_workspace_name",
                                message="path escapes the workspace root")
    real = Path(os.path.realpath(resolved_root / relative))
    if not real.is_relative_to(Path(os.path.realpath(resolved_root))):
        raise AgentToolkitError("invalid_workspace_name",
                                message="path escapes the workspace root")


def _extension_of(relative):
    name = relative.rsplit("/", 1)[-1]
    index = name.rfind(".")
    return name[index:].lower() if index > 0 else ""


def _safe_prefix(prefix, root):
    """列表用的目录前缀：允许空，其余按相对路径校验（不查扩展名）。"""
    if not prefix:
        return ""
    cleaned = prefix.strip().replace("\\", "/").rstrip("/")
    if not cleaned:
        return ""
    return safe_relative_name(cleaned, root) + "/"


# ── 配额（§3.3.3：五棵树合计） ──────────────────────────────────────────────


def usage(directory):
    """返回五棵树分项与合计；`used_bytes` 是配额判据。"""
    by_kind = {}
    for kind in ALL_KINDS:
        total = 0
        base = Path(directory) / kind
        if base.is_dir():
            for path in base.rglob("*"):
                if path.is_file() and not path.is_symlink():
                    total += path.stat().st_size
        by_kind[kind] = total
    return {"used_bytes": sum(by_kind.values()), "used_by_kind": by_kind}


def quota_bytes():
    return int(toolkit_settings()["workspace_quota_mb"]) * 1024 * 1024


def max_file_bytes():
    return int(toolkit_settings()["max_file_mb"]) * 1024 * 1024


# ── 原子写 ─────────────────────────────────────────────────────────────────


def _write_atomic(target, body):
    """临时文件 + `os.replace`；失败时不留 `.tmp-*` 残留（AC-02）。"""
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".tmp-" + os.urandom(4).hex())
    try:
        with open(temporary, "wb") as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink(missing_ok=True)


async def write_file(project_id, name, body, overwrite=False):
    """写 `files/<name>`；配额/单文件超限时**不写入任何字节**。"""
    settings = toolkit_settings()
    if not settings["enabled"]:
        raise AgentToolkitError("toolkit_disabled")
    if not settings["workspace_enabled"]:
        raise AgentToolkitError("workspace_disabled")
    directory = ensure_layout(project_directory(project_id))
    relative = safe_relative_name(name, directory, for_write=True)
    if len(body) > MAX_WRITE_BODY_BYTES:
        raise AgentToolkitError(
            "workspace_file_too_large",
            message=f"content exceeds the 2 MiB write limit ({len(body)} bytes)")
    if len(body) > max_file_bytes():
        raise AgentToolkitError("workspace_file_too_large")
    target = directory / "files" / relative
    if target.exists() and not overwrite:
        raise AgentToolkitError(
            "invalid_argument",
            message="file exists; pass overwrite=true to replace it")
    current = usage(directory)
    if current["used_bytes"] + len(body) > quota_bytes():
        raise AgentToolkitError(
            "workspace_quota_exceeded",
            message="workspace quota exceeded; delete files or raise the quota")
    existed = target.exists()
    try:
        await asyncio.to_thread(_write_atomic, target, body)
    except OSError as error:
        raise AgentToolkitError(
            "storage_unavailable",
            message=f"workspace write failed: {error.strerror or error.errno}") from None
    return {
        "name": relative,
        "bytes": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        "overwritten": existed,
    }


# ── 分页读 ─────────────────────────────────────────────────────────────────


def byte_page(body, offset, max_bytes):
    """UTF-8 边界安全的字节分页。

    与 `app/services/web_research/artifact_store.py:20-32` 同源、同一组测试向量。
    刻意**不**跨域 import：工作区模块不该连带加载研究域的 DB 单例；这是该纯函数
    的第二份拷贝，第三份出现时必须抽公共模块。
    """
    if offset < 0 or offset > len(body):
        raise AgentToolkitError("invalid_offset")
    if offset < len(body) and body[offset] & 0xC0 == 0x80:
        raise AgentToolkitError("invalid_offset")
    end = min(len(body), offset + max_bytes)
    while end < len(body) and end > offset and body[end] & 0xC0 == 0x80:
        end -= 1
    if end == offset and end < len(body):
        raise AgentToolkitError("invalid_page_size")
    return {
        "content": body[offset:end].decode("utf-8"),
        "next_offset": end if end < len(body) else None,
        "total_bytes": len(body),
        "truncated": end < len(body),
    }


def _binary_next_step(relative):
    extension = _extension_of(relative)
    if extension in MEDIA_EXTENSIONS:
        return "Use workspace_import_material to put it in the material library."
    return "Use read_document with a document_id."


def is_binary(body, relative):
    """三条判据任一命中即二进制（§3.3.3 / R-07）。"""
    extension = _extension_of(relative)
    if extension in MEDIA_EXTENSIONS and extension not in TEXT_MEDIA_EXTENSIONS:
        return True
    if b"\x00" in body[:BINARY_SNIFF_BYTES]:
        return True
    try:
        body.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return True
    return False


def read_page(project_id, name, offset=0, max_bytes=DEFAULT_READ_BYTES):
    settings = toolkit_settings()
    if not settings["enabled"]:
        raise AgentToolkitError("toolkit_disabled")
    if not settings["workspace_enabled"]:
        raise AgentToolkitError("workspace_disabled")
    directory = project_directory(project_id)
    relative = safe_relative_name(name, directory)
    target = directory / "files" / relative
    if not target.is_file():
        raise AgentToolkitError("workspace_not_found",
                                message=f"workspace file not found: {relative}")
    if not 1 <= max_bytes <= MAX_READ_BYTES:
        raise AgentToolkitError("invalid_page_size",
                                message=f"max_bytes must be 1..{MAX_READ_BYTES}")
    body = target.read_bytes()
    if is_binary(body, relative):
        error = AgentToolkitError("binary_file",
                                  message="this file is not UTF-8 text")
        error.next_step = _binary_next_step(relative)
        raise error
    page = byte_page(body, offset, max_bytes)
    return {"name": relative, "encoding": "utf8", **page}


# ── 列表 / 删除 / 下载 ─────────────────────────────────────────────────────


def _describe(path, base, relative):
    stat = path.stat()
    return {
        "name": relative,
        "bytes": stat.st_size,
        "mtime": datetime.fromtimestamp(
            stat.st_mtime, timezone.utc).isoformat(),
        "kind": _KIND_BY_EXTENSION.get(_extension_of(relative), "other"),
    }


def list_files(project_id, prefix=None, limit=50):
    settings = toolkit_settings()
    if not settings["enabled"]:
        raise AgentToolkitError("toolkit_disabled")
    if not settings["workspace_enabled"]:
        raise AgentToolkitError("workspace_disabled")
    directory = ensure_layout(project_directory(project_id))
    if not 1 <= limit <= 100:
        raise AgentToolkitError("invalid_argument", message="limit must be 1..100")
    files_root = directory / "files"
    safe_prefix = _safe_prefix(prefix, directory)
    entries = []
    for path in files_root.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(files_root).as_posix()
        if safe_prefix and not relative.startswith(safe_prefix):
            continue
        entries.append(_describe(path, files_root, relative))
    entries.sort(key=lambda item: item["name"])
    truncated = len(entries) > limit
    current = usage(directory)
    return {
        "files": entries[:limit],
        "total_files": len(entries),
        "total_bytes": current["used_by_kind"]["files"],
        "quota_bytes": quota_bytes(),
        "truncated": truncated,
    }


def resolve_file(project_id, name):
    """返回 `files/<name>` 的绝对路径（下载/导入共用）；不存在即 404。"""
    directory = ensure_layout(project_directory(project_id))
    relative = safe_relative_name(name, directory)
    target = directory / "files" / relative
    if not target.is_file():
        raise AgentToolkitError("workspace_not_found",
                                message=f"workspace file not found: {relative}")
    return target, relative


def delete_file(project_id, name):
    settings = toolkit_settings()
    if not settings["enabled"]:
        raise AgentToolkitError("toolkit_disabled")
    if not settings["workspace_enabled"]:
        raise AgentToolkitError("workspace_disabled")
    directory = ensure_layout(project_directory(project_id))
    relative = safe_relative_name(name, directory)
    target = directory / "files" / relative
    if not target.is_file():
        raise AgentToolkitError("workspace_not_found",
                                message=f"workspace file not found: {relative}")
    target.unlink(missing_ok=True)
    # 顺带清理空目录，避免列表里留下空壳（不越过 files/ 根）。
    parent = target.parent
    while parent != directory / "files" and parent.is_dir() and not any(parent.iterdir()):
        parent.rmdir()
        parent = parent.parent
    return {"deleted": True, "name": relative}


# ── 启动清理（§5.2 / AC-27，P0 回归） ─────────────────────────────────────


async def purge_expired_documents(session_factory=None):
    """文档：`ready` 是活体，只清 `expired`/`deleted` 的三件套文件。"""
    from sqlalchemy import select

    from app.models.agent_toolkit_db_models import AgentDocument

    if session_factory is None:
        from app.database import async_session_factory

        session_factory = async_session_factory
    root = workspace_root()
    expired = 0
    removed = 0
    async with session_factory() as session:
        rows = list((await session.execute(select(AgentDocument))).scalars())
        now = utcnow().replace(tzinfo=None)
        for row in rows:
            if (row.state == "ready" and row.expires_at is not None
                    and row.expires_at < now):
                row.state = "expired"
                expired += 1
        await session.commit()
        for row in rows:
            if row.state == "ready":
                # 活体文档及其三件套必须原样保留。
                continue
            directory = project_directory(row.project_id, root)
            candidates = [root / row.text_path]
            candidates += list((directory / "extracted").glob(row.id + ".*"))
            candidates.append(directory / "digest" / (row.id + ".json"))
            candidates += list((directory / "uploads").glob(row.id + ".*"))
            for path in candidates:
                if path.is_file() and not path.is_symlink():
                    path.unlink(missing_ok=True)
                    removed += 1
    await purge_sandbox_outputs()
    return {"expired_documents": expired, "removed_files": removed}


def _newest_mtime(path):
    """一次分析产物目录的「使用时刻」。

    只看**文件**的 mtime：目录本身的 mtime 只反映目录项变化，反而会掩盖真实
    年龄；空目录才退回目录 mtime。
    """
    stamps = []
    if path.is_dir():
        for child in path.rglob("*"):
            if child.is_file() and not child.is_symlink():
                try:
                    stamps.append(datetime.fromtimestamp(
                        child.stat().st_mtime, timezone.utc))
                except OSError:
                    continue
    if not stamps:
        return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
    return max(stamps)


async def purge_sandbox_outputs():
    """`out/` 下 24 小时前的产物直接删除（已导入素材即弃）。"""
    root = workspace_root()
    cutoff = utcnow() - timedelta(hours=24)
    removed = 0
    for directory in root.iterdir() if root.is_dir() else []:
        out_root = directory / "out"
        if not out_root.is_dir() or out_root.is_symlink():
            continue
        for child in list(out_root.iterdir()):
            if child.is_symlink():
                continue
            try:
                mtime = _newest_mtime(child)
            except OSError:
                continue
            if mtime >= cutoff:
                continue
            try:
                if child.is_dir():
                    shutil.rmtree(child)
                else:
                    child.unlink()
                removed += 1
            except OSError:
                continue
    return removed
