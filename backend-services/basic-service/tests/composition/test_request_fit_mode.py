"""``VideoCompositionRequest.fit_mode`` (spec r2 §3.9.3 / §5.3).

An old client that sends no ``fit_mode`` gets ``contain`` (I-1); an unknown
value is rejected by validation instead of reaching the filter builders.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.video_models import VideoCompositionRequest

BASE = {"task_id": "t", "video_items": [], "total_duration": 1.0}


def test_missing_fit_mode_defaults_to_contain():
    assert VideoCompositionRequest(**BASE).fit_mode == "contain"


@pytest.mark.parametrize("fit_mode", ["contain", "cover", "blur"])
def test_known_fit_modes_are_accepted(fit_mode):
    request = VideoCompositionRequest(**BASE, fit_mode=fit_mode)

    assert request.fit_mode == fit_mode


def test_unknown_fit_mode_is_rejected():
    with pytest.raises(ValidationError):
        VideoCompositionRequest(**BASE, fit_mode="stretch")
