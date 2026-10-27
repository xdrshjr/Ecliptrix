"""技能存储：内置（只读）+ 用户 + 启停状态文件。

设计基线：docs/plans/agent-steering-and-skills/spec.md §3.3.4。
文件即真相：不建表；所有 IO 经 `asyncio.to_thread`；所有写路径持同一把
`asyncio.Lock`，使“≤ 50 个”检查与落盘在锁内原子完成；落盘走
`SKILL.md.tmp` + `os.replace`，Windows 上被占用时重试。
"""
import asyncio
import json
import logging
import os
import shutil
import threading
import time
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path

from app.models.agent_skills_models import AgentSkillsError
from app.services.agent_skills import limits
from app.services.agent_skills.parser import (
    SkillDocument,
    check_skill_id,
    parse_skill,
    replace_skill_id,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SkillRecord:
    """磁盘上的一个技能目录的解析结果（含无效、被遮蔽的条目）。"""

    id: str
    builtin: bool
    markdown: str
    document: SkillDocument | None
    problem: dict | None
    updated_at: str
    enabled: bool = True
    shadowed: bool = False

    @property
    def valid(self) -> bool:
        return self.document is not None

    def _common(self) -> dict:
        doc = self.document
        return {
            "id": self.id,
            "name": doc.name if doc else self.id,
            "description": doc.description if doc else "",
            "version": doc.version if doc else 1,
            "tools": list(doc.tools) if doc else [],
            "requires": list(doc.requires) if doc else [],
            "builtin": self.builtin,
        }

    def to_summary(self) -> dict:
        doc = self.document
        return {
            **self._common(),
            "enabled": self.enabled, "valid": self.valid,
            "shadowed": self.shadowed, "problem": self.problem,
            "body_chars": doc.body_chars if doc else 0,
            "updated_at": self.updated_at,
        }

    def to_detail(self) -> dict:
        doc = self.document
        return {
            **self.to_summary(),
            "markdown": self.markdown,
            "body": doc.body if doc else "",
            "body_bytes": doc.body_bytes if doc else 0,
        }

    def to_index_entry(self) -> dict:
        common = self._common()
        return {key: common[key] for key in
                ("id", "name", "description", "requires", "builtin")}


def _iso_from_mtime(mtime_ns: int) -> str:
    return datetime.fromtimestamp(
        mtime_ns / 1e9, tz=timezone.utc).isoformat()


def _problem(error: AgentSkillsError) -> dict:
    return {"error_code": error.error_code, "message": error.message}


def _is_acceptable_directory_name(name: str) -> bool:
    try:
        check_skill_id(name)
    except AgentSkillsError:
        return False
    return True


class SkillStore:
    """内置 + 用户技能的读写门面。"""

    def __init__(self, builtin_root: Path, user_root: Path,
                 scan_ttl: float = limits.SCAN_CACHE_SECONDS) -> None:
        self._builtin_root = Path(builtin_root)
        self._user_root = Path(user_root)
        self._scan_ttl = scan_ttl
        self._write_lock = asyncio.Lock()
        self._cache_lock = threading.RLock()
        self._entry_cache: dict[Path, tuple[tuple[int, int], SkillRecord]] = {}
        self._scan_cache: tuple[float, list[SkillRecord], list[SkillRecord]] \
            | None = None
        self._state_cache: tuple[tuple[int, int], set[str]] | None = None

    # ── 读：目录扫描与单文件解析 ───────────────────────────────────────

    def _read_record(self, directory: Path, builtin: bool) -> SkillRecord:
        path = directory / limits.SKILL_FILE_NAME
        try:
            stat = path.stat()
        except OSError:
            error = AgentSkillsError(
                "invalid_skill", message="目录中缺少 SKILL.md")
            return SkillRecord(directory.name, builtin, "", None,
                               _problem(error), "")
        signature = (stat.st_mtime_ns, stat.st_size)
        with self._cache_lock:
            cached = self._entry_cache.get(path)
            if cached and cached[0] == signature:
                return cached[1]
        record = self._parse_file(directory, path, builtin, stat)
        with self._cache_lock:
            self._entry_cache[path] = (signature, record)
        return record

    def _parse_file(self, directory, path, builtin, stat) -> SkillRecord:
        updated_at = _iso_from_mtime(stat.st_mtime_ns)
        text = ""
        try:
            if stat.st_size > limits.MAX_FILE_BYTES:
                raise AgentSkillsError(
                    "skill_too_large", message="SKILL.md 超过 64 KiB")
            text = path.read_text(encoding="utf-8")
            document = parse_skill(text)
            if document.id != directory.name:
                raise AgentSkillsError(
                    "invalid_skill",
                    message=f"frontmatter id（{document.id}）必须等于目录名")
        except AgentSkillsError as error:
            return SkillRecord(directory.name, builtin, text, None,
                               _problem(error), updated_at)
        except (OSError, UnicodeDecodeError):
            error = AgentSkillsError(
                "invalid_skill", message="SKILL.md 无法按 UTF-8 读取")
            return SkillRecord(directory.name, builtin, "", None,
                               _problem(error), updated_at)
        return SkillRecord(document.id, builtin, text, document, None,
                           updated_at)

    def _scan_root(self, root: Path, builtin: bool) -> list[SkillRecord]:
        if not root.is_dir():
            return []
        resolved_root = root.resolve()
        records = []
        with os.scandir(root) as iterator:
            entries = sorted(iterator, key=lambda item: item.name)
        for entry in entries:
            if entry.name.startswith(("_", ".")):
                continue
            # 名称校验必须先于任何 stat/open：Windows 上对 CON 等设备名
            # 做文件操作会打开设备而不是目录。
            if not _is_acceptable_directory_name(entry.name):
                logger.warning("agent_skills: ignored directory %r "
                               "(invalid or reserved id)", entry.name)
                continue
            directory = Path(entry.path)
            if not self._is_plain_child(directory, resolved_root):
                logger.warning("agent_skills: ignored directory %r "
                               "(not a plain child of the skills root)",
                               entry.name)
                continue
            records.append(self._read_record(directory, builtin))
        return records

    @staticmethod
    def _is_plain_child(directory: Path, resolved_root: Path) -> bool:
        try:
            return directory.is_dir() \
                and directory.resolve().parent == resolved_root
        except OSError:
            return False

    def _snapshot(self) -> tuple[list[SkillRecord], list[SkillRecord]]:
        with self._cache_lock:
            now = time.monotonic()
            cached = self._scan_cache
            if cached and now - cached[0] < self._scan_ttl:
                return cached[1], cached[2]
            builtin = self._scan_root(self._builtin_root, True)
            user = self._scan_root(self._user_root, False)
            self._scan_cache = (now, builtin, user)
            return builtin, user

    def _invalidate(self) -> None:
        with self._cache_lock:
            self._scan_cache = None

    # ── 读：启停状态 ──────────────────────────────────────────────────

    def _state_path(self) -> Path:
        return self._user_root / limits.STATE_FILE_NAME

    def _read_disabled(self) -> set[str]:
        path = self._state_path()
        try:
            stat = path.stat()
        except OSError:
            return set()
        signature = (stat.st_mtime_ns, stat.st_size)
        with self._cache_lock:
            if self._state_cache and self._state_cache[0] == signature:
                return set(self._state_cache[1])
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            disabled = {item for item in raw["disabled"]
                        if isinstance(item, str)}
        except (OSError, ValueError, KeyError, TypeError):
            # 损坏的状态文件视为空，不阻断启动（spec §6）。
            logger.warning("agent_skills: unreadable %s, treated as empty",
                           limits.STATE_FILE_NAME)
            return set()
        with self._cache_lock:
            self._state_cache = (signature, disabled)
        return set(disabled)

    def _view(self) -> list[SkillRecord]:
        """内置 ∪ 用户，已套用启停状态与遮蔽标记。"""
        builtin, user = self._snapshot()
        disabled = self._read_disabled()
        builtin_ids = {record.id for record in builtin}
        view = [replace(record, enabled=record.id not in disabled)
                for record in builtin]
        for record in user:
            view.append(replace(
                record, enabled=record.id not in disabled,
                shadowed=record.id in builtin_ids))
        return view

    # ── 读：公开接口 ──────────────────────────────────────────────────

    async def list_skills(self) -> list[SkillRecord]:
        return await asyncio.to_thread(self._view)

    async def get_skill(self, skill_id: str) -> SkillRecord:
        """内置优先；遮蔽的用户副本不会被返回。"""
        check_skill_id(skill_id, code="invalid_parameters")
        for record in await asyncio.to_thread(self._view):
            if record.id == skill_id and not record.shadowed:
                return record
        raise AgentSkillsError("skill_not_found",
                               message=f"技能不存在：{skill_id}")

    async def index(self) -> tuple[list[SkillRecord], bool]:
        """L0 索引：启用且有效且未被遮蔽；内置优先，用户按更新时间倒序。"""
        view = await asyncio.to_thread(self._view)
        usable = [r for r in view if r.enabled and r.valid and not r.shadowed]
        builtin = sorted((r for r in usable if r.builtin),
                         key=lambda r: r.id)
        user = sorted((r for r in usable if not r.builtin),
                      key=lambda r: r.updated_at, reverse=True)
        ordered = builtin + user
        return (ordered[:limits.MAX_INDEX_ENTRIES],
                len(ordered) > limits.MAX_INDEX_ENTRIES)

    @staticmethod
    def validate(markdown: str) -> SkillDocument:
        """干跑校验：纯函数，不触盘。"""
        return parse_skill(markdown)

    # ── 写：落盘原语 ──────────────────────────────────────────────────

    def _user_directory(self, skill_id: str) -> Path:
        check_skill_id(skill_id, code="invalid_parameters")
        root = self._user_root.resolve()
        directory = (root / skill_id).resolve()
        if directory.parent != root:
            raise AgentSkillsError("invalid_parameters",
                                   message="技能目录必须位于技能根目录下")
        return directory

    @staticmethod
    def _replace_with_retry(source: Path, target: Path) -> None:
        for attempt in range(limits.REPLACE_RETRIES + 1):
            try:
                os.replace(source, target)
                return
            except PermissionError:
                if attempt == limits.REPLACE_RETRIES:
                    break
                time.sleep(limits.REPLACE_RETRY_DELAY_SECONDS)
            except OSError as error:
                raise AgentSkillsError(
                    "internal_error",
                    message=f"写入失败：{error.strerror or error}") from None
        raise AgentSkillsError(
            "internal_error",
            message="目标文件被其他程序占用，请关闭预览/杀毒扫描后重试")

    def _atomic_write(self, target: Path, text: str) -> None:
        data = text.replace("\r\n", "\n").encode("utf-8")
        temporary = target.with_name(target.name + ".tmp")
        try:
            temporary.write_bytes(data)
            self._replace_with_retry(temporary, target)
        except OSError as error:
            raise AgentSkillsError(
                "internal_error",
                message=f"写入失败：{error.strerror or error}") from None
        finally:
            temporary.unlink(missing_ok=True)

    def _write_disabled(self, disabled: set[str]) -> None:
        self._user_root.mkdir(parents=True, exist_ok=True)
        payload = {
            "disabled": sorted(disabled),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self._atomic_write(self._state_path(), json.dumps(payload, indent=2))

    def _builtin_ids(self) -> set[str]:
        return {record.id for record in self._snapshot()[0]}

    def _reject_builtin_target(self, skill_id: str) -> None:
        if skill_id in self._builtin_ids():
            raise AgentSkillsError(
                "builtin_readonly",
                message="内置技能不可修改，可复制为我的技能后编辑")

    # ── 写：同步实现（在锁内、线程里执行）─────────────────────────────

    def _create_sync(self, document: SkillDocument, markdown: str) -> None:
        self._invalidate()
        directory = self._user_directory(document.id)
        if document.id in self._builtin_ids() or directory.exists():
            raise AgentSkillsError(
                "skill_exists", message=f"技能已存在：{document.id}")
        if len(self._snapshot()[1]) >= limits.MAX_USER_SKILLS:
            raise AgentSkillsError(
                "skill_limit",
                message=f"用户技能最多 {limits.MAX_USER_SKILLS} 个")
        directory.mkdir(parents=True)
        try:
            self._atomic_write(directory / limits.SKILL_FILE_NAME, markdown)
        except AgentSkillsError:
            shutil.rmtree(directory, ignore_errors=True)
            raise
        self._invalidate()

    def _update_sync(self, skill_id: str, markdown: str) -> None:
        self._invalidate()
        directory = self._user_directory(skill_id)
        if not directory.is_dir():
            raise AgentSkillsError("skill_not_found",
                                   message=f"技能不存在：{skill_id}")
        self._atomic_write(directory / limits.SKILL_FILE_NAME, markdown)
        self._invalidate()

    def _delete_sync(self, skill_id: str) -> None:
        self._invalidate()
        directory = self._user_directory(skill_id)
        if not directory.is_dir():
            raise AgentSkillsError("skill_not_found",
                                   message=f"技能不存在：{skill_id}")
        try:
            shutil.rmtree(directory)
        except OSError as error:
            raise AgentSkillsError(
                "internal_error",
                message=f"删除失败：{error.strerror or error}") from None
        disabled = self._read_disabled()
        if skill_id in disabled:
            self._write_disabled(disabled - {skill_id})
        self._invalidate()

    def _set_enabled_sync(self, skill_id: str, enabled: bool) -> None:
        self._invalidate()
        if not any(r.id == skill_id for r in self._view()):
            raise AgentSkillsError("skill_not_found",
                                   message=f"技能不存在：{skill_id}")
        disabled = self._read_disabled()
        updated = disabled - {skill_id} if enabled else disabled | {skill_id}
        if updated != disabled:
            self._write_disabled(updated)

    # ── 写：公开接口 ──────────────────────────────────────────────────

    async def create(self, markdown: str) -> SkillRecord:
        document = parse_skill(markdown)
        async with self._write_lock:
            await asyncio.to_thread(self._create_sync, document, markdown)
        return await self.get_skill(document.id)

    async def update(self, skill_id: str, markdown: str) -> SkillRecord:
        check_skill_id(skill_id, code="invalid_parameters")
        await asyncio.to_thread(self._reject_builtin_target, skill_id)
        document = parse_skill(markdown)
        if document.id != skill_id:
            raise AgentSkillsError(
                "invalid_skill",
                message=f"frontmatter id（{document.id}）必须等于 {skill_id}")
        async with self._write_lock:
            await asyncio.to_thread(self._update_sync, skill_id, markdown)
        return await self.get_skill(skill_id)

    async def delete(self, skill_id: str) -> None:
        check_skill_id(skill_id, code="invalid_parameters")
        await asyncio.to_thread(self._reject_builtin_target, skill_id)
        async with self._write_lock:
            await asyncio.to_thread(self._delete_sync, skill_id)

    async def set_enabled(self, skill_id: str, enabled: bool) -> SkillRecord:
        check_skill_id(skill_id, code="invalid_parameters")
        async with self._write_lock:
            await asyncio.to_thread(self._set_enabled_sync, skill_id, enabled)
        return await self.get_skill(skill_id)

    async def duplicate(self, skill_id: str, new_id: str) -> SkillRecord:
        """把任意技能复制为用户技能（便于改内置技能的副本）。"""
        check_skill_id(new_id, code="invalid_parameters")
        source = await self.get_skill(skill_id)
        if source.document is None:
            problem = source.problem or {}
            raise AgentSkillsError(
                "invalid_skill",
                message=f"源技能无效，无法复制：{problem.get('message', '')}")
        return await self.create(replace_skill_id(source.markdown, new_id))
