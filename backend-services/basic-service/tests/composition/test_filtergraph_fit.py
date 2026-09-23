"""Canvas fit in the ``-filter_complex`` path (spec r2 §3.9.3, T-FIT-4).

``contain`` keeps the pre-feature chain character for character; ``cover`` puts
the camera chain after ``crop``; ``blur`` splices a labelled ``split`` /
``overlay`` sub-graph into each clip chain with labels unique across the whole
graph, and FFmpeg accepts the result.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from collections import Counter
from types import SimpleNamespace

import pytest

from app.services.composition.canvas_fit import CanvasFitError
from app.services.composition.filtergraph_builder import (
    build_filtergraph,
    build_fit_fragment,
)

FFMPEG = shutil.which("ffmpeg")

# Captured from the builder BEFORE the fit feature existed.
PRE_FEATURE_GRAPH = (
    "color=c=black:s=1920x1080:r=30:d=2.500000,format=yuv420p[base];"
    "[0:v]trim=start=1:end=3,setpts=PTS-STARTPTS,"
    "scale=1920:1080:force_original_aspect_ratio=decrease,"
    "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1:1,"
    "trim=duration=2.000000,format=rgba,colorchannelmixer=aa=0.5[c0];"
    "[c0]settb=AVTB,setpts=PTS+0.500000/TB[r0];"
    "[base][r0]overlay=0:0:eof_action=pass:format=auto[vout]"
)


def _clip(clip_id, track_id, start, duration=2.0, opacity=1.0):
    return SimpleNamespace(
        id=clip_id, track_id=track_id, start_time=start, duration=duration,
        clip_start=1.0, clip_end=1.0 + duration, opacity=opacity,
        track_z=None, transition_in=None, transition_out=None,
    )


def test_contain_graph_is_character_identical_to_pre_feature():
    clips = [_clip("a", "t", 0.5, opacity=0.5)]

    assert build_filtergraph(clips, 1920, 1080).filter_complex == PRE_FEATURE_GRAPH
    assert build_filtergraph(
        clips, 1920, 1080, fit_mode="contain"
    ).filter_complex == PRE_FEATURE_GRAPH


def test_contain_fragment_is_the_two_pre_feature_steps():
    fragment = build_fit_fragment(1920, 1080)

    assert fragment.graph is None
    assert fragment.steps == (
        "scale=1920:1080:force_original_aspect_ratio=decrease",
        "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black",
    )


def test_cover_fragment_applies_camera_after_crop():
    fragment = build_fit_fragment(1920, 1080, "cover", "zoompan=z=1.1")

    assert fragment.steps == (
        "scale=1920:1080:force_original_aspect_ratio=increase",
        "crop=1920:1080:(iw-1920)/2:(ih-1080)/2",
        "zoompan=z=1.1",
    )


def test_pre_trimmed_inputs_ignore_the_fit_mode():
    clips = [_clip("a", "t", 0.5, opacity=0.5)]

    fitted = build_filtergraph(clips, 1920, 1080, pre_trimmed=True, fit_mode="blur")
    plain = build_filtergraph(clips, 1920, 1080, pre_trimmed=True)

    assert fitted.filter_complex == plain.filter_complex


def test_unknown_fit_mode_raises():
    with pytest.raises(CanvasFitError):
        build_filtergraph([_clip("a", "t", 0.5)], 1920, 1080, fit_mode="stretch")


def _blur_graph():
    clips = [
        _clip("a", "t1", 0.0), _clip("b", "t1", 2.0, opacity=0.5),
        _clip("c", "t2", 0.5),
    ]
    return build_filtergraph(clips, 640, 360, fit_mode="blur", timeline_end=4.0)


def test_blur_splices_one_sub_graph_per_clip():
    graph = _blur_graph().filter_complex

    assert graph.count("split=2") == 3
    assert (
        "[0:v]trim=start=1:end=3,setpts=PTS-STARTPTS[f0_pre];"
        "[f0_pre]split=2[f0_fit_bg][f0_fit_fg];"
    ) in graph
    assert "[f2_fit]setsar=1:1,trim=duration=2.000000[c2]" in graph
    assert "[f1_fit]setsar=1:1,trim=duration=2.000000,format=rgba," in graph


def test_blur_labels_are_unique():
    graph = _blur_graph().filter_complex
    labels = Counter(re.findall(r"\[([^\]]+)\]", graph))

    for label, count in labels.items():
        if re.fullmatch(r"\d+:v", label):
            continue
        expected = 1 if label == "vout" else 2  # produced once, consumed once
        assert count == expected, f"label [{label}] used {count} times"


@pytest.mark.skipif(FFMPEG is None, reason="ffmpeg not on PATH: cannot parse the graph")
def test_blur_graph_is_accepted_by_ffmpeg():
    plan = _blur_graph()
    cmd = [FFMPEG, "-hide_banner", "-nostdin", "-v", "error"]
    for _ in plan.video_inputs:
        cmd += ["-f", "lavfi", "-i", "testsrc2=s=180x320:r=30:d=4"]
    cmd += [
        "-filter_complex", plan.filter_complex, "-map", plan.output_label,
        "-frames:v", "3", "-f", "null", "-",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

    assert result.returncode == 0, result.stderr
