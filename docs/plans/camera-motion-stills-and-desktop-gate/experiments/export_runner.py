"""Drive the REAL export overlay pass, and measure what it rendered.

Every export number in this round comes through here, and nothing here
re-implements the pipeline: it builds the same pydantic items the router builds,
constructs the real :class:`VideoCompositionService`, and calls the real
``_process_image_overlays`` / ``_process_overlays_and_subtitles_combined``. The
only interception is a tee around ``subprocess.run`` that records the argv while
still executing it — so the recorded command IS the command that produced the
file being measured, not a reconstruction of it.

The measurement side is deliberately blunt: find the still's magenta frame in a
rendered frame and report its bounding box. A bounding box is checkable against
the preview without either side having to agree about anything but pixels, which
is what N0 needs (it is testing whether the two sides agree at all).
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image

import _harness as H

#: Magenta frame painted around every fixture still (see stills_fixtures).
#: Chosen because nothing else in either fixture comes close to it in hue, so the
#: bounding box survives x264 quantisation without a tuned threshold.
_MAGENTA_MIN_R = 130
_MAGENTA_MIN_B = 130
_MAGENTA_MAX_G = 105


@dataclass
class ExportRun:
    """One completed overlay pass."""

    ok: bool
    output: Path
    commands: List[List[str]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    error: Optional[str] = None

    @property
    def filter_complex(self) -> Optional[str]:
        for cmd in self.commands:
            if "-filter_complex" in cmd:
                return cmd[cmd.index("-filter_complex") + 1]
        return None

    @property
    def input_options(self) -> List[str]:
        """Everything before the LAST ``-i`` — where ``-loop``/``-framerate`` land."""
        for cmd in self.commands:
            if "-filter_complex" in cmd:
                return list(cmd)
        return []


def make_service() -> Any:
    """A real service instance, with nothing stubbed.

    An earlier version of this redirected ``_convert_url_to_local_path``, on the
    assumption that the production resolver would reject a fixture living outside
    the configured storage root. It does not — ``resolve_media_reference`` accepts
    an absolute local path — so the override was removed rather than left in as a
    seam nobody needed. Every export number in this round therefore comes out of
    unmodified production code.
    """
    from app.services.video_composition_service import VideoCompositionService

    return VideoCompositionService()


def still_item(
    item_id: str,
    still_path: Path,
    start_time: float,
    duration: float,
    position: Dict[str, float],
    camera_motion: Any = None,
) -> Any:
    """One `ImageCompositionItem`, exactly as the router would have parsed it."""
    from app.models.video_models import ImageCompositionItem, ImagePosition

    return ImageCompositionItem(
        id=item_id,
        name=item_id,
        url=str(still_path),
        start_time=start_time,
        duration=duration,
        track_id="images",
        position=ImagePosition(**position),
        camera_motion=camera_motion,
    )


def motion_spec(preset_wire: Dict[str, Any]) -> Any:
    """Turn a production wire payload into the backend's `CameraMotionSpec`."""
    from app.models.video_models import CameraMotionSpec

    return CameraMotionSpec(**preset_wire)


class _CommandTee:
    """Record every ffmpeg argv while still running it for real."""

    def __init__(self, module: Any) -> None:
        self._module = module
        self._original = module.subprocess.run
        self.commands: List[List[str]] = []

    def __enter__(self) -> "_CommandTee":
        def run(cmd, *args, **kwargs):
            self.commands.append([str(part) for part in cmd])
            return self._original(cmd, *args, **kwargs)

        self._module.subprocess.run = run
        return self

    def __exit__(self, *_exc: Any) -> None:
        self._module.subprocess.run = self._original


def run_overlay_pass(
    service: Any,
    items: Sequence[Any],
    base_video: Path,
    output: Path,
    temp_dir: Path,
    resolution: Tuple[int, int] = (H.CANVAS_WIDTH, H.CANVAS_HEIGHT),
    output_fps: int = H.FPS,
    subtitles: Optional[Sequence[Any]] = None,
) -> ExportRun:
    """Run the production image-overlay pass and return what it did.

    Args:
        service: A :func:`make_service` instance.
        items: The stills.
        base_video: The already-composed video the stills are laid over.
        output: Destination file.
        temp_dir: Scratch directory for the pass.
        resolution: Output resolution (width, height).
        output_fps: Requested fps — the emitter still measures the real one (L3).
        subtitles: When present, the COMBINED assembly point is exercised instead.

    Returns:
        An :class:`ExportRun` carrying the recorded commands and any warnings.
    """
    from app.services import video_composition_service as service_module
    from app.services.video_composition_service import OverlayPassContext

    temp_dir.mkdir(parents=True, exist_ok=True)
    ctx = OverlayPassContext(
        temp_dir=str(temp_dir),
        output_resolution={"width": resolution[0], "height": resolution[1]},
        output_fps=output_fps,
    )
    with _CommandTee(service_module) as tee:
        try:
            if subtitles:
                ok = service._process_overlays_and_subtitles_combined(
                    list(items), list(subtitles), str(base_video), str(output), ctx
                )
            else:
                ok = service._process_image_overlays(
                    list(items), str(base_video), str(output), ctx
                )
            error = None
        except Exception as exc:  # recorded as a data point, never swallowed
            ok, error = False, f"{type(exc).__name__}: {exc}"
    return ExportRun(
        ok=bool(ok) and output.exists(),
        output=output,
        commands=tee.commands,
        warnings=list(ctx.warnings),
        error=error,
    )


