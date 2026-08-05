"""D1 / D2 / D3 — the off-grid box matrix, the five export frames, the stills.

D1 is the whole point of this round. Iteration 2's pixel metrics were taken on
boxes that land on WHOLE output pixels, and its own baseline JSON says so
(`downstreamFixtureRule`: "N1/N2/N3 may only use the gating boxes"). That was
honest for that round — the divergence was not camera motion's fault — but it
means every number it reported was measured in the one regime where the two
sides happen to agree. This matrix is deliberately built in the other regime.

Three properties are load-bearing and each is ASSERTED rather than assumed:

* **off-grid**: at least one of `x*W`, `y*H`, `w*W`, `h*H` has a fractional part
  in (0.15, 0.85). A matrix that quietly degenerated to whole pixels would make
  Q1 pass for the wrong reason, so `assert_off_grid` is run over every row and
  its own sensitivity is checked against a known ON-grid row (L-Q3).
* **out of bounds**: ≥4 rows with `x+w > 1` or `y+h > 1`. This is the P0-1
  regression fixture — the preview used to shrink such a box back inside the
  frame while the export cropped it, a 295.5px disagreement. Removing these rows
  would be fixture-picking and fails the round outright.
* **negative**: ≥2 rows with a negative origin (dragged off the left/top edge),
  where clamping and not-clamping diverge in the other direction.

Stills reuse Iteration 2's builder (same corner glyphs, same magenta locator)
and add the odd-width `still_odd_1501x1000`, whose natural size forces FFmpeg's
integer contain and the round-up-to-even rule to disagree at the same time.
"""

from __future__ import annotations

import itertools
import math
from pathlib import Path
from typing import Any, Dict, List, Tuple

import _harness as H
import fixture_media
import stills_fixtures as SF

#: D2 — the five export frames, mirroring `video_scaling.py:_ASPECT_RATIO_MAP`.
#: Keys are the `aspectRatios.ts` ids, which the plan verified are character-
#: identical to the backend `AspectRatio` enum values.
EXPORT_FRAMES: List[Dict[str, Any]] = [
    {"id": "16:9", "width": 1920, "height": 1080},
    {"id": "9:16", "width": 1080, "height": 1920},
    {"id": "4:3", "width": 1440, "height": 1080},
    {"id": "1:1", "width": 1080, "height": 1080},
    {"id": "21:9", "width": 2560, "height": 1080},
]

#: D3 — the odd-width still, added to Iteration 2's table so `stills_fixtures`
#: stays the single builder. 1501x1000 = 1.501:1 (the plan's P2-4 rename).
SF.STILL_SIZES.setdefault("still_odd_1501x1000", (1501, 1000))

_XS = [0.28, 0.3337, 0.5001, 0.7143]
_WS = [0.22, 0.3337, 0.44]

#: Fractional-part window a coordinate must land in to count as off-grid. The
#: bounds are not symmetric decoration: 0.15/0.85 keeps a sample away from both
#: rounding attractors, so `floor` and `round` cannot agree by accident.
OFF_GRID_LOW = 0.15
OFF_GRID_HIGH = 0.85


def _row(row_id: str, x: float, y: float, width: float, height: float) -> Dict[str, Any]:
    return {"id": row_id, "x": x, "y": y, "width": width, "height": height}


