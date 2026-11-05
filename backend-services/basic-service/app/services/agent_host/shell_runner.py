"""本机命令执行：前台命令 + 超时 + 进程树终止 + 输出限幅（spec §4.4）。

**这不是沙箱**。`bash` 是用户本机全权限代码执行：`shell_scope` 只决定默认
cwd 落在哪里，不限制命令读到什么。文档、工具描述与设置页必须一致地这么写
（R-G01）——宁可少承诺，也不做"看起来安全"的假隔离。
"""
import asyncio
import locale
import os
import subprocess
import sys
import time
from pathlib import Path

from app.models.agent_host_models import AgentHostError
from app.security.output_redact import clip_text, redact_text
from app.services.agent_host import audit
from app.services.agent_host.settings import agent_host_settings

# 每项目并发 1、进程级 2（§4.4）；等锁超过 10 s 报 shell_busy。
PROJECT_CONCURRENCY = 1
PROCESS_CONCURRENCY = 2
LOCK_TIMEOUT_SECONDS = 10
# 超时后先 terminate()，5 s 未退再整棵进程树强杀。
TERMINATE_GRACE_SECONDS = 5
# 环境白名单：只透传运行时必需的变量，凭据一律不传。
ENV_ALLOWLIST = ("PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "WINDIR", "TEMP",
                 "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
                 "NUMBER_OF_PROCESSORS", "LANG", "LC_ALL", "PYTHONIOENCODING",
                 "PYTHONUTF8")
SECRET_SUFFIXES = ("KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL")

_project_locks = {}
_process_slots = asyncio.Semaphore(PROCESS_CONCURRENCY)


def shell_name():
    """实际解释器：Windows 上没有 bash，工具名沿用但必须回显真实 shell。"""
    if sys.platform == "win32":
        return os.environ.get("COMSPEC") or "cmd.exe"
    return "/bin/sh"


def shell_command(command):
    """POSIX 返回 argv（`/bin/sh -lc`）；**Windows 返回 None**，走 shell 模式。

    为什么 Windows 不能自己拼 argv：`asyncio.create_subprocess_exec` 会用
    `list2cmdline` 给每个参数补引号，而 `cmd /s /c` 的规则是"以引号开头且以
    引号结尾时剥掉最外层"。两者叠在一起，`"C:\\...\\python.exe" "x.py"` 会被
    二次转义成 `\\"C:\\...\\python.exe\\" \\"x.py\\"` 直接失败（exit 1）。
    交给 `create_subprocess_shell` 才是 cmd 的原生调用方式（它用 `%COMSPEC%`）。
    """
    if sys.platform == "win32":
        return None
    return [shell_name(), "-lc", command]


def _decode(payload):
    """优先本地代码页（cmd.exe 的默认输出），失败回退 UTF-8 + replace。"""
    if not payload:
        return ""
    preferred = locale.getpreferredencoding(False) or "utf-8"
    for encoding in (preferred, "utf-8"):
        try:
            return payload.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    return payload.decode("utf-8", "replace")


def _environment(project_id):
    """白名单环境 + 本域标记；任何名字像凭据的变量都不传。"""
    environment = {}
    for key in ENV_ALLOWLIST:
        value = os.environ.get(key)
        if value is not None:
            environment[key] = value
    for key in list(environment):
        if key.upper().endswith(SECRET_SUFFIXES):
            environment.pop(key, None)
    environment["PYTHONUTF8"] = "1"
    environment["PYTHONIOENCODING"] = "utf-8"
    environment["ECLIPTRIX_AGENT_HOST"] = "1"
    if project_id:
        environment["ECLIPTRIX_PROJECT_ID"] = project_id
    return environment


def _resolve_cwd(settings, project_id, cwd):
    """`workspace` 作用域必须落在项目工作区；`host` 接受任意存在的目录。"""
    scope = settings.get("shell_scope", "workspace")
    if scope == "host":
        base = Path(cwd or Path.home())
        if not base.is_dir():
            raise AgentHostError(
                "path_forbidden", message=f"cwd is not a directory: {base}",
                remediation="给出一个存在的绝对目录，或改用 shell_scope=workspace。")
        return base
    from app.services.agent_toolkit.workspace_store import project_directory

    root = project_directory(project_id).resolve()
    base = root if not cwd else (root / cwd)
    try:
        resolved = base.resolve()
    except OSError:
        raise AgentHostError("path_forbidden",
                            message=f"cwd is not resolvable: {base}") from None
    if not resolved.is_relative_to(root):
        raise AgentHostError(
            "path_forbidden", message="cwd escapes the project workspace",
            remediation="cwd 必须是工作区内的相对路径；需要任意目录请把 "
                        "shell_scope 改成 host。")
    resolved.mkdir(parents=True, exist_ok=True)
    return resolved


def _project_lock(project_id):
    key = project_id or "global"
    lock = _project_locks.get(key)
    if lock is None:
        lock = asyncio.Semaphore(PROJECT_CONCURRENCY)
        _project_locks[key] = lock
    return lock


