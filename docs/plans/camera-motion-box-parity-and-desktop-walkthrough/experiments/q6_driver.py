"""Dump every frozen command string — run identically in BOTH git trees.

Iteration 2's driver (`camera-motion-stills-and-desktop-gate/experiments/
baseline_driver.py`) established the shape and the reason for it: a
"byte-identical to X" claim checked against a literal in a test file only proves
what the author believed when they typed it, so the baseline commit is EXECUTED
and the two JSON documents are diffed. This round extends it with the two things
Q5/Q6 need and Iteration 2 had no reason to dump:

* `imageSideOnGrid` — the overlay graph for stills placed on WHOLE output pixels.
  This round moved the quantisation arithmetic into `overlay_box.py`; if that
  move changed the rule rather than relocating it, these strings move. On-grid
  positions are used deliberately: they are the regime B0 could already emit, so
  any difference is the refactor's fault and nothing else.
* `defaultPositionBox` — a request with NO `position` at all. This one is
  EXPECTED to differ (DD-6 changes the backend fallback from 30% to 80%), and
  dumping it on both sides is what turns "we changed a default" into a measured
  before/after instead of a sentence in a report.

Prints one line of JSON between two markers so the caller can find it in a log
that also carries the service's own chatter.
"""

from __future__ import annotations

import inspect
import json
import subprocess
import sys
import types
from pathlib import Path
from typing import Any, Dict, List, Optional

BEGIN = "===Q6-DRIVER-JSON-BEGIN==="
END = "===Q6-DRIVER-JSON-END==="

CANVAS = (1920, 1080)
FPS = 30
CLIP_DURATION = 6.0

