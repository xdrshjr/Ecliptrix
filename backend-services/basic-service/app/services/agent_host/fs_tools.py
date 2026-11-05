"""文件工具：workspace 作用域**复用** `workspace_store`，host 作用域另立守卫。

设计基线：docs/plans/agent-general-assistant/spec.md §4.5（v2 / REV-P1-1）。

刻意不另写一套限值与错误码：同一个根目录上已经有 `workspace_*` 工具，
两套语义会出现"一条能绕过配额的写路径"。因此：

- workspace：写走 `workspace_store.write_file()`（内含 2 MiB 上限与配额检查），
  读走 `byte_page()`，二进制判定走 `is_binary()`，路径走 `safe_relative_name()`。
- host：`resolve_host_path()` 把 `~` 展开、`resolve()` 后必须落在
  `host_read_roots` / `host_write_roots` 之内，否则 `path_forbidden`(403)。
"""
import fnmatch
import os
import re
import time
from pathlib import Path

from app.models.agent_host_models import AgentHostError
from app.models.agent_toolkit_models import AgentToolkitError
from app.services.agent_host.settings import agent_host_settings

LIST_LIMIT = 500
GLOB_LIMIT = 2000
GREP_HIT_LIMIT = 200
GREP_FILE_LIMIT = 1024 * 1024
GREP_SECONDS = 5
DIFF_PREVIEW_BYTES = 4096
SKIP_DIRECTORIES = frozenset({".git", "node_modules", ".next"})
# 指向"工作区文件根"的等价写法（见 `workspace_path`）。
WORKSPACE_ROOT_ALIASES = frozenset({"", ".", "./", "/", "files", "files/"})


def _settings():
    return agent_host_settings()


def _require_enabled(settings):
    if not settings.get("enabled", True):
        raise AgentHostError("fs_disabled", message="agent host is disabled")
    if not settings.get("fs_enabled", True):
        raise AgentHostError(
            "fs_disabled", message="file tools are disabled",
            remediation="在“设置 › 本机能力”打开“允许文件工具”。")


def _translate(error):
    """`AgentToolkitError` -> `AgentHostError`：码名不变，语义不复制。"""
    if isinstance(error, AgentHostError):
        return error
    converted = AgentHostError(error.error_code, message=error.message,
                               status_code=error.status_code,
                               failure_class=error.failure_class)
    converted.next_step = getattr(error, "next_step", None)
    return converted


def _scope(settings, requested):
    scope = requested or settings.get("shell_scope", "workspace")
    return "host" if scope == "host" else "workspace"


def resolve_host_path(settings, path, write=False):
    """host 作用域路径守卫：绝对化、解析符号链接、必须落在允许的根内。"""
    roots_key = "host_write_roots" if write else "host_read_roots"
    roots = [Path(str(item)).expanduser().resolve()
             for item in settings.get(roots_key) or []]
    if not roots:
        raise AgentHostError(
            "path_forbidden", message=f"{roots_key} is empty",
            remediation="在“设置 › 本机能力”里配置允许访问的绝对路径。")
    try:
        candidate = Path(str(path)).expanduser().resolve()
    except (OSError, ValueError):
        raise AgentHostError(
            "path_forbidden",
            message=f"path is not resolvable: {path}") from None
    if not any(candidate == root or candidate.is_relative_to(root)
               for root in roots):
        raise AgentHostError(
            "path_forbidden", message="path escapes the allowed roots",
            remediation=f"只允许访问 {roots_key} 内的路径；需要更多目录请在设置里添加。")
    return candidate


def workspace_path(project_id, path):
    """workspace 作用域：返回 `(root, relative, target)`；越界即 path_forbidden。"""
    from app.services.agent_toolkit import workspace_store

    directory = workspace_store.project_directory(project_id)
    cleaned = str(path or "").strip()
    if cleaned in WORKSPACE_ROOT_ALIASES:
        # 工作区文件根。别名表是必需的：`safe_relative_name()` 拒绝 `.` 与
        # `..`，而 `list_dir` / `glob` / `grep` 的第一个调用往往就是 `.`——
        # 不归一化就等于"工作区根永远列不出来"。
        return directory, "", directory / "files"
    try:
        relative = workspace_store.safe_relative_name(cleaned, directory)
    except AgentToolkitError as error:
        raise AgentHostError(
            "path_forbidden", message=error.message,
            remediation="工作区内只接受相对路径，且不能含设备名/非法字符。"
        ) from None
    return directory, relative, directory / "files" / relative


def _read_host_file(target, offset, max_bytes):
    body = target.read_bytes()
    if b"\x00" in body[:8192]:
        raise AgentHostError("binary_file", message="this file is binary",
                            next_step="用 shell 工具（如 ffprobe）读取元数据。")
    try:
        text = body.decode("utf-8")
        encoding = "utf8"
    except UnicodeDecodeError:
        text = body.decode("utf-8", "replace")
        encoding = "utf-8-replace"
    page = text.encode("utf-8")[offset:offset + max_bytes]
    content = page.decode("utf-8", "replace")
    next_offset = offset + len(page) if offset + len(page) < len(body) else None
    return {"path": str(target), "content": content, "offset": offset,
            "next_offset": next_offset, "truncated": next_offset is not None,
            "binary": False, "lines": content.count("\n") + 1,
            "encoding": encoding, "total_bytes": len(body)}


