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


_config_cache: Optional[CameraMotionConfig] = None


def load_camera_config(config_path: str = "config/camera-motion.yaml") -> CameraMotionConfig:
    """Load the camera-motion config, falling back to built-in defaults.

    Mirrors the repo's existing YAML convention (``yaml.safe_load`` + defaults
    when the file is absent, see ``video_composition_service._load_video_download_config``).
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


def keyframe_at(motion: Any, e: float) -> Dict[str, float]:
    """Interpolate then clamp, component-wise (§4.2.2)."""
    intensity = clamp(float(_motion_field(motion, "intensity", 1.0)), 0.0, 2.0)
    start = _keyframe_dict(_motion_field(motion, "start"))
    end = _keyframe_dict(_motion_field(motion, "end"))
    out: Dict[str, float] = {}
    for key, (low, high) in CAMERA_RANGES.items():
        raw = start[key] + (end[key] - start[key]) * intensity * e
        out[key] = clamp(raw, low, high)
    return out


def roll_cover(roll_deg: float, frame_aspect: float) -> float:
    """Magnification a rect needs so a `roll` rotation leaves no empty corner."""
    a = abs(math.cos(math.radians(roll_deg)))
    b = abs(math.sin(math.radians(roll_deg)))
    aspect = frame_aspect if frame_aspect > 0 else 1.0
    return max(a + b / aspect, a + b * aspect)


def roll_pad_for_motion(motion: Any, frame_aspect: float) -> float:
    """Motion-level `RP` (D13). 3D folds roll into Rz, so its RP is always 1."""
    if _motion_field(motion, "mode", "2d") != "2d":
        return 1.0
    need = 1.0
    for i in range(CAMERA_COVER_SAMPLES + 1):
        k = keyframe_at(motion, i / CAMERA_COVER_SAMPLES)
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


def cover_scale_for_motion(motion: Any, frame_aspect: float) -> float:
    """Motion-level `coverScale` (D5) — one constant for the whole window."""
    if _motion_field(motion, "mode", "2d") != "3d":
        return 1.0
    need = 1.0
    for i in range(CAMERA_COVER_SAMPLES + 1):
        k = keyframe_at(motion, i / CAMERA_COVER_SAMPLES)
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
    """
    if motion is None:
        return True
    if not keyframe_equals_default(_keyframe_dict(_motion_field(motion, "start"))):
        return False
    intensity = float(_motion_field(motion, "intensity", 1.0))
    if abs(intensity) <= KEYFRAME_EPSILON:
        return True
    return keyframe_equals_default(_keyframe_dict(_motion_field(motion, "end")))


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


def _needs_zoom_segment(motion: Any, roll_pad: float) -> bool:
    """True when the crop is non-identity anywhere in the window.

    NOTE (deviation from spec §4.4.3, recorded in spec §14): this gate is mode-
    INDEPENDENT. §4.4.3 annotates the 2D segment as ``mode=='2d'`` only, but
    §4.3.3 states the preview runs ``crop`` (as the WebGL uv rect) for 3D too and
    that the export order is ``zoompan → perspective``. Skipping zoompan for 3D
    would drop the scale component of e.g. ``parallax-push`` (scale 1 → 1.08)
    from the export while the preview still shows it — a WYSIWYG break.
    """
    for i in range(CAMERA_COVER_SAMPLES + 1):
        k = keyframe_at(motion, i / CAMERA_COVER_SAMPLES)
        crop = compute_crop_rect(k, roll_pad)
        if abs(crop["w"] - 1.0) > 1e-6 or abs(crop["x"]) > 1e-6 or abs(crop["y"]) > 1e-6:
            return True
    return False


def _needs_roll_segment(motion: Any) -> bool:
    if _motion_field(motion, "mode", "2d") != "2d":
        return False
    for i in range(CAMERA_COVER_SAMPLES + 1):
        if abs(keyframe_at(motion, i / CAMERA_COVER_SAMPLES)["roll"]) > 1e-6:
            return True
    return False


