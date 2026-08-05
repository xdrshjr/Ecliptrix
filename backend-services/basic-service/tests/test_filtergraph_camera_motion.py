"""Filtergraph integration for camera motion.

Plan: docs/plans/timeline-camera-motion/experiment-plan.md §7.5 / §9.

Two of these tests are guardrails against SILENT failure, the worst mode this
feature has — an export that reports success while the effect is missing:

  * L1 — a lone moving clip on an otherwise degenerate timeline must not take
    the ``concat`` shortcut, which copies streams and drops every filter.
  * M5 — a timeline with NO motion must produce a byte-identical
    ``filter_complex`` to the pre-feature builder, so this feature cannot have
    changed any existing export.

The rest pin the emitted chain: filter order, the transparent pad/crop pair, and
the track-wide pixel-format promotion that keeps ``concat``/``xfade`` legal.
"""

from __future__ import annotations

import pytest

from app.models.video_models import (
    CameraMotionSpec,
    CameraMotionState,
    ClipTransition,
    VideoCompositionItem,
)
from app.services.composition.filtergraph_builder import (
    FiltergraphOptions,
    build_filtergraph,
)


def motion(space: str = "2d", **overrides) -> CameraMotionSpec:
    defaults = dict(
        preset_id="zoom-in",
        space=space,
        from_state=CameraMotionState(scale=1.0),
        to_state=CameraMotionState(scale=1.25),
        easing="ease-in-out",
        start_ratio=0.0,
        end_ratio=1.0,
        intensity=1.0,
    )
    defaults.update(overrides)
    return CameraMotionSpec(**defaults)


def clip(clip_id: str, track_id: str = "t1", **overrides) -> VideoCompositionItem:
    payload = dict(
        id=clip_id,
        name=clip_id,
        url=f"/tmp/{clip_id}.mp4",
        start_time=0.0,
        duration=4.0,
        track_id=track_id,
        clip_start=0.0,
        clip_end=4.0,
        opacity=1.0,
    )
    payload.update(overrides)
    return VideoCompositionItem(**payload)


# --------------------------------------------------------------------------- #
# L1 — camera motion must never fall through to concat
# --------------------------------------------------------------------------- #


def test_single_clip_without_motion_still_uses_concat():
    """Baseline: the degenerate shortcut is intact for untouched timelines."""
    result = build_filtergraph([clip("a")], 1920, 1080)
    assert result.can_use_concat is True
    assert result.filter_complex == ""


def test_camera_motion_forces_the_filtergraph_path(caplog):
    """L1: concat copies streams, so it would drop the effect with no error.

    Single track, no transitions, opacity 1 — every condition for the concat
    shortcut is met EXCEPT the camera motion. If this flips back to True the
    user gets a video that looks untouched and an export that claims success.
    """
    result = build_filtergraph([clip("a", camera_motion=motion())], 1920, 1080)
    assert result.can_use_concat is False
    assert "perspective=" in result.filter_complex


def test_camera_motion_on_any_clip_of_a_track_forces_the_path():
    clips = [clip("a"), clip("b", start_time=4.0, camera_motion=motion())]
    result = build_filtergraph(clips, 1920, 1080)
    assert result.can_use_concat is False


# --------------------------------------------------------------------------- #
# M5 — zero regression for timelines without camera motion
# --------------------------------------------------------------------------- #


def test_no_motion_filtergraph_is_character_identical_to_the_baseline():
    """M5: the exact string the pre-camera-motion builder produced.

    Frozen literally rather than recomputed: a test that rebuilds the expected
    value from the same code cannot detect a change in that code.
    """
    clips = [
        clip("a", opacity=0.5, transition_in=ClipTransition(type="fade", duration=1.0)),
        clip("b", track_id="t2", opacity=1.0),
    ]
    result = build_filtergraph(clips, 1920, 1080)

    assert result.can_use_concat is False
    assert result.filter_complex == (
        "[0:v]trim=start=0.0:end=4.0,setpts=PTS-STARTPTS,"
        "scale=1920:1080:force_original_aspect_ratio=decrease,"
        "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1:1,"
        "fade=t=in:st=0:d=1.0:alpha=1,format=rgba,colorchannelmixer=aa=0.5[v0];"
        "[1:v]trim=start=0.0:end=4.0,setpts=PTS-STARTPTS,"
        "scale=1920:1080:force_original_aspect_ratio=decrease,"
        "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1:1[v1];"
        "[v0][v1]overlay=0:0:format=auto[vout]"
    )
    assert result.output_label == "[vout]"
    assert result.warnings == []