def read_file(project_id=None, path="", offset=0, max_bytes=None, scope=None):
    """读一页文本；`offset`/`max_bytes` 都是**字节**（与 `byte_page()` 同义）。"""
    settings = _settings()
    _require_enabled(settings)
    limit = int(max_bytes or settings.get("fs_max_bytes", 32768))
    resolved_scope = _scope(settings, scope)
    if resolved_scope == "host":
        target = resolve_host_path(settings, path)
        if not target.is_file():
            raise AgentHostError("not_found", message=f"file not found: {path}")
        return _read_host_file(target, offset, limit)
    from app.services.agent_toolkit import workspace_store

    directory, relative, target = workspace_path(project_id, path)
    if not target.is_file():
        raise AgentHostError("not_found", message=f"file not found: {relative}")
    try:
        body = target.read_bytes()
        if workspace_store.is_binary(body, relative):
            raise AgentHostError(
                "binary_file", message="this file is not UTF-8 text",
                next_step=workspace_store._binary_next_step(relative))
        page = workspace_store.byte_page(body, offset, limit)
    except AgentToolkitError as error:
        raise _translate(error) from None
    return {"path": relative, "scope": "workspace", "encoding": "utf8",
            "lines": page["content"].count("\n") + 1, "binary": False, **page}


async def write_file(project_id=None, path="", content="", overwrite=False,
                     scope=None, create_parents=True):
    """写一个文本文件；workspace 作用域受 `max_file_bytes` + 配额双重约束。"""
    settings = _settings()
    _require_enabled(settings)
    body = (content or "").encode("utf-8")
    resolved_scope = _scope(settings, scope)
    if resolved_scope == "host":
        target = resolve_host_path(settings, path, write=True)
        if target.exists() and not overwrite:
            raise AgentHostError("invalid_argument",
                                 message="file exists; pass overwrite=true")
        if len(body) > 32 * 1024 * 1024:
            raise AgentHostError("host_file_too_large",
                                 message="host write is limited to 32 MiB")
        if create_parents:
            target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        return {"path": str(target), "bytes": len(body), "scope": "host",
                "created": True}
    from app.services.agent_toolkit import workspace_store

    try:
        result = await workspace_store.write_file(
            project_id, str(path), body, overwrite)
    except AgentToolkitError as error:
        raise _translate(error) from None
    return {"path": result["name"], "bytes": result["bytes"],
            "scope": "workspace", "created": not result["overwritten"]}


def _diff_preview(path, old, new, replacements):
    head = f"--- {path}\n+++ {path}\n"
    body = f"-{old}\n+{new}\n"
    text = (head + body) * max(1, min(replacements, 3))
    encoded = text.encode("utf-8")
    if len(encoded) > DIFF_PREVIEW_BYTES:
        text = encoded[:DIFF_PREVIEW_BYTES].decode("utf-8", "replace")
    if replacements > 3:
        return f"{text}\n(replacements: {replacements})"
    return text


async def edit_file(project_id=None, path="", old_string="", new_string="",
                    replace_all=False, scope=None):
    """精确替换：`old_string` 必须恰好出现一次（除 `replace_all`），否则不落盘。"""
    settings = _settings()
    _require_enabled(settings)
    if not old_string:
        raise AgentHostError("invalid_argument",
                             message="old_string is required")
    resolved_scope = _scope(settings, scope)
    if resolved_scope == "host":
        target = resolve_host_path(settings, path, write=True)
        display = str(target)
    else:
        _root, relative, target = workspace_path(project_id, path)
        display = relative
    if not target.is_file():
        raise AgentHostError("not_found", message=f"file not found: {display}")
    try:
        text = target.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        raise AgentHostError("binary_file",
                             message="this file is not UTF-8 text") from None
    occurrences = text.count(old_string)
    if occurrences == 0:
        raise AgentHostError("edit_not_unique",
                            message="old_string does not occur in the file",
                            next_step="先 read_file 确认原文，再给出更长的锚点。")
    if occurrences > 1 and not replace_all:
        raise AgentHostError(
            "edit_not_unique",
            message=f"old_string occurs {occurrences} times",
            next_step="扩大锚点使其唯一，或传 replace_all=true。")
    updated = (text.replace(old_string, new_string) if replace_all
               else text.replace(old_string, new_string, 1))
    replacements = occurrences if replace_all else 1
    await write_file(project_id, path, updated, overwrite=True,
                     scope=resolved_scope)
    diff = _diff_preview(display, old_string, new_string,
                         replacements)
    return {"path": display, "replacements": replacements,
            "bytes": len(updated.encode("utf-8")), "diff": diff}


