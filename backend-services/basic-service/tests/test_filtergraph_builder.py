"""Tests for the multi-track + transition filtergraph builder (spec 05 §6.5).

These pin the EXPORT-side semantics that must mirror the Phase-2 preview
compositor (spec 02): z-order = track order, per-clip opacity →
colorchannelmixer alpha, dissolve → xfade with overlap = transition duration,
clip trim/setpts, and the no-multi-track concat fallback.
"""

from app.services.composition.filtergraph_builder import (
    FiltergraphOptions,
    build_filtergraph,
    group_tracks,
)


class FakeTransition:
    def __init__(self, type_: str, duration: float):
        self.type = type_
        self.duration = duration


class FakeClip:
    """Minimal duck-typed VideoCompositionItem the builder consumes."""

    def __init__(
        self,
        id,
        track_id,
        start_time,
        duration,
        clip_start=0.0,
        clip_end=None,
        opacity=1.0,
        track_z=None,
        transition_in=None,
        transition_out=None,
    ):
        self.id = id
        self.track_id = track_id
        self.start_time = start_time
        self.duration = duration
        self.clip_start = clip_start
        self.clip_end = clip_end if clip_end is not None else clip_start + duration
        self.opacity = opacity
        self.track_z = track_z
        self.transition_in = transition_in
        self.transition_out = transition_out


def test_single_track_no_transition_uses_concat_fallback():
    clips = [
        FakeClip("a", "t1", 0.0, 5.0),
        FakeClip("b", "t1", 5.0, 5.0),
    ]
    result = build_filtergraph(clips, 1920, 1080)
    assert result.can_use_concat is True
    assert result.filter_complex == ""
    assert result.output_label == ""


def test_clip_trim_and_setpts_emitted_for_original_inputs():
    clips = [
        FakeClip("a", "t1", 0.0, 3.0, clip_start=2.0, clip_end=5.0, opacity=0.5),
    ]
    result = build_filtergraph(clips, 1920, 1080)
    assert result.can_use_concat is False
    # Clip window is trimmed and PTS reset (spec 01 clip semantics).
    assert "trim=start=2.0:end=5.0" in result.filter_complex
    assert "setpts=PTS-STARTPTS" in result.filter_complex
    # Scaled fit-contain to the canvas (matches compositor fitContain).
    assert "scale=1920:1080:force_original_aspect_ratio=decrease" in result.filter_complex


def test_pre_trimmed_skips_trim_and_scale():
    clips = [FakeClip("a", "t1", 0.0, 3.0, opacity=0.5)]
    # `pre_trimmed` moved into FiltergraphOptions when camera motion needed to
    # pass fps / caps / letterbox colour too; the keyword form no longer exists.
    result = build_filtergraph(clips, 1920, 1080, FiltergraphOptions(pre_trimmed=True))
    assert "trim=" not in result.filter_complex
    assert "scale=" not in result.filter_complex
    # Opacity is still folded in (the part that survives normalization).
    assert "colorchannelmixer=aa=0.5" in result.filter_complex


def test_per_clip_opacity_maps_to_colorchannelmixer_alpha():
    clips = [
        FakeClip("base", "t1", 0.0, 5.0),
        FakeClip("top", "t2", 0.0, 5.0, opacity=0.4),
    ]
    result = build_filtergraph(clips, 1280, 720)
    # The upper clip's opacity becomes the rgba alpha multiplier — the export
    # analogue of the compositor's globalAlpha = item.opacity.
    assert "format=rgba" in result.filter_complex
    assert "colorchannelmixer=aa=0.4" in result.filter_complex
    # The fully-opaque base clip is NOT given an alpha multiplier.
    assert result.filter_complex.count("colorchannelmixer=aa=") == 1


def test_two_track_overlay_orders_bottom_to_top_by_track_z():
    # track_z drives z-order; lower z draws first (bottom), higher overlays.
    clips = [
        FakeClip("top", "t_top", 0.0, 5.0, track_z=5, opacity=0.5),
        FakeClip("bottom", "t_bottom", 0.0, 5.0, track_z=1),
    ]
    result = build_filtergraph(clips, 1920, 1080)
    assert result.can_use_concat is False
    assert "overlay=" in result.filter_complex
    # Bottom track's clip (track_z=1) is added as an input BEFORE the top one.
    assert result.video_inputs.index("bottom") < result.video_inputs.index("top")
    # The final overlay output is mapped.
    assert result.output_label == "[vout]"


def test_adjacent_dissolve_emits_xfade_with_transition_duration_overlap():
    dissolve = FakeTransition("dissolve", 1.0)
    clips = [
        FakeClip("a", "t1", 0.0, 5.0, transition_out=dissolve),
        FakeClip("b", "t1", 4.0, 5.0, transition_in=dissolve),
    ]
    result = build_filtergraph(clips, 1920, 1080)
    assert "xfade=transition=fade:duration=1.0" in result.filter_complex
    # Overlap offset = first clip duration - dissolve duration = 5 - 1 = 4.
    assert "offset=4.0" in result.filter_complex


def test_fade_transition_emits_fade_in_over_leading_window():
    fade = FakeTransition("fade", 0.5)
    clips = [
        FakeClip("a", "t1", 0.0, 4.0, transition_in=fade),
        FakeClip("b", "t2", 0.0, 4.0),
    ]
    result = build_filtergraph(clips, 1920, 1080)
    # fade-in ramps over the leading `duration` seconds, st=0 (matches
    # TransitionLayer.alphaFor's leading window).
    assert "fade=t=in:st=0:d=0.5" in result.filter_complex


def test_fade_out_starts_at_clip_end_minus_window():
    fade = FakeTransition("fade", 0.5)
    clips = [
        FakeClip("a", "t1", 0.0, 4.0, transition_out=fade),
        FakeClip("b", "t2", 0.0, 4.0),
    ]
    result = build_filtergraph(clips, 1920, 1080)
    # fade-out starts at duration - window = 4 - 0.5 = 3.5.
    assert "fade=t=out:st=3.5:d=0.5" in result.filter_complex


def test_track_positioned_at_start_time_with_tpad():
    clips = [
        FakeClip("base", "t1", 0.0, 5.0),
        FakeClip("late", "t2", 2.0, 5.0, opacity=0.5),
    ]
    result = build_filtergraph(clips, 1920, 1080)
    # The second track starts at t=2s; tpad prepends the leading gap.
    assert "tpad=start_duration=2.0" in result.filter_complex


def test_group_tracks_sorts_by_resolved_z():
    clips = [
        FakeClip("a", "t_hi", 0.0, 5.0, track_z=9),
        FakeClip("b", "t_lo", 0.0, 5.0, track_z=2),
    ]
    plans = group_tracks(clips)
    assert [p.track_id for p in plans] == ["t_lo", "t_hi"]
    assert [p.z for p in plans] == [2, 9]


def test_group_tracks_falls_back_to_first_seen_order_without_track_z():
    clips = [
        FakeClip("a", "t_first", 0.0, 5.0),
        FakeClip("b", "t_second", 0.0, 5.0),
    ]
    plans = group_tracks(clips)
    assert [p.z for p in plans] == [0, 1]


def test_clips_within_track_sorted_by_start_time():
    clips = [
        FakeClip("late", "t1", 5.0, 5.0, opacity=0.5),
        FakeClip("early", "t1", 0.0, 5.0),
    ]
    plans = group_tracks(clips)
    assert [c.id for c in plans[0].clips] == ["early", "late"]
