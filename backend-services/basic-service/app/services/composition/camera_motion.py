"""2D / 3D camera motion — FFmpeg filter-chain builder (camera-motion-2d-3d §4.4).

This module is the export-side MIRROR of the TypeScript math kernel in
``src/components/video/playback/camera/``. Every formula here must stay
byte-for-byte equivalent to its TS twin; the cross-language golden vectors
(``__tests__/fixtures/camera-golden.json``) are the gate that keeps them honest.

The chain is injected into ``_normalize_video``'s ``-vf`` between ``scale`` and
``pad`` (D4), so both ends operate on the same "content rect" and export
reproduces the preview instead of a black-bar-polluted approximation.

⚠️ FRAME-COUNT VARIABLES ARE NOT THE SAME IN ALL THREE FILTERS (P0-1, measured
on this repo's FFmpeg build):

    | filter      | variable used here | note                                    |
    |-------------|--------------------|-----------------------------------------|
    | zoompan     | ``on``             | output frame number                     |
    | perspective | ``on``             | needs ``eval=frame``                    |
    | rotate      | ``n``              | HAS NO ``on`` — using it fails the pad  |

Using ``on`` inside ``rotate`` yields
``Undefined constant or missing '(' in 'on/30)*PI/180'`` → ``Failed to configure
output pad`` → the whole clip fails to normalize. ``dry_run_chain`` is the cheap
net that catches this class of mistake in 0.1s instead of mid-4K-transcode.
"""

from __future__ import annotations

import math
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import yaml

from app.logger import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Constants — mirrored from playback/camera/types.ts
# ---------------------------------------------------------------------------

CAMERA_RANGES: Dict[str, Tuple[float, float]] = {
    "scale": (1.0, 4.0),
    "x": (0.0, 1.0),
    "y": (0.0, 1.0),
    "roll": (-45.0, 45.0),
    "rotate_x": (-45.0, 45.0),
    "rotate_y": (-45.0, 45.0),
    "dolly": (-0.6, 0.6),
}

DEFAULT_KEYFRAME: Dict[str, float] = {
    "scale": 1.0, "x": 0.5, "y": 0.5, "roll": 0.0,
    "rotate_x": 0.0, "rotate_y": 0.0, "dolly": 0.0,
}

MIN_WINDOW = 0.05
EFFECTIVE_SCALE_RANGE = (1.0, 8.0)
ROLL_PAD_RANGE = (1.0, 4.0)
CAMERA_FOV_DEG = 25.0
CAMERA_D = 0.5 / math.tan(math.radians(CAMERA_FOV_DEG) / 2)
CAMERA_Z_MIN = 0.05 * CAMERA_D
CAMERA_COVER_SAMPLES = 100
KEYFRAME_EPSILON = 1e-6

#: Sample count used when fitting the 3D corner trajectories.
POLY_FIT_SAMPLES = 41

#: Keyframe curves (camera-motion-keyframe-curves §7.3) — mirrored from
#: `playback/camera/types.ts`. `CAMERA_MAX_KEYFRAMES` is the compiled-in ceiling;
#: the effective limit is `config.max_keyframes`, enforced inside `expand_stops`.
CAMERA_MAX_KEYFRAMES = 8
MIN_KEYFRAME_GAP = 0.02
CAMERA_SEGMENT_SAMPLES = 16
_GAP_EPSILON = 1e-9

EASINGS = ("linear", "easeIn", "easeOut", "easeInOut")

DEGENERATE = float("inf")


def clamp(value: float, low: float, high: float) -> float:
    if value != value:  # NaN
        return low
    return low if value < low else (high if value > high else value)


# ---------------------------------------------------------------------------
# Config (§7.3)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CameraMotionConfig:
    """``config/camera-motion.yaml``. A missing file MUST NOT break startup."""

    enabled: bool = True
    #: 1 by default on measured evidence, NOT on the spec's original 2 (§8 P6 /
    #: P2-9). A 4K/30fps normalize on this repo's FFmpeg build: no motion 3.01s,
    #: 2D push-in 21.26s at supersample=2 (7.07x) but 6.26s at 1 (2.08x). §8 P6
    #: says to drop to 1 when 2D exceeds 3x, and 7x on a desktop app is not a
    #: trade anyone would take for D7's half-pixel pan precision. Raise it to 2
    #: per-install if a slow pan shows visible 1px stepping.
    supersample: int = 1
    interpolation: str = "linear"
    poly_degree: int = 3
    poly_degree_fallback: Optional[int] = None
    max_fit_error_px: float = 0.75
    dry_run_probe: bool = True
    #: Still-image camera motion master switch (camera-motion-stills §7.3).
    stills_enabled: bool = True
    #: Operator brake, in SOURCE pixels (D28). The content rect is always
    #: <= the position box <= the output resolution, so gating on it would
    #: never fire (4K output is exactly 3840*2160); the cost that actually
    #: hurts is decoding an 8000x6000 original, and `zoompan` sits AFTER
    #: `scale=cw:ch` so it never sees the original at all.
    stills_max_source_pixels: int = 33_177_600  # 7680x4320
    #: Character ceiling on the ASSEMBLED chain (D40). Over it, a multi-keyframe
    #: curve collapses to a two-keyframe motion with a warning rather than
    #: failing the export. Measured headroom is roughly 2x: a single `zoompan`
    #: `z` expression of 8985 chars and a 15KB chain both run (§4.4.5 M2).
    #: NOTE the gate is on the WHOLE chain, not per component: `z_expr` is
    #: inlined into `x_expr` and `y_expr` twice each, so the scale segment string
    #: appears FIVE times inside one zoompan and length is not linear in the
    #: keyframe count.
    max_expr_chars: int = 20000
    #: Keyframe ceiling, aligned with the frontend's CAMERA_MAX_KEYFRAMES.
    #: Enforced in `expand_stops` — neither the pydantic model nor the frontend
    #: constant can see this file, so truncating only there would make the key a
    #: dead knob (worse than not having it).
    max_keyframes: int = CAMERA_MAX_KEYFRAMES


_config_cache: Optional[CameraMotionConfig] = None


def load_camera_config(config_path: str = "config/camera-motion.yaml") -> CameraMotionConfig:
    """Load the camera-motion config, falling back to built-in defaults.

    Mirrors the repo's YAML convention (``yaml.safe_load`` + defaults when the
    file is absent).
    """
    global _config_cache
    if _config_cache is not None:
        return _config_cache
    try:
        path = Path(config_path)
        if path.exists():
            with open(path, "r", encoding="utf-8") as handle:
                raw = yaml.safe_load(handle) or {}
            section = raw.get("camera_motion", raw) or {}
            # A trimmed YAML must behave exactly like no YAML at all: every
            # fallback below has to be the dataclass default, verbatim (§14 I4).
            stills = section.get("stills") or {}
            _config_cache = CameraMotionConfig(
                enabled=bool(section.get("enabled", True)),
                # Default 1, NOT 2 — must agree with CameraMotionConfig's own
                # default (see the measured rationale on that field). A YAML that
                # omits the key must not silently opt into the 7x-slower setting.
                supersample=int(section.get("supersample", 1) or 1),
                interpolation=str(section.get("interpolation", "linear") or "linear"),
                poly_degree=int(section.get("poly_degree", 3) or 3),
                poly_degree_fallback=(
                    int(section["poly_degree_fallback"])
                    if section.get("poly_degree_fallback") else None
                ),
                max_fit_error_px=float(section.get("max_fit_error_px", 0.75) or 0.75),
                dry_run_probe=bool(section.get("dry_run_probe", True)),
                stills_enabled=bool(stills.get("enabled", True)),
                stills_max_source_pixels=int(
                    stills.get("max_source_pixels", 33_177_600) or 33_177_600
                ),
                # Every fallback below MUST be the dataclass default, verbatim
                # (§14 I4 / review P1-9): a YAML that omits the key has to behave
                # exactly like no YAML at all. T19 pins that with a trimmed-file
                # vs no-file comparison.
                max_expr_chars=int(section.get("max_expr_chars", 20000) or 20000),
                max_keyframes=int(
                    section.get("max_keyframes", CAMERA_MAX_KEYFRAMES) or CAMERA_MAX_KEYFRAMES
                ),
            )
            logger.info("Camera motion configuration loaded successfully")
        else:
            _config_cache = CameraMotionConfig()
            logger.warning("Camera motion config file not found, using defaults")
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(f"Failed to load camera motion config ({exc}); using defaults")
        _config_cache = CameraMotionConfig()
    return _config_cache