def _host_root(settings, project_id, scope):
    if scope == "host":
        roots = settings.get("host_read_roots") or []
        if not roots:
            raise AgentHostError("path_forbidden",
                                 message="host_read_roots is empty")
        return Path(str(roots[0])).expanduser().resolve()
    from app.services.agent_toolkit import workspace_store

    return workspace_store.project_directory(project_id) / "files"


def _host_base(settings, project_id, path):
    """host 作用域的落点：`.`/空值落到第一个可读根，而不是进程 cwd。

    进程 cwd 几乎必然不在 `host_read_roots` 里，直接 `resolve_host_path('.')`
    只会给模型一个它无法理解的 `path_forbidden`。
    """
    if str(path or "").strip() in WORKSPACE_ROOT_ALIASES:
        return _host_root(settings, project_id, "host")
    return resolve_host_path(settings, path)


def list_dir(project_id=None, path="", scope=None):
    """列目录：名称 + 类型 + 字节数，最多 500 项。"""
    settings = _settings()
    _require_enabled(settings)
    resolved_scope = _scope(settings, scope)
    base = (_host_base(settings, project_id, path)
            if resolved_scope == "host"
            else workspace_path(project_id, path or "")[0] / "files")
    if not base.is_dir():
        raise AgentHostError("not_found",
                             message=f"directory not found: {path}")
    entries = []
    for child in sorted(base.iterdir(), key=lambda item: item.name.lower()):
        if child.is_symlink():
            continue
        try:
            stat = child.stat()
        except OSError:
            continue
        entries.append({"name": child.name,
                        "type": "dir" if child.is_dir() else "file",
                        "size": 0 if child.is_dir() else stat.st_size})
        if len(entries) >= LIST_LIMIT:
            break
    return {"path": str(base), "entries": entries,
            "truncated": len(entries) >= LIST_LIMIT}


def _iter_files(base):
    for current, directories, files in os.walk(base):
        directories[:] = [name for name in directories
                          if name not in SKIP_DIRECTORIES]
        for name in files:
            yield Path(current) / name


def glob_files(project_id=None, pattern="", cwd=None, scope=None):
    """相对路径匹配，按 mtime 倒序，最多 2000 项；跳过 .git/node_modules。"""
    settings = _settings()
    _require_enabled(settings)
    resolved_scope = _scope(settings, scope)
    if resolved_scope == "host":
        base = (_host_base(settings, project_id, cwd) if cwd
                else _host_root(settings, project_id, "host"))
    else:
        base = workspace_path(project_id, cwd or "")[0] / "files"
    matches = []
    for candidate in _iter_files(base):
        relative = candidate.relative_to(base).as_posix()
        if not fnmatch.fnmatch(relative, pattern):
            continue
        try:
            stat = candidate.stat()
        except OSError:
            continue
        matches.append({"path": relative, "type": "file",
                        "size": stat.st_size, "mtime": stat.st_mtime})
    matches.sort(key=lambda item: item["mtime"], reverse=True)
    return {"matches": matches[:GLOB_LIMIT],
            "truncated": len(matches) > GLOB_LIMIT}


def _compile(pattern, ignore_case):
    try:
        return re.compile(pattern, re.IGNORECASE if ignore_case else 0)
    except re.error as error:
        raise AgentHostError(
            "invalid_argument",
            message=f"invalid regular expression: {error}") from None


def grep_files(project_id=None, pattern="", path=None, glob=None,
               ignore_case=False, scope=None):
    """正则检索：先编译、限文件大小、限命中数、限墙钟（近似 ReDoS 防护）。"""
    settings = _settings()
    _require_enabled(settings)
    expression = _compile(pattern, ignore_case)
    resolved_scope = _scope(settings, scope)
    if resolved_scope == "host":
        base = (_host_base(settings, project_id, path) if path
                else _host_root(settings, project_id, "host"))
    else:
        base = workspace_path(project_id, path or "")[0] / "files"
    candidates = [base] if base.is_file() else list(_iter_files(base))
    hits, scanned, truncated = [], 0, False
    started = time.monotonic()
    for candidate in candidates:
        exhausted = len(hits) >= GREP_HIT_LIMIT
        overtime = time.monotonic() - started > GREP_SECONDS
        if exhausted or overtime:
            truncated = True
            break
        if glob and not fnmatch.fnmatch(candidate.name, glob):
            continue
        try:
            if candidate.stat().st_size > GREP_FILE_LIMIT:
                continue
            text = candidate.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        scanned += 1
        for number, line in enumerate(text.splitlines(), start=1):
            if expression.search(line):
                hits.append({"path": _display(candidate, base),
                             "line": number, "text": line[:400]})
                if len(hits) >= GREP_HIT_LIMIT:
                    truncated = True
                    break
    return {"hits": hits, "files_scanned": scanned, "truncated": truncated}


def _display(candidate, base):
    try:
        return candidate.relative_to(base).as_posix()
    except ValueError:
        return str(candidate)


__all__ = ["read_file", "write_file", "edit_file", "list_dir", "glob_files",
           "grep_files", "resolve_host_path", "workspace_path"]
