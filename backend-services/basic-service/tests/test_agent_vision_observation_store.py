"""观察缓存：键、命中计数、TTL 淘汰、LRU、分页、日用量（§4.14 / §6.1）。"""
from datetime import timedelta

import pytest

from app.services.agent_vision import observation_store
from tests.agent_vision_support import (  # noqa: F401  (pytest fixtures)
    vision_engine,
    vision_storage,
    wire_database,
)


def record(**overrides):
    base = {
        "project_id": "p1", "call_id": "call-1", "source_kind": "material",
        "source_ref": "cached_materials/x.jpg", "image_sha256": "a" * 64,
        "cache_key": "k1", "mode": "look", "model_provider": "host",
        "model_name": "qwen-vl-max", "verdict": "pass",
        "summary": "看起来正常",
        "observations": [{"region": "center", "at_seconds": None,
                          "text": "主体居中"}],
        "issues": [], "text_lines": ["字幕"],
    }
    base.update(overrides)
    return base


# ── 缓存键 ────────────────────────────────────────────────────────────────


def test_cache_key_is_stable_and_whitespace_insensitive():
    first = observation_store.cache_key(
        "digest", mode="look", template="检查字幕", model_name="m")
    second = observation_store.cache_key(
        "digest", mode="look",
        template=observation_store.question_template("  检查字幕  "),
        model_name="m")
    assert first == second


def test_cache_key_changes_with_model_and_mode():
    base = observation_store.cache_key("d", mode="look", template="q",
                                       model_name="m1")
    assert base != observation_store.cache_key("d", mode="scan", template="q",
                                               model_name="m1")
    assert base != observation_store.cache_key("d", mode="look", template="q",
                                               model_name="m2")


def test_question_template_includes_checklist():
    without = observation_store.question_template("q")
    with_list = observation_store.question_template("q", ["watermark"])
    assert without != with_list


# ── 写入 / 命中 ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_write_then_hit_increments_hits(vision_storage, wire_database):
    written = await observation_store.write_observation(record())
    found = await observation_store.find_cached("k1")
    assert found is not None
    assert found.id == written["observation_id"]
    assert found.hits == 1


@pytest.mark.asyncio
async def test_missing_key_returns_none(vision_storage, wire_database):
    assert await observation_store.find_cached("nope") is None


@pytest.mark.asyncio
async def test_expired_row_is_not_a_cache_hit(vision_storage, wire_database,
                                              monkeypatch):
    await observation_store.write_observation(record(ttl_days=1))
    monkeypatch.setattr(observation_store, "utcnow",
                        lambda: observation_store.datetime(
                            2026, 1, 1) + timedelta(days=400))
    assert await observation_store.find_cached("k1") is None


@pytest.mark.asyncio
async def test_get_observation_raises_for_unknown_id(vision_storage,
                                                     wire_database):
    from app.models.agent_vision_models import AgentVisionError

    with pytest.raises(AgentVisionError) as info:
        await observation_store.get_observation("nope")
    assert info.value.error_code == "observation_not_found"


# ── 淘汰 ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_prune_drops_expired_rows_and_directories(
        vision_storage, wire_database, monkeypatch):
    observation_store.run_directory("call-1")
    await observation_store.write_observation(record())
    future = observation_store.utcnow() + timedelta(days=30)
    monkeypatch.setattr(observation_store, "utcnow", lambda: future)
    result = await observation_store.prune()
    assert result["removed_rows"] == 1
    assert result["removed_dirs"] == 1
    assert not (observation_store.observation_root() / "call-1").exists()


@pytest.mark.asyncio
async def test_prune_enforces_the_entry_cap(vision_storage, wire_database,
                                            monkeypatch):
    monkeypatch.setattr(observation_store, "MAX_ENTRIES", 2)
    for index in range(4):
        await observation_store.write_observation(
            record(call_id=f"call-{index}", cache_key=f"k{index}"))
    async with wire_database() as session:
        from sqlalchemy import select

        from app.models.agent_vision_db_models import AgentVisionObservation

        rows = list((await session.execute(
            select(AgentVisionObservation))).scalars())
    assert len(rows) <= 2


# ── 分页 ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_text_page_respects_utf8_boundaries(vision_storage,
                                                  wire_database):
    await observation_store.write_observation(record(summary="中" * 200))
    row = await observation_store.get_observation(
        (await observation_store.find_cached("k1")).id)
    page = observation_store.text_page(row, 0, 7)
    # "中" 是 3 字节：7 字节必须回退到 6，不能切半个字符。
    assert len(page["text"].encode("utf-8")) == 6
    assert page["next_offset"] == 6


def test_text_page_rejects_bad_offset():
    from app.models.agent_vision_models import AgentVisionError

    row = type("Row", (), {"summary": "abc", "observations_json": "",
                           "issues_json": "", "text_lines_json": None})()
    with pytest.raises(AgentVisionError):
        observation_store.text_page(row, 99, 10)


@pytest.mark.asyncio
async def test_payload_for_model_is_capped(vision_storage, wire_database):
    await observation_store.write_observation(record(summary="字" * 2000))
    row = await observation_store.find_cached("k1")
    payload = observation_store.payload_for_model(row, images=2, cached=True)
    assert payload["cached"] is True
    assert payload["images"] == 2
    assert len(payload["summary"]) == observation_store.MODEL_SUMMARY_CHARS
    assert payload["ok"] is True


@pytest.mark.asyncio
async def test_failed_observation_is_not_ok(vision_storage, wire_database):
    await observation_store.write_observation(
        record(verdict="concern", failed=True, error_code="model_failed"))
    row = await observation_store.find_cached("k1")
    payload = observation_store.payload_for_model(row, images=1, cached=False)
    assert payload["ok"] is False


# ── 用量 ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_usage_accumulates_per_day(vision_storage, wire_database):
    await observation_store.record_usage({"project_id": None, "calls": 1,
                                          "images": 2})
    await observation_store.record_usage({"project_id": None, "calls": 1,
                                          "images": 1, "cached": 1})
    usage = await observation_store.daily_usage(None)
    assert usage["calls"] == 2
    assert usage["images"] == 3
    assert usage["cached_calls"] == 1
    assert usage["day"] == observation_store.today()


@pytest.mark.asyncio
async def test_quota_used_sums_all_projects_when_global(
        vision_storage, wire_database):
    await observation_store.record_usage({"project_id": "p1", "calls": 2})
    await observation_store.record_usage({"project_id": None, "calls": 1})
    assert (await observation_store.quota_used("p1"))["calls"] == 2
    assert (await observation_store.quota_used(None))["calls"] == 1


# ── 路径安全 ──────────────────────────────────────────────────────────────


def test_run_directory_rejects_unsafe_call_ids(vision_storage):
    from app.models.agent_vision_models import AgentVisionError

    with pytest.raises(AgentVisionError) as info:
        observation_store.run_directory("../escape")
    assert info.value.error_code == "invalid_call_id"


def test_write_blob_creates_nested_directories(vision_storage):
    observation_store.run_directory("call-9")
    relative = observation_store.write_blob("call-9/frames/1-0.00.jpg", b"x")
    assert (observation_store.observation_root() / relative).is_file()
