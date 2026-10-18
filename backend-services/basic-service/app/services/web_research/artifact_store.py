"""私有不可变资料，UTF-8 字节分页及带预留/pin 的配额事务。"""
import asyncio
import hashlib
import re
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select

from app.models.research_db_models import ResearchArtifact
from app.models.web_research_models import WebResearchError


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def byte_page(body, offset, max_bytes):
    if offset < 0 or offset > len(body):
        raise WebResearchError("invalid_offset")
    if offset < len(body) and body[offset] & 0xC0 == 0x80:
        raise WebResearchError("invalid_offset")
    end = min(len(body), offset + max_bytes)
    while end < len(body) and end > offset and body[end] & 0xC0 == 0x80:
        end -= 1
    if end == offset and end < len(body):
        raise WebResearchError("invalid_page_size")
    return {"content": body[offset:end].decode("utf-8"),
            "next_offset": end if end < len(body) else None,
            "total_bytes": len(body), "truncated": end < len(body)}


class ArtifactStore:
    def __init__(self, root=None, session_factory=None, quota=256 * 1024 * 1024):
        if root is None:
            from app.config import settings
            root = Path(settings.storage.root).resolve().parent / "research_artifacts"
        if session_factory is None:
            from app.database import async_session_factory
            session_factory = async_session_factory
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.session_factory = session_factory
        self.quota = quota
        self.lock = asyncio.Lock()
        self.pins = {}
        self.reserved = 0
        self.accessed = {}
        self.pending_delete = {}

    async def _evict(self, session, row, state="evicted"):
        row.state, row.evicted_at = state, utcnow()
        await session.commit()
        if self.pins.get(row.id):
            self.pending_delete[row.id] = row.relative_path
        else:
            (self.root / row.relative_path).unlink(missing_ok=True)

    async def _reserve(self, size):
        async with self.lock:
            async with self.session_factory() as session:
                records = (await session.execute(select(ResearchArtifact))).scalars()
                rows = [row for row in records
                        if row.state == "ready" or self.pins.get(row.id)]
                used = sum(row.byte_length for row in rows)
                rows.sort(key=lambda r: self.accessed.get(r.id, r.created_at))
                for row in rows:
                    if used + self.reserved + size <= self.quota:
                        break
                    if not self.pins.get(row.id):
                        await self._evict(session, row)
                        used -= row.byte_length
                if used + self.reserved + size > self.quota:
                    raise WebResearchError("artifact_quota_exceeded")
                self.reserved += size

    async def write(self, kind, body, context, retention_days=7):
        if len(body) > 2 * 1024 * 1024:
            raise WebResearchError("response_too_large")
        await self._reserve(len(body))
        identifier = str(uuid4())
        final = self.root / identifier
        temporary = self.root / (identifier + ".tmp")
        committed = False
        try:
            try:
                # 上限 2 MiB 的落盘不得阻塞事件循环（spec §3.8）。
                await asyncio.to_thread(temporary.write_bytes, body)
                await asyncio.to_thread(temporary.replace, final)
            except OSError as error:
                # 磁盘满 / 目录不可写必须显式映射为 507，并清掉半成品（D-16）。
                raise WebResearchError(
                    "cache_commit_failed",
                    message=f"artifact write failed: {error.errno}") from None
            now = utcnow()
            row = ResearchArtifact(
                id=identifier, project_id=context.get("project_id"),
                run_id=context["run_id"], kind=kind, relative_path=identifier,
                mime_type="image/png" if kind == "screenshot" else "text/plain; charset=utf-8",
                byte_length=len(body), sha256=hashlib.sha256(body).hexdigest(),
                provenance={"schema_version": 1, "sources": context.get("sources", [])},
                created_at=now, expires_at=now + timedelta(days=retention_days),
                state="ready")
            async with self.lock:
                try:
                    cancelled = await self._commit_without_cancellation(row)
                except Exception:
                    raise WebResearchError(
                        "cache_commit_failed",
                        message="artifact commit failed") from None
                committed = True
                self.reserved -= len(body)
            if cancelled:
                raise asyncio.CancelledError
            return row
        finally:
            temporary.unlink(missing_ok=True)
            if not committed:
                final.unlink(missing_ok=True)
            if not committed:
                async with self.lock:
                    self.reserved -= len(body)

    async def _commit_without_cancellation(self, row):
        async def commit():
            async with self.session_factory() as session:
                session.add(row)
                await session.commit()

        # SQLite 在线程中提交；取消 await 不代表事务回滚。先确定提交结局，
        # 再传播调用取消，避免删除已被 ready 记录引用的文件。
        task = asyncio.create_task(commit())
        cancelled = False
        while True:
            try:
                await asyncio.shield(task)
                return cancelled
            except asyncio.CancelledError:
                if task.cancelled():
                    raise
                cancelled = True

    @asynccontextmanager
    async def pinned(self, identifier, project_id):
        async with self.lock:
            async with self.session_factory() as session:
                row = await session.get(ResearchArtifact, identifier)
                if not row or row.project_id != project_id:
                    raise WebResearchError("artifact_not_found")
                if row.state != "ready" or row.expires_at <= utcnow():
                    if row.state == "ready":
                        await self._evict(session, row, "expired")
                    raise WebResearchError("artifact_expired")
                self.pins[identifier] = self.pins.get(identifier, 0) + 1
        try:
            path = self.root / row.relative_path
            body = (await asyncio.to_thread(path.read_bytes)
                    if path.is_file() else b"")
            if len(body) != row.byte_length or hashlib.sha256(body).hexdigest() != row.sha256:
                async with self.session_factory() as session:
                    stored = await session.get(ResearchArtifact, identifier)
                    stored.state, stored.evicted_at = "missing", utcnow()
                    await session.commit()
                raise WebResearchError("artifact_expired")
            self.accessed[identifier] = utcnow()
            yield row, body
        finally:
            async with self.lock:
                self.pins[identifier] -= 1
                if not self.pins[identifier]:
                    del self.pins[identifier]
                    pending = self.pending_delete.pop(identifier, None)
                    if pending:
                        (self.root / pending).unlink(missing_ok=True)

    async def read(self, identifier, project_id, offset=0, max_bytes=4000):
        async with self.pinned(identifier, project_id) as (row, body):
            if row.kind == "screenshot":
                raise WebResearchError("unsupported_content_type")
            return {"kind": row.kind, **byte_page(body, offset, max_bytes),
                    "sources": row.provenance["sources"],
                    "source_ids": [s["id"] for s in row.provenance["sources"]]}

    async def recover(self):
        import shutil
        temporary_root = self.root / "tmp"
        if temporary_root.is_dir() and not temporary_root.is_symlink():
            for child in temporary_root.iterdir():
                if (child.is_dir() and not child.is_symlink()
                        and child.resolve().is_relative_to(temporary_root.resolve())
                        and re.fullmatch(r"tmp[a-zA-Z0-9_-]+", child.name)):
                    shutil.rmtree(child)
        async with self.lock:
            async with self.session_factory() as session:
                rows = list((await session.execute(select(ResearchArtifact))).scalars())
                paths = {row.relative_path for row in rows if row.state == "ready"}
                for path in self.root.iterdir():
                    if (path.is_file() and re.fullmatch(r"[a-f0-9-]{36}(\.tmp)?", path.name)
                            and path.name not in paths):
                        path.unlink(missing_ok=True)
                tombstones = []
                for row in rows:
                    if row.state == "ready" and not (self.root / row.relative_path).is_file():
                        row.state, row.evicted_at = "missing", utcnow()
                    elif row.state == "ready" and row.expires_at <= utcnow():
                        await self._evict(session, row, "expired")
                    if row.state != "ready":
                        tombstones.append(row)
                tombstones.sort(key=lambda r: r.evicted_at or r.created_at, reverse=True)
                for index, row in enumerate(tombstones):
                    if index >= 10000 or (row.evicted_at or row.created_at) < utcnow() - timedelta(days=30):
                        await session.delete(row)
                await session.commit()


_store = None


def get_artifact_store():
    global _store
    if _store is None:
        _store = ArtifactStore()
    return _store