def reset_camera_config_cache() -> None:
    """Test seam — drops the process-level config memo."""
    global _config_cache
    _config_cache = None


# ---------------------------------------------------------------------------
# FFmpeg capability probe (§4.4.4)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CameraFilterCaps:
    zoompan: bool = True
    perspective: bool = True
    rotate: bool = True
    crop: bool = True
    scale: bool = True


_caps_cache: Dict[str, CameraFilterCaps] = {}


def probe_camera_filters(ffmpeg_path: str = "ffmpeg") -> CameraFilterCaps:
    """Parse ``ffmpeg -filters`` for the filters the chain needs.

    Process-level cache, matching the ``encode.detect_gpu_encoder`` pattern.
    On any failure we assume everything IS available: an over-optimistic probe
    is caught immediately afterwards by :func:`dry_run_chain`, whereas an
    over-pessimistic one would silently disable the feature.
    """
    cached = _caps_cache.get(ffmpeg_path)
    if cached is not None:
        return cached
    try:
        result = subprocess.run(
            [ffmpeg_path, "-hide_banner", "-filters"],
            capture_output=True, text=True, timeout=20,
        )
        listing = (result.stdout or "") + (result.stderr or "")
        names = set()
        for line in listing.splitlines():
            parts = line.split()
            # Format: " TSC name  in->out  description"
            if len(parts) >= 2 and not line.startswith("Filters:"):
                names.add(parts[1])
        caps = CameraFilterCaps(
            zoompan="zoompan" in names,
            perspective="perspective" in names,
            rotate="rotate" in names,
            crop="crop" in names,
            scale="scale" in names,
        )
    except Exception as exc:
        logger.warning(f"Camera filter probe failed ({exc}); assuming all filters present")
        caps = CameraFilterCaps()
    _caps_cache[ffmpeg_path] = caps
    return caps


_dry_run_cache: Dict[str, Tuple[bool, str]] = {}


def dry_run_chain(chain: str, ffmpeg_path: str = "ffmpeg") -> Tuple[bool, str]:
    """Run the filter chain against a 64x36 / 0.1s lavfi source.

    This is the cheapest possible interception point for "that variable does not
    exist in this filter" errors (P0-1 / R13): 0.1 seconds to a verdict, instead
    of discovering the failure halfway through a 4K transcode. Cached per chain
    string for the life of the process.
    """
    if not chain:
        return True, ""
    cached = _dry_run_cache.get(chain)
    if cached is not None:
        return cached
    try:
        result = subprocess.run(
            [
                ffmpeg_path, "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", "color=c=black:s=64x36:d=0.1",
                "-vf", chain, "-f", "null", "-",
            ],
            capture_output=True, text=True, timeout=60,
        )
        stderr = (result.stderr or "").strip()
        # `rotate` reports an expression error on stderr while still exiting 0,
        # so the return code alone is NOT a sufficient verdict here.
        ok = result.returncode == 0 and not stderr
        first_line = stderr.splitlines()[0] if stderr else ""
        outcome = (ok, first_line)
    except Exception as exc:
        outcome = (False, str(exc))
    _dry_run_cache[chain] = outcome
    return outcome


def reset_camera_probe_caches() -> None:
    """Test seam — drops the capability and dry-run memos."""
    _caps_cache.clear()
    _dry_run_cache.clear()


# ---------------------------------------------------------------------------
# Math mirror (§4.2)
# ---------------------------------------------------------------------------


def _motion_field(motion: Any, name: str, default: Any = None) -> Any:
    """Read a field off either a pydantic model or a plain dict."""
    if motion is None:
        return default
    if isinstance(motion, dict):
        value = motion.get(name, default)
    else:
        value = getattr(motion, name, default)
    return default if value is None else value


def _keyframe_dict(frame: Any) -> Dict[str, float]:
    out = dict(DEFAULT_KEYFRAME)
    if frame is None:
        return out
    for key in DEFAULT_KEYFRAME:
        value = frame.get(key) if isinstance(frame, dict) else getattr(frame, key, None)
        if isinstance(value, (int, float)):
            out[key] = float(value)
    return out


def ease(u: float, easing: str) -> float:
    """Eased progress (§4.2.1)."""
    t = clamp(u, 0.0, 1.0)
    if easing == "easeIn":
        return t ** 3
    if easing == "easeOut":
        return 1 - (1 - t) ** 3
    if easing == "easeInOut":
        if t < 0.5:
            return 4 * t ** 3
        return 1 - ((-2 * t + 2) ** 3) / 2
    return t


def resolve_window(motion: Any, clip_duration: float) -> Tuple[float, float]:
    """The (start, duration) motion window in clip-local seconds (§4.2.1).

    `w0` is clamped FIRST so the `wd` clamp can never get min > max (P2-3), and
    it is allowed to be NEGATIVE — that is how a split clip's right half keeps
    running the window that opened before it (P1-5).
    """
    safe_duration = clip_duration if clip_duration and clip_duration > 0 else MIN_WINDOW
    raw_start = float(_motion_field(motion, "start_offset", 0.0) or 0.0)
    # Bound `w0` from ABOVE only: with an implicit duration that is what keeps
    # `clip_duration - w0 >= MIN_WINDOW`. An EXPLICIT duration is deliberately
    # NOT clamped to the clip length — a window longer than its clip is exactly
    # what a split produces (§4.6 / P1-5), and clamping it would make the left
    # half replay the whole motion in its shorter span.
    w0 = min(raw_start, max(0.0, safe_duration - MIN_WINDOW))
    raw_duration = _motion_field(motion, "duration", None)
    wd = (
        max(float(raw_duration), MIN_WINDOW)
        if raw_duration is not None
        else max(MIN_WINDOW, safe_duration - w0)
    )
    return w0, wd


# ---------------------------------------------------------------------------
# Keyframe curves — the Python mirror of `playback/camera/keyframes.ts`
# (camera-motion-keyframe-curves §4.2.1 / §4.2.2 / §4.2.3 / §4.2.7)
# ---------------------------------------------------------------------------


def _stop_easing(raw: Any) -> Optional[str]:
    return raw if raw in EASINGS else None


def _round_at(value: float) -> float:
    """Canonical `at` precision — the exact mirror of the TS `roundAt`.

    `math.floor(x*1e6 + 0.5)` is JS's `Math.round`, deliberately NOT Python's
    `round()` (which is banker's rounding and would disagree on ties).
    """
    return math.floor(value * 1e6 + 0.5) / 1e6


