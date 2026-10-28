"""Image -> video filter construction: golden strings and geometry.

The goldens are hard-coded on purpose: reading them back from the builder would
make the test agree with any future change, which is what it exists to stop.
Changing a golden means changing ``FILTER_VERSION`` too (cache invalidation).
"""

import pytest

from app.services import image_to_video_filters as f

KEN_BURNS_ZOOM_IN_4000x3000 = (
    "scale=3840:2880:flags=lanczos,crop=3840:2160:0:360,"
    "zoompan=z='1+(1.12-1)*on/150':"
    "x='max(0,min(iw-iw/zoom,0.5*iw-iw/zoom/2))':"
    "y='max(0,min(ih-ih/zoom,0.5*ih-ih/zoom/2))':"
    "d=150:s=1920x1080:fps=30,setsar=1"
)
PAN_RIGHT_TO_LEFT_4000x3000 = (
    "scale=2400:1800:flags=lanczos,crop=2400:1080:0:360,"
    "crop=1920:1080:x='(iw-1920)*(1-(clip(t/5,0,1)*clip(t/5,0,1)"
    "*(3-2*clip(t/5,0,1))))':y=0,setsar=1"
)


def test_filter_version_is_pinned_with_the_goldens():
    assert f.FILTER_VERSION == 1


def test_ken_burns_zoom_in_matches_golden():
    assert f.build_ken_burns_filter(
        (4000, 3000), (1920, 1080), 5, "zoom_in", (0.5, 0.5)
    ) == KEN_BURNS_ZOOM_IN_4000x3000


def test_pan_right_to_left_matches_golden():
    assert f.build_pan_filter(
        (4000, 3000), (1920, 1080), 5, "right_to_left", (0.5, 0.5)
    ) == PAN_RIGHT_TO_LEFT_4000x3000


def test_ken_burns_runs_on_a_supersampled_frame():
    chain = f.build_ken_burns_filter(
        (4000, 3000), (1920, 1080), 5, "zoom_in", (0.5, 0.5))
    assert "crop=3840:2160" in chain  # 2x the 1920x1080 output (D5)


def test_ken_burns_zoom_out_reverses_the_zoom_range():
    chain = f.build_ken_burns_filter(
        (1920, 1080), (1920, 1080), 4, "zoom_out", (0.5, 0.5))
    assert "z='1.12+(1-1.12)*on/120'" in chain


def test_ken_burns_window_is_clamped_inside_the_input():
    chain = f.build_ken_burns_filter(
        (1920, 1080), (1920, 1080), 5, "zoom_in", (0.0, 1.0))
    assert "x='max(0,min(iw-iw/zoom," in chain
    assert "y='max(0,min(ih-ih/zoom," in chain


def test_cover_plan_keeps_the_focus_inside_the_crop():
    plan = f.cover_plan(3000, 4000, 3840, 2160, 0.0, 0.5)
    assert plan.crop_x == 0
    assert 0.0 <= plan.local_focus_x <= 1.0
    assert plan.scale_width >= 3840 and plan.scale_height >= 2160


@pytest.mark.parametrize("source,aspect,expected", [
    ((4000, 3000), None, (1920, 1440)),
    ((3000, 4000), None, (1440, 1920)),
    ((1001, 555), "9:16", (1080, 1920)),
    ((800, 800), "16:9", (1920, 1080)),
])
def test_output_size_is_even_and_capped(source, aspect, expected):
    width, height = f.output_size(*source, aspect, 1920)
    assert (width, height) == expected
    assert width % 2 == 0 and height % 2 == 0


def test_output_size_never_goes_below_the_minimum_side():
    assert f.output_size(100, 10, None, 480)[1] >= f.MIN_SIDE


def test_static_with_matching_ratio_is_a_plain_scale():
    assert f.build_static_filter(
        (1920, 1080), (1920, 1080)) == "scale=1920:1080:flags=lanczos,setsar=1"


def test_static_with_ratio_change_uses_the_blurred_backdrop_not_black_bars():
    chain = f.build_static_filter((1000, 1000), (1920, 1080))
    assert "gblur" in chain and "overlay" in chain
    assert "pad=" not in chain


def test_unknown_effect_is_rejected():
    with pytest.raises(ValueError):
        f.build_video_filter(
            "spin", (10, 10), (64, 64), 1, None, (0.5, 0.5))


def test_input_options_sit_next_to_their_input():
    args = f.build_ffmpeg_args(
        "ffmpeg", "in.png", "out.mp4", "pan", "scale=1:1", 5)
    i = args.index("-i")
    assert args[i - 6:i + 2] == [
        "-loop", "1", "-framerate", "30", "-t", "5", "-i", "in.png"]
    assert args.index("-vf") > i


def test_ken_burns_input_is_not_looped():
    args = f.build_ffmpeg_args(
        "ffmpeg", "in.png", "out.mp4", "ken_burns", "zoompan=...", 5)
    assert "-loop" not in args
    assert args[args.index("-frames:v") + 1] == "150"


def test_encoder_settings():
    args = f.build_ffmpeg_args(
        "ffmpeg", "in.png", "out.mp4", "static", "scale=1:1", 5)
    for flag, value in (("-c:v", "libx264"), ("-pix_fmt", "yuv420p"),
                        ("-crf", "18"), ("-movflags", "+faststart")):
        assert args[args.index(flag) + 1] == value
    assert "-an" in args


def test_canonical_params_ignore_direction_for_static():
    a = f.canonical_params("static", "zoom_in", 5, (0.5, 0.5), (64, 64), "contain")
    b = f.canonical_params("static", None, 5, (0.5, 0.5), (64, 64), "contain")
    assert a == b
    assert a["version"] == f.FILTER_VERSION
