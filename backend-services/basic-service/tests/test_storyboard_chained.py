"""
Unit tests for the chained 2×2 storyboard pipeline.

These tests mock Seedream (ARK image generation) so the driver can be
exercised end-to-end without network I/O or real API credentials. They
target the behaviors that Phase 2 of the refactor plan called out
explicitly: batch splitting, chain-ref extraction, shot-list padding,
partial-failure reporting, and concurrency limiting.
"""

from __future__ import annotations

import asyncio
import io
import os
from typing import List, Optional, Tuple
from unittest import mock

import pytest
from PIL import Image

from app.config import settings
from app.models.storyboard_models import (
    PartialGenerationError,
    StoryboardGenerateRequest,
)
from app.services import storyboard_service


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------


def _make_fake_grid(color: Tuple[int, int, int] = (200, 120, 60)) -> bytes:
    """Build a 256×256 solid-colored PNG to stand in for a Seedream response."""
    img = Image.new("RGB", (256, 256), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _patch_storage(tmp_path, monkeypatch):
    """Redirect all storyboard I/O to a temporary directory and ensure
    ARK_API_KEY is set so the generator does not early-exit."""
    monkeypatch.setattr(settings.storage, "root", str(tmp_path))
    monkeypatch.setattr(settings, "ark_api_key", "test-key")
    yield


@pytest.fixture
def patched_seedream(monkeypatch):
    """Patch the ARK + download helpers to return a fake grid without
    hitting the network. Returns the list of calls for assertions."""

    calls: List[dict] = []

    async def fake_call_ark(*, prompt: str, reference_image: Optional[str]):
        call = {
            "prompt": prompt,
            "reference_image_len": len(reference_image) if reference_image else 0,
            "reference_image": reference_image,
        }
        calls.append(call)
        return f"https://fake.example/{len(calls)}.png", f"task-{len(calls)}"

    async def fake_download(remote_url: str, dest_path: str):
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        with open(dest_path, "wb") as f:
            # Different color per batch makes downstream inspection easier.
            color = (50 * (len(calls) % 5), 120, 60)
            f.write(_make_fake_grid(color))

    monkeypatch.setattr(storyboard_service, "_call_ark_seedream", fake_call_ark)
    monkeypatch.setattr(storyboard_service, "_download_batch_original", fake_download)

    return calls


# ---------------------------------------------------------------------------
# Batch split & frame accounting
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_single_batch_for_n_le_4(patched_seedream):
    req = StoryboardGenerateRequest(prompt="Four scenes about a cat", frame_count=4)
    pack = await storyboard_service.generate_storyboard(req)
    assert pack.frame_count == 4
    assert len(pack.frames) == 4
    assert len(patched_seedream) == 1, "Only one ARK call for N≤4"
    assert pack.grid_size == "2x2"
    assert pack.total_batches == 1
    assert pack.completed_batches == 1


@pytest.mark.asyncio
async def test_two_batches_truncates_when_n_7(patched_seedream, tmp_path):
    req = StoryboardGenerateRequest(prompt="A seven-scene adventure", frame_count=7)
    pack = await storyboard_service.generate_storyboard(req)

    assert len(patched_seedream) == 2, "ceil(7/4)=2 ARK calls"
    assert pack.frame_count == 7
    assert len(pack.frames) == 7
    assert pack.completed_batches == 2
    assert pack.total_batches == 2

    # All final frames live at the pack root; intermediate subdirs should
    # have been collapsed, but _intermediate/ stays for diagnostics.
    pack_root = os.path.dirname(
        os.path.join(os.path.dirname(pack.original_image_url), "")
    )
    # We only know the disk layout indirectly via the storage root; walk it.
    sb_base = os.path.join(str(tmp_path), "storyboard")
    pack_dirs = []
    for date_dir in os.listdir(sb_base):
        pack_dirs.extend(
            os.path.join(sb_base, date_dir, p)
            for p in os.listdir(os.path.join(sb_base, date_dir))
        )
    assert pack_dirs, "pack directory was not created"
    pack_root_real = pack_dirs[0]

    frame_files = sorted(
        f for f in os.listdir(pack_root_real)
        if f.startswith("frame_") and f.endswith(".png")
    )
    # 7 promoted + 1 extra (8th cell produced by batch 2 which was discarded)
    # are expected — the extra should have been deleted by _finalize_pack.
    assert len(frame_files) == 7
    # _batch_XX/ scratch dirs should be gone after promotion.
    for entry in os.listdir(pack_root_real):
        assert not entry.startswith("_batch_"), f"leftover scratch dir {entry}"
    assert pack.discarded_frame_count == 1


@pytest.mark.asyncio
async def test_chain_refs_used_for_batch_2(patched_seedream):
    req = StoryboardGenerateRequest(prompt="Story", frame_count=8)
    pack = await storyboard_service.generate_storyboard(req)
    assert len(patched_seedream) == 2
    # Batch 1 gets no reference (no user ref provided)
    assert patched_seedream[0]["reference_image_len"] == 0
    # Batch 2 must carry a composite reference (data URI).
    assert patched_seedream[1]["reference_image_len"] > 0
    assert patched_seedream[1]["reference_image"].startswith("data:image/")
    # And the two references should differ.
    assert patched_seedream[0]["reference_image"] != patched_seedream[1]["reference_image"]
    assert pack.frame_count == 8


@pytest.mark.asyncio
async def test_frame_scripts_are_padded_on_last_batch(patched_seedream):
    scripts = [f"Scene {i + 1}" for i in range(7)]
    req = StoryboardGenerateRequest(
        prompt="Seven scenes",
        frame_count=7,
        frame_scripts=scripts,
    )
    await storyboard_service.generate_storyboard(req)
    # Second batch's prompt should contain one placeholder shot line.
    batch2_prompt = patched_seedream[1]["prompt"]
    assert "placeholder scene" in batch2_prompt.lower() or "占位" in batch2_prompt


@pytest.mark.asyncio
async def test_batch2_prompt_strips_reference_position_block(patched_seedream):
    # Supply a mention that would normally create "[left area reference image]"
    # placeholders in batch 1. The batch-2 prompt must NOT reproduce them.
    req = StoryboardGenerateRequest(
        prompt="Subject: @hero interacts with @villain.",
        frame_count=8,
    )
    await storyboard_service.generate_storyboard(req)
    batch2_prompt = patched_seedream[1]["prompt"]
    assert "reference image]" not in batch2_prompt
    assert "all reference areas" not in batch2_prompt


# ---------------------------------------------------------------------------
# Partial failure path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_partial_failure_returns_completed_batches(monkeypatch, tmp_path):
    """Batch 2 blows up → driver returns PartialGenerationError with the
    frames produced by batch 1 intact on disk and in the response."""

    call_counter = {"n": 0}

    async def flaky_call(*, prompt: str, reference_image: Optional[str]):
        call_counter["n"] += 1
        if call_counter["n"] >= 2:
            raise RuntimeError("simulated Seedream outage")
        return "https://fake.example/ok.png", "task-1"

    async def fake_download(remote_url: str, dest_path: str):
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        with open(dest_path, "wb") as f:
            f.write(_make_fake_grid())

    # Also stub sleep so retries don't actually wait 2s/4s.
    async def no_sleep(_secs: float):
        return None

    monkeypatch.setattr(storyboard_service, "_call_ark_seedream", flaky_call)
    monkeypatch.setattr(storyboard_service, "_download_batch_original", fake_download)
    monkeypatch.setattr(storyboard_service.asyncio, "sleep", no_sleep)

    req = StoryboardGenerateRequest(prompt="Story", frame_count=8)
    with pytest.raises(PartialGenerationError) as exc_info:
        await storyboard_service.generate_storyboard(req)

    err = exc_info.value
    assert err.completed_batches == 1
    assert err.pack is not None
    assert err.pack.partial is True
    assert err.pack.frame_count == 4
    assert len(err.pack.frames) == 4
    assert err.pack.error and err.pack.error["code"] == "PARTIAL_GENERATION_FAILED"


# ---------------------------------------------------------------------------
# Global concurrency limit (T11)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_concurrent_generations_capped(monkeypatch):
    """Four concurrent generations must never have more than
    ``storyboard.generation.max_concurrent`` simultaneously in-flight."""

    # Force the semaphore to rebuild at the configured limit.
    monkeypatch.setattr(
        settings.storyboard.generation, "max_concurrent", 2
    )
    storyboard_service._GENERATE_SEMAPHORE = None
    storyboard_service._GENERATE_SEMAPHORE_LIMIT = 0

    in_flight = 0
    peak = 0
    lock = asyncio.Lock()

    async def counting_call(*, prompt: str, reference_image: Optional[str]):
        nonlocal in_flight, peak
        async with lock:
            in_flight += 1
            peak = max(peak, in_flight)
        # Simulate Seedream latency so overlap is possible.
        await asyncio.sleep(0.05)
        async with lock:
            in_flight -= 1
        return "https://fake.example/x.png", None

    async def fake_download(remote_url: str, dest_path: str):
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        with open(dest_path, "wb") as f:
            f.write(_make_fake_grid())

    monkeypatch.setattr(storyboard_service, "_call_ark_seedream", counting_call)
    monkeypatch.setattr(storyboard_service, "_download_batch_original", fake_download)

    async def one():
        req = StoryboardGenerateRequest(prompt="Concurrency test", frame_count=4)
        await storyboard_service.generate_storyboard(req)

    await asyncio.gather(*[one() for _ in range(4)])
    assert peak <= 2, f"Expected peak concurrency ≤ 2, saw {peak}"


# ---------------------------------------------------------------------------
# Strip position blocks helper
# ---------------------------------------------------------------------------


def test_strip_position_blocks_removes_placeholders():
    raw = (
        "A hero meets a villain. [left area reference image] punches "
        "[right area reference image]. "
        "Reference image is a 1x2 collage grid. left area; right area. "
        "Please synthesize elements from all reference areas."
    )
    cleaned = storyboard_service._strip_position_blocks(raw)
    assert "reference image]" not in cleaned
    assert "synthesize elements" not in cleaned
    assert "collage grid" not in cleaned
    assert "A hero meets a villain" in cleaned
