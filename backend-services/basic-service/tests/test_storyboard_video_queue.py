"""
Unit tests for the storyboard video-generation job queue.

Verifies:
- Concurrency is bounded by the configured max_concurrent.
- Overflow jobs enter "queued" state and transition to "generating".
- Per-job timeout flips jobs to the "timeout" terminal state and frees slots.
- Failed ARK responses surface as "failed" status with error text.
- Independent slot accounting for repeat=N scenarios.

These tests stub ``ark_video_service.create_task`` / ``get_status`` with
asyncio-controlled coroutines so we do not hit the network.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Dict

import pytest

from app.services import storyboard_video_queue as svq_module
from app.services.queue_manager import QueueManager
from app.services.storyboard_video_queue import _StoryboardVideoQueue, QUEUE_NAME


pytestmark = pytest.mark.asyncio


async def _wait_until(predicate, timeout=2.0, interval=0.02):
    """Poll until predicate returns truthy or timeout."""
    end = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < end:
        result = predicate()
        if result:
            return result
        await asyncio.sleep(interval)
    raise AssertionError(f"Condition not met within {timeout}s")


class _FakeConfig:
    def __init__(self, max_concurrent=3, timeout_seconds=600, poll_interval=0.02, retention=3600):
        self.storyboard = SimpleNamespace(
            video_generation=SimpleNamespace(
                max_concurrent=max_concurrent,
                timeout_seconds=timeout_seconds,
                poll_interval_seconds=poll_interval,
                job_retention_seconds=retention,
            )
        )


def _patch_settings(monkeypatch, max_concurrent=3, timeout_seconds=600, poll_interval=0.02):
    fake = _FakeConfig(max_concurrent=max_concurrent, timeout_seconds=timeout_seconds, poll_interval=poll_interval)
    monkeypatch.setattr(svq_module, "settings", fake, raising=True)


@pytest.fixture
def fresh_queue(monkeypatch):
    """Provide a fresh queue + fresh QueueManager for each test."""
    qm = QueueManager()
    monkeypatch.setattr(svq_module, "queue_manager", qm, raising=True)
    q = _StoryboardVideoQueue()
    return q


async def test_concurrency_limit_enforces_queueing(fresh_queue, monkeypatch):
    """Four submissions with max_concurrent=3 → 3 run, 1 queued."""
    _patch_settings(monkeypatch, max_concurrent=3)

    release_events: Dict[str, asyncio.Event] = {}
    created_ids = []

    async def fake_create_task(request):
        # Allocate a fake ark id per submission.
        aid = f"ark-{len(created_ids) + 1}"
        created_ids.append(aid)
        release_events[aid] = asyncio.Event()
        return aid

    async def fake_get_status(ark_task_id):
        # Remain "running" until the test releases the event.
        if not release_events[ark_task_id].is_set():
            return SimpleNamespace(
                status="running", video_url=None, thumbnail_url=None, duration=None, error=None, message=""
            )
        return SimpleNamespace(
            status="succeeded",
            video_url=f"http://videos/{ark_task_id}.mp4",
            thumbnail_url=None,
            duration=5,
            error=None,
            message="",
        )

    monkeypatch.setattr(svq_module.ark_video_service, "create_task", fake_create_task, raising=True)
    monkeypatch.setattr(svq_module.ark_video_service, "get_status", fake_get_status, raising=True)

    await fresh_queue.initialize()

    job_ids = []
    for i in range(4):
        jid = await fresh_queue.enqueue(
            pack_id="pack-1",
            frame_index=i,
            repeat_index=0,
            description="test",
            duration=5,
            frame_data_uri="data:image/png;base64,AA==",
        )
        job_ids.append(jid)

    # Wait for the first three to transition to generating.
    await _wait_until(lambda: sum(1 for j in job_ids if fresh_queue.jobs_snapshot()[j].status == "generating") == 3)

    snap = fresh_queue.jobs_snapshot()
    states = [snap[j].status for j in job_ids]
    assert states.count("generating") == 3
    assert states.count("queued") == 1
    queued_job = job_ids[states.index("queued")]

    # Release one ARK task → frees the slot → queued job advances.
    first_ark = snap[job_ids[0]].ark_task_id
    release_events[first_ark].set()

    await _wait_until(
        lambda: fresh_queue.jobs_snapshot()[job_ids[0]].status == "success"
    )
    await _wait_until(
        lambda: fresh_queue.jobs_snapshot()[queued_job].status in ("generating", "success")
    )

    # Release the rest to let cleanup proceed without hanging tasks.
    for ev in release_events.values():
        ev.set()


async def test_timeout_marks_job_timeout_and_releases_slot(fresh_queue, monkeypatch):
    """Job that never finishes within timeout_seconds is flipped to 'timeout'."""
    _patch_settings(monkeypatch, max_concurrent=1, timeout_seconds=0.3, poll_interval=0.05)

    calls = {"n": 0}

    async def fake_create_task(request):
        calls["n"] += 1
        return f"ark-{calls['n']}"

    async def fake_get_status(ark_task_id):
        # ark-1 hangs forever (always running) → triggers timeout.
        # ark-2 (and later) succeed immediately, proving the slot was freed.
        if ark_task_id == "ark-1":
            return SimpleNamespace(
                status="running", video_url=None, thumbnail_url=None,
                duration=None, error=None, message="",
            )
        return SimpleNamespace(
            status="succeeded", video_url="http://ok.mp4", thumbnail_url=None,
            duration=5, error=None, message="",
        )

    monkeypatch.setattr(svq_module.ark_video_service, "create_task", fake_create_task, raising=True)
    monkeypatch.setattr(svq_module.ark_video_service, "get_status", fake_get_status, raising=True)

    await fresh_queue.initialize()

    j1 = await fresh_queue.enqueue(
        pack_id="pack-T", frame_index=0, repeat_index=0, description="a",
        duration=5, frame_data_uri="data:image/png;base64,AA==",
    )
    j2 = await fresh_queue.enqueue(
        pack_id="pack-T", frame_index=0, repeat_index=1, description="a",
        duration=5, frame_data_uri="data:image/png;base64,AA==",
    )

    await _wait_until(lambda: fresh_queue.jobs_snapshot()[j1].status == "timeout", timeout=5.0)
    # The slot was freed — j2 must succeed.
    await _wait_until(lambda: fresh_queue.jobs_snapshot()[j2].status == "success", timeout=5.0)


async def test_failed_ark_response_marks_failed(fresh_queue, monkeypatch):
    """ARK returning status=failed should mark the job failed with the ARK error."""
    _patch_settings(monkeypatch, max_concurrent=1, timeout_seconds=60, poll_interval=0.02)

    async def fake_create_task(request):
        return "ark-bad"

    async def fake_get_status(ark_task_id):
        return SimpleNamespace(status="failed", video_url=None, thumbnail_url=None, duration=None, error="render crashed", message="")

    monkeypatch.setattr(svq_module.ark_video_service, "create_task", fake_create_task, raising=True)
    monkeypatch.setattr(svq_module.ark_video_service, "get_status", fake_get_status, raising=True)

    await fresh_queue.initialize()
    jid = await fresh_queue.enqueue(
        pack_id="p", frame_index=0, repeat_index=0, description="x",
        duration=5, frame_data_uri="data:image/png;base64,AA==",
    )
    await _wait_until(lambda: fresh_queue.jobs_snapshot()[jid].status == "failed")
    assert fresh_queue.jobs_snapshot()[jid].error == "render crashed"


async def test_repeat_each_repeat_index_takes_own_slot(fresh_queue, monkeypatch):
    """Enqueuing 4 jobs (simulating repeat=4 on one segment) with cap=3 → 3 run, 1 queued."""
    _patch_settings(monkeypatch, max_concurrent=3, timeout_seconds=60, poll_interval=0.02)

    gate = asyncio.Event()

    async def fake_create_task(request):
        return f"ark-{id(request)}"

    async def fake_get_status(ark_task_id):
        if not gate.is_set():
            return SimpleNamespace(status="running", video_url=None, thumbnail_url=None, duration=None, error=None, message="")
        return SimpleNamespace(status="succeeded", video_url="http://x.mp4", thumbnail_url=None, duration=5, error=None, message="")

    monkeypatch.setattr(svq_module.ark_video_service, "create_task", fake_create_task, raising=True)
    monkeypatch.setattr(svq_module.ark_video_service, "get_status", fake_get_status, raising=True)

    await fresh_queue.initialize()
    job_ids = []
    for ri in range(4):
        jid = await fresh_queue.enqueue(
            pack_id="p", frame_index=0, repeat_index=ri, description="d",
            duration=5, frame_data_uri="data:image/png;base64,AA==",
        )
        job_ids.append(jid)

    await _wait_until(
        lambda: sum(1 for j in job_ids if fresh_queue.jobs_snapshot()[j].status == "generating") == 3
    )

    queued_count = sum(1 for j in job_ids if fresh_queue.jobs_snapshot()[j].status == "queued")
    assert queued_count == 1

    gate.set()
    await _wait_until(
        lambda: all(fresh_queue.jobs_snapshot()[j].status == "success" for j in job_ids),
        timeout=3.0,
    )
