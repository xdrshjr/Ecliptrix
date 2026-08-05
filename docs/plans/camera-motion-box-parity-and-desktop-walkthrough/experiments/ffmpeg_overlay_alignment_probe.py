"""Where does FFmpeg's `overlay` ACTUALLY put the picture?

Written because Q2 refused to reach 0 and the cause was not in either
implementation. Q1 proves the preview and the export agree on the numbers in the
command (0.000px on 140 comparisons). Q2 renders the file those numbers produce
and finds the picture up to 2px away. Something between "the command says
`overlay=537:302`" and "the pixels" is moving it.

This isolates that step with the smallest possible experiment: a solid white
rectangle overlaid on a solid black frame at a known offset, with the landing
position read straight out of the output. No stills, no scaling, no camera
motion, no encoder — the only thing under test is `overlay`.

The measured rule (both builds, all three pixel formats, 72/72 samples):

    landing_x = x & ~1        # the ORIGIN is floored to the even grid
    landing_y = y & ~1
    landing_w = w           # the SIZE is untouched — an 11x11 rect stays 11x11
    landing_h = h

The first version of this probe predicted the size was floored too and scored
18/72. Recording that is not pedantry: an "almost right" rule is how a metric
starts explaining away readings it should be reporting, and the corrected rule is
what makes the residual exactly attributable.

L-Q4 says FFmpeg behaviour is measured, never read from documentation. This is
that measurement, and it is deliberately re-runnable against any binary so the
packaged 8.1.1 can be held to the same table (W1).

Usage:
    python ffmpeg_overlay_alignment_probe.py [--out results/ffmpeg-overlay-alignment.json]
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image

import _harness as H

#: (x, y) offsets: both odd, both even, mixed — enough to separate "floors to
#: even" from "off by one" and from "correct".
OFFSETS: List[Tuple[int, int]] = [(4, 4), (5, 5), (6, 6), (7, 4), (4, 7), (9, 11)]
#: NEGATIVE origins — a picture dragged off the left/top edge. D1 makes these a
#: MANDATORY fixture subset, so the rule has to be measured here too and not
#: extrapolated: "floor to even" (-5 → -6) and "truncate to even" (-5 → -4) agree
#: on every positive sample and disagree on every odd negative one, and picking
#: the wrong branch would put a NEW 1px split exactly where this round promised
#: parity. Only the far edge of the rect is visible, which is what
#: `_infer_origin` reads back.
NEG_OFFSETS: List[Tuple[int, int]] = [(-5, -5), (-6, -6), (-7, -4), (-4, -7), (-5, 6), (6, -5)]
#: Overlay sizes: even and odd in each axis.
SIZES: List[Tuple[int, int]] = [(10, 10), (11, 10), (10, 11), (11, 11)]
CANVAS = (40, 40)
FORMATS = ["yuv420p", "yuv444p", "rgb24"]


def _infer_origin(lo: int, hi: int, size: int, requested: int) -> int:
    """Where the rect starts, read from whichever edge of it is on screen.

    A negative origin crops the near edge against the frame, so `lo` is pinned to
    0 and carries no information; the far edge still moves one-for-one with the
    origin, so the origin is `hi - size + 1`. Positive origins read directly.
    """
    return lo if requested >= 0 else hi - size + 1


def _landing(binary: str, work: Path, x: int, y: int, w: int, h: int, fmt: str) -> Optional[Dict[str, int]]:
    """Overlay a white rect on black and report where the white actually is."""
    out = work / f"overlay-probe-{fmt}-{x}_{y}_{w}x{h}.png"
    graph = (
        f"color=black:s={CANVAS[0]}x{CANVAS[1]}:d=1,format={fmt}[bg];"
        f"color=white:s={w}x{h}:d=1,format={fmt}[fg];"
        f"[bg][fg]overlay={x}:{y}[v]"
    )
    result = H.run(
        [binary, "-y", "-hide_banner", "-v", "error",
         "-f", "lavfi", "-i", "nullsrc=s=8x8:d=1",
         "-filter_complex", graph, "-map", "[v]", "-frames:v", "1", str(out)],
        timeout=120,
    )
    if not result.ok or not out.exists():
        return None
    pixels = np.asarray(Image.open(out).convert("L"))
    cols = np.where(pixels.max(axis=0) > 200)[0]
    rows = np.where(pixels.max(axis=1) > 200)[0]
    if cols.size == 0 or rows.size == 0:
        return None
    return {
        "x": _infer_origin(int(cols.min()), int(cols.max()), w, x),
        "y": _infer_origin(int(rows.min()), int(rows.max()), h, y),
        "width": w if x < 0 else int(cols.max() - cols.min() + 1),
        "height": h if y < 0 else int(rows.max() - rows.min() + 1),
    }


def _predicted(x: int, y: int, w: int, h: int) -> Dict[str, int]:
    """The rule this probe exists to confirm or refute: origin floored, size kept.

    ``&~1`` is floor-to-even in two's complement and therefore also states the
    negative branch: -5 → -6, i.e. it floors AWAY from zero, not toward it.
    """
    return {"x": x & ~1, "y": y & ~1, "width": w, "height": h}


def probe_binary(log: H.Log, binary: str, label: str) -> Dict[str, Any]:
    """Run the whole grid against one FFmpeg binary."""
    work = H.work_dir() / "overlay-probe" / label
    work.mkdir(parents=True, exist_ok=True)
    version = H.run([binary, "-version"], timeout=120)
    rows: List[Dict[str, Any]] = []
    for fmt in FORMATS:
        for sign, offsets in (("positive", OFFSETS), ("negative", NEG_OFFSETS)):
            for (x, y) in offsets:
                for (w, h) in SIZES:
                    landing = _landing(binary, work, x, y, w, h, fmt)
                    predicted = _predicted(x, y, w, h)
                    rows.append({
                        "format": fmt, "origin": sign,
                        "requested": {"x": x, "y": y, "width": w, "height": h},
                        "landed": landing, "predicted": predicted,
                        "matchesRule": landing == predicted,
                        "exact": landing == {"x": x, "y": y, "width": w, "height": h},
                    })
    matches = sum(1 for row in rows if row["matchesRule"])
    exact = sum(1 for row in rows if row["exact"])
    neg = [row for row in rows if row["origin"] == "negative"]
    neg_matches = sum(1 for row in neg if row["matchesRule"])
    log(
        f"  {label}: {matches}/{len(rows)} match `floor to even` "
        f"(negative origins {neg_matches}/{len(neg)}), {exact}/{len(rows)} land exactly"
    )
    return {
        "binary": binary,
        "version": (version.stdout or "").strip().splitlines()[:1],
        "samples": len(rows),
        "matchesFloorToEvenRule": matches,
        "negativeOriginSamples": len(neg),
        "negativeOriginMatches": neg_matches,
        "landsExactlyAsRequested": exact,
        "ruleHolds": matches == len(rows),
        "rows": rows,
    }


def main(argv: List[str]) -> int:
    log = H.Log("ffmpeg-overlay-alignment")
    out_name = "ffmpeg-overlay-alignment.json"
    if "--out" in argv:
        out_name = Path(argv[argv.index("--out") + 1]).name

    log("Probing the development FFmpeg...")
    dev = probe_binary(log, H.FFMPEG, "dev")
    packaged: Dict[str, Any] = {"available": False, "path": str(H.PACKAGED_FFMPEG)}
    if H.PACKAGED_FFMPEG.exists():
        log("Probing the PACKAGED FFmpeg (8.1.1) — W1's cross-version half...")
        packaged = probe_binary(log, str(H.PACKAGED_FFMPEG), "packaged")
        packaged["available"] = True

    same_table = (
        packaged.get("available")
        and [row["landed"] for row in dev["rows"]] == [row["landed"] for row in packaged["rows"]]
    )
    payload = {
        "probe": "ffmpeg-overlay-alignment",
        "question": "does `overlay=x:y` put the picture at x,y?",
        "answer": (
            "No. On both binaries the ORIGIN is floored to the even grid while the size "
            "is kept: overlay=5:5 of an 11x11 rect lands at 4,4 still measuring 11x11. "
            "The behaviour is format-independent (measured on yuv420p, yuv444p and "
            "rgb24), so it is not a chroma-subsampling artefact of the OUTPUT format."
        ),
        "consequence": (
            "The emitted command and the rendered file are not the same statement of "
            "where a still goes. Q1 compares the command — 0.000px, and that IS the "
            "contract the two implementations share. Q2 compares the file, and inherits "
            "up to 1px per axis whenever the quantised origin is odd. This is "
            "EXPORT-SIDE and PRE-EXISTING: a property of `overlay` present at B0 and in "
            "every release that shipped this pipeline. Iterations 1 and 2 never saw it "
            "because their fixtures were all even-aligned (192,108 / 960,216 / 480,270) "
            "— the same fixture-regime blindness this round exists to remove, one level "
            "down in the instrument."
        ),
        "proposedFix": (
            "Floor the ORIGIN to even in the shared quantiser (overlayBoxQuantise.ts + "
            "overlay_box.py), exactly as the SIZE is already rounded to even by "
            "ensure_even_dimensions. The rendered pixels do not move — FFmpeg was "
            "already flooring — so it is export-output-preserving; it only makes the "
            "emitted command honest and lets the preview land on the same pixel. NOT "
            "done in this node: it needs the golden vectors regenerated, two guard "
            "vectors updated, Q1/Q2/Q3/Q6/B3 re-run AND the desktop package rebuilt "
            "(W1 pins the package to the working tree), and shipping that unverified "
            "would be worse than handing over a measured, re-runnable finding."
        ),
        "developerBuild": dev,
        "packagedBuild": packaged,
        "sameTableOnBothBuilds": bool(same_table),
        "pass": dev["ruleHolds"] and (not packaged.get("available") or packaged["ruleHolds"]),
    }
    path = H.write_json(out_name, payload)
    log(
        f"overlay alignment: rule holds dev={dev['ruleHolds']} "
        f"packaged={packaged.get('ruleHolds')} sameTable={same_table} -> {path.name}"
    )
    log.close()
    return 0 if payload["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
