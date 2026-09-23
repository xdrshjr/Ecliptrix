"""Loader for the shared canvas-fit geometry fixture (spec r2 T-FIT-2).

The same JSON is read by the TS preview test (``videoFit.test.ts``), so the
export and the preview are held to one set of expected rects.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "fit-cases.json"
FIT_MODES = ("contain", "cover", "blur")


def load_fit_cases() -> List[Dict[str, Any]]:
    """All geometry cases in the fixture."""
    with FIXTURE_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)["cases"]


def fit_tolerance() -> int:
    """Allowed per-coordinate difference in pixels."""
    with FIXTURE_PATH.open(encoding="utf-8") as handle:
        return int(json.load(handle)["tolerance_px"])