async def _kill_tree(process):
    """整棵进程树终止：Windows `taskkill /T /F`，POSIX 进程组 SIGKILL。"""
    if process.returncode is not None:
        return
    try:
        process.terminate()
    except ProcessLookupError:
        return
    try:
        await asyncio.wait_for(process.wait(), TERMINATE_GRACE_SECONDS)
        return
    except (TimeoutError, asyncio.TimeoutError):
        pass
    if sys.platform == "win32":
        killer = await asyncio.create_subprocess_exec(
            "taskkill", "/T", "/F", "/PID", str(process.pid),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW)
        await killer.wait()
    else:
        try:
            os.killpg(os.getpgid(process.pid), 9)
        except (ProcessLookupError, PermissionError):
            process.kill()
    try:
        await asyncio.wait_for(process.wait(), TERMINATE_GRACE_SECONDS)
    except (TimeoutError, asyncio.TimeoutError):
        pass


async def run_command(project_id=None, command="", cwd=None, timeout_ms=None):
    """执行一条前台命令；**非 0 退出码不是错误**，就是正常结果。"""
    settings = agent_host_settings()
    if not settings.get("enabled", True):
        raise AgentHostError("shell_disabled",
                            message="agent host is disabled")
    if not settings.get("shell_enabled", True):
        raise AgentHostError(
            "shell_disabled", message="local command execution is disabled",
            remediation="在“设置 › 本机能力”打开“允许本机命令”。")
    budget_kb = int(settings.get("shell_max_output_kb", 64))
    max_bytes = budget_kb * 1024
    seconds = (timeout_ms / 1000 if timeout_ms
               else float(settings.get("shell_timeout_s", 120)))
    workdir = _resolve_cwd(settings, project_id, cwd)
    argv = shell_command(command)
    environment = _environment(project_id)
    options = _spawn_options()

    async with _project_lock(project_id):
        try:
            await asyncio.wait_for(_process_slots.acquire(),
                                   LOCK_TIMEOUT_SECONDS)
        except (TimeoutError, asyncio.TimeoutError):
            raise AgentHostError(
                "shell_busy",
                message="another command is running; try again "
                        "shortly") from None
        try:
            return await _spawn(project_id, command, argv, workdir, environment,
                                options, seconds, max_bytes)
        finally:
            _process_slots.release()


def _spawn_options():
    """子进程选项：Windows 不弹控制台，POSIX 独立进程组（便于整树终止）。"""
    if sys.platform == "win32":
        return {"creationflags": subprocess.CREATE_NO_WINDOW}
    return {"start_new_session": True}


async def _start_process(command, argv, workdir, environment, options):
    """按平台选择 exec / shell 模式（见 `shell_command` 的说明）。"""
    common = {"cwd": str(workdir), "env": environment,
              "stdin": asyncio.subprocess.DEVNULL,
              "stdout": asyncio.subprocess.PIPE,
              "stderr": asyncio.subprocess.PIPE, **options}
    if argv is None:
        return await asyncio.create_subprocess_shell(command, **common)
    return await asyncio.create_subprocess_exec(*argv, **common)


async def _spawn(project_id, command, argv, workdir, environment, options,
                 seconds, max_bytes):
    started = time.monotonic()
    try:
        process = await _start_process(command, argv, workdir, environment,
                                      options)
    except (OSError, ValueError) as error:
        audit.record("shell_spawn_failed", project_id=project_id,
                     command_sha256=audit.command_digest(command),
                     error=type(error).__name__)
        raise AgentHostError(
            "shell_spawn_failed",
            message=f"cannot start the shell: {type(error).__name__}",
            remediation="Windows 上常见于 AppLocker/杀软拦截子进程；允许 "
                        "%APPDATA%\\Ecliptrix 下的 python.exe / ffmpeg.exe 后重试。"
        ) from None
    killed = False
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), seconds)
    except (TimeoutError, asyncio.TimeoutError):
        killed = True
        await _kill_tree(process)
        stdout, stderr = b"", b""
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), 5)
        except (TimeoutError, asyncio.TimeoutError):
            pass
    duration = int((time.monotonic() - started) * 1000)
    out_text, out_truncated = clip_text(
        redact_text(_decode(stdout)), max_bytes)
    err_text, err_truncated = clip_text(
        redact_text(_decode(stderr)), max_bytes)
    audit.record_shell(project_id, command,
                       None if killed else process.returncode,
                       duration, out_truncated or err_truncated)
    return {"exit_code": None if killed else process.returncode,
            "stdout": out_text, "stderr": err_text,
            "stdout_truncated": out_truncated,
            "stderr_truncated": err_truncated, "duration_ms": duration,
            "cwd": str(workdir), "killed": killed, "shell": shell_name(),
            "spawn_failed": None}


__all__ = ["run_command", "shell_name", "shell_command"]
