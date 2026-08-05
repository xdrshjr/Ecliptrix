"""Camera-motion degrade warnings — the async status channel (§4.4.5 / P0-3).

Composition is ASYNCHRONOUS: ``start_video_composition`` returns
``status='processing'`` before normalization begins, so a degrade discovered
during normalization can only reach the user through
``GET /compose/{id}/status``. Four hand-offs have to line up (W1→W4) and any one
of them silently defeats G7 — the guarantee that a degrade is never invisible.

This module covers the three that live in the backend:

  W1  ``_normalize_video`` returns its warnings with the result;
  W2  the ``as_completed`` collector merges them into the shared composition
      dict on the MAIN thread (worker threads must not write it);
  W3  ``get_composition_status``'s ``safe_info`` is an EXPLICIT whitelist, so a
      warning that is not listed there never leaves the process. This is the
      easiest hand-off in the chain to miss, and testing only the service layer
      would sail straight past it.
"""

from __future__ import annotations

import pytest

from app.routers import video_router
from app.services.composition.camera_motion import (
    CameraFilterCaps,
    CameraMotionConfig,
    build_camera_filter_chain,
)


class _StubService:
    """Stands in for the singleton composition service."""

    def __init__(self, info):
        self._info = info

    def get_composition_status(self, composition_id: str):
        return self._info


@pytest.fixture
def stub_service(monkeypatch):
    def install(info):
        monkeypatch.setattr(video_router, "video_composition_service", _StubService(info))
    return install


# ---------------------------------------------------------------------------
# W3 — the router whitelist
# ---------------------------------------------------------------------------


class TestStatusRouteWhitelist:
    @pytest.mark.asyncio
    async def test_warnings_reach_the_client_through_the_status_route(self, stub_service):
        warning = "城市航拍_01: 3D camera motion rendered as 2D (FFmpeg has no 'perspective')"
        stub_service({
            "id": "comp-1",
            "task_id": "task-1",
            "status": "completed",
            "progress": 1.0,
            "start_time": 1754380000,
            "warnings": [warning],
        })

        result = await video_router.get_composition_status("comp-1")

        assert result["warnings"] == [warning]
        assert result["status"] == "completed"

    @pytest.mark.asyncio
    async def test_warnings_default_to_an_empty_list(self, stub_service):
        stub_service({
            "id": "comp-1", "task_id": "task-1", "status": "processing",
            "progress": 0.4, "start_time": 0,
        })

        result = await video_router.get_composition_status("comp-1")

        # Present and empty — the frontend type is `warnings?: string[]`, and an
        # absent key must never look like "a warning we failed to parse".
        assert result["warnings"] == []

    @pytest.mark.asyncio
    async def test_warnings_survive_alongside_an_error_payload(self, stub_service):
        stub_service({
            "id": "comp-1", "task_id": "task-1", "status": "failed",
            "progress": 0.6, "start_time": 0,
            "warnings": ["clip 2: rendered without motion"],
            "error": "boom",
        })

        result = await video_router.get_composition_status("comp-1")

        assert result["warnings"] == ["clip 2: rendered without motion"]
        assert result["error"] == "boom"


# ---------------------------------------------------------------------------
# W2 — main-thread aggregation semantics
# ---------------------------------------------------------------------------


class TestWarningAggregation:
    """The collector merges `result['warnings']` into the composition dict.

    Mirrors `video_composition_service`'s `as_completed` loop verbatim, which is
    what makes this a meaningful pin of the merge SEMANTICS: results carry the
    warnings back (thread-safe) and identical lines are de-duplicated so a
    five-clip export does not print the same sentence five times.
    """

    @staticmethod
    def _merge(compositions, composition_id, result):
        for warning in result.get("warnings") or []:
            bucket = compositions[composition_id].setdefault("warnings", [])
            if warning not in bucket:
                bucket.append(warning)

    def test_merges_warnings_from_every_clip_result(self):
        compositions = {"comp-1": {"warnings": []}}
        self._merge(compositions, "comp-1", {"success": True, "warnings": ["clip 1: a"]})
        self._merge(compositions, "comp-1", {"success": True, "warnings": ["clip 2: b"]})
        assert compositions["comp-1"]["warnings"] == ["clip 1: a", "clip 2: b"]

    def test_deduplicates_identical_lines(self):
        compositions = {"comp-1": {"warnings": []}}
        for _ in range(5):
            self._merge(compositions, "comp-1", {"success": True, "warnings": ["same"]})
        assert compositions["comp-1"]["warnings"] == ["same"]

    def test_collects_warnings_from_failed_results_too(self):
        compositions = {"comp-1": {"warnings": []}}
        self._merge(compositions, "comp-1", {"success": False, "warnings": ["clip 3: c"]})
        assert compositions["comp-1"]["warnings"] == ["clip 3: c"]

    def test_tolerates_a_result_without_the_key(self):
        compositions = {"comp-1": {"warnings": []}}
        self._merge(compositions, "comp-1", {"success": True})
        assert compositions["comp-1"]["warnings"] == []