def expand_stops(motion: Any, config: Optional[CameraMotionConfig] = None) -> List[Dict[str, Any]]:
    """View any motion as a stop list. **The only place the backend reads a curve.**

    Return contract (violating it is an implementation error):
      * every item is a PLAIN dict, never a pydantic model;
      * the seven components go through `_keyframe_dict()`, so keys are
        snake_case (`rotate_x` / `rotate_y`) and a missing component takes its
        DEFAULT_KEYFRAME value;
      * plus `at: float` and `easing: Optional[str]`;
      * length >= 2, `at` ascending, `at[0] == 0`, `at[-1] == 1`;
      * anything past `config.max_keyframes` is dropped HERE (ends kept, the
        middle thinned evenly).

    The contract exists because `_piecewise_expr` subscripts these dicts. The
    input may be a `CameraKeyframeStop` (attributes, not subscripts), a bare dict
    or a dict missing components — and one `KeyError`/`TypeError` in the
    expression builder is a 500 on `/api/video/compose`, which is the exact
    opposite of G5's "camera motion never fails an export".
    """
    raw = _motion_field(motion, "keyframes", None)
    limit = max(2, int((config or load_camera_config()).max_keyframes or CAMERA_MAX_KEYFRAMES))
    stops: List[Dict[str, Any]] = []
    if isinstance(raw, (list, tuple)) and len(raw) >= 2:
        for item in raw:
            if item is None:
                continue
            entry = _keyframe_dict(item)
            at_raw = item.get("at") if isinstance(item, dict) else getattr(item, "at", None)
            entry["at"] = _round_at(clamp(float(at_raw), 0.0, 1.0)) if isinstance(at_raw, (int, float)) else 0.0
            easing_raw = item.get("easing") if isinstance(item, dict) else getattr(item, "easing", None)
            entry["easing"] = _stop_easing(easing_raw)
            stops.append(entry)
    if len(stops) < 2:
        # Old two-point motion: `start`/`end` ARE the endpoints (D31), so this
        # expansion makes every downstream formula branch-free.
        first = _keyframe_dict(_motion_field(motion, "start"))
        first["at"] = 0.0
        first["easing"] = _stop_easing(_motion_field(motion, "easing", None))
        last = _keyframe_dict(_motion_field(motion, "end"))
        last["at"] = 1.0
        last["easing"] = None
        return [first, last]

    stops.sort(key=lambda entry: entry["at"])
    stops[0]["at"] = 0.0
    stops[-1]["at"] = 1.0

    kept: List[Dict[str, Any]] = [stops[0]]
    for index in range(1, len(stops)):
        stop = stops[index]
        if stop["at"] - kept[-1]["at"] >= MIN_KEYFRAME_GAP - _GAP_EPSILON:
            kept.append(stop)
            continue
        if index != len(stops) - 1:
            continue
        # The final stop is pinned at 1, so anything crowding it gives way.
        while len(kept) > 1 and stop["at"] - kept[-1]["at"] < MIN_KEYFRAME_GAP - _GAP_EPSILON:
            kept.pop()
        kept.append(stop)

    if len(kept) > limit:
        target = max(0, limit - 2)
        interior = kept[1:-1]
        if target == 0:
            kept = [kept[0], kept[-1]]
        else:
            span = len(interior) - 1
            picked: List[int] = []
            for j in range(target):
                index = round(span / 2) if target == 1 else round((j * span) / (target - 1))
                index = min(span, max(0, int(index)))
                if index not in picked:
                    picked.append(index)
            cursor = 0
            while len(picked) < target and cursor <= span:
                if cursor not in picked:
                    picked.append(cursor)
                cursor += 1
            picked = sorted(picked)[:target]
            kept = [kept[0]] + [interior[i] for i in picked] + [kept[-1]]

    kept[-1]["easing"] = None
    for stop in kept[:-1]:
        if stop["easing"] is None:
            stop["easing"] = _stop_easing(_motion_field(motion, "easing", None)) or "easeInOut"
    return kept


def _segment_index_at(stops: Sequence[Dict[str, Any]], p: float) -> int:
    """The segment containing `p`; an exact interior `at` picks the LEFT one."""
    last = len(stops) - 2
    if last <= 0:
        return 0
    for i in range(last):
        if p <= stops[i + 1]["at"]:
            return i
    return last


def trajectory_samples(motion: Any, config: Optional[CameraMotionConfig] = None) -> List[float]:
    """Sample positions covering the trajectory, every stop included (D43).

    Two stops return `[0, 0.01, …, 1]` element for element — the exact list the
    four call sites used to build inline — so no existing motion's `roll_pad`,
    `cover_scale` or filter string moves by a single bit. With interior stops the
    uniform grid stops hitting the extrema (they sit ON the stops, and the
    shortest legal segment spans only two grid points), which shows up as black
    corners after `rotate` and black wedges around the 3D quad.

    Must stay element-for-element identical to the TS `trajectorySamples`: both
    `roll_pad` and `cover_scale` are compared across languages at 1e-6, and a
    different sample set means a different maximum.
    """
    stops = expand_stops(motion, config)
    if len(stops) == 2:
        return [i / CAMERA_COVER_SAMPLES for i in range(CAMERA_COVER_SAMPLES + 1)]
    segments = len(stops) - 1
    per = max(CAMERA_SEGMENT_SAMPLES, math.ceil(CAMERA_COVER_SAMPLES / segments))
    out: List[float] = []
    for i in range(segments):
        a0 = stops[i]["at"]
        a1 = stops[i + 1]["at"]
        for j in range(per):
            out.append(a0 + (j / per) * (a1 - a0))
    out.append(1.0)
    return out


def tau_at_progress(motion: Any, u: float, config: Optional[CameraMotionConfig] = None) -> float:
    """Linear progress `u` -> trajectory parameter `tau` (§4.2.2).

    This is where easing — per segment — is consumed; everything after it is pure
    geometry. A two-stop motion reduces to `ease(u, motion.easing)` exactly.
    """
    stops = expand_stops(motion, config)
    p = clamp(u, 0.0, 1.0)
    index = _segment_index_at(stops, p)
    a0 = stops[index]["at"]
    a1 = stops[index + 1]["at"]
    span = a1 - a0
    if not span > 0:
        return a1
    s = clamp((p - a0) / span, 0.0, 1.0)
    return a0 + ease(s, stops[index]["easing"] or "easeInOut") * span


def keyframe_at_trajectory(
    motion: Any, tau: float, config: Optional[CameraMotionConfig] = None,
) -> Dict[str, float]:
    """Interpolate then clamp at trajectory parameter `tau` (§4.2.3).

    `intensity` scales the trajectory ABOUT THE FIRST STOP (D35), so
    `intensity = 0` holds the opening framing rather than meaning "no motion".
    With two stops `(frm - base)` is exactly 0.0 and the expression is today's
    `start + (end - start) * intensity * tau` with one factor re-associated —
    equal to a few ULP, not bit for bit. Byte-level zero regression is proved on
    the emitted STRINGS instead (T2 / C21).
    """
    stops = expand_stops(motion, config)
    intensity = clamp(float(_motion_field(motion, "intensity", 1.0)), 0.0, 2.0)
    p = clamp(tau, 0.0, 1.0)
    index = _segment_index_at(stops, p)
    a0 = stops[index]["at"]
    a1 = stops[index + 1]["at"]
    span = a1 - a0
    s = clamp((p - a0) / span, 0.0, 1.0) if span > 0 else 1.0
    out: Dict[str, float] = {}
    for key, (low, high) in CAMERA_RANGES.items():
        base = stops[0][key]
        frm = stops[index][key]
        to = stops[index + 1][key]
        raw = base + (frm - base + (to - frm) * s) * intensity
        out[key] = clamp(raw, low, high)
    return out


def keyframe_at(motion: Any, e: float) -> Dict[str, float]:
    """Interpolate then clamp, component-wise (§4.2.2).

    ⚠️ `e` is the TRAJECTORY parameter, not time and not eased progress (D32).
    The name and signature are kept because `roll_pad_for_motion`,
    `cover_scale_for_motion`, `_needs_zoom_segment` and `_needs_roll_segment` all
    sample "along the whole trajectory", which is precisely what this now means.
    """
    return keyframe_at_trajectory(motion, e)


def roll_cover(roll_deg: float, frame_aspect: float) -> float:
    """Magnification a rect needs so a `roll` rotation leaves no empty corner."""
    a = abs(math.cos(math.radians(roll_deg)))
    b = abs(math.sin(math.radians(roll_deg)))
    aspect = frame_aspect if frame_aspect > 0 else 1.0
    return max(a + b / aspect, a + b * aspect)


