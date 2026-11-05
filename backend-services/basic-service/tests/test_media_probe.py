"""ffprobe reads a source's display size, frame rate and duration (EX3-01 / EX3-02).

OpenCV reported the coded size of a rotated phone clip (the export squashed it)
and a negative frame count for a live-style WebM (the export failed).
"""

from __future__ import annotations

import os
import shutil
import subprocess

import pytest

from app.services.composition.media_probe import (
    ffprobe_path_for,
    parse_probe_payload,
    probe_video_stream,
)

_FFMPEG = shutil.which("ffmpeg")
_FFPROBE = shutil.which("ffprobe")


@pytest.mark.skipif(not (_FFMPEG and _FFPROBE), reason="ffmpeg/ffprobe not on PATH")
def test_rotated_clip_reports_display_size(tmp_path):
    landscape = tmp_path / "landscape.mp4"
    rotated = tmp_path / "rotated.mp4"
    subprocess.run(
        [_FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=64x36:r=30:d=1",
         "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", str(landscape)],
        check=True, capture_output=True,
    )
    subprocess.run(
        [_FFMPEG, "-y", "-v", "error", "-display_rotation:v:0", "90",
         "-i", str(landscape), "-c", "copy", str(rotated)],
        check=True, capture_output=True,
    )

    info = probe_video_stream(str(rotated), _FFPROBE)

    assert (info.width, info.height) == (36, 64)
    assert info.rotation % 180 == 90
    assert info.duration == pytest.approx(1.0, abs=0.05)


def test_legacy_rotate_tag_swaps_dimensions():
    payload = {
        "streams": [{
            "width": 1920, "height": 1080, "avg_frame_rate": "30000/1001",
            "tags": {"rotate": "90"},
        }],
        "format": {"duration": "12.5"},
    }

    info = parse_probe_payload(payload)

    assert (info.width, info.height, info.rotation) == (1080, 1920, 90)
    assert info.duration == 12.5
    assert info.fps == pytest.approx(29.97, abs=0.01)


def test_a_source_without_any_duration_reports_an_unknown_length():
    payload = {
        "streams": [{"width": 64, "height": 36, "avg_frame_rate": "0/0", "r_frame_rate": "30/1"}],
        "format": {},
    }

    info = parse_probe_payload(payload)

    assert info.duration is None
    assert info.fps == 30.0


def test_a_probe_that_cannot_run_returns_none(tmp_path):
    assert probe_video_stream(str(tmp_path / "clip.mp4"), str(tmp_path / "no-ffprobe")) is None


def test_ffprobe_is_looked_up_next_to_ffmpeg():
    assert ffprobe_path_for("ffmpeg") == "ffprobe"
    assert ffprobe_path_for(os.path.join("tools", "ffmpeg")) == os.path.join("tools", "ffprobe")


@pytest.mark.asyncio
async def test_workspace_probe_missing_program(monkeypatch, tmp_path):
    from app.services.composition import media_probe
    from app.models.agent_toolkit_models import AgentToolkitError
    monkeypatch.setattr(media_probe.shutil, 'which', lambda _: None)
    with pytest.raises(AgentToolkitError, match='media_probe_unavailable'):
        await media_probe.probe_workspace_media(tmp_path / 'bgm.wav', 'wav')


@pytest.mark.asyncio
@pytest.mark.parametrize('duration', ['0', '-1', 'NaN', 'Infinity', None])
async def test_workspace_probe_rejects_invalid_duration(monkeypatch, duration):
    import json
    from unittest.mock import AsyncMock
    from app.services.composition import media_probe
    from app.models.agent_toolkit_models import AgentToolkitError
    process = AsyncMock()
    process.returncode = 0
    process.communicate.return_value = (json.dumps({
        'streams': [{'duration': duration}], 'format': {},
    }).encode(), None)
    monkeypatch.setattr(media_probe.shutil, 'which', lambda _: 'ffprobe')
    create = AsyncMock(return_value=process)
    monkeypatch.setattr(media_probe.asyncio, 'create_subprocess_exec', create)
    with pytest.raises(AgentToolkitError, match='media_probe_failed'):
        await media_probe.probe_workspace_media('bgm.wav', 'wav')
    assert 'a:0' in create.call_args.args


@pytest.mark.asyncio
@pytest.mark.parametrize('cancel', [False, True])
async def test_workspace_probe_timeout_and_cancel_reap_child(monkeypatch, cancel):
    import asyncio
    from unittest.mock import AsyncMock, Mock
    from app.services.composition import media_probe
    from app.models.agent_toolkit_models import AgentToolkitError
    entered = asyncio.Event()

    async def communicate():
        entered.set()
        await asyncio.Event().wait()

    process = Mock(returncode=None, communicate=communicate, wait=AsyncMock())
    monkeypatch.setattr(media_probe.shutil, 'which', lambda _: 'ffprobe')
    monkeypatch.setattr(media_probe.asyncio, 'create_subprocess_exec', AsyncMock(return_value=process))
    task = asyncio.create_task(media_probe.probe_workspace_media('bgm.wav', 'wav', timeout=0.02))
    await entered.wait()
    if cancel:
        task.cancel()
    with pytest.raises(asyncio.CancelledError if cancel else AgentToolkitError):
        await task
    process.kill.assert_called_once()
    process.wait.assert_awaited_once()