def test_no_motion_emits_no_alpha_format_step():
    """A yuva420p promotion on an untouched timeline would change its encode."""
    result = build_filtergraph([clip("a"), clip("b", track_id="t2")], 1920, 1080)
    assert "yuva420p" not in result.filter_complex


# --------------------------------------------------------------------------- #
# Emitted chain structure
# --------------------------------------------------------------------------- #


def split_unquoted(text: str, separator: str) -> list:
    """Split on ``separator`` only OUTSIDE single quotes.

    Camera-motion expressions legitimately contain ``,`` and ``;`` — a comma
    between an FFmpeg function's arguments, a semicolon between the ``st()``
    statements and the expression that reads them. FFmpeg's own filtergraph
    lexer is quote-aware (verified by rendering such a graph), so the emitted
    string is valid; a naive ``str.split`` here would only test the helper.
    """
    parts, current, quoted = [], [], False
    for char in text:
        if char == "'":
            quoted = not quoted
        if char == separator and not quoted:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    parts.append("".join(current))
    return parts


def _chain_for(clip_item, **option_overrides) -> str:
    options = FiltergraphOptions(pre_trimmed=True, fps=30, **option_overrides)
    # A second track keeps the builder off the concat shortcut for the no-motion
    # control cases, without touching the chain under test.
    result = build_filtergraph([clip_item, clip("z", track_id="t9")], 1920, 1080, options)
    return split_unquoted(result.filter_complex, ";")[0]


def test_motion_is_spliced_after_setpts_and_before_fade():
    """Geometry acts on canvas-space frames; alpha is applied to the result.

    Same order as the preview (transform, then globalAlpha). Reversing it would
    fade the untransformed picture and then move it — visibly different at any
    clip edge carrying a transition.
    """
    chain = _chain_for(
        clip("a", camera_motion=motion(), transition_in=ClipTransition(type="fade", duration=1.0))
    )
    setpts_at = chain.index("setpts=PTS-STARTPTS")
    perspective_at = chain.index("perspective=")
    fade_at = chain.index("fade=t=in")
    assert setpts_at < perspective_at < fade_at


def test_pre_trimmed_chain_has_no_scale_or_pad_of_its_own():
    """The normalization pass already sized the frames (R-P1-1)."""
    chain = _chain_for(clip("a", camera_motion=motion()))
    assert "scale=1920:1080" not in chain
    assert "setsar" not in chain


def test_two_d_motion_needs_no_backdrop_pad():
    """Coverage guarantees a 2D move never exposes the canvas edge."""
    chain = _chain_for(clip("a", camera_motion=motion()))
    assert "format=yuva420p" in chain
    assert "pad=" not in chain
    assert "crop=" not in chain


def test_three_d_motion_pads_transparently_and_crops_back():
    """A black pad would occlude the track below; only transparency can work."""
    spec = motion(
        space="3d",
        preset_id="swing-in",
        from_state=CameraMotionState(scale=1.0, yaw=22),
        to_state=CameraMotionState(scale=1.06, yaw=0),
    )
    chain = _chain_for(clip("a", camera_motion=spec))

    assert "format=yuva420p" in chain
    assert "color=#00000000" in chain
    assert "black" not in chain

    pad_at = chain.index("pad=")
    perspective_at = chain.index("perspective=")
    crop_at = chain.index("crop=")
    assert pad_at < perspective_at < crop_at

    pad_args = split_unquoted(chain[pad_at:], ",")[0].split("=")[1].split(":")
    # The crop step ends the chain, so strip the trailing `[label]`.
    crop_args = split_unquoted(chain[crop_at:], ",")[0].split("[")[0].split("=")[1].split(":")
    margin_x, margin_y = int(pad_args[2]), int(pad_args[3])
    assert margin_x > 0 and margin_y > 0
    # yuv420p subsamples chroma 2x2; an odd offset misaligns the planes.
    assert margin_x % 2 == 0 and margin_y % 2 == 0
    assert int(pad_args[0]) == 1920 + 2 * margin_x
    assert int(pad_args[1]) == 1080 + 2 * margin_y
    # crop must undo exactly what pad added, or the output resolution changes.
    assert crop_args == ["1920", "1080", str(margin_x), str(margin_y)]


