"""计算沙箱：AST 白名单 + 独立子进程（默认关闭）。

设计基线：docs/plans/agent-general-toolkit/spec.md §3.4。

**这不是内核级隔离。** 它防的是「模型写错代码误伤文件」，不防「本机恶意用户」：
只有墙钟超时，没有内存 / CPU 上限（Windows 无 `setrlimit` 对应语义，
也不建 job object）。因此默认关闭、必须显式开启，且设置面板必须照实说明。
"""
import ast
import asyncio
import os
import re
import shutil
import subprocess  # noqa: F401 - CREATE_NO_WINDOW 常量在 Windows 上取自此处
import sys
import time
from pathlib import Path

from app.models.agent_toolkit_models import AgentToolkitError
from app.services.agent_toolkit.analysis_prelude import PRELUDE
from app.services.agent_toolkit.workspace_store import project_directory

MAX_CODE_CHARS = 6000
ALLOWED_MODULES = frozenset({
    "math", "statistics", "json", "csv", "re", "datetime", "decimal",
    "fractions", "itertools", "collections", "functools", "string",
    "textwrap", "random", "unicodedata", "base64", "hashlib",
})
FORBIDDEN_NAMES = frozenset({
    "eval", "exec", "compile", "open", "input", "__import__", "globals",
    "locals", "vars", "getattr", "setattr", "delattr", "breakpoint",
    "exit", "quit", "memoryview", "help",
})
MAX_ARTIFACT_FILES = 20
MAX_ARTIFACT_BYTES = 5 * 1024 * 1024
MAX_ARTIFACT_TOTAL = 20 * 1024 * 1024
DEFAULT_TIMEOUT = 20
DEFAULT_OUTPUT_KB = 64
TRUNCATION_MARK = "…[truncated]"
# 产物目录名白名单：`call_id` 来自请求头，只允许这几类字符落地成路径。
_UNSAFE_DIR_CHARS = re.compile(r"[^A-Za-z0-9_-]")


def _settings():
    from app.services.system_settings_service import toolkit_settings

    return toolkit_settings()


def _reject(reason):
    error = AgentToolkitError("analysis_rejected",
                              message=f"code rejected: {reason}")
    error.reason = reason
    raise error


def validate_code(code):
    """静态校验（§3.4 五条）；任一不通过即 `analysis_rejected`。"""
    if not isinstance(code, str):
        _reject("type")
    if len(code) > MAX_CODE_CHARS:
        _reject("too_long")
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError:
        _reject("syntax")
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            _check_import(node)
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            _reject("forbidden_name:" + node.id)
        elif isinstance(node, ast.Name) and node.id.startswith("__"):
            # `__builtins__` 是模块全局，`__builtins__.eval(...)` 的属性名不以
            # `_` 开头，会绕过下面的 private-attribute 规则（spec §10 R1）。
            _reject("dunder_name:" + node.id)
        elif isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            _reject("private_attribute:" + node.attr)
        elif isinstance(node, (ast.Await, ast.AsyncWith, ast.AsyncFor,
                              ast.AsyncFunctionDef)):
            _reject("async_not_supported")
        elif isinstance(node, ast.YieldFrom):
            _reject("yield_from")
    return tree


def _check_import(node):
    if isinstance(node, ast.Import):
        roots = [alias.name.split(".")[0] for alias in node.names]
    else:
        if node.level:
            _reject("relative_import")
        roots = [(node.module or "").split(".")[0]]
    for root in roots:
        if root not in ALLOWED_MODULES:
            _reject("module_not_allowed:" + (root or "(empty)"))


def build_script(out_dir, in_dir, code):
    """前导内联拼接（`-I` 不保证脚本目录在 sys.path 内，R-31）。"""
    header = (
        "OUT = " + repr(str(out_dir)) + "\n"
        + "IN = " + repr(str(in_dir)) + "\n"
    )
    return header + PRELUDE + "\n\n" + code + "\n"


def _minimal_environment():
    environment = {"PYTHONDONTWRITEBYTECODE": "1"}
    for key in ("PATH", "SYSTEMROOT", "SYSTEMDRIVE", "TEMP", "TMP"):
        value = os.environ.get(key)
        if value:
            environment[key] = value
    # 不继承代理变量 / 密钥 / STORAGE_ROOT：阻断环境变量泄露与顺手出网。
    return environment


def _truncate(raw, limit_bytes):
    if len(raw) <= limit_bytes:
        return raw.decode("utf-8", errors="replace"), False
    return (raw[:limit_bytes].decode("utf-8", errors="replace")
            + TRUNCATION_MARK), True