def _build_perspective_segment(
    motion: Any, frame_w: int, frame_h: int, fps: int, w0: float, wd: float,
    easing: str, config: CameraMotionConfig, label: str, warnings: List[str],
) -> Optional[str]:
    """Fit the 3D corner trajectories and emit the `perspective` filter.

    Returns ``None`` (with a warning) when the quad degenerates or the fit is
    worse than ``max_fit_error_px`` — the clip then keeps its 2D components.
    """
    aspect = frame_w / frame_h
    cover = cover_scale_for_motion(motion, aspect)
    if cover == DEGENERATE:
        warnings.append(f"{label}: 3D camera motion degenerated (corner behind camera); rendered as 2D")
        return None

    samples_e = [i / (POLY_FIT_SAMPLES - 1) for i in range(POLY_FIT_SAMPLES)]
    tracks: Dict[str, List[float]] = {key: [] for pair in _PERSPECTIVE_KEYS for key in pair}
    for e in samples_e:
        pts = project_3d_corners(keyframe_at(motion, e), aspect)
        if pts is None:
            warnings.append(f"{label}: 3D camera motion degenerated mid-window; rendered as 2D")
            return None
        scaled = scale_quad(pts, cover)
        for index, (kx, ky) in enumerate(_PERSPECTIVE_KEYS):
            tracks[kx].append(scaled[index]["x"] * frame_w)
            tracks[ky].append(scaled[index]["y"] * frame_h)

    degrees = [config.poly_degree]
    if config.poly_degree_fallback:
        degrees.append(config.poly_degree_fallback)

    fitted: Optional[Dict[str, List[float]]] = None
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
            fitted = candidate
            break

    if fitted is None:
        warnings.append(
            f"{label}: 3D trajectory fit error {worst:.2f}px exceeds "
            f"{config.max_fit_error_px}px; rendered as 2D"
        )
        return None

    # `perspective` DOES expose `on`, but only with eval=frame.
    e_expr = _ease_expr(_progress_expr("on", fps, w0, wd), easing)
    parts = [f"{key}='{_horner(fitted[key], e_expr)}'" for pair in _PERSPECTIVE_KEYS for key in pair]
    interpolation = config.interpolation if config.interpolation in ("linear", "cubic") else "linear"
    return "perspective=" + ":".join(parts) + f":sense=destination:eval=frame:interpolation={interpolation}"


def build_camera_filter_chain(
    motion: Any,
    frame_w: int,
    frame_h: int,
    fps: int,
    clip_duration: float,
    caps: Optional[CameraFilterCaps] = None,
    config: Optional[CameraMotionConfig] = None,
    label: str = "clip",
) -> Tuple[str, List[str]]:
    """Build the FFmpeg filter chain for one clip's camera motion.

    Returns ``(chain, warnings)``. ``chain`` is ``''`` whenever there is nothing
    to do (no motion / identity motion / feature disabled / no usable filters),
    and an empty chain leaves ``build_video_filter``'s output character-identical
    to the pre-feature behaviour — the zero-regression guarantee (§4.4.2 / C8).

    ``frame_w``/``frame_h`` are ``scaling_params['scale_width'/'scale_height']``
    (the CONTENT rect, i.e. after scale and before pad) so the aspect matches the
    preview's fit-rect exactly (§4.2 preamble).
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
    start = _keyframe_dict(_motion_field(motion, "start"))
    end = _keyframe_dict(_motion_field(motion, "end"))
    w0, wd = resolve_window(motion, clip_duration)
    aspect = frame_w / frame_h

    roll_pad = roll_pad_for_motion(motion, aspect)
    needs_roll = _needs_roll_segment(motion)
    needs_zoom = _needs_zoom_segment(motion, roll_pad)

    if needs_roll and not (caps.rotate and caps.crop):
        warnings.append(f"{label}: FFmpeg lacks 'rotate'/'crop'; the roll component was dropped")
        needs_roll = False
        roll_pad = 1.0
        # Recompute: without the roll pad the crop rect changes.
        needs_zoom = _needs_zoom_segment(motion, roll_pad)
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
            e_expr = _ease_expr(_progress_expr("on", fps, w0, wd), easing)
            scale_expr = _component_expr(start["scale"], end["scale"], intensity, e_expr, "scale")
            # `z` is the zoom relative to the CONTENT rect: S/RP. The RP part of
            # the magnification is delivered by the crop-back below, and the two
            # multiply back to exactly S = clamp(scale·RP, 1, 8) from §4.2.3.
            z_expr = f"clip(({scale_expr})*{_num(roll_pad)},1,8)/{_num(roll_pad)}"
            cx_expr = _component_expr(start["x"], end["x"], intensity, e_expr, "x")
            cy_expr = _component_expr(start["y"], end["y"], intensity, e_expr, "y")
            x_expr = f"clip(({cx_expr})*iw*({z_expr})-ow/2,0,iw*({z_expr})-ow)"
            y_expr = f"clip(({cy_expr})*ih*({z_expr})-oh/2,0,ih*({z_expr})-oh)"
            parts.append(
                f"zoompan=z='{z_expr}':x='{x_expr}':y='{y_expr}'"
                f":d=1:fps={fps}:s={up_w}x{up_h}"
            )

        if needs_roll:
            # ⚠️ `rotate` has NO `on` variable — use `n` (P0-1, measured).
            roll_e = _ease_expr(_progress_expr("n", fps, w0, wd), easing)
            roll_expr = _component_expr(start["roll"], end["roll"], intensity, roll_e, "roll")
            parts.append(f"rotate=a='({roll_expr})*PI/180':c=black:ow=iw:oh=ih")
            # Crop back the central 1/RP. `RP >= rollCover` guarantees this
            # window has no empty corner (D13; measured: a white frame's
            # top-left 8x8 YAVG stays 235 instead of collapsing to 16).
            rp = _num(roll_pad)
            parts.append(f"crop=iw/{rp}:ih/{rp}:(iw-iw/{rp})/2:(ih-ih/{rp})/2")

        parts.append(f"scale={frame_w}:{frame_h}:flags=bicubic")

    if perspective_segment:
        parts.append(perspective_segment)

    return ",".join(parts), warnings