def roll_pad_for_motion(
    motion: Any, frame_aspect: float, config: Optional[CameraMotionConfig] = None,
) -> float:
    """Motion-level `RP` (D13). 3D folds roll into Rz, so its RP is always 1."""
    if _motion_field(motion, "mode", "2d") != "2d":
        return 1.0
    need = 1.0
    # Sample SET from `trajectory_samples` (D43); the loop body is unchanged.
    for tau in trajectory_samples(motion, config):
        k = keyframe_at_trajectory(motion, tau, config)
        need = max(need, roll_cover(k["roll"], frame_aspect))
    return clamp(need, ROLL_PAD_RANGE[0], ROLL_PAD_RANGE[1])


def compute_crop_rect(k: Dict[str, float], roll_pad: float) -> Dict[str, float]:
    """Normalized source crop for one keyframe (§4.2.3)."""
    s = clamp(k["scale"] * roll_pad, EFFECTIVE_SCALE_RANGE[0], EFFECTIVE_SCALE_RANGE[1])
    w = roll_pad / s
    h = roll_pad / s
    return {
        "x": clamp(k["x"] - w / 2, 0.0, max(0.0, 1 - w)),
        "y": clamp(k["y"] - h / 2, 0.0, max(0.0, 1 - h)),
        "w": w,
        "h": h,
    }


def _rotate_model_point(p: Tuple[float, float, float], k: Dict[str, float]):
    """``Rz(roll) · Ry(rotate_y) · Rx(rotate_x)`` on a column vector."""
    rx, ry, rz = map(math.radians, (k["rotate_x"], k["rotate_y"], k["roll"]))
    x, y, z = p
    cx, sx = math.cos(rx), math.sin(rx)
    y, z = y * cx - z * sx, y * sx + z * cx
    cy, sy = math.cos(ry), math.sin(ry)
    x, z = x * cy + z * sy, -x * sy + z * cy
    cz, sz = math.cos(rz), math.sin(rz)
    x, y = x * cz - y * sz, x * sz + y * cz
    return x, y, z


def project_3d_corners(
    k: Dict[str, float], frame_aspect: float,
) -> Optional[List[Dict[str, float]]]:
    """Project the plane corners in TL, TR, BL, BR order (§4.2.4).

    Returns ``None`` when any corner reaches the near plane — the caller then
    degrades that clip to its 2D components rather than emitting a broken quad.
    """
    aspect = frame_aspect if frame_aspect > 0 else 1.0
    model = [
        (-aspect / 2, -0.5, 0.0),
        (aspect / 2, -0.5, 0.0),
        (-aspect / 2, 0.5, 0.0),
        (aspect / 2, 0.5, 0.0),
    ]
    zc = CAMERA_D * (1 - k["dolly"])
    pts: List[Dict[str, float]] = []
    for m in model:
        vx, vy, vz = _rotate_model_point(m, k)
        wq = zc + vz
        if not wq > CAMERA_Z_MIN:
            return None
        pts.append({
            "x": 0.5 + (CAMERA_D * vx) / (wq * aspect),
            "y": 0.5 + (CAMERA_D * vy) / wq,
            "q": CAMERA_D / wq,
        })
    return pts


def _ray_segment_t(c, d, p, q) -> Optional[float]:
    ex, ey = q[0] - p[0], q[1] - p[1]
    denom = d[0] * ey - d[1] * ex
    if abs(denom) < 1e-12:
        return None
    px, py = p[0] - c[0], p[1] - c[1]
    t = (px * ey - py * ex) / denom
    s = (px * d[1] - py * d[0]) / denom
    if t <= 0 or s < -1e-9 or s > 1 + 1e-9:
        return None
    return t


def cover_scale_for_quad(pts: Sequence[Dict[str, float]], frame_aspect: float) -> float:
    """How much the quad must grow about the centre to cover the output rect."""
    aspect = frame_aspect if frame_aspect > 0 else 1.0
    poly = [
        (pts[0]["x"] * aspect, pts[0]["y"]),
        (pts[1]["x"] * aspect, pts[1]["y"]),
        (pts[3]["x"] * aspect, pts[3]["y"]),
        (pts[2]["x"] * aspect, pts[2]["y"]),
    ]
    c = (aspect / 2, 0.5)
    need = 1.0
    for corner in ((0.0, 0.0), (aspect, 0.0), (0.0, 1.0), (aspect, 1.0)):
        d = (corner[0] - c[0], corner[1] - c[1])
        best: Optional[float] = None
        for i in range(len(poly)):
            t = _ray_segment_t(c, d, poly[i], poly[(i + 1) % len(poly)])
            if t is None:
                continue
            if best is None or t < best:
                best = t
        if best is None:
            return DEGENERATE
        need = max(need, 1 / best)
    return need


def cover_scale_for_motion(
    motion: Any, frame_aspect: float, config: Optional[CameraMotionConfig] = None,
) -> float:
    """Motion-level `coverScale` (D5) — one constant for the whole window."""
    if _motion_field(motion, "mode", "2d") != "3d":
        return 1.0
    need = 1.0
    # Sample SET from `trajectory_samples` (D43); the loop body is unchanged.
    for tau in trajectory_samples(motion, config):
        k = keyframe_at_trajectory(motion, tau, config)
        pts = project_3d_corners(k, frame_aspect)
        if pts is None:
            return DEGENERATE
        cover = cover_scale_for_quad(pts, frame_aspect)
        if cover == DEGENERATE:
            return DEGENERATE
        need = max(need, cover)
    return need


def scale_quad(pts: Sequence[Dict[str, float]], factor: float) -> List[Dict[str, float]]:
    return [
        {"x": 0.5 + (p["x"] - 0.5) * factor, "y": 0.5 + (p["y"] - 0.5) * factor, "q": p["q"]}
        for p in pts
    ]


def keyframe_equals_default(frame: Dict[str, float]) -> bool:
    return all(abs(frame[key] - DEFAULT_KEYFRAME[key]) <= KEYFRAME_EPSILON for key in DEFAULT_KEYFRAME)


def is_identity_camera_motion(motion: Any) -> bool:
    """§7.2 — `intensity == 0` alone is NOT identity (P1-2).

    ``pull-out`` starts at ``scale = 1.25``; intensity 0 means "hold that static
    1.25x framing", not "no motion". Treating it as no-motion would export the
    un-cropped frame while the panel showed the crop.

    ⚠️ GENERALIZED TO CURVES (camera-motion-keyframe-curves §4.2.5, review P0-1).
    ``k(tau) = S0 + (traj(tau) - S0) * I``, so the motion is the identity iff
    ``S0`` is default AND (``I ~ 0`` OR every stop equals the default). Reading
    only ``start``/``end`` would judge a curve whose ENDPOINTS are default but
    whose middle keyframe pushes to 2x as "no motion" — and this function is the
    FIRST gate in both ``build_camera_filter_chain`` and
    ``build_still_overlay_plan``, both of which return early with NO warning
    (the user did not ask for a motion, so there is nothing to explain). The
    result would be a motion that plays in the panel and in the preview, is
    absent from the render, and is mentioned nowhere. Keep this in lockstep with
    ``identity.ts`` (C29).

    Two-stop motions expand to ``[start, end]``, so this degenerates to today's
    rule with no behaviour change at all.
    """
    if motion is None:
        return True
    stops = expand_stops(motion)
    if not keyframe_equals_default(stops[0]):
        return False
    intensity = float(_motion_field(motion, "intensity", 1.0))
    if abs(intensity) <= KEYFRAME_EPSILON:
        return True
    # `keyframe_equals_default` only reads the seven components; the extra `at` /
    # `easing` keys a stop carries are simply not looked at.
    return all(keyframe_equals_default(stop) for stop in stops)


# ---------------------------------------------------------------------------
# Expression helpers
# ---------------------------------------------------------------------------