def _collect_files(out_dir):
    entries = []
    total = 0
    truncated = False
    for path in sorted(Path(out_dir).rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        if path.name.endswith(".py") or path.name.endswith(".tmp"):
            continue
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if len(entries) >= MAX_ARTIFACT_FILES or size > MAX_ARTIFACT_BYTES:
            truncated = True
            continue
        if total + size > MAX_ARTIFACT_TOTAL:
            truncated = True
            continue
        total += size
        entries.append({
            "name": path.relative_to(out_dir).as_posix(),
            "bytes": size,
            "kind": _kind_of(path.name),
        })
    return entries, truncated


def _kind_of(name):
    extension = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if extension in {"png", "jpg", "jpeg", "webp", "gif", "svg"}:
        return "image"
    if extension in {"csv", "tsv"}:
        return "csv"
    if extension in {"json", "md", "txt"}:
        return "text"
    return "other"


def _call_directory_name(call_id):
    """`call_id` 来自 HTTP 头，绝不能直接当日录名。

    先按白名单净化（只留 `A-Za-z0-9_-`）：`..`、`/`、`\\`、盘符冒号与尾点全部
    消失，也就无法借 `Path.__truediv__` 跳出 `out/`。净化后为空则退回时间戳，
    避免出现空目录名。
    """
    token = _UNSAFE_DIR_CHARS.sub("", (call_id or "").strip())[:64]
    if not token.strip("-_"):
        return f"call-{int(time.time() * 1000)}"
    return token if token.startswith("call-") else "call-" + token


def _kill(process):
    try:
        if process.returncode is None:
            process.kill()
    except ProcessLookupError:
        pass


async def _drain_after_kill(process, grace=5.0):
    """kill 之后有界地收尾：孙进程可能仍持有管道，无界 `communicate()` 会挂死。"""
    _kill(process)
    try:
        return await asyncio.wait_for(process.communicate(), timeout=grace)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        return b"", b""


async def _remove_call_dir(call_dir):
    """取消路径的清理：产物目录连同 `_analysis.py` 一起消失（§3.8）。"""
    await asyncio.to_thread(shutil.rmtree, call_dir, True)


async def run(code, project_id=None, call_id=None, root=None):
    """执行一次分析；`status` 与 HTTP 解耦（非零退出是工具结果，不是 HTTP 错误）。"""
    settings = _settings()
    if not settings["enabled"]:
        raise AgentToolkitError("toolkit_disabled")
    if not settings["analysis_enabled"]:
        error = AgentToolkitError("analysis_disabled")
        error.next_step = ("Ask the user to enable Analysis in "
                           "Settings → Agent capabilities.")
        raise error
    validate_code(code)
    directory = project_directory(project_id, root)
    in_dir = directory / "files"
    in_dir.mkdir(parents=True, exist_ok=True)
    call_dir = directory / "out" / _call_directory_name(call_id)
    call_dir.mkdir(parents=True, exist_ok=True)
    script = call_dir / "_analysis.py"
    script.write_text(build_script(call_dir, in_dir, code), encoding="utf-8")
    timeout = float(settings["analysis_timeout_seconds"])
    output_limit = int(settings["analysis_max_output_kb"]) * 1024
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    started = time.monotonic()
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-I", "-B", "-X", "utf8", str(script),
        cwd=str(call_dir),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_minimal_environment(),
        creationflags=flags,
    )
    timed_out = False
    try:
        stdout_raw, stderr_raw = await asyncio.wait_for(
            process.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        timed_out = True
        stdout_raw, stderr_raw = await _drain_after_kill(process)
    except asyncio.CancelledError:
        # 用户取消本轮（`abortSignal`）：必须 kill 并清掉本次产物目录，
        # 否则每次取消都会留下一个永不结束的子进程 + 一份 out/ 残留（§3.8）。
        _kill(process)
        await asyncio.shield(_remove_call_dir(call_dir))
        raise
    finally:
        _kill(process)
    duration_ms = int((time.monotonic() - started) * 1000)
    stdout, cut_out = _truncate(stdout_raw or b"", output_limit)
    stderr, cut_err = _truncate(stderr_raw or b"", output_limit)
    files, cut_files = _collect_files(call_dir)
    if timed_out:
        error = AgentToolkitError(
            "analysis_timeout",
            message=f"analysis exceeded {int(timeout)}s")
        error.partial = {"stdout": stdout, "stderr": stderr,
                         "exit_code": process.returncode}
        raise error
    status = "ok" if process.returncode == 0 else "error"
    return {
        "status": status,
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": int(process.returncode or 0),
        "duration_ms": duration_ms,
        "files": files,
        "truncated": cut_out or cut_err or cut_files,
    }
