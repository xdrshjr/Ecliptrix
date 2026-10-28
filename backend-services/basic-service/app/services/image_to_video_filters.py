"""Pure FFmpeg filter/argument construction for image -> video conversion.

Nothing here touches the filesystem or spawns a process, so the strings can be
pinned by golden tests. ``image_to_video_service`` owns all IO.

Bump ``FILTER_VERSION`` whenever a filter string changes: it is part of the
content-addressed cache key, so stale renders from an older implementation are
never served as the new one.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from app.services.composition.canvas_fit import blur_graph, format_number

FILTER_VERSION = 1
FPS = 30
MIN_SIDE = 64

EFFECT_STATIC = "static"
EFFECT_KEN_BURNS = "ken_burns"
EFFECT_PAN = "pan"

KB_ZOOM_IN = "zoom_in"
KB_ZOOM_OUT = "zoom_out"
PAN_LEFT_TO_RIGHT = "left_to_right"
PAN_RIGHT_TO_LEFT = "right_to_left"

ASPECT_RATIOS: Dict[str, Tuple[int, int]] = {
    "16:9": (16, 9),
    "9:16": (9, 16),
    "1:1": (1, 1),
    "4:3": (4, 3),
    "21:9": (21, 9),
}

#: Ken Burns zoom range: 1.00 <-> 1.12 (a slow, clearly visible push).
KEN_BURNS_ZOOM_MIN = 1.0
KEN_BURNS_ZOOM_MAX = 1.12
#: zoompan runs on an input this many times the output size; without the
#: oversampling its integer crop positions shimmer visibly.
KEN_BURNS_SUPERSAMPLE = 2
#: The pan strip is this much wider than the output; the surplus is the travel.
PAN_STRIP_FACTOR = 1.25
#: Aspect ratios closer than this are treated as equal (no blur padding).
RATIO_TOLERANCE = 0.01


@dataclass(frozen=True)
class CoverPlan:
    """Scale-to-cover then crop, resolved to exact integers."""

    scale_width: int
    scale_height: int
    crop_x: int
    crop_y: int
    #: Focus point re-expressed inside the cropped frame, each in 0..1.
    local_focus_x: float
    local_focus_y: float


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def even_floor(value: float, minimum: int = MIN_SIDE) -> int:
    """Largest even integer <= ``value``, never below ``minimum``."""
    floored = int(math.floor(value))
    floored -= floored % 2
    return max(minimum, floored)


def even_ceil(value: float) -> int:
    ceiled = int(math.ceil(value))
    return ceiled + (ceiled % 2)


def output_size(
    source_width: int,
    source_height: int,
    aspect_ratio: Optional[str],
    max_long_side: int,
) -> Tuple[int, int]:
    """Output frame ``(width, height)``: even, long side <= ``max_long_side``."""
    if aspect_ratio is not None:
        ratio_w, ratio_h = ASPECT_RATIOS[aspect_ratio]
        ratio = ratio_w / ratio_h
    else:
        ratio = source_width / source_height
    if ratio >= 1:
        width = even_floor(max_long_side)
        height = even_floor(width / ratio)
    else:
        height = even_floor(max_long_side)
        width = even_floor(height * ratio)
    return width, height


def ratios_match(
    source_width: int, source_height: int, width: int, height: int
) -> bool:
    source_ratio = source_width / source_height
    return abs(source_ratio / (width / height) - 1) <= RATIO_TOLERANCE


def cover_plan(
    source_width: int,
    source_height: int,
    target_width: int,
    target_height: int,
    focus_x: float,
    focus_y: float,
) -> CoverPlan:
    """Scale the source until it covers the target, crop around the focus.

    Computing this in Python (instead of ``crop=...:(iw-ow)/2``) keeps the
    subject inside the frame when the ratio changes, and lets the zoom/pan
    stages use the focus in the *cropped* frame.
    """
    factor = max(target_width / source_width, target_height / source_height)
    scale_width = max(target_width, even_ceil(source_width * factor))
    scale_height = max(target_height, even_ceil(source_height * factor))
    crop_x = int(
        _clamp(focus_x * scale_width - target_width / 2, 0,
               scale_width - target_width)
    )
    crop_y = int(
        _clamp(focus_y * scale_height - target_height / 2, 0,
               scale_height - target_height)
    )
    return CoverPlan(
        scale_width=scale_width,
        scale_height=scale_height,
        crop_x=crop_x,
        crop_y=crop_y,
        local_focus_x=_clamp(
            (focus_x * scale_width - crop_x) / target_width, 0.0, 1.0),
        local_focus_y=_clamp(
            (focus_y * scale_height - crop_y) / target_height, 0.0, 1.0),
    )


def _cover_steps(plan: CoverPlan, target_width: int, target_height: int) -> str:
    return (
        f"scale={plan.scale_width}:{plan.scale_height}:flags=lanczos,"
        f"crop={target_width}:{target_height}:{plan.crop_x}:{plan.crop_y}"
    )


def frame_count(duration: float) -> int:
    return max(1, int(round(duration * FPS)))


def build_ken_burns_filter(
    source_size: Tuple[int, int],
    size: Tuple[int, int],
    duration: float,
    direction: str,
    focus: Tuple[float, float],
) -> str:
    """``zoompan`` on a 2x supersampled cover frame; the window is clamped.

    ``zoompan`` x/y are the top-left of the crop window in *input* pixels, so
    the centre-on-focus expression is ``fx*iw - iw/zoom/2`` clamped to
    ``[0, iw - iw/zoom]`` - without the clamp an off-centre focus runs off the
    image and shows black.
    """
    width, height = size
    big_w, big_h = width * KEN_BURNS_SUPERSAMPLE, height * KEN_BURNS_SUPERSAMPLE
    plan = cover_plan(*source_size, big_w, big_h, *focus)
    frames = frame_count(duration)
    if direction == KB_ZOOM_OUT:
        zoom_start, zoom_end = KEN_BURNS_ZOOM_MAX, KEN_BURNS_ZOOM_MIN
    else:
        zoom_start, zoom_end = KEN_BURNS_ZOOM_MIN, KEN_BURNS_ZOOM_MAX
    zoom = (
        f"{format_number(zoom_start)}+({format_number(zoom_end)}"
        f"-{format_number(zoom_start)})*on/{frames}"
    )
    fx = format_number(plan.local_focus_x)
    fy = format_number(plan.local_focus_y)
    x_expr = f"max(0,min(iw-iw/zoom,{fx}*iw-iw/zoom/2))"
    y_expr = f"max(0,min(ih-ih/zoom,{fy}*ih-ih/zoom/2))"
    return (
        f"{_cover_steps(plan, big_w, big_h)},"
        f"zoompan=z='{zoom}':x='{x_expr}':y='{y_expr}'"
        f":d={frames}:s={width}x{height}:fps={FPS},setsar=1"
    )


def build_pan_filter(
    source_size: Tuple[int, int],
    size: Tuple[int, int],
    duration: float,
    direction: str,
    focus: Tuple[float, float],
) -> str:
    """Horizontal drift across a 1.25x-wide strip with smoothstep easing."""
    width, height = size
    strip_w = even_ceil(width * PAN_STRIP_FACTOR)
    plan = cover_plan(*source_size, strip_w, height, *focus)
    progress = f"clip(t/{format_number(duration)},0,1)"
    eased = f"({progress}*{progress}*(3-2*{progress}))"
    if direction == PAN_RIGHT_TO_LEFT:
        eased = f"(1-{eased})"
    x_expr = f"(iw-{width})*{eased}"
    return (
        f"{_cover_steps(plan, strip_w, height)},"
        f"crop={width}:{height}:x='{x_expr}':y=0,setsar=1"
    )


def build_static_filter(
    source_size: Tuple[int, int], size: Tuple[int, int]
) -> str:
    """Plain scale, or the export-identical blurred backdrop on a ratio change."""
    width, height = size
    if ratios_match(*source_size, width, height):
        return f"scale={width}:{height}:flags=lanczos,setsar=1"
    foreground = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease:"
        "flags=lanczos"
    )
    return f"{blur_graph(width, height, foreground)},setsar=1"


def build_video_filter(
    effect: str,
    source_size: Tuple[int, int],
    size: Tuple[int, int],
    duration: float,
    direction: Optional[str],
    focus: Tuple[float, float],
) -> str:
    """Dispatch to the effect's filter string. Raises ``ValueError`` on unknown."""
    if effect == EFFECT_STATIC:
        return build_static_filter(source_size, size)
    if effect == EFFECT_KEN_BURNS:
        return build_ken_burns_filter(
            source_size, size, duration, direction or KB_ZOOM_IN, focus)
    if effect == EFFECT_PAN:
        return build_pan_filter(
            source_size, size, duration, direction or PAN_LEFT_TO_RIGHT, focus)
    raise ValueError(f"Unsupported image-to-video effect: {effect!r}")