def _num(value: float, digits: int = 6) -> str:
    """Format a number for an FFmpeg expression: fixed notation, no exponent.

    Only NUMBERS ever reach a filter graph (R11) — no user-supplied string is
    interpolated anywhere in this module, so there is no injection surface.
    """
    text = f"{value:.{digits}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _progress_expr(time_var: str, fps: int, w0: float, wd: float) -> str:
    """`U = clip((T - w0)/wd, 0, 1)` for the given filter's frame variable."""
    return f"clip(({time_var}/{_num(float(fps))}-{_num(w0)})/{_num(wd)},0,1)"


def _ease_expr(u_expr: str, easing: str) -> str:
    """`E = ease(U)`, inlining `U` (FFmpeg has no per-filter expression vars)."""
    if easing == "easeIn":
        return f"pow({u_expr},3)"
    if easing == "easeOut":
        return f"(1-pow(1-{u_expr},3))"
    if easing == "easeInOut":
        return f"if(lt({u_expr},0.5),4*pow({u_expr},3),1-pow(2-2*{u_expr},3)/2)"
    return f"({u_expr})"


def _component_expr(start: float, end: float, intensity: float, e_expr: str, key: str) -> str:
    """`clip(start + (end-start)*intensity*E, range)` — mirrors keyframe_at."""
    low, high = CAMERA_RANGES[key]
    delta = (end - start) * intensity
    if abs(delta) <= 1e-12:
        return _num(clamp(start, low, high))
    return f"clip({_num(start)}+({_num(delta)})*({e_expr}),{_num(low)},{_num(high)})"


def _piecewise_expr(
    stops: Sequence[Dict[str, Any]],
    key: str,
    intensity: float,
    u_expr: str,
    *,
    low: float,
    high: float,
) -> str:
    """`clip(nested-if(...), low, high)` — the expression mirror of
    `keyframe_at_trajectory` (§4.4.2).

    CORRECTNESS (check this against §4.2.2/§4.2.3 before touching anything):
    inside segment `i`, `tau_at_progress` gives `tau = a0 + ease(s)*(a1-a0)`.
    Feeding that back into `keyframe_at_trajectory` gives
    `s' = (tau-a0)/(a1-a0) = ease(s)`, hence `v = v_i + (v_{i+1}-v_i)*ease(s)`.
    Applying D35's intensity about the FIRST stop:

        k = v0 + (v - v0)*I
          = [v0 + (v_i - v0)*I] + (v_{i+1} - v_i)*I*ease(s)
          = base_i + delta_i*ease(s)

    which is exactly what `seg()` below emits.

    D37: the caller guarantees `len(stops) > 2`. A two-stop motion takes
    `_component_expr`, i.e. TODAY'S code path, so its string is character-
    identical rather than merely "a degenerate case that happens to print the
    same". `u_expr` is supplied by the caller because the frame variable differs
    per filter — `zoompan`/`perspective` have `on`, `rotate` only has `n` — and
    hard-coding one here is precisely the v1 P0-1 bug.
    """
    v0 = stops[0][key]

    def seg(i: int) -> str:
        a0 = stops[i]["at"]
        a1 = stops[i + 1]["at"]
        base = v0 + (stops[i][key] - v0) * intensity
        delta = (stops[i + 1][key] - stops[i][key]) * intensity
        if abs(delta) <= 1e-12 or abs(a1 - a0) <= 1e-12:
            return _num(base)
        local = f"clip(({u_expr}-{_num(a0)})/{_num(a1 - a0)},0,1)"
        return f"{_num(base)}+({_num(delta)})*({_ease_expr(local, stops[i].get('easing') or 'easeInOut')})"

    expr = seg(len(stops) - 2)
    for i in range(len(stops) - 3, -1, -1):
        expr = f"if(lt({u_expr},{_num(stops[i + 1]['at'])}),{seg(i)},{expr})"
    return f"clip({expr},{_num(low)},{_num(high)})"


def _horner(coeffs_low_to_high: Sequence[float], e_expr: str) -> str:
    """`a0+(E)*(a1+(E)*(a2+(E)*a3))` — short and numerically well-behaved."""
    expr = _num(coeffs_low_to_high[-1], 8)
    for coeff in reversed(coeffs_low_to_high[:-1]):
        expr = f"{_num(coeff, 8)}+({e_expr})*({expr})"
    return expr


def _fit_polynomial(
    samples_e: Sequence[float], values: Sequence[float], degree: int,
) -> Tuple[List[float], float]:
    """Least-squares fit, returned low-to-high with the max abs residual."""
    import numpy as np

    coeffs_high_first = np.polyfit(np.asarray(samples_e), np.asarray(values), degree)
    fitted = np.polyval(coeffs_high_first, np.asarray(samples_e))
    max_error = float(np.max(np.abs(fitted - np.asarray(values))))
    return [float(c) for c in reversed(coeffs_high_first.tolist())], max_error


# ---------------------------------------------------------------------------
# Chain builder (§4.4.3)
# ---------------------------------------------------------------------------

#: Corner order matches FFmpeg `perspective`'s x0..x3 → TL, TR, BL, BR.
_PERSPECTIVE_KEYS = [("x0", "y0"), ("x1", "y1"), ("x2", "y2"), ("x3", "y3")]


def _even(value: float) -> int:
    """Round up to the next even integer — yuv420p frames require even dims."""
    n = int(math.ceil(value - 1e-9))
    return n if n % 2 == 0 else n + 1


def _track_expr(
    stops: Sequence[Dict[str, Any]],
    key: str,
    intensity: float,
    u_expr: str,
    e_expr: str,
) -> str:
    """One component's expression, choosing the D37 branch.

    Two stops go through `_component_expr` — literally the pre-curve code — so
    every existing motion's filter string stays character-identical and the
    zero-regression comparison (T2 / C21) keeps its meaning. Anything longer is
    a real curve and takes the nested-`if` builder, which needs the UN-eased
    progress because each segment carries its own easing.
    """
    low, high = CAMERA_RANGES[key]
    if len(stops) == 2:
        return _component_expr(stops[0][key], stops[1][key], intensity, e_expr, key)
    return _piecewise_expr(stops, key, intensity, u_expr, low=low, high=high)


def _needs_zoom_segment(
    motion: Any, roll_pad: float, config: Optional[CameraMotionConfig] = None,
) -> bool:
    """True when the crop is non-identity anywhere in the window.

    NOTE (deviation from spec §4.4.3, recorded in spec §14): this gate is mode-
    INDEPENDENT. §4.4.3 annotates the 2D segment as ``mode=='2d'`` only, but
    §4.3.3 states the preview runs ``crop`` (as the WebGL uv rect) for 3D too and
    that the export order is ``zoompan → perspective``. Skipping zoompan for 3D
    would drop the scale component of e.g. ``parallax-push`` (scale 1 → 1.08)
    from the export while the preview still shows it — a WYSIWYG break.
    """
    for tau in trajectory_samples(motion, config):
        k = keyframe_at_trajectory(motion, tau, config)
        crop = compute_crop_rect(k, roll_pad)
        if abs(crop["w"] - 1.0) > 1e-6 or abs(crop["x"]) > 1e-6 or abs(crop["y"]) > 1e-6:
            return True
    return False


def _needs_roll_segment(motion: Any, config: Optional[CameraMotionConfig] = None) -> bool:
    if _motion_field(motion, "mode", "2d") != "2d":
        return False
    for tau in trajectory_samples(motion, config):
        if abs(keyframe_at_trajectory(motion, tau, config)["roll"]) > 1e-6:
            return True
    return False


