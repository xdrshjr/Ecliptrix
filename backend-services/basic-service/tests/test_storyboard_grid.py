"""
Tests for the post-refactor storyboard request model.

The old ``compute_optimal_grid`` helper and the N×M grid selector have been
removed — storyboard generation now always uses 2×2 batches chained
together, and ``grid_size`` only accepts the constant ``"2x2"`` (or None,
which the validator auto-fills).
"""

import pytest
from pydantic import ValidationError

from app.models.storyboard_models import (
    STORYBOARD_MAX_SCENE_COUNT,
    StoryboardGenerateRequest,
)


class TestStoryboardGenerateRequest:
    """Validate the request model with frame_count and grid_size interactions."""

    def test_frame_count_only(self):
        """Providing only frame_count still yields a 2x2 grid internally."""
        req = StoryboardGenerateRequest(prompt="test", frame_count=5)
        assert req.frame_count == 5
        assert req.grid_size == "2x2"

    def test_neither_provided_defaults_to_one_batch(self):
        """Empty request defaults to one full 2×2 batch (4 scenes)."""
        req = StoryboardGenerateRequest(prompt="test")
        assert req.frame_count == 4
        assert req.grid_size == "2x2"

    def test_grid_size_explicit_2x2_allowed(self):
        req = StoryboardGenerateRequest(prompt="test", grid_size="2x2", frame_count=8)
        assert req.grid_size == "2x2"
        assert req.frame_count == 8

    @pytest.mark.parametrize("grid", ["3x3", "4x4", "6x6", "8x8", "2x3", "9x9", "0x3", "3by3"])
    def test_grid_size_rejected_for_non_2x2(self, grid: str):
        with pytest.raises(ValidationError):
            StoryboardGenerateRequest(prompt="test", grid_size=grid)

    def test_frame_count_bounds(self):
        """frame_count is clamped to [1, STORYBOARD_MAX_SCENE_COUNT]."""
        with pytest.raises(ValidationError):
            StoryboardGenerateRequest(prompt="test", frame_count=0)
        with pytest.raises(ValidationError):
            StoryboardGenerateRequest(
                prompt="test", frame_count=STORYBOARD_MAX_SCENE_COUNT + 1
            )

        req1 = StoryboardGenerateRequest(prompt="test", frame_count=1)
        assert req1.frame_count == 1
        req_max = StoryboardGenerateRequest(
            prompt="test", frame_count=STORYBOARD_MAX_SCENE_COUNT
        )
        assert req_max.frame_count == STORYBOARD_MAX_SCENE_COUNT

    def test_grid_size_preserved_when_explicit_2x2(self):
        """The validator must not overwrite an explicit '2x2' with None."""
        req = StoryboardGenerateRequest(prompt="t", grid_size="2x2")
        assert req.grid_size == "2x2"