def build_ffmpeg_args(
    ffmpeg_path: str,
    input_image: str,
    output_video: str,
    effect: str,
    video_filter: str,
    duration: float,
) -> List[str]:
    """Full argv. Input options sit right next to their ``-i`` (see D27/C18).

    ``zoompan`` turns ONE input frame into ``d`` output frames, so the Ken
    Burns input must not be looped; the other effects need a looped stream
    because ``crop``'s ``t`` and the static scale are per-frame.
    """
    if effect == EFFECT_KEN_BURNS:
        input_options = ["-i", input_image]
        output_limit = ["-frames:v", str(frame_count(duration))]
    else:
        input_options = [
            "-loop", "1", "-framerate", str(FPS),
            "-t", format_number(duration), "-i", input_image,
        ]
        output_limit = ["-frames:v", str(frame_count(duration))]
    return [
        ffmpeg_path, "-hide_banner", "-loglevel", "error", "-nostdin",
        *input_options,
        "-vf", video_filter,
        *output_limit,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-movflags", "+faststart", "-an", "-y", output_video,
    ]


def build_thumbnail_args(
    ffmpeg_path: str, input_video: str, output_image: str, at_seconds: float
) -> List[str]:
    return [
        ffmpeg_path, "-hide_banner", "-loglevel", "error", "-nostdin",
        "-ss", format_number(at_seconds), "-i", input_video,
        "-frames:v", "1", "-q:v", "3", "-y", output_image,
    ]


def canonical_params(
    effect: str,
    direction: Optional[str],
    duration: float,
    focus: Tuple[float, float],
    size: Tuple[int, int],
    fit: str,
) -> Dict[str, object]:
    """Everything that changes the rendered pixels, in a stable shape."""
    return {
        "effect": effect,
        "direction": direction if effect != EFFECT_STATIC else None,
        "duration": round(duration, 3),
        "focus": [round(focus[0], 4), round(focus[1], 4)],
        "size": list(size),
        "fit": fit,
        "version": FILTER_VERSION,
    }
