"""Shared fakes for VideoCompositionService tests (helper module, not a test file).

`FakeFfmpeg` records every command and creates the output file of each one it
lets succeed, so the composition pipeline runs end to end without encoding.
`composing()` patches the local-media and FFmpeg seams for `_compose_video_sync`.
"""

from __future__ import annotations

import subprocess
from contextlib import ExitStack, contextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Callable, Iterator, List, Optional
from unittest.mock import MagicMock, patch

from app.models.video_models import (
    AudioCompositionItem,
    ImageCompositionItem,
    ImagePosition,
    VideoCompositionItem,
    VideoCompositionRequest,
)
from PIL import Image

from app.services.composition.camera_motion import CameraFilterCaps, CameraMotionConfig
from app.services.composition.composition_lifecycle import CancelRegistry
from app.services.subtitle_service import SubtitleService
from app.services.video_composition_service import VideoCompositionService

MODULE = "app.services.video_composition_service"
RESOLUTION = {"width": 64, "height": 36}
_MEDIA_SUFFIXES = (".mp4", ".wav")


class FakeFfmpeg:
    """`subprocess.run` stand-in: records commands, writes successful outputs."""

    def __init__(
        self,
        fail_when: Optional[Callable[[List[str]], bool]] = None,
        stderr: str = "ffmpeg version n7\nInvalid argument",
    ) -> None:
        self.commands: List[List[str]] = []
        self.fail_when = fail_when
        self.stderr = stderr

    def __call__(self, cmd, *args, **kwargs) -> subprocess.CompletedProcess:
        command = [str(part) for part in cmd]
        self.commands.append(command)
        if self.fail_when is not None and self.fail_when(command):
            return subprocess.CompletedProcess(command, 1, "", self.stderr)
        target = command[-1]
        if target.endswith(_MEDIA_SUFFIXES) and not target.startswith("-"):
            Path(target).parent.mkdir(parents=True, exist_ok=True)
            Path(target).write_bytes(b"media")
        return subprocess.CompletedProcess(command, 0, "", "")


def make_service(tmp_path: Path, composition_id: str = "comp-1") -> VideoCompositionService:
    """A service without its constructor's side effects, with one tracked task."""
    service = object.__new__(VideoCompositionService)
    service.compositions = {
        composition_id: {
            "id": composition_id, "task_id": "task-1", "status": "processing",
            "progress": 0.0, "start_time": 1.0, "warnings": [], "degradations": [],
        }
    }
    service.output_dir = tmp_path / "composed"
    service.output_dir.mkdir(parents=True, exist_ok=True)
    service.subtitle_service = object.__new__(SubtitleService)
    service._gpu_encoder = None
    service._cancel_events = CancelRegistry()
    return service


def media_file(tmp_path: Path, name: str) -> str:
    path = tmp_path / "media" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"media")
    return str(path)


def png_file(tmp_path: Path, name: str) -> str:
    """A decodable image: export leaves undecodable images out (EX3-05)."""
    path = tmp_path / "media" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (4, 4), (255, 0, 0)).save(path, format="PNG")
    return str(path)


def video_item(tmp_path: Path, item_id: str, track_id: str, start: float, duration: float) -> VideoCompositionItem:
    return VideoCompositionItem(
        id=item_id, name=item_id, url=media_file(tmp_path, f"{item_id}.mp4"),
        start_time=start, duration=duration, track_id=track_id,
        clip_start=0.0, clip_end=duration,
    )


def audio_item(tmp_path: Path, item_id: str, start: float, duration: float) -> AudioCompositionItem:
    return AudioCompositionItem(
        id=item_id, name=item_id, url=media_file(tmp_path, f"{item_id}.wav"),
        start_time=start, duration=duration, track_id="audio-track-1",
    )


def image_item(tmp_path: Path, item_id: str, start: float, duration: float) -> ImageCompositionItem:
    return ImageCompositionItem(
        id=item_id, name=f"{item_id}.png", url=png_file(tmp_path, f"{item_id}.png"),
        start_time=start, duration=duration, track_id="image-track-1",
        position=ImagePosition(x=0.0, y=0.0, width=1.0, height=1.0),
    )


def composition_request(*, total_duration: float, **items) -> VideoCompositionRequest:
    return VideoCompositionRequest(
        task_id="task-1",
        video_items=list(items.get("video_items", [])),
        audio_items=list(items.get("audio_items", [])),
        image_items=list(items.get("image_items", [])),
        subtitle_items=list(items.get("subtitle_items", [])),
        total_duration=total_duration,
        output_resolution=dict(RESOLUTION),
        output_fps=30,
    )


def _normalized(self, task):
    return {
        "success": True,
        "normalized_path": str(Path(task["temp_dir"]) / f"normalized_{task['index']}.mp4"),
        "warnings": [],
    }


@contextmanager
def camera_seams() -> Iterator[None]:
    """No capability probe, no dry run: stills take the static branch."""
    with patch.object(VideoCompositionService, "_get_camera_caps", return_value=CameraFilterCaps()), \
            patch.object(VideoCompositionService, "_get_camera_config",
                         return_value=CameraMotionConfig(dry_run_probe=False)):
        yield


@contextmanager
def composing(ffmpeg: FakeFfmpeg) -> Iterator[MagicMock]:
    """Patch every I/O seam of `_compose_video_sync`; yields the normalize mock."""
    with ExitStack() as stack:
        stack.enter_context(patch(f"{MODULE}.subprocess.run", side_effect=ffmpeg))
        stack.enter_context(patch(
            f"{MODULE}.resolve_local_media",
            side_effect=lambda url, cache_lookup=None: SimpleNamespace(local_path=url, origin="local"),
        ))
        stack.enter_context(patch(f"{MODULE}.get_material_download_service", return_value=MagicMock()))
        stack.enter_context(patch.object(
            VideoCompositionService, "_convert_url_to_local_path", lambda self, url: url,
        ))
        stack.enter_context(camera_seams())
        normalizer = stack.enter_context(patch.object(
            VideoCompositionService, "_normalize_video_with_retry",
            autospec=True, side_effect=_normalized,
        ))
        yield normalizer
