"""Tests for the canvas compositor filtergraph builder (round 2, S6).

These pin the EXPORT-side semantics that must mirror the preview compositor:
z-order = track order, clips placed at their real start time on a black canvas
as long as the timeline, per-clip opacity and transitions as alpha ramps, and
the concat fast path only for one gap-free, alpha-free track.
"""

from app.services.composition.filtergraph_builder import (
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


def test_contiguous_single_track_uses_concat_fast_path():
    clips = [
        FakeClip("a", "t1", 0.0, 5.0),
        FakeClip("b", "t1", 5.0, 5.0),
    ]
    result = build_filtergraph(clips, 1920, 1080)
    assert result.can_use_concat is True
    assert result.filter_complex == ""
    assert result.output_label == ""
    assert result.video_inputs == ["a", "b"]
    assert result.timeline_end == 10.0


def test_labels_use_indices_not_track_ids():
    clips = [
        FakeClip("base", "video-track-1", 0.0, 6.0),
        FakeClip("top", "video-track-2", 2.0, 2.0),
    ]
    graph = build_filtergraph(clips, 1920, 1080).filter_complex
    assert "video-track" not in graph
    assert "[r0]" in graph and "[r1]" in graph


def test_zero_opacity_clip_is_not_an_input():
    clips = [
        FakeClip("base", "t1", 0.0, 6.0),
        FakeClip("hidden", "t2", 0.0, 6.0, opacity=0.0),
    ]
    result = build_filtergraph(clips, 1920, 1080)
    assert "hidden" not in result.video_inputs


def test_clip_trim_and_setpts_emitted_for_original_inputs():
    clips = [
        FakeClip("a", "t1", 0.0, 3.0, clip_start=2.0, clip_end=5.0, opacity=0.5),
    ]
    result = build_filtergraph(clips, 1920, 1080)
    assert result.can_use_concat is False
    assert "trim=start=2:end=5" in result.filter_complex
    assert "setpts=PTS-STARTPTS" in result.filter_complex
    assert "scale=1920:1080:force_original_aspect_ratio=decrease" in result.filter_complex


def test_pre_trimmed_skips_trim_window_and_scale():
    clips = [FakeClip("a", "t1", 0.0, 3.0, opacity=0.5)]
    result = build_filtergraph(clips, 1920, 1080, pre_trimmed=True)
    assert "trim=start=" not in result.filter_complex
    assert "scale=" not in result.filter_complex
    assert "trim=duration=3.000000" in result.filter_complex
    assert "colorchannelmixer=aa=0.5" in result.filter_complex


def test_per_clip_opacity_maps_to_colorchannelmixer_alpha():
    clips = [
        FakeClip("base", "t1", 0.0, 5.0),
        FakeClip("top", "t2", 0.0, 5.0, opacity=0.4),
    ]
    result = build_filtergraph(clips, 1280, 720)
    assert "format=rgba" in result.filter_complex
    assert "colorchannelmixer=aa=0.4" in result.filter_complex
    # The fully-opaque base clip is NOT given an alpha multiplier.
    assert result.filter_complex.count("colorchannelmixer=aa=") == 1


def test_two_track_overlay_orders_bottom_to_top_by_track_z():
    clips = [
        FakeClip("top", "t_top", 0.0, 5.0, track_z=5, opacity=0.5),
        FakeClip("bottom", "t_bottom", 0.0, 5.0, track_z=1),
    ]
    result = build_filtergraph(clips, 1920, 1080)
    assert result.can_use_concat is False
    assert "overlay=" in result.filter_complex
    assert result.video_inputs.index("bottom") < result.video_inputs.index("top")
    assert result.output_label == "[vout]"


def test_upper_track_overlay_passes_through_before_and_after_clip():
    clips = [
        FakeClip("base", "t1", 0.0, 6.0),
        FakeClip("top", "t2", 2.0, 2.0),
    ]
    graph = build_filtergraph(clips, 1920, 1080, pre_trimmed=True).filter_complex
    assert "tpad" not in graph
    assert "eof_action=pass" in graph
    assert "setpts=PTS+2.000000/TB" in graph


def test_same_track_gap_keeps_clip_at_start_time():
    clips = [
        FakeClip("red", "t1", 0.0, 2.0),
        FakeClip("blue", "t1", 4.0, 2.0),
    ]
    result = build_filtergraph(clips, 1920, 1080, pre_trimmed=True)
    assert result.can_use_concat is False
    assert "setpts=PTS+4.000000/TB" in result.filter_complex
    assert "concat=" not in result.filter_complex
    assert result.timeline_end == 6.0


def test_leading_gap_disables_concat_fast_path():
    clips = [FakeClip("late", "t1", 3.0, 2.0)]
    result = build_filtergraph(clips, 1920, 1080, pre_trimmed=True)
    assert result.can_use_concat is False
    assert "setpts=PTS+3.000000/TB" in result.filter_complex


def test_timeline_end_past_last_clip_disables_concat_and_sets_base_duration():
    clips = [FakeClip("a", "t1", 0.0, 5.0)]
    result = build_filtergraph(clips, 1920, 1080, pre_trimmed=True, timeline_end=8.0)
    assert result.can_use_concat is False
    assert "d=8.000000" in result.filter_complex
    assert result.timeline_end == 8.0


def test_dissolve_renders_as_alpha_ramps_without_shortening_timeline():
    dissolve = FakeTransition("dissolve", 1.0)
    clips = [
        FakeClip("a", "t1", 0.0, 3.0, transition_out=dissolve),
        FakeClip("b", "t1", 3.0, 3.0, transition_in=dissolve, transition_out=dissolve),
        FakeClip("c", "t1", 6.0, 3.0, transition_in=dissolve),
    ]
    graph = build_filtergraph(clips, 1920, 1080, pre_trimmed=True).filter_complex
    assert "xfade" not in graph
    assert "color=c=black:s=1920x1080:r=30:d=9.000000" in graph
    assert "fade=t=out:st=2:d=1:alpha=1" in graph
    assert "fade=t=in:st=0:d=1:alpha=1" in graph
    assert "concat=n=3" in graph


def test_fade_transition_emits_fade_in_over_leading_window():
    fade = FakeTransition("fade", 0.5)
    clips = [
        FakeClip("a", "t1", 0.0, 4.0, transition_in=fade),
        FakeClip("b", "t2", 0.0, 4.0),
    ]
    result = build_filtergraph(clips, 1920, 1080)
    assert "fade=t=in:st=0:d=0.5" in result.filter_complex


def test_fade_out_starts_at_clip_end_minus_window():
    fade = FakeTransition("fade", 0.5)
    clips = [
        FakeClip("a", "t1", 0.0, 4.0, transition_out=fade),
        FakeClip("b", "t2", 0.0, 4.0),
    ]
    result = build_filtergraph(clips, 1920, 1080)
    assert "fade=t=out:st=3.5:d=0.5" in result.filter_complex


def test_bottom_track_fade_and_opacity_composite_over_black_canvas():
    clips = [
        FakeClip("solo", "t1", 0.0, 4.0, opacity=0.5,
                 transition_in=FakeTransition("fade", 1.0)),
    ]
    result = build_filtergraph(clips, 1920, 1080, pre_trimmed=True)
    assert result.can_use_concat is False
    assert result.filter_complex.startswith("color=c=black")
    assert "format=rgba" in result.filter_complex
    assert "[base][r0]overlay=0:0:eof_action=pass:format=auto[vout]" in result.filter_complex


def test_hard_cut_then_dissolve_never_feeds_concat_into_a_transition():
    dissolve = FakeTransition("dissolve", 1.0)
    clips = [
        FakeClip("a", "t1", 0.0, 2.0),
        FakeClip("b", "t1", 2.0, 2.0, transition_out=dissolve),
        FakeClip("c", "t1", 4.0, 2.0, transition_in=dissolve),
    ]
    graph = build_filtergraph(clips, 1920, 1080, pre_trimmed=True).filter_complex
    assert "xfade" not in graph
    # One run → one pixel format for every clip, so concat never mixes formats.
    assert graph.count("format=rgba") == 3


def test_hard_cut_after_dissolve_clip_emits_no_zero_length_transition():
    clips = [
        FakeClip("a", "t1", 0.0, 3.0, transition_out=FakeTransition("dissolve", 1.0)),
        FakeClip("b", "t1", 3.0, 3.0),
    ]
    graph = build_filtergraph(clips, 1920, 1080, pre_trimmed=True).filter_complex
    assert "duration=0" not in graph
    assert "d=0:" not in graph
    assert "fade=t=in" not in graph


def test_no_clips_renders_black_base_of_timeline_end():
    result = build_filtergraph([], 1280, 720, pre_trimmed=True, timeline_end=5.0)
    assert result.can_use_concat is False
    assert result.video_inputs == []
    assert result.filter_complex == (
        "color=c=black:s=1280x720:r=30:d=5.000000,format=yuv420p[base];[base]null[vout]"
    )


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