def _fit_corner_tracks(
    tracks: Dict[str, List[float]],
    samples_e: Sequence[float],
    config: CameraMotionConfig,
    label: str,
    warnings: List[str],
) -> Optional[Dict[str, List[float]]]:
    """Least-squares fit all eight corner tracks, with the configured retry.

    Returns ``None`` (having appended a warning) when even the fallback degree
    misses ``max_fit_error_px`` — the caller then drops to the 2D components.
    """
    degrees = [config.poly_degree]
    if config.poly_degree_fallback:
        degrees.append(config.poly_degree_fallback)

    worst = 0.0
    for degree in degrees:
        try:
            candidate: Dict[str, List[float]] = {}
            worst = 0.0
            for key, values in tracks.items():
                coeffs, error = _fit_polynomial(samples_e, values, degree)
                candidate[key] = coeffs
                worst = max(worst, error)
        except Exception as exc:
            warnings.append(f"{label}: 3D trajectory fit failed ({exc}); rendered as 2D")
            return None
        if worst <= config.max_fit_error_px:
            return candidate

    warnings.append(
        f"{label}: 3D trajectory fit error {worst:.2f}px exceeds "
        f"{config.max_fit_error_px}px; rendered as 2D"
    )
    return None


def _build_perspective_segment(
    motion: Any, frame_w: int, frame_h: int, fps: int, w0: float, wd: float,
    easing: str, config: CameraMotionConfig, label: str, warnings: List[str],
) -> Optional[str]:
    """Fit the 3D corner trajectories and emit the `perspective` filter.

    Returns ``None`` (with a warning) when the quad degenerates or the fit is
    worse than ``max_fit_error_px`` — the clip then keeps its 2D components.

    Two shapes (D39):
      * two stops — the whole window, one cubic per corner, exactly the v1 code,
        so the emitted string does not move;
      * a curve — each SEGMENT gets its own fit and they are nested with
        ``if(lt(U, at_i), …)``. A piecewise path has corners at the keyframes, and
        one cubic across the whole window would blow past ``max_fit_error_px``
        every time, degrading multi-keyframe 3D to 2D as a matter of course.
        Per segment the path is a smooth homography again, so the fit is no
        harder than today's.
    """
    aspect = frame_w / frame_h
    cover = cover_scale_for_motion(motion, aspect, config)
    if cover == DEGENERATE:
        warnings.append(f"{label}: 3D camera motion degenerated (corner behind camera); rendered as 2D")
        return None

    stops = expand_stops(motion, config)
    samples_e = [i / (POLY_FIT_SAMPLES - 1) for i in range(POLY_FIT_SAMPLES)]
    interpolation = config.interpolation if config.interpolation in ("linear", "cubic") else "linear"
    u_expr = _progress_expr("on", fps, w0, wd)

    def corner_tracks(tau_of: Any) -> Optional[Dict[str, List[float]]]:
        tracks: Dict[str, List[float]] = {key: [] for pair in _PERSPECTIVE_KEYS for key in pair}
        for sample in samples_e:
            pts = project_3d_corners(keyframe_at_trajectory(motion, tau_of(sample), config), aspect)
            if pts is None:
                warnings.append(f"{label}: 3D camera motion degenerated mid-window; rendered as 2D")
                return None
            # `cover` stays a motion-level constant (D5) — it is the maximum over
            # the WHOLE trajectory, so per-segment fitting cannot change it.
            scaled = scale_quad(pts, cover)
            for index, (kx, ky) in enumerate(_PERSPECTIVE_KEYS):
                tracks[kx].append(scaled[index]["x"] * frame_w)
                tracks[ky].append(scaled[index]["y"] * frame_h)
        return tracks

    if len(stops) == 2:
        tracks = corner_tracks(lambda sample: sample)
        if tracks is None:
            return None
        fitted = _fit_corner_tracks(tracks, samples_e, config, label, warnings)
        if fitted is None:
            return None
        # `perspective` DOES expose `on`, but only with eval=frame.
        e_expr = _ease_expr(u_expr, easing)
        parts = [f"{key}='{_horner(fitted[key], e_expr)}'" for pair in _PERSPECTIVE_KEYS for key in pair]
        return "perspective=" + ":".join(parts) + f":sense=destination:eval=frame:interpolation={interpolation}"

    # Per-segment fits. The fit variable is the segment's EASED local progress,
    # so the easing lives in the expression and the polynomial only has to
    # describe the geometry — the same split the 2D path gets from `_ease_expr`.
    segment_exprs: Dict[str, List[str]] = {key: [] for pair in _PERSPECTIVE_KEYS for key in pair}
    for index in range(len(stops) - 1):
        a0 = stops[index]["at"]
        a1 = stops[index + 1]["at"]
        tracks = corner_tracks(lambda sample, a0=a0, a1=a1: a0 + sample * (a1 - a0))
        if tracks is None:
            return None
        fitted = _fit_corner_tracks(tracks, samples_e, config, label, warnings)
        if fitted is None:
            return None
        local = f"clip(({u_expr}-{_num(a0)})/{_num(a1 - a0)},0,1)"
        local_e = _ease_expr(local, stops[index].get("easing") or "easeInOut")
        for key in segment_exprs:
            segment_exprs[key].append(_horner(fitted[key], local_e))

    parts: List[str] = []
    for pair in _PERSPECTIVE_KEYS:
        for key in pair:
            exprs = segment_exprs[key]
            expr = exprs[-1]
            for index in range(len(exprs) - 2, -1, -1):
                expr = f"if(lt({u_expr},{_num(stops[index + 1]['at'])}),{exprs[index]},{expr})"
            parts.append(f"{key}='{expr}'")
    return "perspective=" + ":".join(parts) + f":sense=destination:eval=frame:interpolation={interpolation}"


def _collapse_to_two_stops(motion: Any) -> Dict[str, Any]:
    """A shallow copy of `motion` WITHOUT `keyframes` (D40's one-level degrade).

    The endpoints survive on `start`/`end` thanks to the D31 mirror, so the
    collapsed motion still opens and closes on the user's own framing — the
    smallest possible information loss. Returning a plain dict is deliberate:
    `_motion_field` reads dicts and models alike, and a dict cannot carry a
    `keyframes` attribute back in by accident.
    """
    out: Dict[str, Any] = {
        "version": _motion_field(motion, "version", 1),
        "mode": _motion_field(motion, "mode", "2d"),
        "preset_id": _motion_field(motion, "preset_id", "custom"),
        "intensity": _motion_field(motion, "intensity", 1.0),
        "easing": _motion_field(motion, "easing", "easeInOut"),
        "start": _keyframe_dict(_motion_field(motion, "start")),
        "end": _keyframe_dict(_motion_field(motion, "end")),
    }
    start_offset = _motion_field(motion, "start_offset", None)
    if start_offset is not None:
        out["start_offset"] = start_offset
    duration = _motion_field(motion, "duration", None)
    if duration is not None:
        out["duration"] = duration
    return out


