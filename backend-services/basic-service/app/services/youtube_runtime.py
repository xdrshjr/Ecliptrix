"""仅管理 YouTube 的官方 wheel、不可变版本租约和可回收操作进程。"""
from __future__ import annotations

import asyncio
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone
from email.parser import BytesParser
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit
import uuid
import zipfile

import httpx
try:
    from packaging.version import Version
    from packaging.specifiers import SpecifierSet
    from packaging.requirements import Requirement
except ImportError:  # pip 随桌面 Python 提供，不增加产品依赖
    from pip._vendor.packaging.version import Version
    from pip._vendor.packaging.specifiers import SpecifierSet
    from pip._vendor.packaging.requirements import Requirement

from .youtube_worker import error_code

ERRORS = {
    "SIGN_IN_REQUIRED": "YouTube 要求登录或验证，当前网络出口暂时无法访问此视频。",
    "RATE_LIMITED": "YouTube 请求受限，请稍后重试。",
    "NETWORK_ERROR": "无法连接 YouTube 或媒体服务器，请检查网络及代理后重试。",
    "PREVIEW_LIMIT": "预览准备超过时长、大小或时间上限；请选择较短的视频。",
    "UNSUPPORTED_MEDIA": "暂不支持直播、DRM 或不可访问的视频。",
    "MERGE_FAILED": "视频合并或格式校验失败，请检查 FFmpeg 后重试。",
    "CANCELLED": "操作已取消。",
}
operation_cancel: ContextVar[threading.Event | None] = ContextVar("youtube_cancel", default=None)


class YoutubeOperationError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(f"{code}: {ERRORS.get(code, ERRORS['NETWORK_ERROR'])}")


@dataclass(frozen=True)
class RuntimeLease:
    version: str
    directory: str | None


def utcnow():
    return datetime.now(timezone.utc).isoformat()


