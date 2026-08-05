"""Read the placement boxes back out of the command that actually ran.

Neither side of Q1 is allowed to be re-derived by the harness (plan §2.2): the
preview number is `buildImageLayersAt`'s own output and the export number is
whatever integers went to FFmpeg. This module is only the reader.

It handles both shapes the service can emit — `-filter_complex <text>` and, once
the graph passes the argv limit, `-filter_complex_script <file>`. Iteration 1's
final review flagged that the script form existed but was never exercised; a
28-still command sits right at the boundary, so guessing which one appeared
would have been a real source of silent zero-sample passes.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

_SCALE_RE = re.compile(
    r"^\[(?P<input>\d+):v\]scale=(?P<w>\d+):(?P<h>\d+):force_original_aspect_ratio=decrease,"
    r"pad=\d+:\d+:\(ow-iw\)/2:\(oh-ih\)/2:black@0(?P<rest>.*)\[img(?P<index>\d+)\]$"
)
_OVERLAY_RE = re.compile(
    r"^\[[^\]]+\]\[img(?P<index>\d+)\]overlay=(?P<x>-?\d+):(?P<y>-?\d+)"
    r":enable='between\(t,(?P<start>[^,]+),(?P<end>[^)]+)\)'\[v\d+\]$"
)


def filter_complex_of(commands: List[List[str]]) -> Optional[str]:
    """The filtergraph text of the overlay command, whichever way it was passed.

    Args:
        commands: Every argv the service handed to `subprocess.run`.

    Returns:
        The graph text, or None when no overlay command was issued.
    """
    for cmd in commands:
        if "-filter_complex" in cmd:
            return cmd[cmd.index("-filter_complex") + 1]
        if "-filter_complex_script" in cmd:
            script = Path(cmd[cmd.index("-filter_complex_script") + 1])
            if script.exists():
                return script.read_text(encoding="utf-8")
    return None


def boxes_of(filter_complex: str) -> Dict[int, Dict[str, Any]]:
    """Per-still placement boxes, keyed by the index in the emitted chain.

    Args:
        filter_complex: The graph text that rendered the file.

    Returns:
        `{index: {x, y, width, height, motionFilter}}` in OUTPUT pixels.
    """
    boxes: Dict[int, Dict[str, Any]] = {}
    for part in filter_complex.split(";"):
        scale = _SCALE_RE.match(part.strip())
        if scale:
            entry = boxes.setdefault(int(scale.group("index")), {})
            entry["width"] = int(scale.group("w"))
            entry["height"] = int(scale.group("h"))
            entry["motionFilter"] = scale.group("rest").lstrip(",") or None
            continue
        overlay = _OVERLAY_RE.match(part.strip())
        if overlay:
            entry = boxes.setdefault(int(overlay.group("index")), {})
            entry["x"] = int(overlay.group("x"))
            entry["y"] = int(overlay.group("y"))
    return boxes


def corner_deltas(preview: Dict[str, float], export: Dict[str, float]) -> Dict[str, float]:
    """Per-corner distance between two axis-aligned boxes, in output pixels."""

    def corners(box: Dict[str, float]):
        return [
            (box["x"], box["y"]),
            (box["x"] + box["width"], box["y"]),
            (box["x"] + box["width"], box["y"] + box["height"]),
            (box["x"], box["y"] + box["height"]),
        ]

    return {
        name: ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5
        for name, a, b in zip(("TL", "TR", "BR", "BL"), corners(preview), corners(export))
    }
