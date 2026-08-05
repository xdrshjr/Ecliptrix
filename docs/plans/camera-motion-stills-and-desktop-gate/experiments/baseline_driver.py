"""Dump the two frozen command strings — run identically in BOTH git trees.

N4-① and N4-② are "byte-identical to `8c702ec`" claims. The weak way to check
them is a literal frozen in a test file, which only proves the author's belief at
the time they typed it. The strong way is to execute the old code and diff the
result, and the only way that is a fair diff is if the SAME driver produces both
sides. So this file is copied into a detached worktree of the baseline commit and
run there, then run again in the live tree, and the two JSON documents are
compared.

It adapts to the two API generations it has to speak to:

* ``_process_image_overlays`` took ``(items, video, out, temp_dir, resolution)``
  at the baseline and takes ``(items, video, out, ctx)`` now — the *command it
  builds* is the artefact under comparison, not its call signature.
* ``camera_motion_overlay`` does not exist at the baseline at all, which is
  expected: N4-② is about a timeline with NO camera motion, where the new code
  must produce the old command exactly.

Prints one line of JSON between two markers so the caller can find it in a log
that also contains the service's own chatter.
"""

from __future__ import annotations

import inspect
import json
import subprocess
import sys
import types
from pathlib import Path

BEGIN = "===BASELINE-DRIVER-JSON-BEGIN==="
END = "===BASELINE-DRIVER-JSON-END==="

CANVAS = (1920, 1080)
FPS = 30
CLIP_DURATION = 6.0


def _install_cv2_stub() -> None:
    try:
        import cv2  # noqa: F401

        return
    except Exception:
        pass
    stub = types.ModuleType("cv2")
    stub.__getattr__ = lambda _name: (_ for _ in ()).throw(RuntimeError("cv2 stubbed"))
    sys.modules["cv2"] = stub


def _presets(wire_path: Path):
    payload = json.loads(wire_path.read_text(encoding="utf-8"))
    return {entry["presetId"]: entry["wire"] for entry in payload["presets"]}


def _video_side(wires) -> dict:
    """N4-①: the video-clip filtergraph for each preset."""
    from app.models.video_models import CameraMotionSpec, VideoCompositionItem
    from app.services.composition.filtergraph_builder import (
        FiltergraphOptions,
        build_filtergraph,
    )

    graphs = {}
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


def _motionless_overlay(tmp_dir: Path) -> dict:
    """N4-②: the image-overlay command for a still with NO camera move."""
    from app.models.video_models import ImageCompositionItem, ImagePosition
    from app.services import video_composition_service as module
    from app.services.video_composition_service import VideoCompositionService

    still = tmp_dir / "still.png"
    still.write_bytes(b"png")
    service = VideoCompositionService.__new__(VideoCompositionService)
    service._get_ffmpeg_path = lambda: "ffmpeg"
    service._get_encoding_params = lambda quality="fast": ["-c:v", "libx264"]
    service._convert_url_to_local_path = lambda url: str(still)
    service._ensure_even_dimensions = lambda w, h: (w - w % 2, h - h % 2)

    captured = {}
    original_run = module.subprocess.run

    def fake_run(cmd, *args, **kwargs):
        captured["cmd"] = [str(part) for part in cmd]
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    module.subprocess.run = fake_run
    original_getsize = module.os.path.getsize
    module.os.path.getsize = lambda path: 10
    try:
        item = ImageCompositionItem(
            id="s1", name="s1", url=str(still), start_time=1.0, duration=4.0,
            track_id="images",
            position=ImagePosition(x=0.1, y=0.2, width=0.5, height=0.4),
        )
        signature = inspect.signature(service._process_image_overlays)
        if "ctx" in signature.parameters:
            from app.services.video_composition_service import OverlayPassContext

            service._process_image_overlays(
                [item], str(tmp_dir / "in.mp4"), str(tmp_dir / "out.mp4"),
                OverlayPassContext(
                    temp_dir=str(tmp_dir),
                    output_resolution={"width": CANVAS[0], "height": CANVAS[1]},
                    output_fps=FPS,
                ),
            )
        else:
            service._process_image_overlays(
                [item], str(tmp_dir / "in.mp4"), str(tmp_dir / "out.mp4"),
                str(tmp_dir), {"width": CANVAS[0], "height": CANVAS[1]},
            )
    finally:
        module.subprocess.run = original_run
        module.os.path.getsize = original_getsize

    cmd = captured.get("cmd", [])
    index = cmd.index("-filter_complex") if "-filter_complex" in cmd else -1
    return {
        "filterComplex": cmd[index + 1] if index >= 0 else None,
        "hasLoopInput": "-loop" in cmd,
        "inputFlags": [part for part in cmd if part.startswith("-")],
        "signature": str(signature),
    }


def main() -> int:
    _install_cv2_stub()
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    wire_path = Path(sys.argv[1])
    tmp_dir = Path(sys.argv[2])
    tmp_dir.mkdir(parents=True, exist_ok=True)
    wires = _presets(wire_path)
    payload = {
        "videoSideFiltergraphs": _video_side(wires),
        "motionlessOverlay": _motionless_overlay(tmp_dir),
    }
    print(BEGIN)
    print(json.dumps(payload, sort_keys=True))
    print(END)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
