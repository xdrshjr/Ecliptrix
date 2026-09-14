"""Canvas compositor ``-filter_complex`` builder (round 2, S6).

The export-side mirror of the preview compositor. Every video clip is placed at
its real timeline ``start_time`` on a black canvas as long as the timeline:

  - clips are grouped per track and ordered bottom→top by ``track_z`` (the same
    rule as the preview ``buildVideoTrackGroups``);
  - inside a track, clips that touch (within half a frame) form a *contiguous
    run*; a run is concatenated once and shifted to its first clip's start with
    ``setpts=PTS+start/TB``;
  - runs are overlaid on the canvas with ``eof_action=pass``, so an upper track
    shows the lower one outside its own clips — never black before the clip,
    never a frozen last frame after it (EXV-01);
  - gaps inside a track and before its first clip stay black instead of being
    collapsed (EXV-02 / EXV-09), and the canvas lasts until the timeline end,
    not the sum of clip durations (EXV-03);
  - per-clip opacity and ``fade`` / ``dissolve`` transitions become alpha
    ramps (``format=rgba,fade=…:alpha=1,colorchannelmixer``). With a magnetic
    timeline two dissolving clips never overlap, so a dissolve is "fade out +
    fade in", exactly what ``TransitionLayer`` draws in preview. There is no
    ``xfade`` and no ``tpad`` any more (EXV-04 / EXV-05 / EXV-06 / EXV-08).

Only a single track that starts at 0, has no gaps, no alpha and ends exactly at
the timeline end reports ``can_use_concat`` — the caller then concatenates the
planned inputs with the lightweight concat demuxer.

PURE string construction: no subprocess, no filesystem.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import List, Optional, Protocol, Sequence, Tuple

# Matches TransitionLayer's TIME_EPSILON (spec 01) so boundary arithmetic agrees
# with the preview compositor.
TIME_EPSILON = 0.001
#: A canvas command with more inputs than this is refused before it runs: each
#: input costs ~55 MB of decoder memory at 1080p (N-04 / EX3-04).
MAX_CANVAS_INPUTS = 200


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


@dataclass
class TrackPlan:
    """One video track's clips, ordered by start_time, with a resolved z."""

    track_id: str
    z: int
    clips: List[ClipLike] = field(default_factory=list)


@dataclass(frozen=True)
class FiltergraphResult:
    """Outcome of planning the composite filtergraph."""

    #: True when a single gap-free, alpha-free track spans the whole timeline;
    #: the caller concatenates ``video_inputs`` instead of running the graph.
    can_use_concat: bool
    #: The ``-filter_complex`` string (empty when can_use_concat).
    filter_complex: str
    #: The final video label to ``-map`` (e.g. '[vout]'); empty when concat.
    output_label: str
    #: Input ordering: the clip ids in the order the caller must add ``-i``.
    video_inputs: List[str]
    #: Canvas duration in seconds (the timeline end).
    timeline_end: float = 0.0


@dataclass(frozen=True)
class RunPlan:
    """One contiguous run of a track — the unit the canvas overlays (N-04)."""

    track_id: str
    z: int
    clips: Tuple[ClipLike, ...]
    start: float
    duration: float
    #: Any clip has a transition or an opacity below 1, so the run keeps one
    #: input per clip (its alpha ramps are applied per clip).
    needs_alpha: bool


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


def _clip_end(clip: ClipLike) -> float:
    return clip.start_time + clip.duration


def _num(value: float) -> str:
    """Short, stable number for filter options (``0.5``, not ``0.500000``)."""
    return f"{value:.6f}".rstrip("0").rstrip(".") or "0"


def _needs_alpha(clip: ClipLike) -> bool:
    """Opacity below 1 or any effective transition (fade and dissolve alike)."""
    if _clamp01(clip.opacity) < 1.0 - TIME_EPSILON:
        return True
    for transition in (clip.transition_in, clip.transition_out):
        if _effective_transition_duration(transition, clip.duration) > TIME_EPSILON:
            return True
    return False


