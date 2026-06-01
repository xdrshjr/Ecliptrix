"""
Unit tests for the rate-limiter kernel (spec 02 §2.1 — ``RateLimiter``).

Covers: sliding-window allow/deny, window recovery, ``retry_after`` math,
asyncio concurrency correctness, GC memory bound, fail-open on bad config, and
``reset()`` / ``stats()`` isolation.

The kernel uses ``time.monotonic()``; tests that need deterministic timing
monkeypatch ``rate_limiter`` module's ``time.monotonic`` via a small clock
shim so we never rely on real wall-clock sleeps (except the explicit recovery
test, which uses a tiny real window).

These tests construct fresh ``RateLimiter`` instances (NOT the global singleton)
so they are hermetic and need no cross-test reset of shared state.
"""

from __future__ import annotations

import asyncio

import pytest

from app.services import rate_limiter as rl_module
from app.services.rate_limiter import Decision, RateLimiter, rate_limiter


pytestmark = pytest.mark.asyncio


class _Clock:
    """Controllable monotonic clock for deterministic window tests."""

    def __init__(self, start: float = 1000.0) -> None:
        self.t = start

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt


@pytest.fixture
def clock(monkeypatch):
    """Patch ``time.monotonic`` inside the rate_limiter module with a fake clock."""
    c = _Clock()
    monkeypatch.setattr(rl_module.time, "monotonic", c)
    return c


# ---------------------------------------------------------------------------
# Allow / deny within the window
# ---------------------------------------------------------------------------
async def test_allows_up_to_limit_then_denies():
    limiter = RateLimiter()
    # limit=3 → first 3 allowed, 4th denied.
    results = [await limiter.check("k", limit=3, window_seconds=60) for _ in range(4)]
    assert [d.allowed for d in results] == [True, True, True, False]
    assert results[-1].retry_after >= 1
    assert results[-1].limit == 3
    assert results[-1].remaining == 0


async def test_remaining_decrements_as_window_fills():
    limiter = RateLimiter()
    d1 = await limiter.check("k", limit=3, window_seconds=60)
    d2 = await limiter.check("k", limit=3, window_seconds=60)
    d3 = await limiter.check("k", limit=3, window_seconds=60)
    assert d1.remaining == 2
    assert d2.remaining == 1
    assert d3.remaining == 0


async def test_distinct_keys_count_independently():
    limiter = RateLimiter()
    # Exhaust key A.
    for _ in range(2):
        await limiter.check("A", limit=2, window_seconds=60)
    denied_a = await limiter.check("A", limit=2, window_seconds=60)
    # Key B is untouched.
    allowed_b = await limiter.check("B", limit=2, window_seconds=60)
    assert denied_a.allowed is False
    assert allowed_b.allowed is True


# ---------------------------------------------------------------------------
# Window recovery (deterministic via fake clock)
# ---------------------------------------------------------------------------
async def test_window_recovery_via_clock(clock):
    limiter = RateLimiter()
    # Fill the window (limit=2, window=60).
    assert (await limiter.check("k", limit=2, window_seconds=60)).allowed is True
    assert (await limiter.check("k", limit=2, window_seconds=60)).allowed is True
    assert (await limiter.check("k", limit=2, window_seconds=60)).allowed is False

    # Advance past the window so both stamps roll out → slot frees up.
    clock.advance(61)
    recovered = await limiter.check("k", limit=2, window_seconds=60)
    assert recovered.allowed is True


async def test_window_recovery_real_time():
    """A short real window recovers after a real sleep (end-to-end timing)."""
    limiter = RateLimiter()
    assert (await limiter.check("k", limit=1, window_seconds=1)).allowed is True
    assert (await limiter.check("k", limit=1, window_seconds=1)).allowed is False
    await asyncio.sleep(1.05)
    assert (await limiter.check("k", limit=1, window_seconds=1)).allowed is True


# ---------------------------------------------------------------------------
# retry_after math
# ---------------------------------------------------------------------------
async def test_retry_after_is_window_minus_elapsed(clock):
    limiter = RateLimiter()
    # Single slot used at t=0.
    await limiter.check("k", limit=1, window_seconds=60)
    # 10s later, the next request is denied; the oldest stamp expires in 50s.
    clock.advance(10)
    denied = await limiter.check("k", limit=1, window_seconds=60)
    assert denied.allowed is False
    assert denied.retry_after == 50


async def test_retry_after_floored_at_one(clock):
    limiter = RateLimiter()
    await limiter.check("k", limit=1, window_seconds=60)
    # 59.5s later: 0.5s remain; ceil → 1, and floor guarantees >= 1.
    clock.advance(59.5)
    denied = await limiter.check("k", limit=1, window_seconds=60)
    assert denied.allowed is False
    assert denied.retry_after == 1