def build_camera_filter_chain(
    motion: Any,
    frame_w: int,
    frame_h: int,
    fps: int,
    clip_duration: float,
    caps: Optional[CameraFilterCaps] = None,
    config: Optional[CameraMotionConfig] = None,
    label: str = "clip",
    allow_collapse: bool = True,
) -> Tuple[str, List[str]]:
    """Build the FFmpeg filter chain for one clip's camera motion.

    Returns ``(chain, warnings)``. ``chain`` is ``''`` whenever there is nothing
    to do (no motion / identity motion / feature disabled / no usable filters),
    and an empty chain leaves ``build_video_filter``'s output character-identical
    to the pre-feature behaviour — the zero-regression guarantee (§4.4.2 / C8).

    ``frame_w``/``frame_h`` are ``scaling_params['scale_width'/'scale_height']``
    (the CONTENT rect, i.e. after scale and before pad) so the aspect matches the
    preview's fit-rect exactly (§4.2 preamble).

    ``allow_collapse`` is D40's one-level degrade switch. The recursive call
    passes ``False``; it is an explicit parameter rather than real recursion so
    no future edit can turn "degrade once" into an unbounded loop.
    """
    warnings: List[str] = []
    config = config or load_camera_config()
    caps = caps or CameraFilterCaps()

    if motion is None or is_identity_camera_motion(motion):
        return "", warnings
    if not config.enabled:
        warnings.append(f"{label}: camera motion is disabled on the server; rendered without motion")
        return "", warnings
    if frame_w <= 0 or frame_h <= 0 or fps <= 0:
        return "", warnings
    if not caps.scale:
        warnings.append(f"{label}: FFmpeg has no 'scale' filter; rendered without camera motion")
        return "", warnings

    mode = _motion_field(motion, "mode", "2d")
    easing = str(_motion_field(motion, "easing", "easeInOut"))
    intensity = clamp(float(_motion_field(motion, "intensity", 1.0)), 0.0, 2.0)
    stops = expand_stops(motion, config)
    w0, wd = resolve_window(motion, clip_duration)
    aspect = frame_w / frame_h

    # The config is threaded through so the maxima are taken over EXACTLY the
    # stop list the chain is built from: `max_keyframes` truncates inside
    # `expand_stops`, so an operator who lowers it would otherwise get a
    # `roll_pad` computed for keyframes that no longer reach the filter.
    roll_pad = roll_pad_for_motion(motion, aspect, config)
    needs_roll = _needs_roll_segment(motion, config)
    needs_zoom = _needs_zoom_segment(motion, roll_pad, config)

    if needs_roll and not (caps.rotate and caps.crop):
        warnings.append(f"{label}: FFmpeg lacks 'rotate'/'crop'; the roll component was dropped")
        needs_roll = False
        roll_pad = 1.0
        # Recompute: without the roll pad the crop rect changes.
        needs_zoom = _needs_zoom_segment(motion, roll_pad, config)
    if needs_zoom and not caps.zoompan:
        warnings.append(f"{label}: FFmpeg has no 'zoompan'; the zoom/pan component was dropped")
        needs_zoom = False

    perspective_segment: Optional[str] = None
    if mode == "3d":
        if not caps.perspective:
            warnings.append(f"{label}: FFmpeg has no 'perspective' filter; 3D motion rendered as 2D")
        else:
            perspective_segment = _build_perspective_segment(
                motion, frame_w, frame_h, fps, w0, wd, easing, config, label, warnings,
            )

    if not needs_zoom and not needs_roll and perspective_segment is None:
        return "", warnings

    # `fps` at the head forces CFR so `on/F` is exactly the presentation time.
    parts: List[str] = ["setpts=PTS-STARTPTS", f"fps={fps}"]

    supersample = int(clamp(float(config.supersample or 1), 1, 3))
    up = (supersample if needs_zoom else 1) * (roll_pad if needs_roll else 1.0)

    if needs_zoom or needs_roll:
        up_w = _even(frame_w * up)
        up_h = _even(frame_h * up)
        parts.append(f"scale={up_w}:{up_h}:flags=bicubic")

        if needs_zoom:
            # zoompan exposes `on` (output frame number).
            u_expr = _progress_expr("on", fps, w0, wd)
            e_expr = _ease_expr(u_expr, easing)
            scale_expr = _track_expr(stops, "scale", intensity, u_expr, e_expr)
            # `z` is the zoom relative to the CONTENT rect: S/RP. The RP part of
            # the magnification is delivered by the crop-back below, and the two
            # multiply back to exactly S = clamp(scale·RP, 1, 8) from §4.2.3.
            z_expr = f"clip(({scale_expr})*{_num(roll_pad)},1,8)/{_num(roll_pad)}"
            cx_expr = _track_expr(stops, "x", intensity, u_expr, e_expr)
            cy_expr = _track_expr(stops, "y", intensity, u_expr, e_expr)
            x_expr = f"clip(({cx_expr})*iw*({z_expr})-ow/2,0,iw*({z_expr})-ow)"
            y_expr = f"clip(({cy_expr})*ih*({z_expr})-oh/2,0,ih*({z_expr})-oh)"
            parts.append(
                f"zoompan=z='{z_expr}':x='{x_expr}':y='{y_expr}'"
                f":d=1:fps={fps}:s={up_w}x{up_h}"
            )

        if needs_roll:
            # ⚠️ `rotate` has NO `on` variable — use `n` (P0-1, measured). The
            # piecewise builder takes the frame variable through `u_expr` for
            # exactly this reason; it must never hard-code one.
            roll_u = _progress_expr("n", fps, w0, wd)
            roll_e = _ease_expr(roll_u, easing)
            roll_expr = _track_expr(stops, "roll", intensity, roll_u, roll_e)
            parts.append(f"rotate=a='({roll_expr})*PI/180':c=black:ow=iw:oh=ih")
            # Crop back the central 1/RP. `RP >= rollCover` guarantees this
            # window has no empty corner (D13; measured: a white frame's
            # top-left 8x8 YAVG stays 235 instead of collapsing to 16).
            rp = _num(roll_pad)
            parts.append(f"crop=iw/{rp}:ih/{rp}:(iw-iw/{rp})/2:(ih-ih/{rp})/2")

        parts.append(f"scale={frame_w}:{frame_h}:flags=bicubic")

    if perspective_segment:
        parts.append(perspective_segment)

    chain = ",".join(parts)

    # D40 — the length gate, on the ASSEMBLED chain (review P2-3: `z_expr` is
    # inlined into `x_expr` and `y_expr` twice each, so a scale curve appears
    # five times in one zoompan and length is nowhere near linear in the stop
    # count). Over the ceiling we drop to a two-keyframe motion — the user's
    # opening and closing framing survive — instead of dropping the motion or,
    # worse, failing the export (G5).
    if allow_collapse and len(chain) > config.max_expr_chars and len(stops) > 2:
        warnings.append(
            f"{label}: camera curve is too complex for the export filter "
            f"({len(chain)} chars > {config.max_expr_chars}); "
            f"rendered as a two-keyframe motion"
        )
        collapsed_chain, collapsed_warnings = build_camera_filter_chain(
            _collapse_to_two_stops(motion), frame_w, frame_h, fps, clip_duration,
            caps=caps, config=config, label=label,
            allow_collapse=False,
        )
        # ⚠️ EXTEND, never return the recursive result directly (review P0-3).
        # The recursive call builds a FRESH warnings list, so returning it would
        # throw away the degrade notice just appended above AND everything this
        # call already accumulated (`no zoompan`, `3D degenerated`, `fit error`).
        # The user would see a render that differs from the preview with nothing
        # said about it anywhere — the exact failure G5 exists to prevent.
        warnings.extend(collapsed_warnings)
        return collapsed_chain, warnings
    # If the collapsed chain is STILL over the ceiling (a few hundred characters
    # in practice, so this cannot happen), it is returned as-is rather than
    # degraded again: `video_composition_service` already retries without the
    # camera chain on a non-zero return code. Returning `""` here would add one
    # more silent path for a motion to disappear down.

    return chain, warnings


# ---------------------------------------------------------------------------
# Still-image overlay plan (camera-motion-stills §4.4.2)
# ---------------------------------------------------------------------------


def contain_fit(nat_w: int, nat_h: int, box_w: int, box_h: int) -> Tuple[int, int]:
    """The content rect an image occupies after `contain` inside its box.

    Equivalent to FFmpeg's ``scale=box_w:box_h:force_original_aspect_ratio=
    decrease``; we compute it explicitly because the camera chain needs literal
    numbers (``zoompan``'s ``s=WxH`` and ``perspective``'s corner coordinates
    cannot be expressed with run-time variables other than ``iw``/``ih``).

    Returns ``(0, 0)`` on any non-positive input — the caller then drops the
    motion for that image instead of raising (R22: an unreadable image must
    never fail the whole export).

    ``_even`` rounds UP, so the result could in principle exceed the box and make
    the following ``pad`` fail with "Padded dimensions cannot be smaller than
    input dimensions". It cannot: ``k = min(box_w/nat_w, box_h/nat_h)`` puts both
    sides at ``<= box``, and for an EVEN integer ``box``, ``x <= box`` implies
    ``_even(x) <= box`` (``ceil(x) <= box``; if ``ceil(x) == box - 1`` it is odd
    and the +1 lands exactly on ``box``). Anchor: ``contain_fit(1919, 1080, 1920,
    1080) == (1920, 1080)`` — flush with the edge, never past it.
    """
    if nat_w <= 0 or nat_h <= 0 or box_w <= 0 or box_h <= 0:
        return (0, 0)
    k = min(box_w / nat_w, box_h / nat_h)
    return (_even(nat_w * k), _even(nat_h * k))