class YoutubeRuntime:
    def __init__(self, root=None, proxy=None):
        storage = Path(os.environ.get("STORAGE_ROOT", "./storage")).resolve()
        self.root = Path(root or os.environ.get("YOUTUBE_RUNTIME_ROOT") or storage.parent / "youtube-runtime").resolve()
        self.proxy = proxy
        self.node = os.environ.get("YOUTUBE_NODE_PATH")
        if not self.node:
            bundled = Path(sys.executable).parent / "Lib/site-packages/playwright/driver/node.exe"
            self.node = str(bundled) if bundled.is_file() else shutil.which("node")
        self._guard = threading.RLock()
        self._check_lock = threading.Lock()
        self._slots = threading.BoundedSemaphore(4)
        self._leases = {}
        self._check_task = None
        self._periodic = None
        self._closing = threading.Event()
        baseline = importlib.metadata.version("yt-dlp")
        self._baseline = RuntimeLease(baseline, str(importlib.metadata.distribution("yt-dlp").locate_file("")))
        self._active = self._baseline
        self._state = dict(active_version=baseline, available_version=None, status="ready", last_checked_at=None,
                           last_updated_at=None, last_result=None, error=None, history=[])
        try:
            saved = json.loads((self.root / "state.json").read_text("utf-8"))
            directory = self.root / "versions" / saved["active_version"]
            if not directory.exists() and saved["active_version"] == baseline:
                self._state.update(saved)
                self._recover_interruption()
                return
            lease = RuntimeLease(saved["active_version"], str(directory))
            report = self.run("selftest", {"require_ejs": True}, lease=lease, timeout=20)
            if Version(report["version"]) != Version(lease.version) or not Path(report["module_path"]).is_relative_to(directory):
                raise ValueError("运行时自检失败")
            self._active = lease
            self._state.update(saved)
            self._recover_interruption()
        except FileNotFoundError:
            pass
        except Exception:
            self._state.update(status="error", error="保存的 YouTube 运行时不可用，已使用随包基线。")

    def _recover_interruption(self):
        if self._state["status"] in ("checking", "installing"):
            self._state.update(status="error", last_result="interrupted", error="上次更新被中断，已保留最后可用版本。")

    @property
    def generation(self):
        return (self._active.version, self._active.directory)

    def status(self):
        with self._guard:
            return json.loads(json.dumps(self._state))

    def _persist(self):
        self.root.mkdir(parents=True, exist_ok=True)
        temp = self.root / ("state-" + uuid.uuid4().hex + ".tmp")
        try:
            temp.write_text(json.dumps(self._state, ensure_ascii=False), encoding="utf-8")
            os.replace(temp, self.root / "state.json")
        finally:
            temp.unlink(missing_ok=True)

    def _prune(self):
        """保留活动版、最后可用版及所有租用版；只删除专用根目录内的旧版本。"""
        directory = self.root / "versions"
        if not directory.exists():
            return
        keep = {self._active.version, self._state.get("previous_version")}
        keep.update(lease.version for lease, count in self._leases.items() if count)
        try:
            for path in directory.iterdir():
                if path.name not in keep and path.is_dir() and path.resolve().is_relative_to(directory.resolve()):
                    shutil.rmtree(path, ignore_errors=True)
        except OSError:
            pass  # 清理失败不改变已验证运行时的激活结果。

    @contextmanager
    def lease(self):
        with self._guard:
            lease = self._active
            self._leases[lease] = self._leases.get(lease, 0) + 1
        try:
            yield lease
        finally:
            with self._guard:
                self._leases[lease] -= 1
                self._prune()

    @staticmethod
    def _stop(process):
        if process.poll() is not None:
            return
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True,
                           creationflags=subprocess.CREATE_NO_WINDOW, timeout=10)
        else:
            os.killpg(process.pid, signal.SIGKILL)
        if process.poll() is None:
            process.kill()
        process.wait(timeout=10)

    def run(self, operation, payload=None, *, lease=None, timeout=40, cancel=None, byte_limit=None):
        if lease is None:
            with self.lease() as acquired:
                return self.run(operation, payload, lease=acquired, timeout=timeout, cancel=cancel, byte_limit=byte_limit)
        cancel = cancel or operation_cancel.get()
        deadline = time.monotonic() + timeout
        while not self._slots.acquire(timeout=0.1):
            if self._closing.is_set() or (cancel and cancel.is_set()):
                raise YoutubeOperationError("CANCELLED")
            if time.monotonic() > deadline:
                raise YoutubeOperationError("PREVIEW_LIMIT")
        process = None
        try:
            worker = str(Path(__file__).with_name("youtube_worker.py"))
            bootstrap = "import sys,runpy; p=sys.argv[1]; sys.path.insert(0,p) if p else None; runpy.run_path(sys.argv[2],run_name='__main__')"
            message = dict(payload or {}, operation=operation, node=self.node)
            env = dict(os.environ, PYTHONNOUSERSITE="1")
            process = subprocess.Popen([sys.executable, "-B", "-X", "utf8", "-c", bootstrap, lease.directory or "", worker],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env,
                creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
                start_new_session=os.name != "nt")
            encoded = json.dumps(message).encode("utf-8")
            first = True
            while True:
                if self._closing.is_set() or (cancel and cancel.is_set()):
                    raise YoutubeOperationError("CANCELLED")
                if time.monotonic() > deadline:
                    raise YoutubeOperationError("PREVIEW_LIMIT" if operation == "preview" else "NETWORK_ERROR")
                if byte_limit and message.get("output_dir"):
                    size = 0
                    for path in Path(message["output_dir"]).rglob("*"):
                        try:
                            if path.is_file():
                                size += path.stat().st_size
                        except FileNotFoundError:
                            pass  # worker 可能刚删除已合并的中间文件。
                    if size > byte_limit:
                        raise YoutubeOperationError("PREVIEW_LIMIT")
                try:
                    out, _ = process.communicate(input=encoded if first else None, timeout=0.2)
                    break
                except subprocess.TimeoutExpired:
                    first = False
            if process.returncode:
                raise YoutubeOperationError("NETWORK_ERROR")
            result = json.loads(out)
            if not result.get("success"):
                raise YoutubeOperationError(result.get("code", "NETWORK_ERROR"))
            return result["data"]
        finally:
            if process is not None:
                self._stop(process)
                for pipe in (process.stdin, process.stdout):
                    if pipe:
                        pipe.close()
            self._slots.release()

    def _metadata(self, client, package, version=None):
        url = f"https://pypi.org/pypi/{package}/" + (f"{version}/json" if version else "json")
        response = client.get(url)
        response.raise_for_status()
        return response.json()

    def _wheel(self, client, metadata, destination):
        python = ".".join(map(str, sys.version_info[:3]))
        files = [f for f in metadata["urls"] if f["filename"].endswith("-py3-none-any.whl") and not f.get("yanked")
                 and SpecifierSet(f.get("requires_python") or "").contains(python)]
        if not files:
            raise ValueError("新版本不支持当前 Python，继续使用当前版本。")
        item = files[0]
        url = urlsplit(item["url"])
        if url.scheme != "https" or url.hostname != "files.pythonhosted.org":
            raise ValueError("更新来源不符合官方源约束。")
        digest = hashlib.sha256()
        deadline = time.monotonic() + 120
        with tempfile.TemporaryFile(dir=self.root) as wheel:
            with client.stream("GET", item["url"]) as response:
                response.raise_for_status()
                total = 0
                for chunk in response.iter_bytes():
                    if self._closing.is_set() or time.monotonic() > deadline:
                        raise ValueError("更新已中断。")
                    total += len(chunk)
                    if total > 32 * 1024**2:
                        raise ValueError("更新文件过大。")
                    digest.update(chunk)
                    wheel.write(chunk)
            if digest.hexdigest() != item["digests"]["sha256"]:
                raise ValueError("更新文件完整性校验失败，保留原版本。")
            wheel.seek(0)
            with zipfile.ZipFile(wheel) as archive:
                if sum(i.file_size for i in archive.infolist()) > 128 * 1024**2:
                    raise ValueError("更新解压大小超限。")
                for member in archive.namelist():
                    if not (destination / member).resolve().is_relative_to(destination.resolve()):
                        raise ValueError("更新文件路径无效。")
                metadata_file = next(n for n in archive.namelist() if n.endswith(".dist-info/METADATA"))
                package_metadata = BytesParser().parsebytes(archive.read(metadata_file))
                archive.extractall(destination)
                return package_metadata

    def check(self, force=False):
        if not self._check_lock.acquire(blocking=False):
            return self.status()
        staging = None
        previous = self._active
        installed = False
        try:
            last = self._state["last_checked_at"]
            interval = 3600 if self._state["status"] == "error" else 86400
            if not force and last and time.time() - datetime.fromisoformat(last).timestamp() < interval:
                return self.status()
            with self._guard:
                self._state.update(status="checking", last_checked_at=utcnow(), error=None)
            self._persist()
            with httpx.Client(timeout=20, proxy=self.proxy or None, follow_redirects=False) as client:
                metadata = self._metadata(client, "yt-dlp")
                version = Version(metadata["info"]["version"])
                if version.is_prerelease or version.is_devrelease:
                    raise ValueError("更新源未提供稳定版本。")
                self._state["available_version"] = str(version)
                # 同版本基线可能缺 EJS；安装完整运行时使首次启动也能修复组件缺失。
                if version <= Version(previous.version) and previous != self._baseline:
                    self._state.update(status="ready", last_result="no_update")
                    self._persist()
                    return self.status()
                if version < Version(previous.version):
                    self._state.update(status="ready", last_result="no_update")
                    self._persist()
                    return self.status()
                self._state["status"] = "installing"
                staging = self.root / ("staging-" + uuid.uuid4().hex)
                staging.mkdir(parents=True)
                wheel_meta = self._wheel(client, metadata, staging)
                requirements = [Requirement(r) for r in wheel_meta.get_all("Requires-Dist", [])]
                ejs = next((r for r in requirements if r.name.replace("_", "-") == "yt-dlp-ejs"
                            and (not r.marker or r.marker.evaluate({"extra": "default"}))), None)
                if ejs is None:
                    raise ValueError("新版本没有匹配的 EJS 依赖声明。")
                pinned = [s.version for s in ejs.specifier if s.operator == "=="]
                ejs_meta = self._metadata(client, "yt-dlp-ejs", pinned[0] if pinned else None)
                if not ejs.specifier.contains(ejs_meta["info"]["version"]):
                    raise ValueError("EJS 版本不匹配。")
                self._wheel(client, ejs_meta, staging)
            candidate = RuntimeLease(metadata["info"]["version"], str(staging))
            report = self.run("selftest", {"require_ejs": True}, lease=candidate, timeout=25)
            if Version(report["version"]) != version or not Path(report["module_path"]).is_relative_to(staging):
                raise ValueError("隔离 worker 版本校验失败。")
            if Version(report["ejs_version"]) != Version(ejs_meta["info"]["version"]) or not report["ejs_challenge_ok"]:
                raise ValueError("EJS 挑战脚本或依赖版本校验失败。")
            target = self.root / "versions" / candidate.version
            target.parent.mkdir(parents=True, exist_ok=True)
            with self._guard:
                if not target.resolve().is_relative_to(target.parent.resolve()):
                    raise ValueError("运行时目录超出专用根目录。")
                if target.exists():
                    # 只可能是激活前中断遗留；不触碰已租用版本。
                    if any(l.directory == str(target) and n for l, n in self._leases.items()):
                        raise ValueError("目标版本仍在使用。")
                    shutil.rmtree(target)
                os.replace(staging, target)
                staging = None
                installed = True
                state_before = self.status()
                self._state.update(active_version=candidate.version, previous_version=previous.version, status="ready", last_updated_at=utcnow(), last_result="activated", error=None)
                self._state["history"] = (self._state["history"] + [dict(old_version=previous.version, new_version=candidate.version,
                    checked_at=self._state["last_checked_at"], activated_at=self._state["last_updated_at"], result="activated")])[-10:]
                try:
                    self._persist()  # 原子记录成功后才向新任务发布
                except Exception:
                    self._state = state_before
                    raise
                self._active = RuntimeLease(candidate.version, str(target))
                self._prune()
            return self.status()
        except Exception as error:
            # HTTP 异常字符串可能含代理地址；只持久化固定、无秘密的错误。
            reason = str(error) if isinstance(error, ValueError) else "无法访问官方更新源或安装失败；当前版本仍可使用。"
            with self._guard:
                self._state.update(status="error", last_result="activation_failed" if installed else "update_failed", error=reason)
                self._state["history"] = (self._state["history"] + [dict(old_version=previous.version,
                    new_version=self._state["available_version"], checked_at=self._state["last_checked_at"],
                    activated_at=None, result=self._state["last_result"], error=reason)])[-10:]
                try:
                    self._persist()
                except OSError:
                    pass
            return self.status()
        finally:
            if staging and staging.exists():
                shutil.rmtree(staging, ignore_errors=True)
            self._check_lock.release()

    def request_check(self, force=True):
        if self._check_task is None or self._check_task.done():
            if force:
                self._state["status"] = "checking"
            self._check_task = asyncio.create_task(asyncio.to_thread(self.check, force))
        return self.status()

    def start(self):
        self._closing.clear()
        async def periodic():
            while not self._closing.is_set():
                self.request_check(False)
                await asyncio.sleep(60)
        self._periodic = asyncio.create_task(periodic())

    async def close(self):
        self._closing.set()
        if self._periodic:
            self._periodic.cancel()
            await asyncio.gather(self._periodic, return_exceptions=True)
        if self._check_task:
            await asyncio.gather(self._check_task, return_exceptions=True)


async def cancellable_call(function, *args):
    cancel = threading.Event()
    token = operation_cancel.set(cancel)
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(task)
    finally:
        cancel.set()
        operation_cancel.reset(token)
        # 线程里的 worker 实际退出后才放弃所有权。
        await asyncio.gather(task, return_exceptions=True)


youtube_runtime = YoutubeRuntime()
