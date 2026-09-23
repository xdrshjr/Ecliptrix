"""Canvas fit in the ``-vf`` normalization path (spec r2 §3.9.3).

T-FIT-1: ``contain`` must stay character-identical to the pre-feature code for
both branches (padded / not padded). The expected strings were captured from
the code BEFORE the fit feature existed and are hard-coded on purpose.
T-FIT-2 (Python side): the geometry each mode renders matches the shared
fixture within 1px.
"""

from __future__ import annotations

import pytest

from app.services.composition.canvas_fit import CanvasFitError
from app.services.composition.video_scaling import (
    build_video_filter,
    calculate_video_scaling,
    camera_frame_size,
    fit_background_rect,
    fit_content_rect,
)
from tests.composition.fit_fixture import FIT_MODES, fit_tolerance, load_fit_cases

CAMERA = "zoompan=z=1.1:s=10x10"

# (source, target, filter, filter with camera) captured before the change.
PRE_FEATURE_CONTAIN = [
    ((1080, 1920), (1920, 1080),
     "scale=608:1080,pad=1920:1080:656:0:black,setsar=1:1",
     "scale=608:1080,zoompan=z=1.1:s=10x10,pad=1920:1080:656:0:black,setsar=1:1"),
    ((1920, 1080), (1080, 1920),
     "scale=1080:608,pad=1080:1920:0:656:black,setsar=1:1",
     "scale=1080:608,zoompan=z=1.1:s=10x10,pad=1080:1920:0:656:black,setsar=1:1"),
    ((1440, 1080), (1080, 1080),
     "scale=1080:810,pad=1080:1080:0:135:black,setsar=1:1",
     "scale=1080:810,zoompan=z=1.1:s=10x10,pad=1080:1080:0:135:black,setsar=1:1"),
    ((1280, 720), (1920, 1080),
     "scale=1920:1080,setsar=1:1",
     "scale=1920:1080,zoompan=z=1.1:s=10x10,setsar=1:1"),
]

PRE_FEATURE_PARAMS = {
    "scale_width": 608, "scale_height": 1080, "pad_width": 1920,
    "pad_height": 1080, "pad_x": 656, "pad_y": 0, "needs_padding": True,
}


@pytest.mark.parametrize("source,target,expected,expected_camera", PRE_FEATURE_CONTAIN)
def test_contain_filter_is_character_identical_to_pre_feature(
    source, target, expected, expected_camera
):
    params = calculate_video_scaling(*source, *target)

    assert build_video_filter(params) == expected
    assert build_video_filter(params, CAMERA) == expected_camera
    assert build_video_filter(params, CAMERA, "contain") == expected_camera


def test_contain_params_dict_is_unchanged():
    assert calculate_video_scaling(1080, 1920, 1920, 1080) == PRE_FEATURE_PARAMS
    assert calculate_video_scaling(
        1080, 1920, 1920, 1080, "contain"
    ) == PRE_FEATURE_PARAMS


def test_cover_filter_crops_and_applies_camera_after_crop():
    params = calculate_video_scaling(1080, 1920, 1920, 1080, "cover")

    assert build_video_filter(params, CAMERA, "cover") == (
        "scale=1920:1080:force_original_aspect_ratio=increase,"
        "crop=1920:1080:(iw-1920)/2:(ih-1080)/2,"
        "zoompan=z=1.1:s=10x10,setsar=1:1"
    )
    assert camera_frame_size(params) == (1920, 1080)


def test_blur_filter_is_the_spec_graph():
    params = calculate_video_scaling(1080, 1920, 1920, 1080, "blur")

    assert build_video_filter(params, "", "blur") == (
        "split=2[bg][fg];"
        "[bg]scale=1920:1080:force_original_aspect_ratio=increase,"
        "crop=1920:1080,gblur=sigma=20,"
        "colorchannelmixer=rr=0.6:gg=0.6:bb=0.6[bgb];"
        "[fg]scale=608:1080[fgs];"
        "[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1:1"
    )
    assert camera_frame_size(params) == (608, 1080)


def test_blur_sigma_scales_with_output_height():
    params = calculate_video_scaling(1920, 1080, 1080, 1920, "blur")

    assert "gblur=sigma=35.5556," in build_video_filter(params, "", "blur")


def test_blur_camera_moves_the_foreground_only():
    params = calculate_video_scaling(1080, 1920, 1920, 1080, "blur")

    assert "[fg]scale=608:1080,zoompan=z=1.1:s=10x10[fgs]" in (
        build_video_filter(params, CAMERA, "blur")
    )


@pytest.mark.parametrize("fit_mode", ["cover", "blur"])
def test_same_aspect_source_keeps_the_plain_scale(fit_mode):
    params = calculate_video_scaling(1280, 720, 1920, 1080, fit_mode)

    assert build_video_filter(params, "", fit_mode) == "scale=1920:1080,setsar=1:1"


def test_fill_mode_with_contain_params_raises_instead_of_falling_back():
    params = calculate_video_scaling(1080, 1920, 1920, 1080)

    with pytest.raises(CanvasFitError):
        build_video_filter(params, "", "blur")


def test_unknown_fit_mode_raises():
    with pytest.raises(CanvasFitError):
        calculate_video_scaling(1080, 1920, 1920, 1080, "stretch")


def _assert_rect_close(actual, expected, tolerance, where):
    assert expected is not None, where
    for got, want in zip(actual, expected):
        assert abs(got - want) <= tolerance, f"{where}: {actual} vs {expected}"


@pytest.mark.parametrize("case", load_fit_cases(), ids=lambda case: case["name"])
@pytest.mark.parametrize("fit_mode", FIT_MODES)
def test_export_geometry_matches_shared_fixture(case, fit_mode):
    source, canvas = case["source"], case["canvas"]
    params = calculate_video_scaling(
        source["width"], source["height"],
        canvas["width"], canvas["height"], fit_mode,
    )
    expected = case["expected"][fit_mode]
    where = f"{case['name']} / {fit_mode}"

    _assert_rect_close(
        fit_content_rect(params), expected["content"], fit_tolerance(), where
    )
    background = fit_background_rect(params)
    if expected["background"] is None:
        assert background is None, where
    else:
        _assert_rect_close(
            background, expected["background"], fit_tolerance(), where
        )
