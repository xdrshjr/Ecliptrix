"""
Integration test for storyboard_service.batch_generate_videos end-to-end
against the new queue. Verifies:

1. A 10-segment batch with max_concurrent=3 yields exactly 3 running slots at
   any moment.
2. A single-segment repeat=4 batch yields 3 generating + 1 queued.
3. ``get_batch_video_status`` reflects queued jobs with ``position_in_queue``.
"""

from __future__ import annotations

import asyncio
import json
import os
from types import SimpleNamespace
from typing import Dict

import pytest

from app.models.storyboard_models import (
    StoryboardBatchVideoRequest,
    StoryboardVideoSegment,
)
from app.services import storyboard_service, storyboard_video_queue as svq_module
from app.services.queue_manager import QueueManager
from app.services.storyboard_video_queue import _StoryboardVideoQueue


pytestmark = pytest.mark.asyncio


async def _wait_until(predicate, timeout=3.0, interval=0.02):
    end = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < end:
        if predicate():
            return True
        await asyncio.sleep(interval)
    raise AssertionError(f"Condition not met within {timeout}s")


class _FakeConfig:
    def __init__(self, max_concurrent=3, timeout_seconds=600, poll_interval=0.02):
        self.storyboard = SimpleNamespace(
            video_generation=SimpleNamespace(
                max_concurrent=max_concurrent,
                timeout_seconds=timeout_seconds,
                poll_interval_seconds=poll_interval,
                job_retention_seconds=3600,
            )
        )


def _write_pack(tmp_path, frame_count: int) -> str:
    """Create a minimal pack directory on disk and return its pack_id."""
    import datetime

    pack_id = "pack_test_123"
    date_str = datetime.date.today().isoformat()
    pack_dir = tmp_path / "storyboard" / date_str / pack_id
    pack_dir.mkdir(parents=True, exist_ok=True)

    frames = []
    for i in range(frame_count):
        fname = f"frame_{i:03d}.png"
        # 1x1 PNG bytes
        png = bytes.fromhex(
            "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA6300010000000005000150000000FF000000000049454E44AE426082"
        )
        (pack_dir / fname).write_bytes(png)
        frames.append({"index": i, "filename": fname, "url": f"local://{fname}", "row": 0, "col": i})

    (pack_dir / "metadata.json").write_text(
        json.dumps({"frames": frames}), encoding="utf-8"
    )
    return pack_id


@pytest.fixture
def fresh_queue(monkeypatch):
    """Fresh queue with isolated QueueManager."""
    qm = QueueManager()
    monkeypatch.setattr(svq_module, "queue_manager", qm, raising=True)
    q = _StoryboardVideoQueue()
    monkeypatch.setattr(svq_module, "storyboard_video_queue", q, raising=True)
    return q


async def test_batch_ten_segments_max_concurrent_three(fresh_queue, monkeypatch, tmp_path):
    """10 jobs with max_concurrent=3 → only 3 generating at a time."""
    monkeypatch.setattr(svq_module, "settings", _FakeConfig(max_concurrent=3), raising=True)

    # Point the storyboard storage root at our tmp_path.
    monkeypatch.setattr(storyboard_service, "_storage_root", lambda: str(tmp_path), raising=True)

    release = asyncio.Event()
    created = {"n": 0}

    async def fake_create_task(request):
        created["n"] += 1
        return f"ark-{created['n']}"

    async def fake_get_status(ark_task_id):
        if not release.is_set():
            return SimpleNamespace(status="running", video_url=None, thumbnail_url=None, duration=None, error=None, message="")
        return SimpleNamespace(status="succeeded", video_url="http://x.mp4", thumbnail_url=None, duration=5, error=None, message="")

    monkeypatch.setattr(svq_module.ark_video_service, "create_task", fake_create_task, raising=True)
    monkeypatch.setattr(svq_module.ark_video_service, "get_status", fake_get_status, raising=True)

    pack_id = _write_pack(tmp_path, frame_count=10)

    request = StoryboardBatchVideoRequest(
        pack_id=pack_id,
        segments=[
            StoryboardVideoSegment(frame_index=i, description=f"scene {i}", duration=5)
            for i in range(10)
        ],
    )

    results = await storyboard_service.batch_generate_videos(request)
    assert len(results) == 10
    assert all(r.get("job_id") for r in results), results

    # Wait until 3 are in generating state.
    await _wait_until(
        lambda: sum(
            1 for r in results
            if fresh_queue.jobs_snapshot()[r["job_id"]].status == "generating"
        ) == 3
    )
    snap = fresh_queue.jobs_snapshot()
    statuses = [snap[r["job_id"]].status for r in results]
    assert statuses.count("generating") == 3
    assert statuses.count("queued") == 7

    # Batch status endpoint surfaces queued + position_in_queue.
    batch_status = await storyboard_service.get_batch_video_status(pack_id)
    assert len(batch_status) == 10
    queued_entries = [s for s in batch_status if s["status"] == "queued"]
    assert len(queued_entries) == 7
    # All queued entries should have a position_in_queue.
    assert all(s.get("position_in_queue") is not None for s in queued_entries)

    # Release and let all finish.
    release.set()
    await _wait_until(
        lambda: all(
            fresh_queue.jobs_snapshot()[r["job_id"]].status == "success"
            for r in results
        ),
        timeout=5.0,
    )


async def test_repeat_four_on_single_segment_produces_four_independent_slots(
    fresh_queue, monkeypatch, tmp_path
):
    """A single segment with repeat=4 should produce 4 jobs, 3 generating + 1 queued."""
    monkeypatch.setattr(svq_module, "settings", _FakeConfig(max_concurrent=3), raising=True)
    monkeypatch.setattr(storyboard_service, "_storage_root", lambda: str(tmp_path), raising=True)

    gate = asyncio.Event()
    counter = {"n": 0}

    async def fake_create_task(request):
        counter["n"] += 1
        return f"ark-R-{counter['n']}"

    async def fake_get_status(ark_task_id):
        if not gate.is_set():
            return SimpleNamespace(status="running", video_url=None, thumbnail_url=None, duration=None, error=None, message="")
        return SimpleNamespace(status="succeeded", video_url="http://x.mp4", thumbnail_url=None, duration=5, error=None, message="")

    monkeypatch.setattr(svq_module.ark_video_service, "create_task", fake_create_task, raising=True)
    monkeypatch.setattr(svq_module.ark_video_service, "get_status", fake_get_status, raising=True)

    pack_id = _write_pack(tmp_path, frame_count=1)
    request = StoryboardBatchVideoRequest(
        pack_id=pack_id,
        segments=[StoryboardVideoSegment(frame_index=0, description="x", duration=5, repeat=4)],
    )
    results = await storyboard_service.batch_generate_videos(request)
    assert len(results) == 4

    await _wait_until(
        lambda: sum(
            1 for r in results
            if fresh_queue.jobs_snapshot()[r["job_id"]].status == "generating"
        ) == 3
    )
    snap = fresh_queue.jobs_snapshot()
    statuses = [snap[r["job_id"]].status for r in results]
    assert statuses.count("generating") == 3
    assert statuses.count("queued") == 1

    gate.set()
    await _wait_until(
        lambda: all(
            fresh_queue.jobs_snapshot()[r["job_id"]].status == "success"
            for r in results
        ),
        timeout=5.0,
    )
