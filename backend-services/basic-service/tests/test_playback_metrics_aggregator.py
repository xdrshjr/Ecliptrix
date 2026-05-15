"""
Tests for PlaybackMetricsAggregator (Phase 4 §3.2.2 / §5.2).
"""

from __future__ import annotations

import asyncio
from typing import List

import pytest

from app.services.playback_metrics_aggregator import (
    PlaybackMetricsAggregator,
    _percentile,
)


@pytest.fixture
def aggregator() -> PlaybackMetricsAggregator:
    return PlaybackMetricsAggregator(window_minutes=15, retention_hours=24)


@pytest.mark.asyncio
async def test_unknown_metric_returns_false(aggregator: PlaybackMetricsAggregator) -> None:
    accepted = await aggregator.record_event(
        name="playback.unknown_metric", value=1.0
    )
    assert accepted is False
    snap = await aggregator.snapshot()
    assert snap["sampleCount"] == 0


@pytest.mark.asyncio
async def test_counter_metric_increments_24h(aggregator: PlaybackMetricsAggregator) -> None:
    for _ in range(1000):
        await aggregator.record_event(
            name="playback.playhead_regression", value=None, now_sec=1_700_000_000
        )
    snap = await aggregator.snapshot(now_sec=1_700_000_000)
    assert snap["playheadRegressionLast24h"] == 1000
    assert snap["sampleCount"] == 1000


@pytest.mark.asyncio
async def test_histogram_p95_estimate(aggregator: PlaybackMetricsAggregator) -> None:
    values: List[float] = [float(v) for v in range(1, 101)]
    for v in values:
        await aggregator.record_event(
            name="playback.click_to_first_frame_ms",
            value=v,
            now_sec=1_700_000_000,
        )
    snap = await aggregator.snapshot(now_sec=1_700_000_000)
    # P95 of 1..100 is 95.05 with linear interpolation.
    assert snap["clickToFirstFramePct95Ms"] is not None
    assert 94.0 <= snap["clickToFirstFramePct95Ms"] <= 96.0


@pytest.mark.asyncio
async def test_gauge_average_in_window(aggregator: PlaybackMetricsAggregator) -> None:
    for v in [0.1, 0.3, 0.5, 0.7]:
        await aggregator.record_event(
            name="playback.preview_proxy_cached_hit_rate",
            value=v,
            now_sec=1_700_000_000,
        )
    snap = await aggregator.snapshot(now_sec=1_700_000_000)
    assert snap["previewProxyHitRate"] == pytest.approx(0.4, rel=1e-3)


@pytest.mark.asyncio
async def test_snapshot_window_filters_old_samples(
    aggregator: PlaybackMetricsAggregator,
) -> None:
    # Add a sample 30 minutes ago.
    await aggregator.record_event(
        name="playback.click_to_first_frame_ms",
        value=999.0,
        now_sec=1_700_000_000 - 30 * 60,
    )
    # And one inside the 15-minute window.
    await aggregator.record_event(
        name="playback.click_to_first_frame_ms",
        value=10.0,
        now_sec=1_700_000_000 - 60,
    )
    snap = await aggregator.snapshot(window_minutes=15, now_sec=1_700_000_000)
    # Only the recent value should drive the percentile.
    assert snap["clickToFirstFramePct95Ms"] == pytest.approx(10.0)


@pytest.mark.asyncio
async def test_record_batch_returns_accepted_count(
    aggregator: PlaybackMetricsAggregator,
) -> None:
    accepted = await aggregator.record_batch(
        [
            ("playback.error", None),
            ("playback.unknown", 1.0),
            ("playback.stalled_event", None),
        ]
    )
    assert accepted == 2


@pytest.mark.asyncio
async def test_concurrent_records_are_threadsafe(
    aggregator: PlaybackMetricsAggregator,
) -> None:
    async def push() -> None:
        for _ in range(50):
            await aggregator.record_event(
                name="playback.error", value=None, now_sec=1_700_000_000
            )

    await asyncio.gather(*(push() for _ in range(5)))
    snap = await aggregator.snapshot(now_sec=1_700_000_000)
    assert snap["errorLast24h"] == 250


def test_percentile_edge_cases() -> None:
    assert _percentile([], 50.0) is None
    assert _percentile([42.0], 99.0) == 42.0
    assert _percentile([1.0, 2.0], 50.0) == pytest.approx(1.5)
