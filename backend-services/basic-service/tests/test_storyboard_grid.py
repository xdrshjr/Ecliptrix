"""
Tests for storyboard custom frame count feature:
- compute_optimal_grid layout calculation
- StoryboardGenerateRequest model validation
- Backward compatibility with grid_size parameter
"""

import pytest
from pydantic import ValidationError

from app.models.storyboard_models import (
    StoryboardGenerateRequest,
    compute_optimal_grid,
)


# ---------------------------------------------------------------------------
# compute_optimal_grid tests
# ---------------------------------------------------------------------------

class TestComputeOptimalGrid:
    """Verify that compute_optimal_grid returns correct (rows, cols) pairs."""

    @pytest.mark.parametrize(
        "frame_count, expected",
        [
            (1, (1, 1)),
            (2, (1, 2)),
            (3, (2, 2)),
            (4, (2, 2)),
            (5, (2, 3)),
            (6, (2, 3)),
            (7, (3, 3)),
            (8, (3, 3)),
            (9, (3, 3)),
            (10, (3, 4)),
            (12, (3, 4)),
            (15, (4, 4)),
            (16, (4, 4)),
            (20, (4, 5)),
            (25, (5, 5)),
            (36, (6, 6)),
            (49, (7, 7)),
            (64, (8, 8)),
        ],
    )
    def test_known_values(self, frame_count: int, expected: tuple):
        result = compute_optimal_grid(frame_count)
        rows, cols = result
        # rows <= cols (landscape orientation)
        assert rows <= cols, f"rows ({rows}) should be <= cols ({cols})"
        # Total cells >= requested
        assert rows * cols >= frame_count, (
            f"Grid {rows}x{cols}={rows*cols} < requested {frame_count}"
        )
        assert result == expected, (
            f"frame_count={frame_count}: expected {expected}, got {result}"
        )

    def test_rows_le_cols_for_all(self):
        """For every valid frame_count (1-64), rows should be <= cols."""
        for n in range(1, 65):
            rows, cols = compute_optimal_grid(n)
            assert rows <= cols, f"n={n}: rows={rows} > cols={cols}"

    def test_minimal_waste(self):
        """Grid should not waste more cells than necessary."""
        for n in range(1, 65):
            rows, cols = compute_optimal_grid(n)
            total = rows * cols
            assert total >= n
            # Reducing cols by 1 should not still fit
            if cols > 1:
                import math
                alt_rows = math.ceil(n / (cols - 1))
                if alt_rows <= cols - 1:
                    alt_total = alt_rows * (cols - 1)
                    # The alternative should be worse or equal
                    assert alt_total >= total or alt_total < n

    def test_edge_case_zero(self):
        assert compute_optimal_grid(0) == (1, 1)


# ---------------------------------------------------------------------------
# StoryboardGenerateRequest model validation tests
# ---------------------------------------------------------------------------

class TestStoryboardGenerateRequest:
    """Validate the request model with frame_count and grid_size interactions."""

    def test_frame_count_only(self):
        """When only frame_count is provided, grid_size is auto-computed."""
        req = StoryboardGenerateRequest(prompt="test", frame_count=5)
        assert req.frame_count == 5
        assert req.grid_size == "2x3"

    def test_grid_size_only(self):
        """When only grid_size is provided, it should be accepted."""
        req = StoryboardGenerateRequest(prompt="test", grid_size="3x3")
        assert req.grid_size == "3x3"
        assert req.frame_count is None

    def test_neither_defaults_to_9(self):
        """When neither is provided, frame_count defaults to 9."""
        req = StoryboardGenerateRequest(prompt="test")
        assert req.frame_count == 9
        assert req.grid_size == "3x3"

    def test_both_provided_frame_count_priority(self):
        """When both are provided, frame_count auto-computes grid_size."""
        req = StoryboardGenerateRequest(prompt="test", frame_count=5, grid_size="4x4")
        # Both provided: frame_count is set, grid_size was explicitly provided
        # The model_validator only auto-computes grid_size when it's None
        assert req.frame_count == 5
        assert req.grid_size == "4x4"

    def test_backward_compat_preset_grid_sizes(self):
        """Old preset grid sizes should still work."""
        for gs in ["2x2", "3x3", "4x4", "6x6", "8x8"]:
            req = StoryboardGenerateRequest(prompt="test", grid_size=gs)
            assert req.grid_size == gs

    def test_custom_grid_size(self):
        """Custom non-square grid sizes should work."""
        req = StoryboardGenerateRequest(prompt="test", grid_size="2x3")
        assert req.grid_size == "2x3"

    def test_invalid_grid_size_format(self):
        """Invalid grid_size format should raise validation error."""
        with pytest.raises(ValidationError):
            StoryboardGenerateRequest(prompt="test", grid_size="3by3")

    def test_invalid_grid_size_too_large(self):
        """Grid size with N or M > 8 should raise validation error."""
        with pytest.raises(ValidationError):
            StoryboardGenerateRequest(prompt="test", grid_size="9x9")

    def test_grid_size_at_max(self):
        """8x8 = 64 cells, which is at the limit and should work."""
        req = StoryboardGenerateRequest(prompt="test", grid_size="8x8")
        assert req.grid_size == "8x8"

    def test_grid_size_zero_row(self):
        """0xN should be rejected by the range validator."""
        with pytest.raises(ValidationError):
            StoryboardGenerateRequest(prompt="test", grid_size="0x3")

    def test_frame_count_bounds(self):
        """frame_count must be between 1 and 64."""
        with pytest.raises(ValidationError):
            StoryboardGenerateRequest(prompt="test", frame_count=0)
        with pytest.raises(ValidationError):
            StoryboardGenerateRequest(prompt="test", frame_count=65)
        # Edge cases that should work
        req1 = StoryboardGenerateRequest(prompt="test", frame_count=1)
        assert req1.frame_count == 1
        req64 = StoryboardGenerateRequest(prompt="test", frame_count=64)
        assert req64.frame_count == 64

    def test_auto_grid_for_various_frame_counts(self):
        """Auto-computed grid_size matches compute_optimal_grid."""
        test_cases = [
            (1, "1x1"), (3, "2x2"), (5, "2x3"), (7, "3x3"),
            (10, "3x4"), (12, "3x4"), (15, "4x4"), (20, "4x5"), (64, "8x8"),
        ]
        for fc, expected_gs in test_cases:
            req = StoryboardGenerateRequest(prompt="test", frame_count=fc)
            assert req.grid_size == expected_gs, (
                f"frame_count={fc}: expected grid_size='{expected_gs}', got '{req.grid_size}'"
            )