def extract_frame(video: Path, frame_index: int, out_png: Path, ffmpeg: Optional[str] = None) -> Path:
    """Pull one exact frame by index (not by timestamp) out of a rendered file."""
    out_png.parent.mkdir(parents=True, exist_ok=True)
    result = H.run(
        [
            ffmpeg or H.FFMPEG, "-y", "-hide_banner", "-v", "error",
            "-i", str(video),
            "-vf", f"select='eq(n\\,{frame_index})'",
            "-vsync", "0", "-frames:v", "1",
            str(out_png),
        ],
        timeout=300,
    )
    if not result.ok or not out_png.exists():
        raise RuntimeError(f"frame {frame_index} extraction failed: {result.stderr[-400:]}")
    return out_png


def magenta_mask(png: Path) -> np.ndarray:
    """Boolean mask of the still's magenta frame within an image."""
    pixels = np.asarray(Image.open(png).convert("RGB")).astype(np.int16)
    red, green, blue = pixels[..., 0], pixels[..., 1], pixels[..., 2]
    return (red >= _MAGENTA_MIN_R) & (blue >= _MAGENTA_MIN_B) & (green <= _MAGENTA_MAX_G)


def marker_bbox(png: Path, min_run: int = 4) -> Optional[Dict[str, int]]:
    """Bounding box of the still's magenta frame, or None when it is absent.

    ``min_run`` rejects rows/columns holding only a handful of chroma-bleed
    pixels; the real frame is several pixels thick, so a genuine edge always
    clears it while a compression artefact never does.
    """
    mask = magenta_mask(png)
    rows = np.where(mask.sum(axis=1) >= min_run)[0]
    cols = np.where(mask.sum(axis=0) >= min_run)[0]
    if rows.size == 0 or cols.size == 0:
        return None
    return {
        "x0": int(cols[0]), "y0": int(rows[0]),
        "x1": int(cols[-1]), "y1": int(rows[-1]),
        "width": int(cols[-1] - cols[0] + 1),
        "height": int(rows[-1] - rows[0] + 1),
        "pixels": int(mask.sum()),
    }


def sample_rgb(png: Path, points: Sequence[Tuple[int, int]]) -> List[List[int]]:
    """RGB at explicit pixel coordinates — used by N3's see-through assertion."""
    pixels = np.asarray(Image.open(png).convert("RGB"))
    return [[int(v) for v in pixels[y, x]] for x, y in points]


def ssim_region(
    reference: Path,
    candidate: Path,
    region: Optional[Dict[str, int]] = None,
    mirror_candidate: bool = False,
    scale: str = "640:360",
    candidate_region: Optional[Dict[str, int]] = None,
) -> Optional[float]:
    """SSIM between two frames, optionally cropped to a region first.

    Cropping is not a convenience. A still occupies a fraction of the canvas —
    box A is 9% of it — so a whole-frame SSIM is dominated by the background both
    sides copy verbatim and would score ~0.99 with the still drawn in the wrong
    place entirely. Every gating number in N2/N3 is therefore measured on the
    still's own box.

    Args:
        reference: Preview frame.
        candidate: Export frame.
        region: ``{x, y, width, height}`` to crop both to, or None for full frame.
        mirror_candidate: Flip the candidate vertically first — the direction
            sentinel that caught Iteration 1's upside-down 3D preview.
        scale: Common size both are resampled to before comparison.
        candidate_region: Crop the CANDIDATE from somewhere else. Cropping both
            sides identically moves the window, not the content, and scores the
            same — so a displacement probe has to move one side only.

    Returns:
        The ``All`` SSIM value, or None when FFmpeg emitted no ssim line.
    """

    def crop_of(rect: Optional[Dict[str, int]]) -> str:
        if not rect:
            return ""
        return f"crop={rect['width']}:{rect['height']}:{rect['x']}:{rect['y']},"

    crop_a = crop_of(region)
    crop_b = crop_of(candidate_region if candidate_region is not None else region)
    flip = "vflip," if mirror_candidate else ""
    result = H.run(
        [
            H.FFMPEG, "-hide_banner",
            "-i", str(reference),
            "-i", str(candidate),
            "-lavfi",
            f"[0:v]{crop_a}scale={scale}:flags=bicubic,format=gray[a];"
            f"[1:v]{crop_b}{flip}scale={scale}:flags=bicubic,format=gray[b];[a][b]ssim",
            "-f", "null", "-",
        ],
        timeout=300,
    )
    for line in reversed((result.stderr or "").splitlines()):
        if "SSIM" in line and "All:" in line:
            token = line.split("All:")[1].strip().split()[0]
            try:
                return float(token)
            except ValueError:
                return None
    return None


def downscale(png: Path, out_jpg: Path, width: int = 480) -> Path:
    """A small JPEG for `results/samples/` — binaries stay out of the repo (L10)."""
    image = Image.open(png).convert("RGB")
    height = max(1, round(image.height * width / image.width))
    out_jpg.parent.mkdir(parents=True, exist_ok=True)
    image.resize((width, height), Image.LANCZOS).save(out_jpg, quality=82)
    return out_jpg