# ---------------------------------------------------------------------------
# The service seeds the bucket, and the builder produces real messages
# ---------------------------------------------------------------------------


class TestServiceWiring:
    def test_start_video_composition_seeds_an_empty_warnings_bucket(self):
        """W2 precondition: the collector uses `setdefault`, but seeding the key
        up front means a status poll before the first clip finishes already
        returns `warnings: []` rather than omitting it."""
        import inspect
        from app.services import video_composition_service as module

        source = inspect.getsource(module.VideoCompositionService.start_video_composition)
        assert '"warnings": []' in source

    def test_normalize_forwards_the_camera_motion_and_clip_label(self):
        import inspect
        from app.services import video_composition_service as module

        source = inspect.getsource(module.VideoCompositionService._compose_video_sync)
        assert "'camera_motion'" in source
        assert "'camera_label'" in source

    def test_normalize_returns_warnings_on_both_paths(self):
        import inspect
        from app.services import video_composition_service as module

        source = inspect.getsource(module.VideoCompositionService._normalize_video)
        # Success and failure results both carry the list (W1).
        assert '"warnings": warnings' in source
        assert '"error": error_msg, "index": index, "warnings": warnings' in source
        # The no-motion re-run lives INSIDE _normalize_video (P1-4), so a
        # deterministic expression failure degrades immediately instead of
        # burning the outer retry budget first.
        assert "retrying without it" in source

    # NOTE the roll case uses a 2D motion on purpose: in 3D the roll is folded
    # into Rz and there is no `rotate` filter to lose, so a missing `rotate`
    # correctly produces no warning there.
    @pytest.mark.parametrize(
        "mode,caps,config,expect_fragment",
        [
            ("3d", CameraFilterCaps(), CameraMotionConfig(enabled=False), "disabled"),
            ("3d", CameraFilterCaps(perspective=False), CameraMotionConfig(), "perspective"),
            ("2d", CameraFilterCaps(rotate=False), CameraMotionConfig(), "roll"),
        ],
    )
    def test_degrade_paths_produce_a_user_readable_warning(
        self, mode, caps, config, expect_fragment,
    ):
        motion = {
            "version": 1, "mode": mode, "preset_id": "orbit-left",
            "intensity": 1.0, "easing": "easeInOut",
            "start": {"rotate_y": 10, "roll": -3}, "end": {"rotate_y": -10, "roll": 3},
        }
        _, warnings = build_camera_filter_chain(
            motion, 1920, 1080, 30, 6.0, caps=caps, config=config, label="城市航拍_01",
        )
        assert warnings, "a degrade must never be silent (G7)"
        assert any(expect_fragment in w for w in warnings)
        # The clip name is in the message so a multi-clip export is actionable.
        assert all("城市航拍_01" in w for w in warnings)

    def test_a_clean_render_produces_no_warnings(self):
        motion = {
            "version": 1, "mode": "2d", "preset_id": "push-in",
            "intensity": 1.0, "easing": "easeInOut",
            "start": {"scale": 1.0}, "end": {"scale": 1.25},
        }
        chain, warnings = build_camera_filter_chain(
            motion, 1920, 1080, 30, 6.0,
            caps=CameraFilterCaps(), config=CameraMotionConfig(), label="clip",
        )
        assert chain
        assert warnings == []
