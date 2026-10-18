"""长期记忆：去重、容量淘汰、过期过滤、密钥拒写、LIKE 转义、全局桶。

覆盖 AC-16、AC-17、AC-34。
"""
import pytest

from app.models.agent_toolkit_models import AgentToolkitError
from app.services.agent_toolkit import memory_store
from tests.agent_toolkit_support import (  # noqa: F401  (pytest fixtures)
    toolkit_engine,
    toolkit_settings_override,
)


@pytest.mark.asyncio
async def test_deduplicates_identical_text(toolkit_engine):
    first = await memory_store.write(
        "p1", "资讯视频默认 16:9", session_factory=toolkit_engine)
    second = await memory_store.write(
        "p1", "  资讯视频默认 16:9  ", session_factory=toolkit_engine)
    assert first["deduplicated"] is False
    assert second["deduplicated"] is True
    assert second["memory_id"] == first["memory_id"]
    listing = await memory_store.list_entries("p1", session_factory=toolkit_engine)
    assert listing["count"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("secret", [
    "token sk-abcdefgh12345678",
    "Authorization: Bearer abcdefgh12345678",
    "AKIAIOSFODNN7EXAMPLE",
    "ghp_abcdefghijklmnopqrstuvwxyz",
])
async def test_rejects_credential_like_text(toolkit_engine, secret):
    with pytest.raises(AgentToolkitError) as info:
        await memory_store.write("p1", secret, session_factory=toolkit_engine)
    assert info.value.error_code == "policy_blocked"
    assert info.value.status_code == 403


@pytest.mark.asyncio
async def test_capacity_evicts_by_documented_order(
        toolkit_engine, toolkit_settings_override):
    toolkit_settings_override(memory_max_entries=20)
    ids = []
    for index in range(20):
        result = await memory_store.write(
            "p1", f"fact number {index}", session_factory=toolkit_engine)
        ids.append(result["memory_id"])
    # 让第 20 条被检索命中一次，成为 hit_count 最高者，不该被淘汰。
    await memory_store.search("p1", "fact number 19",
                             session_factory=toolkit_engine)
    await memory_store.write("p1", "fact number 20",
                            session_factory=toolkit_engine)
    listing = await memory_store.list_entries(
        "p1", limit=100, session_factory=toolkit_engine)
    texts = {entry["text"] for entry in listing["entries"]}
    assert len(texts) == 20
    assert "fact number 19" in texts
    assert "fact number 0" not in texts


@pytest.mark.asyncio
async def test_decisions_are_never_evicted(
        toolkit_engine, toolkit_settings_override):
    toolkit_settings_override(memory_max_entries=20)
    for index in range(20):
        await memory_store.write(
            "p1", f"decision {index}", kind="decision",
            session_factory=toolkit_engine)
    with pytest.raises(AgentToolkitError) as info:
        await memory_store.write("p1", "one more", kind="fact",
                                session_factory=toolkit_engine)
    assert info.value.error_code == "memory_limit_reached"


@pytest.mark.asyncio
async def test_global_bucket_counts_independently(
        toolkit_engine, toolkit_settings_override):
    toolkit_settings_override(memory_max_entries=20)
    for index in range(20):
        await memory_store.write(
            "p1", f"project fact {index}", session_factory=toolkit_engine)
    # 项目桶已满，全局桶仍然可写（各自独立计数）。
    result = await memory_store.write(
        "p1", "global preference", scope="global",
        session_factory=toolkit_engine)
    assert result["deduplicated"] is False
    counts = await memory_store.count("p1", session_factory=toolkit_engine)
    assert counts == {"project": 20, "global": 1}


@pytest.mark.asyncio
async def test_like_wildcards_are_escaped(toolkit_engine):
    await memory_store.write("p1", "discount 100%", session_factory=toolkit_engine)
    await memory_store.write("p1", "snake a_b", session_factory=toolkit_engine)
    await memory_store.write("p1", "path c\\d", session_factory=toolkit_engine)
    percent = await memory_store.search(
        "p1", "%", session_factory=toolkit_engine)
    assert [entry["text"] for entry in percent["entries"]] == ["discount 100%"]
    underscore = await memory_store.search(
        "p1", "_", session_factory=toolkit_engine)
    assert [entry["text"] for entry in underscore["entries"]] == ["snake a_b"]
    backslash = await memory_store.search(
        "p1", "\\", session_factory=toolkit_engine)
    assert [entry["text"] for entry in backslash["entries"]] == ["path c\\d"]


@pytest.mark.asyncio
async def test_search_rejects_control_characters(toolkit_engine):
    with pytest.raises(AgentToolkitError) as info:
        await memory_store.search("p1", "bad\x00query",
                                 session_factory=toolkit_engine)
    assert info.value.error_code == "invalid_argument"


@pytest.mark.asyncio
async def test_search_bumps_hit_count(toolkit_engine):
    await memory_store.write("p1", "brand voice is calm",
                            session_factory=toolkit_engine)
    await memory_store.search("p1", "calm", session_factory=toolkit_engine)
    listing = await memory_store.list_entries("p1", session_factory=toolkit_engine)
    assert listing["entries"][0]["hit_count"] == 1


@pytest.mark.asyncio
async def test_digest_budget(toolkit_engine):
    for index in range(8):
        await memory_store.write(
            "p1", f"preference {index} " + "x" * 200, kind="preference",
            session_factory=toolkit_engine)
    digest = await memory_store.digest("p1", session_factory=toolkit_engine)
    assert digest["count"] <= memory_store.DIGEST_MAX_ENTRIES
    assert len(digest["text"]) <= memory_store.DIGEST_MAX_CHARS


@pytest.mark.asyncio
async def test_expired_entries_are_filtered_and_purged(toolkit_engine):
    from datetime import timedelta

    from app.models.agent_toolkit_db_models import AgentMemory

    result = await memory_store.write(
        "p1", "short lived", session_factory=toolkit_engine)
    async with toolkit_engine() as session:
        row = await session.get(AgentMemory, result["memory_id"])
        row.expires_at = memory_store.utcnow() - timedelta(days=1)
        await session.commit()
    listing = await memory_store.list_entries("p1", session_factory=toolkit_engine)
    assert listing["count"] == 0
    purged = await memory_store.purge_expired(toolkit_engine)
    assert purged["expired_memories"] == 1
    async with toolkit_engine() as session:
        row = await session.get(AgentMemory, result["memory_id"])
        assert row.state == "expired"


@pytest.mark.asyncio
async def test_forget_is_idempotent_safe(toolkit_engine):
    result = await memory_store.write("p1", "temporary",
                                      session_factory=toolkit_engine)
    await memory_store.forget(result["memory_id"], toolkit_engine)
    with pytest.raises(AgentToolkitError) as info:
        await memory_store.forget(result["memory_id"], toolkit_engine)
    assert info.value.error_code == "memory_not_found"
