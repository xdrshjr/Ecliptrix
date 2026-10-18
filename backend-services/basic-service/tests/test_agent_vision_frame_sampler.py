"""抽帧：时间点公式、首尾避让、单帧超时记账、cv2 懒加载（§4.8）。"""
import pytest

from app.models.agent_vision_models import AgentVisionError
from app.services.agent_vision import frame_sampler
from tests.agent_vision_support import FakeCapture, fake_cv2_module


def use_fake_capture(monkeypatch, capture=None):
    """把 cv2 替身装进 `frame_sampler`（真实 OpenCV 在本机是坏的）。"""
    capture = capture if capture is not None else FakeCapture()
    monkeypatch.setattr(frame_sampler, "_load_cv2",
                        lambda: fake_cv2_module(capture))
    return capture


def test_sample_times_centre_of_each_slot():
    times = frame_sampler.sample_times(0.0, 10.0, 4)
    # 避开首尾 0.2s → [0.2, 9.8] 四等分的中点。
    assert times == [1.4, 3.8, 6.2, 8.6]


def test_sample_times_degenerate_range_gives_single_point():
    assert frame_sampler.sample_times(5.0, 5.0, 4) == [5.0]


def test_sample_times_clamps_edge_skip_for_short_ranges():
    """区间比 2×0.2s 还短时，避让量收敛到 span/4，仍返回 count 个点。"""
    times = frame_sampler.sample_times(0.0, 0.3, 2)
    assert len(times) == 2
    assert 0.0 < times[0] < times[1] < 0.3


def test_sample_times_rejects_zero_count():
    with pytest.raises(AgentVisionError) as info:
        frame_sampler.sample_times(0.0, 1.0, 0)
    assert info.value.error_code == "invalid_argument"


@pytest.mark.asyncio
async def test_sample_frames_returns_time_pairs(monkeypatch):
    capture = use_fake_capture(monkeypatch)
    times, frames, skipped = await frame_sampler.sample_frames(
        "clip.mp4", 0.0, 4.0, 2)
    assert times == [1.1, 2.9]
    assert [moment for moment, _ in frames] == times
    assert skipped == []
    # 每帧都过了一遍编码管道（JPEG 头）。
    assert frames[0][1][:2] == b"\xff\xd8"
    assert capture.released is True


@pytest.mark.asyncio
async def test_unopenable_video_is_invalid(monkeypatch):
    capture = FakeCapture(opened=False)
    monkeypatch.setattr(frame_sampler, "_load_cv2",
                        lambda: fake_cv2_module(capture))
    with pytest.raises(AgentVisionError) as info:
        await frame_sampler.sample_frames("clip.mp4", 0.0, 4.0, 1)
    assert info.value.error_code == "image_invalid"


@pytest.mark.asyncio
async def test_slow_frame_is_skipped_and_reported(monkeypatch):
    """单帧超过 3s → 跳过并记进 `skipped[]`（绝不让一帧拖死整次抽帧）。"""
    capture = FakeCapture()
    original_read = capture.read
    calls = {"count": 0}

    def slow_read():
        calls["count"] += 1
        if calls["count"] == 2:
            return False, None
        return original_read()

    capture.read = slow_read
    monkeypatch.setattr(frame_sampler, "_load_cv2",
                        lambda: fake_cv2_module(capture))
    times, frames, skipped = await frame_sampler.sample_frames(
        "clip.mp4", 0.0, 4.0, 2)
    assert len(frames) == 1
    assert len(skipped) == 1
    assert "frame 2" in skipped[0]


@pytest.mark.asyncio
async def test_sample_single_without_timestamp_uses_midpoint(monkeypatch):
    use_fake_capture(monkeypatch)
    moment, body = await frame_sampler.sample_single("clip.mp4")
    assert moment == pytest.approx(2.0)  # 4s / 2
    assert body[:2] == b"\xff\xd8"


@pytest.mark.asyncio
async def test_video_duration_from_frame_count_and_fps(monkeypatch):
    use_fake_capture(monkeypatch)
    duration = await frame_sampler.video_duration("clip.mp4")
    assert duration == pytest.approx(4.0)


def test_cv2_is_not_imported_at_module_import_time():
    """模块导入期不得加载 OpenCV（本机 OpenCV 是坏的，见 conftest.py）。"""
    import ast
    import inspect
    import textwrap

    source = textwrap.dedent(inspect.getsource(frame_sampler))
    tree = ast.parse(source)
    top_level_imports = []
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [alias.name for alias in getattr(node, "names", [])]
            top_level_imports.extend(names)
            top_level_imports.append(getattr(node, "module", "") or "")
    assert not any(name.startswith("cv2") for name in top_level_imports)