def test_track_with_one_moving_clip_promotes_every_sibling(caplog):
    """L14: concat/xfade reject inputs whose pixel formats differ."""
    clips = [
        clip("a", camera_motion=motion()),
        clip("b", start_time=4.0),
        clip("c", start_time=8.0),
    ]
    result = build_filtergraph(clips, 1920, 1080, FiltergraphOptions(pre_trimmed=True, fps=30))
    chains = split_unquoted(result.filter_complex, ";")
    for index in range(3):
        assert "format=yuva420p" in chains[index], f"clip {index} was left in a different format"
    # Only the moving clip warps; the siblings just change format.
    assert chains[0].count("perspective=") == 1
    assert "perspective=" not in chains[1]
    assert "perspective=" not in chains[2]


def test_expressions_reference_the_output_frame_counter():
    chain = _chain_for(clip("a", camera_motion=motion()))
    assert "eval=frame" in chain
    assert "sense=destination" in chain
    assert "on" in chain


def test_static_motion_when_ffmpeg_cannot_evaluate_per_frame():
    """Tier 2: a frozen framing is acceptable — a SILENT one is not."""

    class Caps:
        has_perspective = True
        perspective_supports_eval_frame = False

    options = FiltergraphOptions(pre_trimmed=True, fps=30, caps=Caps())
    result = build_filtergraph([clip("a", camera_motion=motion())], 1920, 1080, options)

    assert "eval=init" in result.filter_complex
    # A frozen framing must not reference the frame counter at all.
    assert "on" not in result.filter_complex.split("perspective=")[1].split(":sense")[0]
    assert result.warnings, "a degraded render MUST be reported to the user"
    assert any("camera_motion_static" in w for w in result.warnings)


def test_missing_perspective_filter_raises_instead_of_dropping_the_effect():
    """Tier 3: fail loudly rather than deliver an effect-free 'success'."""
    from app.services.composition.camera_motion import CameraMotionUnsupportedError

    class Caps:
        has_perspective = False
        perspective_supports_eval_frame = False

    options = FiltergraphOptions(pre_trimmed=True, fps=30, caps=Caps())
    with pytest.raises(CameraMotionUnsupportedError) as excinfo:
        build_filtergraph([clip("a", camera_motion=motion())], 1920, 1080, options)
    # The message has to tell the user what to actually do about it.
    assert "perspective" in str(excinfo.value)
    assert "FFmpeg" in str(excinfo.value)


def test_expression_length_stays_within_the_command_line_budget():
    """L7: the busiest preset's filter must stay far below the hard limit.

    The real bound is the ~32767-character Windows ``CreateProcess`` command
    line, which every argument shares even without a shell; the service also
    diverts graphs over 8 KB into ``-filter_complex_script``. Spiral animates
    yaw, pitch AND roll at once, so it is the worst case: ~4 KB. Constant
    folding and register hoisting are what keep it there — the alternative, a
    piecewise-linear approximation, would be both longer and less accurate.
    """
    spec = motion(
        space="3d",
        preset_id="spiral",
        from_state=CameraMotionState(scale=1.14, yaw=-12, pitch=6, roll=-4),
        to_state=CameraMotionState(scale=1.14, yaw=12, pitch=-6, roll=4),
    )
    chain = _chain_for(clip("a", camera_motion=spec))
    perspective = chain[chain.index("perspective=") :]
    assert len(perspective) < 5000, f"perspective filter is {len(perspective)} chars"


def test_window_must_be_non_empty():
    """An inverted window silently freezes the move, so it is rejected."""
    with pytest.raises(ValueError):
        motion(start_ratio=0.8, end_ratio=0.2)