#: Positions whose projection onto 1920x1080 is whole-pixel AND even-sized, i.e.
#: the regime where B0's truncate-then-round-up produced exact numbers already.
ON_GRID_POSITIONS = [
    {"id": "og-a", "x": 0.1, "y": 0.1, "width": 0.3, "height": 0.3},
    {"id": "og-b", "x": 0.5, "y": 0.2, "width": 0.4, "height": 0.3},
    {"id": "og-c", "x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5},
]


def _install_cv2_stub() -> None:
    try:
        import cv2  # noqa: F401

        return
    except Exception:
        pass
    stub = types.ModuleType("cv2")
    stub.__getattr__ = lambda _name: (_ for _ in ()).throw(RuntimeError("cv2 stubbed"))
    sys.modules["cv2"] = stub


def _presets(wire_path: Path) -> Dict[str, Any]:
    payload = json.loads(wire_path.read_text(encoding="utf-8"))
    return {entry["presetId"]: entry["wire"] for entry in payload["presets"]}


def _video_side(wires: Dict[str, Any]) -> Dict[str, str]:
    """Q6-①: the video-clip filtergraph for each preset (must not move at all)."""
    from app.models.video_models import CameraMotionSpec, VideoCompositionItem
    from app.services.composition.filtergraph_builder import (
        FiltergraphOptions,
        build_filtergraph,
    )

    graphs: Dict[str, str] = {}
    for preset_id, wire in sorted(wires.items()):
        clips = [
            VideoCompositionItem(
                id="clip-0", name="clip 0", url="file://clip-0.mp4",
                start_time=0.0, duration=CLIP_DURATION, track_id="track-1",
                clip_start=0.0, clip_end=CLIP_DURATION, track_z=0,
                camera_motion=CameraMotionSpec(**wire),
            ),
            VideoCompositionItem(
                id="clip-1", name="clip 1", url="file://clip-1.mp4",
                start_time=CLIP_DURATION, duration=CLIP_DURATION, track_id="track-1",
                clip_start=0.0, clip_end=CLIP_DURATION, track_z=0,
            ),
        ]
        result = build_filtergraph(
            clips, CANVAS[0], CANVAS[1], FiltergraphOptions(pre_trimmed=True, fps=FPS)
        )
        graphs[preset_id] = result.filter_complex
    return graphs


def _stub_service(still: Path):
    """A service whose FFmpeg call is captured instead of executed."""
    from app.services.video_composition_service import VideoCompositionService

    service = VideoCompositionService.__new__(VideoCompositionService)
    service._get_ffmpeg_path = lambda: "ffmpeg"
    service._get_encoding_params = lambda quality="fast": ["-c:v", "libx264"]
    service._convert_url_to_local_path = lambda url: str(still)
    service._ensure_even_dimensions = lambda w, h: (w - w % 2, h - h % 2)
    return service


def _run_overlay(service: Any, items: List[Any], tmp_dir: Path) -> Dict[str, Any]:
    """Call the real overlay pass with FFmpeg teed, on either API generation."""
    from app.services import video_composition_service as module

    captured: Dict[str, Any] = {}
    original_run = module.subprocess.run
    original_getsize = module.os.path.getsize

    def fake_run(cmd, *args, **kwargs):
        captured.setdefault("cmds", []).append([str(part) for part in cmd])
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    module.subprocess.run = fake_run
    module.os.path.getsize = lambda path: 10
    try:
        signature = inspect.signature(service._process_image_overlays)
        if "ctx" in signature.parameters:
            from app.services.video_composition_service import OverlayPassContext

            service._process_image_overlays(
                items, str(tmp_dir / "in.mp4"), str(tmp_dir / "out.mp4"),
                OverlayPassContext(
                    temp_dir=str(tmp_dir),
                    output_resolution={"width": CANVAS[0], "height": CANVAS[1]},
                    output_fps=FPS,
                ),
            )
        else:
            service._process_image_overlays(
                items, str(tmp_dir / "in.mp4"), str(tmp_dir / "out.mp4"),
                str(tmp_dir), {"width": CANVAS[0], "height": CANVAS[1]},
            )
    finally:
        module.subprocess.run = original_run
        module.os.path.getsize = original_getsize

    cmds = captured.get("cmds", [])
    graph = None
    flags: List[str] = []
    for cmd in cmds:
        if "-filter_complex" in cmd:
            graph = cmd[cmd.index("-filter_complex") + 1]
            flags = [part for part in cmd if part.startswith("-")]
        elif "-filter_complex_script" in cmd:
            script = Path(cmd[cmd.index("-filter_complex_script") + 1])
            graph = script.read_text(encoding="utf-8") if script.exists() else "<script gone>"
            flags = [part for part in cmd if part.startswith("-")]
    return {
        "filterComplex": graph,
        "hasLoopInput": any("-loop" in cmd for cmd in cmds),
        "inputFlags": flags,
        "signature": str(inspect.signature(service._process_image_overlays)),
    }


def _item(still: Path, item_id: str, position: Optional[Dict[str, float]]):
    from app.models.video_models import ImageCompositionItem, ImagePosition

    kwargs: Dict[str, Any] = {
        "id": item_id, "name": item_id, "url": str(still),
        "start_time": 1.0, "duration": 4.0, "track_id": "images",
    }
    if position is not None:
        kwargs["position"] = ImagePosition(**position)
    return ImageCompositionItem(**kwargs)


def _motionless_overlay(still: Path, tmp_dir: Path) -> Dict[str, Any]:
    """Q6-②: one still, no camera move — the historical single-overlay command."""
    service = _stub_service(still)
    item = _item(still, "s1", {"x": 0.1, "y": 0.2, "width": 0.5, "height": 0.4})
    return _run_overlay(service, [item], tmp_dir)


def _image_side_on_grid(still: Path, tmp_dir: Path) -> Dict[str, Any]:
    """Q6 image-side: three on-grid stills in ONE graph (P2-6)."""
    service = _stub_service(still)
    items = [
        _item(still, entry["id"], {k: entry[k] for k in ("x", "y", "width", "height")})
        for entry in ON_GRID_POSITIONS
    ]
    payload = _run_overlay(service, items, tmp_dir)
    payload["positions"] = ON_GRID_POSITIONS
    return payload


def _default_position_box(still: Path, tmp_dir: Path) -> Dict[str, Any]:
    """Q5: an item whose `position` is absent — the DD-6 fallback, measured.

    Constructed WITH a position and then nulled, because `ImageCompositionItem`
    declares `position` as a required field: pydantic refuses to build one
    without it. That is itself a finding worth carrying in the payload — the
    fallback is a defensive branch on this route rather than something a
    well-formed API request can reach — but `_overlay_placement` still guards
    against a falsy `position`, and this reproduces exactly that state.
    """
    service = _stub_service(still)
    try:
        item = _item(still, "no-position", {"x": 0.4, "y": 0.4, "width": 0.2, "height": 0.2})
        item.position = None
    except Exception as exc:  # a model that forbids it is data, not a crash
        return {"constructed": False, "error": f"{type(exc).__name__}: {exc}"}
    if getattr(item, "position", "sentinel") is not None:
        return {
            "constructed": False,
            "error": "the model refused to accept a null position after construction",
        }
    payload = _run_overlay(service, [item], tmp_dir)
    payload["constructed"] = True
    payload["modelRequiresPosition"] = True
    payload["reachability"] = (
        "ImageCompositionItem.position is a REQUIRED pydantic field, so a request "
        "cannot omit it; the fallback is reached only by duck-typed callers or by an "
        "item whose position is nulled after construction. DD-6 aligns a defensive "
        "branch, which lowers its risk but does not remove the divergence."
    )
    return payload


def main() -> int:
    _install_cv2_stub()
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    wire_path = Path(sys.argv[1])
    tmp_dir = Path(sys.argv[2])
    tmp_dir.mkdir(parents=True, exist_ok=True)
    still = tmp_dir / "still.png"
    still.write_bytes(b"png")
    wires = _presets(wire_path)
    payload = {
        "videoSideFiltergraphs": _video_side(wires),
        "motionlessOverlay": _motionless_overlay(still, tmp_dir),
        "imageSideOnGrid": _image_side_on_grid(still, tmp_dir),
        "defaultPositionBox": _default_position_box(still, tmp_dir),
    }
    print(BEGIN)
    print(json.dumps(payload, sort_keys=True))
    print(END)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