async def test_retry_after_ceiled(clock):
    limiter = RateLimiter()
    await limiter.check("k", limit=1, window_seconds=60)
    # 10.2s elapsed → 49.8 remaining → ceil → 50.
    clock.advance(10.2)
    denied = await limiter.check("k", limit=1, window_seconds=60)
    assert denied.retry_after == 50


# ---------------------------------------------------------------------------
# Fail-open on bad config
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("bad_limit", [0, -1, -100, None])
async def test_non_positive_limit_fails_open(bad_limit):
    limiter = RateLimiter()
    # A misconfigured non-positive limit must NEVER hard-lock the API: treated
    # as unlimited (allow) rather than "deny all".
    for _ in range(5):
        d = await limiter.check("k", limit=bad_limit, window_seconds=60)
        assert d.allowed is True


async def test_non_positive_window_defaults_to_sixty(clock):
    limiter = RateLimiter()
    await limiter.check("k", limit=1, window_seconds=0)
    # With window coerced to 60, the second call is denied with retry_after<=60.
    denied = await limiter.check("k", limit=1, window_seconds=0)
    assert denied.allowed is False
    assert 1 <= denied.retry_after <= 60


# ---------------------------------------------------------------------------
# asyncio concurrency — counts must be exact under gather
# ---------------------------------------------------------------------------
async def test_concurrent_checks_count_exactly():
    limiter = RateLimiter()
    limit = 50
    total = 200
    results = await asyncio.gather(
        *[limiter.check("hot", limit=limit, window_seconds=60) for _ in range(total)]
    )
    allowed = sum(1 for d in results if d.allowed)
    denied = sum(1 for d in results if not d.allowed)
    assert allowed == limit, "exactly `limit` requests should be allowed"
    assert denied == total - limit
    stats = limiter.stats()
    assert stats["total_checked"] == total
    assert stats["total_blocked"] == denied


# ---------------------------------------------------------------------------
# GC — memory bound under key churn
# ---------------------------------------------------------------------------
async def test_gc_bounds_active_keys(clock):
    limiter = RateLimiter(max_keys=4)
    # Flood 50 distinct keys, advancing the clock so older keys go stale.
    for i in range(50):
        await limiter.check(f"ip:{i}", limit=10, window_seconds=60)
        clock.advance(2)  # each key is 2s apart; after 60s older ones expire
    assert limiter.stats()["active_keys"] <= 4, "GC must bound the window dict"


async def test_gc_last_resort_eviction_under_simultaneous_churn():
    """All keys active at once still cannot exceed max_keys (hard bound)."""
    limiter = RateLimiter(max_keys=4)
    # No clock advance → every key's stamp is in-window, forcing the last-resort
    # oldest-first eviction branch.
    for i in range(50):
        await limiter.check(f"k:{i}", limit=10, window_seconds=60)
    assert limiter.stats()["active_keys"] <= 4


# ---------------------------------------------------------------------------
# stats() snapshot + reset() isolation
# ---------------------------------------------------------------------------
async def test_stats_snapshot_shape():
    limiter = RateLimiter()
    await limiter.check("k", limit=1, window_seconds=60)
    await limiter.check("k", limit=1, window_seconds=60)  # denied
    snap = limiter.stats()
    assert set(snap.keys()) == {"total_checked", "total_blocked", "active_keys"}
    assert snap["total_checked"] == 2
    assert snap["total_blocked"] == 1
    assert snap["active_keys"] == 1


async def test_reset_clears_windows_and_counters():
    limiter = RateLimiter()
    for _ in range(3):
        await limiter.check("k", limit=1, window_seconds=60)
    assert limiter.stats()["total_checked"] == 3
    await limiter.reset()
    snap = limiter.stats()
    assert snap == {"total_checked": 0, "total_blocked": 0, "active_keys": 0}
    # After reset the same key is allowed again (window cleared).
    assert (await limiter.check("k", limit=1, window_seconds=60)).allowed is True


async def test_global_singleton_reset_isolation():
    """The shared ``rate_limiter`` singleton's reset() restores a clean slate.

    Other integration tests rely on this for cross-test isolation; assert it
    actually zeroes everything.
    """
    await rate_limiter.check("probe", limit=1, window_seconds=60)
    assert rate_limiter.stats()["total_checked"] >= 1
    await rate_limiter.reset()
    assert rate_limiter.stats() == {
        "total_checked": 0,
        "total_blocked": 0,
        "active_keys": 0,
    }


# ---------------------------------------------------------------------------
# Decision is immutable
# ---------------------------------------------------------------------------
async def test_decision_is_frozen():
    d = Decision(allowed=True, retry_after=0, limit=5, remaining=4)
    with pytest.raises(Exception):
        d.allowed = False  # type: ignore[misc]