def box_matrix() -> List[Dict[str, Any]]:
    """The D1 matrix — 28 normalized positions, none of them on the pixel grid.

    Built as two sweeps plus four hand-placed edge rows. The first sweep varies
    the horizontal pair and cycles the vertical one; the second does the reverse.
    Cycling (rather than taking the full 4x4x3x3 cross product) keeps the export
    side to one FFmpeg command per aspect ratio while still visiting every value
    of every axis at least three times.
    """
    rows: List[Dict[str, Any]] = []
    for index, (x, width) in enumerate(itertools.product(_XS, _WS)):
        rows.append(_row(f"h{index:02d}", x, _XS[index % 4], width, _WS[(index // 2) % 3]))
    for index, (y, height) in enumerate(itertools.product(_XS, _WS)):
        rows.append(_row(f"v{index:02d}", _XS[(index // 2) % 4], y, _WS[index % 3], height))
    rows.append(_row("oob-right", 0.9001, 0.2801, 0.3337, 0.22))
    rows.append(_row("oob-bottom", 0.28, 0.8801, 0.22, 0.44))
    rows.append(_row("neg-left", -0.05, 0.3337, 0.3337, 0.22))
    rows.append(_row("neg-top", 0.3337, -0.05, 0.22, 0.3337))
    return rows


def is_off_grid(row: Dict[str, Any], frame: Dict[str, Any]) -> bool:
    """Does this row land off the output pixel grid on this frame?

    Args:
        row: One D1 row (normalized x/y/width/height).
        frame: One D2 export frame (`width`/`height` in pixels).

    Returns:
        True when at least one projected coordinate has a fractional part inside
        the (OFF_GRID_LOW, OFF_GRID_HIGH) window.
    """
    projected = (
        row["x"] * frame["width"],
        row["y"] * frame["height"],
        row["width"] * frame["width"],
        row["height"] * frame["height"],
    )
    for value in projected:
        fraction = abs(value) - math.floor(abs(value))
        if OFF_GRID_LOW < fraction < OFF_GRID_HIGH:
            return True
    return False


def is_out_of_bounds(row: Dict[str, Any]) -> bool:
    return row["x"] + row["width"] > 1.0 or row["y"] + row["height"] > 1.0


def is_negative(row: Dict[str, Any]) -> bool:
    return row["x"] < 0.0 or row["y"] < 0.0


def audit_matrix() -> Dict[str, Any]:
    """L-Q3 — prove the matrix has the properties the metrics depend on.

    The last entry is the assertion's OWN sensitivity check: a deliberately
    on-grid row (0.25/0.25/0.5/0.5 at 1920x1080 → 480/270/960/540) must be
    rejected by `is_off_grid`. Without it, a predicate that returned True for
    everything would let the matrix silently degenerate.
    """
    rows = box_matrix()
    per_frame = {
        frame["id"]: sum(1 for row in rows if is_off_grid(row, frame))
        for frame in EXPORT_FRAMES
    }
    on_grid_control = _row("control-on-grid", 0.25, 0.25, 0.5, 0.5)
    return {
        "rows": len(rows),
        "offGridRowsPerFrame": per_frame,
        "everyRowOffGridOnEveryFrame": all(
            count == len(rows) for count in per_frame.values()
        ),
        "outOfBoundsRowIds": [row["id"] for row in rows if is_out_of_bounds(row)],
        "negativeRowIds": [row["id"] for row in rows if is_negative(row)],
        "offGridWindow": [OFF_GRID_LOW, OFF_GRID_HIGH],
        "predicateSensitivity": {
            "control": on_grid_control,
            "frame": EXPORT_FRAMES[0],
            "projected": [480, 270, 960, 540],
            "isOffGrid": is_off_grid(on_grid_control, EXPORT_FRAMES[0]),
            "expected": False,
            "pass": is_off_grid(on_grid_control, EXPORT_FRAMES[0]) is False,
        },
    }


def base_clip(frame: Dict[str, Any], duration: float) -> Path:
    """The clip the stills are overlaid onto, at one export frame's ratio.

    Ratio equality with the project canvas is inherited from Iteration 2's D4:
    it keeps §1.2's letterbox variable out of every reading, so a deviation is
    attributable to the box rule and nothing else.
    """
    work = H.work_dir()
    png = work / f"base_{frame['width']}x{frame['height']}.png"
    mp4 = work / f"base_{frame['width']}x{frame['height']}_{duration:g}s.mp4"
    if not png.exists():
        SF._draw_base(frame["width"], frame["height"], png)  # noqa: SLF001 — the one builder
    if not mp4.exists():
        fixture_media.encode_clip(png, mp4, duration, H.FPS)
    return mp4


def still(name: str) -> Path:
    """One D3 still (Iteration 2's builder + magenta locator)."""
    return SF.still(name)


def still_size(name: str) -> Tuple[int, int]:
    return SF.STILL_SIZES[name]


def manifest() -> Dict[str, Dict[str, object]]:
    """Fixture identities for `results/env.json` — SHA256 of every input."""
    entries: Dict[str, Dict[str, object]] = {}
    for name in SF.STILL_SIZES:
        path = still(name)
        width, height = SF.STILL_SIZES[name]
        entries[name] = {
            "path": str(path),
            "width": width,
            "height": height,
            "sha256": SF.sha256(path),
        }
    return entries
