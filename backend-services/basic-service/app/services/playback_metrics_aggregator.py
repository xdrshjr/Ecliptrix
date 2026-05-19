"""
Playback metrics aggregator (Phase 4 spec §3.2.2 / §5.2).

Single-process, in-memory rolling-window aggregator for the metrics
ingested through ``/api/telemetry/playback``. The aggregator is the data
source for ``/api/admin/playback-metrics``; it never persists state.

Threading
---------
FastAPI runs everything in one asyncio event loop, so we serialize all
mutations behind an ``asyncio.Lock``. ``snapshot`` is intentionally
read-only and acquires the same lock to keep the view internally
consistent.

Multi-worker note
-----------------
This aggregator is process-local. Production runs gunicorn ``-w 4``;
when more than one worker is present, the response should be flagged
``degraded=true`` and the values should not drive automated rollback.
Detection lives in the router (which can read worker count from the
environment).
"""

from __future__ import annotations

import asyncio
import math
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, Iterable, List, Optional, Tuple


# Whitelisted metric names that feed into the aggregator. Anything outside
# this set is still logged by telemetry_router but excluded from snapshots
# (spec §3.2.2 / evaluation R-P1-5).
COUNTER_METRICS = {
    "playback.playhead_regression",
    "playback.stalled_event",
    "playback.error",
}

HISTOGRAM_METRICS = {
    "playback.click_to_first_frame_ms",
    "playback.seek_to_first_frame_ms",
    "playback.swap_latency_ms",
}

GAUGE_METRICS = {
    "playback.preview_proxy_cached_hit_rate",
    "playback.canvas_dropped_frame_rate",
    "playback.cache_memory_mb",
}

ALL_KNOWN_METRICS = COUNTER_METRICS | HISTOGRAM_METRICS | GAUGE_METRICS


@dataclass
class _Counter24h:
    """Per-minute bucket counter spanning the last 24 hours."""

    maxlen: int
    bucket_minute: Deque[Tuple[int, int]] = field(default_factory=deque)

    def __post_init__(self) -> None:
        # Re-bound the deque to honour the configured retention.
        self.bucket_minute = deque(self.bucket_minute, maxlen=self.maxlen)

    def add(self, *, now_sec: int, delta: int = 1) -> None:
        minute = now_sec // 60
        if self.bucket_minute and self.bucket_minute[-1][0] == minute:
            last_minute, count = self.bucket_minute[-1]
            self.bucket_minute[-1] = (last_minute, count + delta)
        else:
            self.bucket_minute.append((minute, delta))

    def sum_last(self, *, now_sec: int, window_sec: int) -> int:
        cutoff_minute = (now_sec - window_sec) // 60
        total = 0
        for minute, count in self.bucket_minute:
            if minute >= cutoff_minute:
                total += count
        return total


@dataclass
class _Histogram:
    """Bounded sample list for percentile estimation."""

    maxlen: int
    samples: Deque[Tuple[int, float]] = field(default_factory=deque)

    def __post_init__(self) -> None:
        self.samples = deque(self.samples, maxlen=self.maxlen)

    def add(self, *, now_sec: int, value: float) -> None:
        self.samples.append((now_sec, value))

    def values_in_window(self, *, now_sec: int, window_sec: int) -> List[float]:
        cutoff = now_sec - window_sec
        return [v for ts, v in self.samples if ts >= cutoff]


@dataclass
class _Gauge:
    """Rolling list of gauge readings, most-recent-wins per window."""

    maxlen: int
    samples: Deque[Tuple[int, float]] = field(default_factory=deque)

    def __post_init__(self) -> None:
        self.samples = deque(self.samples, maxlen=self.maxlen)

    def add(self, *, now_sec: int, value: float) -> None:
        self.samples.append((now_sec, value))

    def average_in_window(self, *, now_sec: int, window_sec: int) -> Optional[float]:
        cutoff = now_sec - window_sec
        bucket = [v for ts, v in self.samples if ts >= cutoff]
        if not bucket:
            return None
        return sum(bucket) / len(bucket)


def _percentile(values: List[float], pct: float) -> Optional[float]:
    """Linear-interpolation percentile estimator.

    Returns ``None`` for empty input. Uses pure Python so the aggregator
    keeps working in test environments where numpy is unavailable.
    """
    if not values:
        return None
    sorted_vals = sorted(values)
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * (pct / 100.0)
    lo = int(math.floor(k))
    hi = int(math.ceil(k))
    if lo == hi:
        return sorted_vals[lo]
    frac = k - lo
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * frac


