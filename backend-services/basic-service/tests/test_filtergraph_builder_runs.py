"""Contiguous runs the canvas pre-merges into one input each (N-04).

One FFmpeg input per clip decoded every clip at once: 241 inputs peaked at
16.4 GB and 4342 threads. Alpha-free runs are joined first; runs with fades or
opacity keep one input per clip because their alpha ramps are per clip.
"""

from __future__ import annotations

from app.services.composition.filtergraph_builder import (
    build_filtergraph,
    merged_run_clip,
    pin_to_layer,
    plan_runs,
)


class _Transition:
    def __init__(self, type_: str, duration: float):
        self.type = type_
        self.duration = duration


class _Clip:
    def __init__(self, id, track_id, start_time, duration, opacity=1.0,
                 transition_in=None, transition_out=None, track_z=None):
        self.id = id
        self.track_id = track_id
        self.start_time = start_time
        self.duration = duration
        self.clip_start = 0.0
        self.clip_end = duration
        self.opacity = opacity
        self.track_z = track_z
        self.transition_in = transition_in
        self.transition_out = transition_out


def _describe(runs):
    return [
        ([clip.id for clip in run.clips], run.start, run.duration, run.needs_alpha, run.z)
        for run in runs
    ]


def test_plan_runs_merges_contiguous_alpha_free_clips():
    clips = [
        _Clip("a", "t1", 0.0, 2.0), _Clip("b", "t1", 2.0, 3.0), _Clip("c", "t1", 5.0, 1.0),
        _Clip("late", "t1", 8.0, 2.0), _Clip("top", "t2", 1.0, 1.0),
    ]

    runs = plan_runs(clips, fps=30)

    assert _describe(runs) == [
        (["a", "b", "c"], 0.0, 6.0, False, 0),
        (["late"], 8.0, 2.0, False, 0),
        (["top"], 1.0, 1.0, False, 1),
    ]


def test_plan_runs_keeps_alpha_runs_per_clip():
    dissolve = _Transition("dissolve", 0.5)
    clips = [
        _Clip("a", "t1", 0.0, 2.0, transition_out=dissolve),
        _Clip("b", "t1", 2.0, 2.0, transition_in=dissolve),
        _Clip("hidden", "t1", 4.0, 1.0, opacity=0.0),
    ]

    (run,) = plan_runs(clips, fps=30)

    assert [clip.id for clip in run.clips] == ["a", "b"]
    assert run.needs_alpha is True


def test_a_merged_run_keeps_the_track_stacking_order():
    clips = [
        _Clip("a", "t1", 0.0, 2.0), _Clip("b", "t1", 2.0, 2.0), _Clip("top", "t2", 1.0, 1.0),
    ]
    base_run, top_run = plan_runs(clips, fps=30)

    canvas = [merged_run_clip(base_run, "__run_0"), pin_to_layer(top_run.clips[0], top_run.z)]
    plan = build_filtergraph(canvas, 64, 36, pre_trimmed=True, fps=30, timeline_end=4.0)

    assert plan.video_inputs == ["__run_0", "top"]
    assert "[base][r0]overlay" in plan.filter_complex
    assert "[o0][r1]overlay" in plan.filter_complex
