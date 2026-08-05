"""Multi-track + transition ``-filter_complex`` builder (spec 05 §2.4 / §2.5).

This is the export-side mirror of the Phase-2 preview compositor. It reproduces
the SAME visual semantics the canvas compositor produces (spec 02 §2.2 / §2.4,
`assembleLayers` + `TransitionLayer.alphaFor`) so export is what-you-see-is-
what-you-get:

  - z-order = track order (bottom track drawn first, upper tracks overlaid on
    top), keyed by ``track_z``;
  - per-clip opacity → ``format=rgba,colorchannelmixer=aa=<opacity>`` (the alpha
    the overlay blends with), the FFmpeg analogue of the compositor's
    ``globalAlpha = item.opacity``;
  - ``fade`` transition → FFmpeg ``fade=t=in``/``fade=t=out`` over the clip's
    leading/trailing ``duration`` seconds (the exact window
    ``TransitionLayer.alphaFor`` ramps);
  - ``dissolve`` transition between two temporally-adjacent clips on the SAME
    track → ``xfade=transition=fade`` with ``duration`` = transition duration
    (the cross-dissolve overlap);
  - subtitles are burned in by the caller's existing drawtext chain (reused, not
    reimplemented) — this builder only positions the produced ``[vout]`` label.

PURE string construction: no subprocess, no filesystem. The caller wires the
``-i`` inputs in ``video_inputs`` order, passes the result as
``-filter_complex``, and maps ``output_label``.

When the timeline has no real multi-track overlay AND no transitions, the
builder reports ``can_use_concat=True`` so the caller takes the lighter, already-
proven concat path (spec 05 §2.4 fallback).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List, Optional, Protocol

from .camera_motion import build_motion_filters, plan_from_spec

# Matches TransitionLayer's TIME_EPSILON (spec 01) so boundary arithmetic agrees
# with the preview compositor.
TIME_EPSILON = 0.001


class TransitionLike(Protocol):
    type: str
    duration: float


class ClipLike(Protocol):
    """Duck-typed view of a VideoCompositionItem the builder consumes."""

    id: str
    start_time: float
    duration: float
    clip_start: Optional[float]
    clip_end: Optional[float]
    opacity: Optional[float]
    track_z: Optional[int]
    transition_in: Optional[TransitionLike]
    transition_out: Optional[TransitionLike]
    camera_motion: Optional[Any]


@dataclass
class TrackPlan:
    """One video track's clips, ordered by start_time, with a resolved z."""

    track_id: str
    z: int
    clips: List[ClipLike] = field(default_factory=list)


@dataclass(frozen=True)
class FiltergraphOptions:
    """Knobs for :func:`build_filtergraph`.

    Bundled into an object rather than added as more positional parameters:
    camera motion needs the frame rate, the FFmpeg capability probe and the
    letterbox colour, which would have pushed the signature past this repo's
    5-parameter ceiling.
    """

    #: Inputs were already trimmed + scaled to the canvas by normalization.
    pre_trimmed: bool = False
    #: Output frame rate — camera-motion expressions map frame index to time.
    fps: int = 30
    #: FFmpeg capability probe (see ``ffmpeg_caps``); None assumes full support.
    caps: Any = None
    #: Preview letterbox colour, mirrored as the transparent backdrop's RGB.
    letterbox_color: str = "#000000"


@dataclass(frozen=True)
class FiltergraphResult:
    """Outcome of planning the composite filtergraph."""

    #: True when the timeline is degenerate (single track, no transitions) and
    #: the caller should use the existing concat path instead.
    can_use_concat: bool
    #: The ``-filter_complex`` string (empty when can_use_concat).
    filter_complex: str
    #: The final video label to ``-map`` (e.g. '[vout]'); empty when concat.
    output_label: str
    #: Input ordering: the clip ids in the order the caller must add ``-i``.
    video_inputs: List[str]
    #: Non-fatal degradations to surface to the user (never swallow these).
    warnings: List[str] = field(default_factory=list)


def _clamp01(value: Optional[float]) -> float:
    if value is None:
        return 1.0
    if value <= 0:
        return 0.0
    if value >= 1:
        return 1.0
    return value


def _effective_transition_duration(
    transition: Optional[TransitionLike], clip_duration: float
) -> float:
    """Transition window clamped to >=0 and at most half the clip.

    Mirrors ``TransitionLayer.effectiveDuration`` so a fade-in + fade-out on a
    short clip never overlap into alpha>1 in the middle.
    """
    if transition is None:
        return 0.0
    duration = getattr(transition, "duration", 0.0) or 0.0
    if duration <= 0:
        return 0.0
    return min(duration, clip_duration / 2.0)