def _contiguous_runs(clips: List[ClipLike], tolerance: float) -> List[List[ClipLike]]:
    """Split start-sorted clips wherever the next one does not touch the previous.

    Overlapping (malformed) clips also start a new run, so the later clip is
    stacked above instead of shifting everything after it.
    """
    runs: List[List[ClipLike]] = []
    for clip in clips:
        if runs and abs(clip.start_time - _clip_end(runs[-1][-1])) <= tolerance:
            runs[-1].append(clip)
        else:
            runs.append([clip])
    return runs


def _is_plain_contiguous_single_track(
    plans: List[TrackPlan], end: float, tolerance: float
) -> bool:
    if len(plans) != 1 or not plans[0].clips:
        return False
    clips = plans[0].clips
    if any(_needs_alpha(clip) for clip in clips):
        return False
    if clips[0].start_time > tolerance:
        return False
    if len(_contiguous_runs(clips, tolerance)) != 1:
        return False
    return end - _clip_end(clips[-1]) <= tolerance


def _append_clip_chain(
    parts: List[str],
    input_index: int,
    clip: ClipLike,
    width: int,
    height: int,
    pre_trimmed: bool,
    needs_alpha: bool,
) -> str:
    """Filter chain for ONE clip, ending at label ``c{input_index}``.

    ``pre_trimmed`` inputs were already trimmed to their clip window and scaled
    to the canvas by the normalization pass, so only the PTS reset, the exact
    timeline duration and the alpha steps remain.
    """
    steps: List[str] = []
    if not pre_trimmed:
        clip_start = clip.clip_start if clip.clip_start is not None else 0.0
        clip_end = clip.clip_end if clip.clip_end is not None else clip_start + clip.duration
        steps.append(f"trim=start={_num(clip_start)}:end={_num(clip_end)}")
    steps.append("setpts=PTS-STARTPTS")
    if not pre_trimmed:
        steps.append(f"scale={width}:{height}:force_original_aspect_ratio=decrease")
        steps.append(f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black")
        steps.append("setsar=1:1")
    steps.append(f"trim=duration={clip.duration:.6f}")

    if needs_alpha:
        # One format for the whole run: concat needs identical pixel formats.
        steps.append("format=rgba")
        fade_in = _effective_transition_duration(clip.transition_in, clip.duration)
        if fade_in > TIME_EPSILON:
            steps.append(f"fade=t=in:st=0:d={_num(fade_in)}:alpha=1")
        fade_out = _effective_transition_duration(clip.transition_out, clip.duration)
        if fade_out > TIME_EPSILON:
            steps.append(
                f"fade=t=out:st={_num(max(0.0, clip.duration - fade_out))}"
                f":d={_num(fade_out)}:alpha=1"
            )
        opacity = _clamp01(clip.opacity)
        if opacity < 1.0 - TIME_EPSILON:
            steps.append(f"colorchannelmixer=aa={_num(opacity)}")

    label = f"c{input_index}"
    parts.append(f"[{input_index}:v]" + ",".join(steps) + f"[{label}]")
    return label


def _append_run_placement(
    parts: List[str], clip_labels: List[str], start: float, run_index: int
) -> str:
    """Join a run's clips and shift them to the run's timeline start."""
    label = f"r{run_index}"
    if len(clip_labels) == 1:
        parts.append(
            f"[{clip_labels[0]}]settb=AVTB,setpts=PTS+{start:.6f}/TB[{label}]"
        )
        return label
    inputs = "".join(f"[{clip_label}]" for clip_label in clip_labels)
    parts.append(
        f"{inputs}concat=n={len(clip_labels)}:v=1:a=0,"
        f"settb=AVTB,setpts=PTS-STARTPTS+{start:.6f}/TB[{label}]"
    )
    return label


def _overlay_runs_on_base(run_labels: List[str]) -> List[str]:
    """Overlay runs bottom→top on ``[base]``; labels use indices, never track ids."""
    if not run_labels:
        return ["[base]null[vout]"]
    parts: List[str] = []
    current = "base"
    for index, run_label in enumerate(run_labels):
        out = "vout" if index == len(run_labels) - 1 else f"o{index}"
        parts.append(
            f"[{current}][{run_label}]overlay=0:0:eof_action=pass:format=auto[{out}]"
        )
        current = out
    return parts


def _visible_clips(clips: Sequence[ClipLike]) -> List[ClipLike]:
    """Clips that draw anything; a fully transparent clip gets no input at all."""
    return [clip for clip in clips if _clamp01(clip.opacity) > TIME_EPSILON]


def plan_runs(clips: Sequence[ClipLike], fps: int) -> List[RunPlan]:
    """The contiguous runs :func:`build_filtergraph` overlays, bottom track first.

    The caller pre-merges every alpha-free run of several clips into one file
    with the concat demuxer, so the canvas decodes one input per run instead of
    one per clip (N-04: 241 inputs peaked at 16.4 GB). Runs with alpha keep one
    input per clip because their fades and opacity are applied per clip.
    """
    tolerance = 0.5 / max(1, fps)
    runs: List[RunPlan] = []
    for plan in group_tracks(_visible_clips(clips)):
        for run in _contiguous_runs(plan.clips, tolerance):
            start = run[0].start_time
            runs.append(RunPlan(
                track_id=plan.track_id,
                z=plan.z,
                clips=tuple(run),
                start=start,
                duration=_clip_end(run[-1]) - start,
                needs_alpha=any(_needs_alpha(clip) for clip in run),
            ))
    return runs


def pin_to_layer(clip: ClipLike, z: int) -> SimpleNamespace:
    """A read-only view of ``clip`` on a fixed track z.

    Once some runs of a track are merged, the track's first clip may be a merged
    run, so every canvas clip carries the z :func:`group_tracks` resolved.
    """
    return SimpleNamespace(
        id=clip.id, track_id=getattr(clip, "track_id", ""), track_z=z,
        start_time=clip.start_time, duration=clip.duration,
        clip_start=clip.clip_start, clip_end=clip.clip_end, opacity=clip.opacity,
        transition_in=clip.transition_in, transition_out=clip.transition_out,
    )


def merged_run_clip(run: RunPlan, clip_id: str) -> SimpleNamespace:
    """The one alpha-free canvas clip that stands for a run joined into a file."""
    return SimpleNamespace(
        id=clip_id, track_id=run.track_id, track_z=run.z, start_time=run.start,
        duration=run.duration, clip_start=None, clip_end=None, opacity=1.0,
        transition_in=None, transition_out=None,
    )


def build_filtergraph(
    clips: List[ClipLike],
    width: int,
    height: int,
    pre_trimmed: bool = False,
    fps: int = 30,
    timeline_end: Optional[float] = None,
) -> FiltergraphResult:
    """Plan the canvas composite for the video clips.

    Args:
        clips: all video composition items (any number of tracks).
        width / height: output resolution.
        pre_trimmed: inputs were already trimmed and scaled by normalization.
        fps: canvas frame rate; also sets the half-frame gap tolerance.
        timeline_end: where the timeline ends (images, audio and subtitles can
            outlast the last video clip). The canvas is at least that long.
    """
    visible = _visible_clips(clips)
    last_end = max((_clip_end(clip) for clip in visible), default=0.0)
    end = max(last_end, timeline_end or 0.0)
    plans = group_tracks(visible)
    tolerance = 0.5 / max(1, fps)

    if _is_plain_contiguous_single_track(plans, end, tolerance):
        return FiltergraphResult(
            True, "", "", [clip.id for clip in plans[0].clips], end
        )

    parts: List[str] = []
    inputs: List[str] = []
    run_labels: List[str] = []
    for plan in plans:
        for run in _contiguous_runs(plan.clips, tolerance):
            needs_alpha = any(_needs_alpha(clip) for clip in run)
            clip_labels = []
            for clip in run:
                clip_labels.append(_append_clip_chain(
                    parts, len(inputs), clip, width, height, pre_trimmed, needs_alpha,
                ))
                inputs.append(clip.id)
            run_labels.append(_append_run_placement(
                parts, clip_labels, run[0].start_time, len(run_labels),
            ))

    base = f"color=c=black:s={width}x{height}:r={fps}:d={end:.6f},format=yuv420p[base]"
    graph = ";".join([base, *parts, *_overlay_runs_on_base(run_labels)])
    return FiltergraphResult(False, graph, "[vout]", inputs, end)