#: At or above this the image is treated as fully opaque (no alpha filters).
OPAQUE_THRESHOLD = 0.999


def _opacity_filter(opacity: float) -> str:
    """Multiply the image alpha; the overlay blends with it (EXO-02)."""
    return f"colorchannelmixer=aa={opacity:.4f}"


def still_static_chain(box_w: int, box_h: int, opacity: float = 1.0) -> str:
    """The legacy, motion-free image filter chain — character for character.

    This is the zero-regression contract (D16 / C11): the string between the
    ``[k:v]`` and ``[imgN]`` labels for an OPAQUE image WITHOUT camera motion
    must be byte-identical to the inline f-strings this constructor replaced,
    so "no motion" is provably free rather than merely believed to be. A
    translucent image converts to RGBA first so the padding stays transparent
    and the opacity multiplies a real alpha channel.
    """
    if opacity >= OPAQUE_THRESHOLD:
        return (
            f"scale={box_w}:{box_h}:force_original_aspect_ratio=decrease,"
            f"pad={box_w}:{box_h}:(ow-iw)/2:(oh-ih)/2:black@0"
        )
    return (
        f"scale={box_w}:{box_h}:force_original_aspect_ratio=decrease,format=rgba,"
        f"pad={box_w}:{box_h}:(ow-iw)/2:(oh-ih)/2:color=black@0,"
        f"{_opacity_filter(opacity)}"
    )


@dataclass(frozen=True)
class StillOverlayPlan:
    """One image's complete plan inside the overlay filtergraph."""

    #: Input options for THIS input, e.g. ``['-loop','1','-t','8.000',...]``.
    #: They must be emitted immediately before the ``-i`` they modify (D27).
    input_args: List[str]
    #: The filter chain between the ``[k:v]`` and ``[imgN]`` labels.
    chain: str
    #: Appended after ``overlay=x:y:enable=...`` (e.g. ``':eof_action=pass'``).
    overlay_suffix: str
    warnings: List[str]
    #: True only when a camera chain was actually injected.
    animated: bool


def _static_plan(
    box_w: int, box_h: int, warnings: List[str], opacity: float = 1.0,
) -> StillOverlayPlan:
    return StillOverlayPlan(
        input_args=[],
        chain=still_static_chain(box_w, box_h, opacity),
        overlay_suffix="",
        warnings=warnings,
        animated=False,
    )


def build_still_overlay_plan(
    motion: Any,
    *,
    nat_w: int,
    nat_h: int,
    box_w: int,
    box_h: int,
    fps: int,
    duration: float,
    start_time: float,
    caps: CameraFilterCaps,
    label: str,
    ffmpeg_path: str,
    config: Optional[CameraMotionConfig] = None,
    opacity: float = 1.0,
) -> StillOverlayPlan:
    """Build the overlay branch for ONE image (camera-motion-stills §4.4.2).

    ``opacity`` below :data:`OPAQUE_THRESHOLD` multiplies the image alpha on
    every branch, static or animated (round 2, EXO-02).

    The single constructor behind both image-overlay call sites (D16 / H3):
    injecting the motion in only one of them would make camera motion vanish as
    soon as the project also has subtitles — an almost un-diagnosable WYSIWYG
    break.

    ``caps`` / ``label`` / ``ffmpeg_path`` deliberately have NO defaults (D26 /
    review P0-2, P1-6). ``CameraFilterCaps()`` defaults every field to True, so a
    ``caps=None`` fallback would not be conservative — it would assert that every
    filter exists on every machine and silently disable the "probe missing →
    degrade" path G4 promises. A missing ``label`` would likewise make every
    still warning read the same, leaving the user unable to tell WHICH image was
    degraded. Both mistakes belong in the type checker, not in someone's export.
    """
    warnings: List[str] = []
    config = config or load_camera_config()

    # The user did not ask for motion — nothing to explain.
    if motion is None or is_identity_camera_motion(motion):
        return _static_plan(box_w, box_h, warnings, opacity)

    if not config.stills_enabled:
        warnings.append(
            f"{label}: still-image camera motion is disabled on the server; "
            f"rendered without motion"
        )
        return _static_plan(box_w, box_h, warnings, opacity)

    if nat_w <= 0 or nat_h <= 0:
        warnings.append(
            f"{label}: could not read the image dimensions; rendered without camera motion"
        )
        return _static_plan(box_w, box_h, warnings, opacity)

    if nat_w * nat_h > config.stills_max_source_pixels:
        warnings.append(
            f"{label}: image is {nat_w}x{nat_h}, above the "
            f"{config.stills_max_source_pixels}px camera-motion limit; "
            f"rendered without motion"
        )
        return _static_plan(box_w, box_h, warnings, opacity)

    cw, ch = contain_fit(nat_w, nat_h, box_w, box_h)
    if cw <= 0 or ch <= 0:
        warnings.append(
            f"{label}: the image frame is too small for camera motion; "
            f"rendered without motion"
        )
        return _static_plan(box_w, box_h, warnings, opacity)

    # The math kernel is shared with video verbatim — stills only feed it the
    # right "content rect" (§4.2). No new geometry, no second implementation.
    chain, chain_warnings = build_camera_filter_chain(
        motion=motion,
        frame_w=cw,
        frame_h=ch,
        fps=fps,
        clip_duration=duration,
        caps=caps,
        config=config,
        label=label,
    )
    warnings.extend(chain_warnings)

    # D26: 0.1s lavfi pre-flight. On the video side a bad chain costs one clip's
    # normalize; here it costs a whole-file re-encode of the overlay pass, so
    # this gate is the single highest-value check on the still path.
    if chain and config.dry_run_probe:
        ok, first_error = dry_run_chain(chain, ffmpeg_path)
        if not ok:
            logger.error(f"Still camera filter dry-run failed ({label}): {first_error}")
            warnings.append(
                f"{label}: camera motion filter check failed "
                f"({first_error or 'unknown error'}); rendered without motion"
            )
            chain = ""

    if not chain:
        return _static_plan(box_w, box_h, warnings, opacity)

    # D18: contain-scale → camera → pad. The motion acts on the content rect,
    # exactly like the preview, instead of on a box already padded with
    # transparency (which would dilute the motion and break WYSIWYG).
    # `chain` opens with `setpts=PTS-STARTPTS,fps=F`, so the timeline shift has
    # to come after it.
    parts = [
        f"scale={cw}:{ch}:flags=bicubic",
        chain,
        f"pad={box_w}:{box_h}:(ow-iw)/2:(oh-ih)/2:black@0",
    ]
    if opacity < OPAQUE_THRESHOLD:
        parts.extend(["format=rgba", _opacity_filter(opacity)])
    parts.append(f"setpts=PTS-STARTPTS+{_num(start_time)}/TB")
    return StillOverlayPlan(
        # D17: only an animated image becomes a stream. `zoompan=d=1` emits a
        # single frame for a single-frame input; measured 1 frame vs exactly 90
        # with `-loop 1 -t 3 -framerate 30` (§4.4.5).
        input_args=["-loop", "1", "-t", f"{duration:.3f}", "-framerate", str(fps)],
        chain=",".join(parts),
        # D25: the looped input ends at `-t`; `pass` says so explicitly. Only on
        # the animated branch, so the static string stays byte-identical.
        overlay_suffix=":eof_action=pass",
        warnings=warnings,
        animated=True,
    )