def group_tracks(clips: List[ClipLike]) -> List[TrackPlan]:
    """Group clips into per-track plans ordered bottom→top by z.

    z is each track's first clip ``track_z`` when present, else first-seen track
    order — the SAME rule the preview ``buildVideoTrackGroups`` uses (spec 02),
    so export and preview agree on which track is on top. Clips within a track
    are sorted by ``start_time`` (TrackScheduler INV-5).
    """
    by_track: dict[str, TrackPlan] = {}
    order: List[str] = []
    for clip in clips:
        track_id = getattr(clip, "track_id", "") or ""
        plan = by_track.get(track_id)
        if plan is None:
            plan = TrackPlan(track_id=track_id, z=len(order))
            by_track[track_id] = plan
            order.append(track_id)
        plan.clips.append(clip)

    plans: List[TrackPlan] = []
    for index, track_id in enumerate(order):
        plan = by_track[track_id]
        first_z = getattr(plan.clips[0], "track_z", None)
        plan.z = first_z if first_z is not None else index
        plan.clips.sort(key=lambda c: c.start_time)
        plans.append(plan)

    plans.sort(key=lambda p: p.z)
    return plans


def _build_clip_chain(
    input_idx: int,
    clip: ClipLike,
    scale_to: str,
    options: FiltergraphOptions,
    track_needs_alpha: bool = False,
) -> tuple[str, str, List[str]]:
    """Build the filter chain for ONE clip: trim → setpts → 运镜 → fade → opacity.

    Returns ``(chain, out_label, warnings)`` where ``chain`` ends at
    ``[out_label]``. ``scale_to`` is the canvas ``WxH`` (e.g. '1920x1080'); the
    clip is scaled to fit-contain with letterbox padding (matches the
    compositor's fitContain).

    When ``options.pre_trimmed`` the input has ALREADY been trimmed to its clip
    window and scaled to the canvas by an upstream normalization pass; we then
    skip the trim/scale steps (which would double-apply) and keep only the setpts
    reset + transition + opacity steps. The default emits the full self-contained
    chain over an ORIGINAL input — the form the unit tests assert.

    Camera motion is spliced in right after ``setpts`` and before ``fade``: the
    geometry must act on canvas-space frames (which is exactly what the
    normalization pass produced), and the transition alpha must be applied to the
    already-transformed picture — the same order the preview uses (transform,
    then ``globalAlpha``).

    ``track_needs_alpha`` forces ``format=yuva420p`` even on clips without their
    own motion: ``concat`` and ``xfade`` require every input on a track to share
    a pixel format, so one moving clip promotes the whole track (L14).
    """
    clip_start = clip.clip_start if clip.clip_start is not None else 0.0
    clip_end = clip.clip_end if clip.clip_end is not None else (clip_start + clip.duration)
    width, height = scale_to.split("x")

    label = f"v{input_idx}"
    steps: List[str] = []
    warnings: List[str] = []
    if not options.pre_trimmed:
        steps.append(f"trim=start={clip_start}:end={clip_end}")
    steps.append("setpts=PTS-STARTPTS")
    if not options.pre_trimmed:
        steps.append(f"scale={width}:{height}:force_original_aspect_ratio=decrease")
        steps.append(f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black")
        steps.append("setsar=1:1")

    motion_plan = plan_from_spec(getattr(clip, "camera_motion", None))
    if motion_plan is not None:
        emitted = build_motion_filters(
            motion_plan,
            clip.duration,
            (int(width), int(height)),
            options.fps,
            options.caps,
        )
        steps.extend(emitted.filters)
        warnings.extend(emitted.warnings)
    elif track_needs_alpha:
        steps.append("format=yuva420p")

    fade_in = _effective_transition_duration(clip.transition_in, clip.duration)
    if fade_in > TIME_EPSILON:
        steps.append(f"fade=t=in:st=0:d={fade_in}:alpha=1")
    fade_out = _effective_transition_duration(clip.transition_out, clip.duration)
    if fade_out > TIME_EPSILON:
        out_start = max(0.0, clip.duration - fade_out)
        steps.append(f"fade=t=out:st={out_start}:d={fade_out}:alpha=1")

    opacity = _clamp01(clip.opacity)
    if opacity < 1.0 - TIME_EPSILON:
        steps.append("format=rgba")
        steps.append(f"colorchannelmixer=aa={opacity}")

    chain = f"[{input_idx}:v]" + ",".join(steps) + f"[{label}]"
    return chain, label, warnings


def _has_dissolve(clip: ClipLike) -> bool:
    t = clip.transition_in
    if t is not None and getattr(t, "type", None) == "dissolve":
        return True
    t = clip.transition_out
    return t is not None and getattr(t, "type", None) == "dissolve"


def _track_has_camera_motion(plan: TrackPlan) -> bool:
    """Whether any clip on this track carries a camera motion."""
    return any(getattr(clip, "camera_motion", None) is not None for clip in plan.clips)


def _track_needs_filtergraph(plan: TrackPlan) -> bool:
    """Whether a track must take the filtergraph path rather than plain concat.

    Camera motion is a hard trigger (L1): concat copies streams untouched, so a
    single moving clip on an otherwise degenerate timeline would export with the
    effect silently dropped and no error anywhere — the worst failure this
    feature can have, and invisible to anything except a human watching the
    result.
    """
    if _track_has_camera_motion(plan):
        return True
    for clip in plan.clips:
        if _clamp01(clip.opacity) < 1.0 - TIME_EPSILON:
            return True
        if clip.transition_in is not None or clip.transition_out is not None:
            return True
    return False


def build_filtergraph(
    clips: List[ClipLike],
    canvas_width: int,
    canvas_height: int,
    options: Optional[FiltergraphOptions] = None,
) -> FiltergraphResult:
    """Plan the composite ``-filter_complex`` for the video clips.

    Args:
        clips: all video composition items (any number of tracks).
        canvas_width: output width in pixels.
        canvas_height: output height in pixels.
        options: see :class:`FiltergraphOptions`. Defaults reproduce the
            pre-camera-motion behaviour exactly, so a timeline without motion
            yields a byte-identical ``filter_complex`` (M5).

    Returns:
        A :class:`FiltergraphResult`. ``can_use_concat`` is True for the
        degenerate single-track / no-transition case so the caller uses concat —
        never when a clip carries a camera motion.
    """
    opts = options or FiltergraphOptions()
    tracks = group_tracks(clips)
    multi_track = len(tracks) > 1
    any_track_needs_fg = any(_track_needs_filtergraph(t) for t in tracks)
    if not multi_track and not any_track_needs_fg:
        return FiltergraphResult(
            can_use_concat=True, filter_complex="", output_label="", video_inputs=[]
        )

    scale_to = f"{canvas_width}x{canvas_height}"
    parts: List[str] = []
    video_inputs: List[str] = []
    track_labels: List[str] = []
    warnings: List[str] = []

    input_idx = 0
    for plan in tracks:
        clip_labels: List[str] = []
        track_needs_alpha = _track_has_camera_motion(plan)
        for clip in plan.clips:
            chain, label, clip_warnings = _build_clip_chain(
                input_idx, clip, scale_to, opts, track_needs_alpha
            )
            parts.append(chain)
            clip_labels.append(label)
            video_inputs.append(clip.id)
            warnings.extend(clip_warnings)
            input_idx += 1
        track_label = _compose_track(parts, plan, clip_labels, scale_to)
        track_label = _position_track(parts, plan, track_label)
        track_labels.append(track_label)

    output_label = _overlay_tracks(parts, track_labels)
    return FiltergraphResult(
        can_use_concat=False,
        filter_complex=";".join(parts),
        output_label=f"[{output_label}]",
        video_inputs=video_inputs,
        # De-duplicate: one warning per distinct cause, not one per clip.
        warnings=list(dict.fromkeys(warnings)),
    )


def _position_track(parts: List[str], plan: TrackPlan, track_label: str) -> str:
    """Delay a track's composed stream to its first clip's timeline start.

    Each track is built starting at PTS 0; ``tpad`` prepends the leading
    timeline gap so the track lands at the correct composition time before the
    inter-track overlay (the export analogue of the compositor drawing a clip at
    its ``startTime``).
    """
    if not track_label or not plan.clips:
        return track_label
    start = plan.clips[0].start_time
    if start <= TIME_EPSILON:
        return track_label
    out_label = f"pos_{plan.track_id}"
    parts.append(f"[{track_label}]tpad=start_duration={start}[{out_label}]")
    return out_label


def _compose_track(
    parts: List[str], plan: TrackPlan, clip_labels: List[str], scale_to: str
) -> str:
    """Compose a track's clips into a single labelled stream.

    Adjacent clips joined by a ``dissolve`` transition cross-fade via ``xfade``
    with overlap = the transition duration (matching the preview's overlapping
    fade windows). Non-dissolve adjacent clips concatenate. A single-clip track
    passes through unchanged.
    """
    if not clip_labels:
        return ""
    if len(clip_labels) == 1:
        return clip_labels[0]

    width, height = scale_to.split("x")
    current = clip_labels[0]
    cumulative_offset = plan.clips[0].duration
    for index in range(1, len(clip_labels)):
        prev_clip = plan.clips[index - 1]
        clip = plan.clips[index]
        next_label = clip_labels[index]
        out_label = f"trk_{plan.track_id}_{index}"
        if _has_dissolve(clip) or _has_dissolve(prev_clip):
            duration = _effective_transition_duration(
                clip.transition_in or prev_clip.transition_out, clip.duration
            )
            offset = max(0.0, cumulative_offset - duration)
            parts.append(
                f"[{current}][{next_label}]"
                f"xfade=transition=fade:duration={duration}:offset={offset}[{out_label}]"
            )
            cumulative_offset = offset + duration + clip.duration
        else:
            parts.append(f"[{current}][{next_label}]concat=n=2:v=1:a=0[{out_label}]")
            cumulative_offset += clip.duration
        current = out_label
    return current


def _overlay_tracks(parts: List[str], track_labels: List[str]) -> str:
    """Overlay tracks bottom→top; per-clip opacity already folded into alpha."""
    track_labels = [label for label in track_labels if label]
    if not track_labels:
        return ""
    current = track_labels[0]
    if len(track_labels) == 1:
        out = "vout"
        parts.append(f"[{current}]null[{out}]")
        return out
    for index in range(1, len(track_labels)):
        upper = track_labels[index]
        out = "vout" if index == len(track_labels) - 1 else f"ov_{index}"
        parts.append(f"[{current}][{upper}]overlay=0:0:format=auto[{out}]")
        current = out
    return current
