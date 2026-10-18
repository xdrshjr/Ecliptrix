"""启动清理语义（P0 回归）：`ready` 文档必须原样保留。

覆盖 AC-27。spec §5.2 / 评审记录 R-02 的原缺陷是「用 `state != 'active'`
清理文档」，而 `AgentDocument` 的活体值是 `ready` —— 照那样实现每次启动都会
把全部正常文档删光。这个文件把正确语义钉死。
"""
from datetime import timedelta

import pytest

from app.models.agent_toolkit_db_models import AgentDocument, AgentMemory
from app.services.agent_toolkit import memory_store, purge_expired, workspace_store
from tests.agent_toolkit_support import (  # noqa: F401  (pytest fixtures)
    toolkit_engine,
    toolkit_workspace,
)


def _now():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).replace(tzinfo=None)


def _seed_document(document_id, state, expired):
    directory = workspace_store.project_directory("p1")
    workspace_store.ensure_layout(directory)
    (directory / "extracted" / f"{document_id}.txt").write_text(
        "body", encoding="utf-8")
    (directory / "digest" / f"{document_id}.json").write_text(
        "{}", encoding="utf-8")
    (directory / "uploads" / f"{document_id}.pdf").write_bytes(b"%PDF")
    created = _now() - timedelta(days=10)
    return AgentDocument(
        id=document_id, project_id="p1", name=f"{document_id}.pdf",
        kind="pdf", pages=1, chars=4,
        text_path=(f"{directory.name}/extracted/{document_id}.txt"),
        page_offsets=[{"page": 1, "start": 0, "end": 4}],
        sha256="0" * 64, state=state, digest_state="ready",
        created_at=created,
        expires_at=(_now() - timedelta(days=1)) if expired else None,
    )


def _three_files(document_id):
    directory = workspace_store.project_directory("p1")
    return [
        directory / "extracted" / f"{document_id}.txt",
        directory / "digest" / f"{document_id}.json",
        directory / "uploads" / f"{document_id}.pdf",
    ]


@pytest.mark.asyncio
async def test_ready_documents_and_active_memories_survive_purge(
        toolkit_engine, toolkit_workspace):
    ready_id, expired_id = "doc-ready", "doc-expired"
    async with toolkit_engine() as session:
        session.add(_seed_document(ready_id, "ready", expired=False))
        session.add(_seed_document(expired_id, "ready", expired=True))
        session.add(AgentMemory(
            id="mem-active", project_id="p1", scope="project", kind="fact",
            text="keep me", text_hash="a" * 64, tags=[], hit_count=0,
            created_at=_now(), updated_at=_now(), expires_at=None,
            state="active"))
        session.add(AgentMemory(
            id="mem-expired", project_id="p1", scope="project", kind="fact",
            text="drop me", text_hash="b" * 64, tags=[], hit_count=0,
            created_at=_now(), updated_at=_now(),
            expires_at=_now() - timedelta(days=1), state="active"))
        await session.commit()

    await purge_expired(toolkit_engine)

    async with toolkit_engine() as session:
        ready = await session.get(AgentDocument, ready_id)
        expired = await session.get(AgentDocument, expired_id)
        active_memory = await session.get(AgentMemory, "mem-active")
        expired_memory = await session.get(AgentMemory, "mem-expired")

    # 活体文档：行仍是 ready，三件套原样保留。
    assert ready.state == "ready"
    for path in _three_files(ready_id):
        assert path.is_file(), f"missing {path}"
    # 过期文档：标记 expired，三件套全部删除。
    assert expired.state == "expired"
    for path in _three_files(expired_id):
        assert not path.exists(), f"left behind {path}"
    # 记忆：active 保留，过期被标记。
    assert active_memory.state == "active"
    assert expired_memory.state == "expired"


@pytest.mark.asyncio
async def test_expired_memory_disappears_from_search_and_digest(
        toolkit_engine, toolkit_workspace):
    async with toolkit_engine() as session:
        session.add(AgentMemory(
            id="mem-1", project_id="p1", scope="project", kind="fact",
            text="secret sauce", text_hash="c" * 64, tags=[], hit_count=0,
            created_at=_now(), updated_at=_now(),
            expires_at=_now() - timedelta(days=1), state="expired"))
        await session.commit()
    found = await memory_store.search(
        "p1", "sauce", session_factory=toolkit_engine)
    assert found["entries"] == []
    digest = await memory_store.digest("p1", session_factory=toolkit_engine)
    assert digest["text"] == ""


@pytest.mark.asyncio
async def test_old_sandbox_outputs_are_removed(toolkit_workspace):
    import os

    directory = workspace_store.project_directory("p1")
    workspace_store.ensure_layout(directory)
    stale = directory / "out" / "call-old" / "x.csv"
    stale.parent.mkdir(parents=True, exist_ok=True)
    stale.write_text("a", encoding="utf-8")
    old = (_now().replace(tzinfo=None) - timedelta(days=2)).timestamp()
    os.utime(stale, (old, old))
    removed = await workspace_store.purge_sandbox_outputs()
    assert removed == 1
    assert not stale.exists()