class PlaybackMetricsAggregator:
    """In-memory rolling-window aggregator (spec §3.2.2)."""

    def __init__(
        self,
        *,
        retention_hours: int = 24,
        window_minutes: int = 15,
    ) -> None:
        self._lock = asyncio.Lock()
        self._retention_hours = max(1, retention_hours)
        self._window_minutes = max(1, window_minutes)
        # Counter retention spans `retention_hours * 60` minute buckets.
        counter_max = self._retention_hours * 60
        # Histogram retention spans the window length × 60 seconds.
        hist_max = self._window_minutes * 60
        # Gauge retention spans the last hour (60 minute resolution).
        gauge_max = 60
        self._counters: Dict[str, _Counter24h] = {
            name: _Counter24h(maxlen=counter_max) for name in COUNTER_METRICS
        }
        self._histograms: Dict[str, _Histogram] = {
            name: _Histogram(maxlen=hist_max) for name in HISTOGRAM_METRICS
        }
        self._gauges: Dict[str, _Gauge] = {
            name: _Gauge(maxlen=gauge_max) for name in GAUGE_METRICS
        }
        self._sample_count = 0

    @property
    def retention_hours(self) -> int:
        return self._retention_hours

    @property
    def window_minutes(self) -> int:
        return self._window_minutes

    @staticmethod
    def is_known_metric(name: str) -> bool:
        return name in ALL_KNOWN_METRICS

    async def record_event(
        self,
        *,
        name: str,
        value: Optional[float],
        now_sec: Optional[int] = None,
    ) -> bool:
        """Ingest a single event. Returns True when the metric was known."""
        if name not in ALL_KNOWN_METRICS:
            return False
        ts = int(now_sec if now_sec is not None else time.time())
        async with self._lock:
            self._sample_count += 1
            if name in COUNTER_METRICS:
                self._counters[name].add(now_sec=ts)
                return True
            if name in HISTOGRAM_METRICS:
                if value is None or not math.isfinite(value):
                    return True
                self._histograms[name].add(now_sec=ts, value=float(value))
                return True
            if name in GAUGE_METRICS:
                if value is None or not math.isfinite(value):
                    return True
                self._gauges[name].add(now_sec=ts, value=float(value))
                return True
        return False

    async def record_batch(
        self,
        events: Iterable[Tuple[str, Optional[float]]],
        *,
        now_sec: Optional[int] = None,
    ) -> int:
        accepted = 0
        for name, value in events:
            ok = await self.record_event(name=name, value=value, now_sec=now_sec)
            if ok:
                accepted += 1
        return accepted

    async def snapshot(
        self,
        *,
        window_minutes: Optional[int] = None,
        now_sec: Optional[int] = None,
    ) -> Dict[str, Any]:
        win = max(1, window_minutes or self._window_minutes)
        ts = int(now_sec if now_sec is not None else time.time())
        async with self._lock:
            window_sec = win * 60
            day_sec = 24 * 3600
            regression_24h = self._counters["playback.playhead_regression"].sum_last(
                now_sec=ts, window_sec=day_sec
            )
            stalled_24h = self._counters["playback.stalled_event"].sum_last(
                now_sec=ts, window_sec=day_sec
            )
            error_24h = self._counters["playback.error"].sum_last(
                now_sec=ts, window_sec=day_sec
            )
            click_p95 = _percentile(
                self._histograms["playback.click_to_first_frame_ms"].values_in_window(
                    now_sec=ts, window_sec=window_sec
                ),
                95.0,
            )
            seek_p95 = _percentile(
                self._histograms["playback.seek_to_first_frame_ms"].values_in_window(
                    now_sec=ts, window_sec=window_sec
                ),
                95.0,
            )
            swap_p95 = _percentile(
                self._histograms["playback.swap_latency_ms"].values_in_window(
                    now_sec=ts, window_sec=window_sec
                ),
                95.0,
            )
            preview_hit_avg = self._gauges[
                "playback.preview_proxy_cached_hit_rate"
            ].average_in_window(now_sec=ts, window_sec=window_sec)
            cache_mem_avg = self._gauges[
                "playback.cache_memory_mb"
            ].average_in_window(now_sec=ts, window_sec=window_sec)
            canvas_drop_avg = self._gauges[
                "playback.canvas_dropped_frame_rate"
            ].average_in_window(now_sec=ts, window_sec=window_sec)
            window_stalled = sum(
                count
                for minute, count in self._counters[
                    "playback.stalled_event"
                ].bucket_minute
                if minute >= (ts - window_sec) // 60
            )
            stalled_ratio_window = (
                (window_stalled / float(self._sample_count))
                if self._sample_count > 0
                else None
            )
            return {
                "window": f"{win}m",
                "windowMinutes": win,
                "retentionHours": self._retention_hours,
                "playheadRegressionLast24h": regression_24h,
                "stalledEventLast24h": stalled_24h,
                "errorLast24h": error_24h,
                "clickToFirstFramePct95Ms": _round_or_none(click_p95, 1),
                "seekToFirstFramePct95Ms": _round_or_none(seek_p95, 1),
                "swapLatencyPct95Ms": _round_or_none(swap_p95, 1),
                "previewProxyHitRate": _round_or_none(preview_hit_avg, 4),
                "cacheMemoryMbAvg": _round_or_none(cache_mem_avg, 2),
                "canvasDroppedFrameRateAvg": _round_or_none(canvas_drop_avg, 4),
                "stalledRatioWindow": _round_or_none(stalled_ratio_window, 4),
                "sampleCount": self._sample_count,
            }


def _round_or_none(value: Optional[float], digits: int) -> Optional[float]:
    if value is None:
        return None
    if not math.isfinite(value):
        return None
    return round(float(value), digits)


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------

_aggregator_singleton: Optional[PlaybackMetricsAggregator] = None


def get_playback_metrics_aggregator() -> PlaybackMetricsAggregator:
    """Return the process-wide aggregator instance.

    Settings are read lazily so tests can monkeypatch the singleton before
    importing this module. The window / retention are sourced from the
    pydantic settings layer; defaults match spec §4.3.
    """
    global _aggregator_singleton
    if _aggregator_singleton is None:
        try:
            from app.config import settings as _settings

            window = int(
                getattr(_settings, "playback_v2_telemetry_agg_window_min", 15) or 15
            )
            retention = int(
                getattr(
                    _settings, "playback_v2_telemetry_agg_retention_hours", 24
                )
                or 24
            )
        except Exception:
            window, retention = 15, 24
        _aggregator_singleton = PlaybackMetricsAggregator(
            window_minutes=window, retention_hours=retention
        )
    return _aggregator_singleton


def reset_playback_metrics_aggregator_for_tests() -> None:
    """Drop the singleton — tests can call this between cases."""
    global _aggregator_singleton
    _aggregator_singleton = None
