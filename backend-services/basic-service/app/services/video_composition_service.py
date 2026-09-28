"""
Video composition service for combining multiple video, audio, and subtitle tracks.
Based on the reference video_composer.py with adaptations for FastAPI service architecture.
"""

import os
import uuid
import time
import shutil
import tempfile
import subprocess
import threading
import asyncio
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Any, Sequence, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from dataclasses import dataclass
from types import SimpleNamespace
from urllib.parse import urlparse

import cv2

from app.logger import get_logger
from app.config import settings
from app.security.url_guard import (
    URLGuardError,
    validate_external_url,
    validate_local_path_for_ffmpeg,
)
from app.models import (
    VideoCompositionRequest,
    VideoCompositionResponse,
    VideoCompositionItem,
    SubtitleCompositionItem,
    AspectRatio,
    VideoProcessingError,
    CompositionErrorDetails,
    VideoProcessingStage
)
from app.services.subtitle_service import SubtitleService
from app.services.material_download_service import get_material_download_service
from app.services.local_media_resolver import (
    LOCAL_HOSTS,
    ROUTE_PREFIXES,
    LocalMediaResolveError,
    audio_generated_dir,
    audio_subtitle_dir,
    composed_output_dir,
    legacy_audio_generated_dir,
    legacy_audio_subtitle_dir,
    resolve_media_reference,
)
from app.services.composition.encode import (
    detect_gpu_encoder,
    get_encoding_params,
)
from app.services.composition.media_resolution import (
    NonLocalMediaError,
    resolve_local_media,
)
from app.services.composition.filtergraph_builder import (
    MAX_CANVAS_INPUTS,
    FiltergraphResult,
    RunPlan,
    build_filtergraph,
    merged_run_clip,
    pin_to_layer,
    plan_runs,
)
from app.services.composition.audio_mix import (
    MAX_MIX_INPUTS,
    AudioSource,
    build_audio_mix,
    chunk_sources,
)
from app.services.composition.composition_outcome import (
    AudioMixResult,
    CompositionStageError,
    DroppedAudio,
    SkippedImage,
    append_degradation,
    clip_reason,
    frame_count_for,
    last_stderr_line,
    timeline_end_of,
)
from app.services.composition.cover_contract import (
    CoverCompositionError, PreparedCover, require_strict_images,
)
from app.services.composition.ffmpeg_args import (
    filter_complex_args,
    progress_file_path,
    with_progress,
)
from app.services.composition.canvas_fit import CanvasFitError
from app.services.composition.video_scaling import (
    build_video_filter,
    calculate_video_scaling,
    camera_frame_size,
    ensure_even_dimensions,
    get_aspect_ratio_info,
)
from app.services.composition.composition_lifecycle import (
    CANCELLED_SUMMARY,
    CANVAS_PROGRESS_NAME,
    SETTLED_STATUSES,
    CancelRegistry,
    CompositionCancelled,
    evict_settled,
    remove_file,
    remove_stale_outputs,
    set_stage,
    status_snapshot,
    temp_dir_for,
)
from app.services.composition.media_probe import (
    VideoStreamInfo,
    ffprobe_path_for,
    probe_video_stream,
)
from app.services.composition.camera_motion import (
    build_camera_filter_chain,
    build_still_overlay_plan,
    dry_run_chain,
    load_camera_config,
    probe_camera_filters,
)

logger = get_logger(__name__)


def _is_loopback_local_reference(url: str) -> bool:
    """True when ``url`` is a loopback same-origin reference to a known local
    media route (e.g. ``http://127.0.0.1:PORT/api/storage/files/...``).

    The packaged desktop shell serves the frontend on ``http://127.0.0.1:PORT``,
    so a material field that already holds an absolute same-origin URL reaches
    the compositor as a loopback http(s) URL. Those are NOT SSRF targets: the
    per-clip resolver (``local_media_resolver._normalize_reference``) already
    strips the loopback host and re-validates the path with
    ``validate_local_path_for_ffmpeg`` (containerised against the storage roots).
    Treating them as external would reject a legitimate local file on the
    ``url_guard._is_unsafe_ip`` loopback branch. We exempt them here — and only
    here — so the request-time guard agrees with the resolver it delegates to.

    The exemption is deliberately narrow: host must be a loopback literal and
    the path must start with a known local-media prefix. Traversal (``..``) is
    still caught downstream by ``validate_local_path_for_ffmpeg``; any other
    loopback path (e.g. ``/admin``) falls through to ``validate_external_url``.
    """
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme.lower() not in {"http", "https"}:
        return False
    host = (parsed.hostname or "").lower()
    if host not in LOCAL_HOSTS:
        return False
    path = parsed.path or ""
    return any(path.startswith(prefix) for prefix, _root, _kind in ROUTE_PREFIXES)


#: Errors `_convert_url_to_local_path` raises for media it cannot resolve.
_MEDIA_RESOLVE_ERRORS = (OSError, URLGuardError, LocalMediaResolveError)
#: An image at or below this opacity is hidden on purpose and never rendered.
_HIDDEN_IMAGE_OPACITY = 0.001
_DEFAULT_IMAGE_Z_INDEX = 10
_MAX_IMAGE_Z_INDEX = 999
#: Files a stage writes next to the final output before replacing it.
_INTERMEDIATE_SUFFIXES = (
    "_with_audio.mp4", "_merged.mp4", "_with_images.mp4", "_with_subtitles.mp4",
)
#: How often a queued composition re-checks for cancellation (RV3-13).
_SLOT_POLL_SECONDS = 0.5
#: Above this many inputs every decoder runs single-threaded (N-04).
_SINGLE_THREAD_INPUT_THRESHOLD = 16
_TOO_MANY_INPUTS = "too many inputs for one FFmpeg command"
#: ``ERROR_FILENAME_EXCED_RANGE``: the command line is over 32767 characters.
_WINDOWS_COMMAND_TOO_LONG = 206


def _image_stack_key(item: Any) -> int:
    """Stacking order of an image overlay: its z-index clamped to [0, 999].

    The clamp keeps every image below the subtitle layer, as in the preview
    (RV-10). There is no Pydantic range check on purpose, so an out-of-range
    legacy value cannot reject the whole export with a 422.
    """
    position = getattr(item, "position", None) or getattr(item, "image_position", None)
    raw = getattr(position, "z_index", None) if position is not None else None
    try:
        z_index = int(raw)
    except (TypeError, ValueError):
        z_index = _DEFAULT_IMAGE_Z_INDEX
    return min(max(z_index, 0), _MAX_IMAGE_Z_INDEX)


def _image_opacity(item: Any) -> float:
    """Image opacity in [0, 1]; only a missing value means opaque."""
    raw = getattr(item, "opacity", None)
    if raw is None:
        return 1.0
    return min(max(float(raw), 0.0), 1.0)


def _intermediate_paths_for(output_path: Path) -> List[str]:
    base = str(output_path)
    return [base.replace(".mp4", suffix) for suffix in _INTERMEDIATE_SUFFIXES]


def _nth_or_none(values: Optional[Sequence[Optional[str]]], index: int) -> Optional[str]:
    return values[index] if values is not None and index < len(values) else None


def _dropped_audio(item: Any, reason: str) -> DroppedAudio:
    item_id = str(getattr(item, "id", "") or "")
    return DroppedAudio(
        item_id=item_id,
        name=str(getattr(item, "name", None) or item_id),
        reason=clip_reason(reason) or "audio could not be processed",
    )


@dataclass(frozen=True)
class _AudioMergeJob:
    """Inputs of the audio merge stage (keeps its signature small)."""

    composition_id: str
    request: VideoCompositionRequest
    output_path: Path
    temp_dir: str
    ffmpeg_path: str
    timeline_end: float


class VideoCompositionService:
    """
    Service for composing videos from timeline data.
    """
    
    def __init__(self):
        """Initialize the video composition service."""
        self.compositions: Dict[str, Dict[str, Any]] = {}
        # Under STORAGE_ROOT: the packaged backend's CWD is its install dir (EX3-06).
        self.output_dir = composed_output_dir()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        # composition_id -> set when the user cancels the export (EXO-07)
        self._cancel_events = CancelRegistry()

        # Initialize subtitle service for subtitle composition
        self.subtitle_service = SubtitleService()

        # Check ffmpeg availability
        self._check_ffmpeg()

        # Detect GPU encoder availability
        self._gpu_encoder = self._detect_gpu_encoder()

        # Concurrency control: limit simultaneous compositions to prevent CPU/memory overload
        self._composition_semaphore = threading.Semaphore(2)

        remove_stale_outputs(self.output_dir)
        logger.info(f"VideoCompositionService initialized (gpu_encoder={self._gpu_encoder})")
    
    def _check_ffmpeg(self) -> bool:
        """Check if ffmpeg is available."""
        try:
            subprocess.run(['ffmpeg', '-version'], 
                         capture_output=True, check=True)
            logger.info("ffmpeg is available")
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            logger.error("ffmpeg not found - video composition will not work")
            return False
    
    def _get_ffmpeg_path(self) -> Optional[str]:
        """Get ffmpeg executable path."""
        try:
            subprocess.run(['ffmpeg', '-version'], 
                         capture_output=True, check=True)
            return 'ffmpeg'
        except (subprocess.CalledProcessError, FileNotFoundError):
            logger.error("ffmpeg not available")
            return None
    
    def _detect_gpu_encoder(self) -> Optional[str]:
        """Detect available GPU hardware encoder via ffmpeg (spec 05 §2.5)."""
        return detect_gpu_encoder(self._get_ffmpeg_path() or "ffmpeg")

    def _get_encoding_params(self, quality: str = "fast") -> List[str]:
        """Get FFmpeg encoding parameters for the detected encoder + quality."""
        return get_encoding_params(self._gpu_encoder, quality)

    @staticmethod
    def _run_tracked_ffmpeg(
        cmd: List[str], progress_path: str, stage: str,
    ) -> subprocess.CompletedProcess:
        """``subprocess.run`` reporting activity to ``progress_path`` (RV3-02); a command
        line Windows refuses (``WinError 206``) becomes a readable stage error (EX3-04)."""
        try:
            return subprocess.run(with_progress(cmd, progress_path), capture_output=True, text=True)
        except OSError as exc:
            if getattr(exc, "winerror", None) != _WINDOWS_COMMAND_TOO_LONG:
                raise
            logger.error(
                f"FFmpeg command of stage '{stage}' is over the Windows command-line "
                f"limit ({len(cmd)} arguments)"
            )
            raise CompositionStageError(stage, _TOO_MANY_INPUTS) from exc

    def _compose_videos_filtergraph(
        self,
        request: VideoCompositionRequest,
        normalized_videos: List[str],
        output_path: Path,
        ffmpeg_path: str,
        output_resolution: Dict[str, int],
        timeline_end: float,
        temp_dir: str,
    ) -> bool:
        """Write the timeline's video stream to ``output_path`` (round 2, S6).

        Plans the canvas composite. A plain single gap-free track uses the concat
        demuxer over the planned inputs (returns False); everything else runs
        the canvas graph (returns True). A failed composite raises
        :class:`CompositionStageError`: it never falls back to concatenating
        every track, which produced a longer, wrong video reported as success
        (EXV-07). The seven inputs are the stage's real dependencies. Alpha-free
        runs are joined first: one input per run, not per clip (N-04 / EX3-04).
        """
        width, height = int(output_resolution["width"]), int(output_resolution["height"])
        fps = int(request.output_fps)
        clip_paths = self._clip_path_map(request, normalized_videos)
        plan = build_filtergraph(
            list(request.video_items), width, height,
            pre_trimmed=True, fps=fps, timeline_end=timeline_end,
            fit_mode=request.fit_mode,
        )
        if plan.can_use_concat:
            logger.info("Single contiguous track: composing with the concat demuxer")
            self._concat_videos(
                self._planned_input_paths(clip_paths, plan.video_inputs),
                output_path, temp_dir, ffmpeg_path,
            )
            return False

        canvas_clips = self._premerge_runs(
            plan_runs(request.video_items, fps), clip_paths, temp_dir, ffmpeg_path,
        )
        plan = build_filtergraph(
            canvas_clips, width, height, pre_trimmed=True, fps=fps,
            timeline_end=timeline_end, fit_mode=request.fit_mode,
        )
        planned_paths = self._planned_input_paths(clip_paths, plan.video_inputs)
        self._run_canvas_composite(plan, planned_paths, output_path, temp_dir, ffmpeg_path)
        return True

    def _run_canvas_composite(
        self, plan: FiltergraphResult, input_paths: List[str], output_path: Path,
        temp_dir: str, ffmpeg_path: str,
    ) -> None:
        """Run the canvas graph over ``input_paths``; a command too large to run is refused (N-04)."""
        if len(input_paths) > MAX_CANVAS_INPUTS:
            logger.error(
                f"Canvas composition needs {len(input_paths)} inputs "
                f"(limit {MAX_CANVAS_INPUTS})"
            )
            raise CompositionStageError("compose", _TOO_MANY_INPUTS)

        single_threaded = len(input_paths) > _SINGLE_THREAD_INPUT_THRESHOLD
        cmd = [ffmpeg_path, '-y']
        for path in input_paths:
            if single_threaded:
                cmd.extend(['-threads', '1'])
            cmd.extend(['-i', path])
        cmd.extend(filter_complex_args(plan.filter_complex, temp_dir, ffmpeg_path))
        cmd.extend(['-map', plan.output_label])
        cmd.extend(self._get_encoding_params("fast"))
        cmd.append(str(output_path))

        logger.info(
            f"Running canvas composition: {len(input_paths)} inputs, "
            f"timeline_end={plan.timeline_end:.3f}s"
        )
        logger.debug(f"Filtergraph: {plan.filter_complex}")
        result = self._run_tracked_ffmpeg(
            cmd, progress_file_path(temp_dir, CANVAS_PROGRESS_NAME), "compose",
        )
        if result.returncode != 0:
            summary = last_stderr_line(result.stderr)
            logger.error(f"Canvas composition failed: {summary}")
            raise CompositionStageError("compose", summary)
        logger.info("Canvas composition succeeded")

    @staticmethod
    def _clip_path_map(
        request: VideoCompositionRequest, normalized_videos: List[str],
    ) -> Dict[str, str]:
        """Clip id -> its normalized file."""
        return {
            item.id: normalized_videos[index]
            for index, item in enumerate(request.video_items)
            if index < len(normalized_videos)
        }

    @staticmethod
    def _planned_input_paths(clip_paths: Dict[str, str], clip_ids: List[str]) -> List[str]:
        """The file of every planned input, in plan order."""
        paths: List[str] = []
        for clip_id in clip_ids:
            path = clip_paths.get(clip_id)
            if not path:
                raise CompositionStageError("compose", f"normalized clip missing for {clip_id}")
            paths.append(path)
        return paths

    def _premerge_runs(
        self, runs: List[RunPlan], clip_paths: Dict[str, str], temp_dir: str, ffmpeg_path: str,
    ) -> List[Any]:
        """Canvas clips with each alpha-free multi-clip run joined into one file (N-04);
        normalized clips share codec and exact frame budgets, so concat is lossless."""
        canvas_clips: List[Any] = []
        for number, run in enumerate(runs):
            if run.needs_alpha or len(run.clips) == 1:
                canvas_clips.extend(pin_to_layer(clip, run.z) for clip in run.clips)
                continue
            run_id = f"__run_{number}"
            run_path = os.path.join(temp_dir, f"run_{number}.mp4")
            self._concat_videos(
                self._planned_input_paths(clip_paths, [clip.id for clip in run.clips]),
                Path(run_path), temp_dir, ffmpeg_path,
            )
            clip_paths[run_id] = run_path
            canvas_clips.append(merged_run_clip(run, run_id))
        return canvas_clips

    def _fail_composition(
        self, composition_id: str, *, error_details: Dict[str, Any], progress: float,
    ) -> None:
        """Mark a composition failed IN PLACE (EXO-13).

        Replacing the whole status dict dropped ``task_id``, ``start_time``,
        ``warnings`` and ``degradations``, so the status endpoint reported an
        anonymous failure.
        """
        info = self.compositions.setdefault(composition_id, {"id": composition_id})
        info.update(
            status="failed",
            progress=progress,
            error_details=error_details,
            error=error_details.get("error_summary"),
            failed_at=datetime.utcnow(),
        )
        if info.get('strict_image_ids') and error_details.get('composition_stage') != 'cancelled':
            info['error_code'] = 'COVER_EXPORT_FAILED'

    def _composition_failure_response(
        self, composition_id: str, request: VideoCompositionRequest, stage: str, summary: str,
    ) -> VideoCompositionResponse:
        """Fail the composition with a readable summary and build the response."""
        error_details = CompositionErrorDetails(
            failed_videos=[],
            total_videos=len(request.video_items),
            successful_videos=0,
            composition_stage=stage,
            error_summary=summary,
            recovery_suggestions=[
                "Check if all video files are accessible and not corrupted",
                "Verify that FFmpeg is properly configured",
                "Ensure there is enough disk space and memory",
                "Try simplifying the composition or reducing video quality",
                "Contact support if the issue persists"
            ]
        )
        progress = float(self.compositions.get(composition_id, {}).get("progress", 0.0))
        self._fail_composition(
            composition_id, error_details=error_details.model_dump(mode="json"), progress=progress,
        )
        return VideoCompositionResponse(
            success=False,
            message=summary,
            composition_id=composition_id,
            status="failed",
            progress=progress,
            error_details=error_details,
            error_code=self.compositions.get(composition_id, {}).get('error_code'),
        )

    def _record_degradation(
        self, composition_id: Optional[str], kind: str, items: Sequence[Any], reason: str,
    ) -> None:
        """Record content that did not reach the export (S7). Logged, never silent."""
        info = self.compositions.get(composition_id) if composition_id else None
        require_strict_images(info, items, reason)
        if info is None:
            logger.warning(f"Untracked composition lost {kind} content: {clip_reason(reason)}")
            return
        entry = append_degradation(info.setdefault("degradations", []), kind, items, reason)
        if entry is not None:
            logger.warning(
                f"Composition {composition_id} degraded ({kind}) for "
                f"{entry['item_names']}: {entry['reason']}"
            )

    def _record_skipped_images(
        self, composition_id: Optional[str], skipped: Sequence[SkippedImage],
    ) -> None:
        for skipped_image in skipped:
            self._record_degradation(
                composition_id, "image_overlay", [skipped_image.item], skipped_image.reason
            )

    @staticmethod
    def _remove_intermediates(paths: Sequence[str], output_path: Path) -> None:
        """Delete files a stage left next to the output; the output itself stays."""
        for path in paths:
            if path == str(output_path) or not os.path.exists(path):
                continue
            try:
                os.remove(path)
            except OSError as exc:
                logger.warning(f"Could not remove intermediate file {path}: {exc}")

    @staticmethod
    def _validate_clip_windows(request: VideoCompositionRequest) -> List[float]:
        """Source window length of every video item; an empty window is invalid."""
        durations: List[float] = []
        for i, video_item in enumerate(request.video_items):
            clip_start = getattr(video_item, 'clip_start', None) or 0.0
            clip_end = getattr(video_item, 'clip_end', None) or video_item.duration
            if clip_start < 0:
                logger.warning(f"Video {i+1}: Invalid clip_start {clip_start}, setting to 0.0")
                clip_start = 0.0
            if clip_end <= clip_start:
                logger.warning(f"Video {i+1}: Invalid clip_end {clip_end} <= clip_start {clip_start}, using full duration")
                clip_end = video_item.duration
            clipped_duration = clip_end - clip_start
            if clipped_duration <= 0:
                logger.error(f"Video {i+1}: Invalid clipped duration {clipped_duration}s, this will cause composition failure")
                raise ValueError(f"Video item {video_item.id} has invalid clipping parameters: start={clip_start}s, end={clip_end}s")
            durations.append(clipped_duration)
        return durations

    def _concat_videos(
        self,
        normalized_videos: List[str],
        output_path: Path,
        temp_dir: str,
        ffmpeg_path: str,
    ) -> None:
        """Concatenate normalized clips with the concat demuxer (the fast path).

        A failure is a compose-stage error summarised by the last FFmpeg stderr
        line, exactly like a failed canvas composite. Raising the whole stderr
        put the version banner and build configuration in ``error_summary``.
        """
        concat_list_path = os.path.join(temp_dir, "concat_list.txt")
        with open(concat_list_path, 'w', encoding='utf-8') as f:
            for video in normalized_videos:
                video_path_for_concat = video.replace('\\', '/')
                f.write(f"file '{video_path_for_concat}'\n")
        logger.info(f"Created concat list with {len(normalized_videos)} videos")

        logger.info("Combining videos...")
        concat_cmd = [
            ffmpeg_path, '-y',
            '-f', 'concat', '-safe', '0',
            '-i', concat_list_path,
            '-c', 'copy',
            str(output_path),
        ]
        # The re-encode fallback can encode a whole timeline: report activity (RV3-02)
        progress_path = progress_file_path(temp_dir, f"concat_{output_path.stem}")
        result = self._run_tracked_ffmpeg(concat_cmd, progress_path, "compose")
        if result.returncode != 0:
            logger.warning("Direct copy failed, trying re-encoding...")
            concat_cmd = [
                ffmpeg_path, '-y',
                '-f', 'concat', '-safe', '0',
                '-i', concat_list_path,
            ] + self._get_encoding_params("fast") + [str(output_path)]
            result = self._run_tracked_ffmpeg(concat_cmd, progress_path, "compose")
            if result.returncode != 0:
                summary = last_stderr_line(result.stderr)
                logger.error(f"Video concatenation failed: {summary}")
                raise CompositionStageError("compose", summary)

    def _ensure_even_dimensions(self, width: int, height: int) -> Tuple[int, int]:
        """Ensure dimensions are even numbers (divisible by 2) for H.264 encoding."""
        return ensure_even_dimensions(width, height)
    
    def _get_video_properties(self, video_path: str) -> tuple:
        """Display width, height and fps, or ``(None, None, None)``. ffprobe first: OpenCV
        reports the coded size and ignores rotation (EX3-01)."""
        info = probe_video_stream(video_path, ffprobe_path_for("ffmpeg"))
        if info is not None:
            return info.width, info.height, info.fps
        return self._cv2_video_properties(video_path)

    @staticmethod
    def _cv2_video_properties(video_path: str) -> tuple:
        """Coded width, height and fps from OpenCV, or ``(None, None, None)``."""
        try:
            cap = cv2.VideoCapture(video_path)
            if not cap.isOpened():
                return None, None, None

            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = cap.get(cv2.CAP_PROP_FPS)

            cap.release()
            return width, height, fps
        except Exception as e:
            logger.error(f"Failed to get video properties of {video_path}: {str(e)}")
            return None, None, None

    def _describe_source(self, video_path: str, ffmpeg_path: str) -> Optional[VideoStreamInfo]:
        """Display geometry and duration (``None`` when unknown) of a clip source (EX3-01 / EX3-02)."""
        info = probe_video_stream(video_path, ffprobe_path_for(ffmpeg_path))
        if info is not None:
            return info
        # OpenCV only: ffprobe already failed once for this file
        width, height, fps = self._cv2_video_properties(video_path)
        if not width or not height:
            return None
        return VideoStreamInfo(
            width=int(width), height=int(height), fps=float(fps or 30.0),
            duration=self._cv2_duration(video_path, fps), rotation=0,
        )

    @staticmethod
    def _cv2_duration(video_path: str, fps: Optional[float]) -> Optional[float]:
        """Frame-count duration; ``None`` when OpenCV cannot count the frames."""
        cap = cv2.VideoCapture(video_path)
        try:
            frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        finally:
            cap.release()
        if not fps or fps <= 0 or not frame_count or frame_count <= 0:
            return None
        return frame_count / fps

    def _normalize_video_with_retry(self, video_info: Dict[str, Any], max_retries: int = 3) -> Dict[str, Any]:
        """Normalize a single video with retry mechanism."""
        logger.info(f"Starting video normalization with retry: index {video_info['index']} (max_retries: {max_retries})")
        
        last_error = None
        
        for attempt in range(max_retries + 1):
            try:
                logger.info(f"Normalization attempt {attempt + 1}/{max_retries + 1} for video {video_info['index']}")
                
                # Call the existing normalization method
                result = self._normalize_video(video_info)
                
                if result.get('success'):
                    if attempt > 0:
                        logger.info(f"Video normalization succeeded on retry attempt {attempt + 1}")
                    else:
                        logger.info(f"Video normalization succeeded on first attempt")
                    return result
                else:
                    last_error = result.get('error', 'Unknown normalization error')
                    logger.warning(f"Normalization attempt {attempt + 1} failed: {last_error}")
                    if result.get('retryable') is False:
                        # A bad clip window or unreadable source fails the same
                        # way every time: retrying only delays the error (EX3-02).
                        return {**result, "attempts": attempt + 1, "last_error": last_error}
                    
                    if attempt >= max_retries:
                        break
                        
                    # Wait before retry with exponential backoff
                    wait_time = min(2 ** attempt, 10)
                    logger.info(f"Waiting {wait_time}s before normalization retry {attempt + 2}")
                    time.sleep(wait_time)
                    
            except Exception as e:
                last_error = str(e)
                logger.error(f"Normalization attempt {attempt + 1} exception: {last_error}")
                
                if attempt >= max_retries:
                    break
                    
                # Wait before retry
                wait_time = min(2 ** attempt, 10)
                logger.info(f"Waiting {wait_time}s before normalization retry {attempt + 2}")
                time.sleep(wait_time)
        
        # All attempts failed
        error_details = {
            "success": False,
            "error": f"Video normalization failed after {max_retries + 1} attempts",
            "last_error": last_error,
            "attempts": max_retries + 1,
            "warnings": [],
            "video_details": video_info
        }
        
        logger.error(f"All normalization attempts failed for video {video_info['index']}: {last_error}")
        return error_details
    
    # Over 60 lines: probing, scaling, the camera-motion fallback and the command share state.
    def _normalize_video(self, video_info: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize a single video to target specifications with optional clipping."""
        thread_id = threading.current_thread().ident
        video_path = video_info['video_path']
        index = video_info['index']
        temp_dir = video_info['temp_dir']
        ffmpeg_path = video_info['ffmpeg_path']
        
        # 新增：剪辑参数
        clip_start = video_info.get('clip_start', 0.0)
        clip_end = video_info.get('clip_end', None)
        
        logger.info(f"[Thread {thread_id}] Normalizing video {index + 1}")
        logger.info(f"[Thread {thread_id}] Clipping parameters: start={clip_start}s, end={clip_end}s")
        
        # Display size (rotation applied) and duration, which may be unknown (EX3-01 / EX3-02)
        source = self._describe_source(video_path, ffmpeg_path)
        if source is None:
            error_msg = f"Cannot get video properties: {video_path}"
            return {"success": False, "error": error_msg, "index": index, "retryable": False}
        width, height, fps = source.width, source.height, source.fps

        # 计算实际的剪辑参数；源时长未知时不钳制终点，-t 与 -frames:v 仍限定输出
        actual_clip_start = max(0.0, clip_start)
        actual_clip_end = clip_end if clip_end is not None else source.duration
        if source.duration is not None and actual_clip_end is not None:
            actual_clip_end = min(source.duration, actual_clip_end)
        clip_duration = actual_clip_end - actual_clip_start if actual_clip_end is not None else 0.0

        logger.info(
            f"[Thread {thread_id}] Source {width}x{height} {fps:.2f}fps rotation={source.rotation} "
            f"original={source.duration}s; clip {actual_clip_start:.2f}-{actual_clip_end}s"
        )

        # Validate clipping parameters
        if clip_duration <= 0:
            error_msg = f"Invalid clipping parameters: clip duration is {clip_duration:.2f}s"
            logger.error(f"[Thread {thread_id}] {error_msg}")
            return {"success": False, "error": error_msg, "index": index, "retryable": False}
        
        # Normalize video with clipping
        normalized_path = os.path.join(temp_dir, f"normalized_{index}.mp4")
        progress_path = progress_file_path(temp_dir, f"normalize_{index}")
        
        # 获取目标视频的宽高比信息
        target_aspect_ratio = self._get_aspect_ratio_info(video_info['target_aspect_ratio'])
        target_width = target_aspect_ratio["width"]
        target_height = target_aspect_ratio["height"]
        
        # 计算缩放和填充参数（画布适配 spec r2 §3.9.3；缺省 contain = 今天的行为）
        fit_mode = video_info.get('fit_mode') or 'contain'
        try:
            scaling_params = self._calculate_video_scaling(
                width, height, target_width, target_height, fit_mode
            )
        except CanvasFitError as exc:
            return self._canvas_fit_failure(thread_id, index, fit_mode, exc)
        camera_frame_w, camera_frame_h = camera_frame_size(scaling_params)

        # ── 运镜（camera-motion-2d-3d §4.4）────────────────────────────────
        # 滤镜链注入在 scale 之后、pad 之前（D4）：此刻画面正是「内容矩形」，
        # 与预览端的 fit-rect 同一个基准，运镜才不会被黑边污染。
        warnings: List[str] = []
        camera_chain = ""
        camera_motion = video_info.get('camera_motion')
        if camera_motion is not None:
            clip_label = video_info.get('camera_label') or f"clip {index + 1}"
            camera_chain, camera_warnings = build_camera_filter_chain(
                motion=camera_motion,
                frame_w=camera_frame_w,
                frame_h=camera_frame_h,
                fps=video_info['target_fps'],
                clip_duration=clip_duration,
                caps=self._get_camera_caps(ffmpeg_path),
                config=self._get_camera_config(),
                label=clip_label,
            )
            warnings.extend(camera_warnings)
            # 表达式预检：用 64x36/0.1s 的 lavfi 源空跑一遍，0.1 秒内抓住
            # 「该滤镜没有这个变量」这类必然失败（P0-1 / R13），而不是让 4K
            # 素材跑到一半才报错。结果按 chain 字符串进程级缓存。
            if camera_chain and self._get_camera_config().dry_run_probe:
                ok, first_error = dry_run_chain(camera_chain, ffmpeg_path)
                if not ok:
                    logger.error(
                        f"[Thread {thread_id}] Camera filter dry-run failed: {first_error}"
                    )
                    warnings.append(
                        f"{clip_label}: camera motion filter check failed "
                        f"({first_error or 'unknown error'}); rendered without motion"
                    )
                    camera_chain = ""

        try:
            vf_params = self._build_video_filter(scaling_params, camera_chain, fit_mode)
        except CanvasFitError as exc:
            return self._canvas_fit_failure(thread_id, index, fit_mode, exc)
        
        # 构建FFmpeg命令，包含剪辑参数
        normalize_cmd = [
            ffmpeg_path,
            '-y'
        ]
        
        # 添加剪辑参数
        if actual_clip_start > 0:
            normalize_cmd.extend(['-ss', str(actual_clip_start)])
        
        normalize_cmd.extend([
            '-i', video_path
        ])
        
        # Always bound the window: a source without a known length has nothing
        # to clamp it against (EX3-02)
        normalize_cmd.extend(['-t', str(clip_duration)])
        
        normalize_cmd.extend([
            '-vf', vf_params,
            '-r', str(video_info['target_fps']),
            # `-t` alone rounds up to whole frames and drifts clip after clip (EXV-10).
            '-frames:v', str(frame_count_for(
                video_info.get('timeline_start') or 0.0, clip_duration, video_info['target_fps'],
            )),
            '-an',  # Strip audio - video audio handled separately via _extract_video_audio_tracks
        ])
        # Use ultrafast preset for normalization (intermediate files, will be re-encoded later if needed)
        normalize_cmd.extend(self._get_encoding_params("ultrafast"))
        normalize_cmd.extend([
            '-movflags', '+faststart',
            '-avoid_negative_ts', 'make_zero',
            normalized_path
        ])
        
        try:
            logger.info(f"[Thread {thread_id}] Running FFmpeg command: {' '.join(normalize_cmd)}")
            result = self._run_tracked_ffmpeg(normalize_cmd, progress_path, "normalization")

            if result.returncode != 0 and camera_chain:
                # 运镜表达式错误是「确定性失败」，重试多少次都一样。降级必须发生在
                # 本函数内部（评审 P1-4）：放到外层 _normalize_video_with_retry 就会
                # 先白烧 4 次 + 2/4/8s 退避 ≈14s 才轮到降级，而外层 retry 的职责应当
                # 只是磁盘/编码器一类的瞬时故障。
                clip_label = video_info.get('camera_label') or f"clip {index + 1}"
                first_line = (result.stderr or '').strip().splitlines()
                logger.warning(
                    f"[Thread {thread_id}] Normalization with camera motion failed; "
                    f"retrying without it: {first_line[0] if first_line else 'unknown error'}"
                )
                warnings.append(
                    f"{clip_label}: rendering the camera motion failed; "
                    f"rendered without motion"
                )
                retry_cmd = [
                    arg if arg != vf_params
                    else self._build_video_filter(scaling_params, "", fit_mode)
                    for arg in normalize_cmd
                ]
                result = self._run_tracked_ffmpeg(retry_cmd, progress_path, "normalization")
                camera_chain = ""

            if result.returncode != 0:
                error_msg = f"Normalization failed: {result.stderr}"
                logger.error(f"[Thread {thread_id}] {error_msg}")
                return {"success": False, "error": error_msg, "index": index, "warnings": warnings}

            # 时长守卫：zoompan 的 fps 重采样可能让片段时长漂移，破坏时间轴对齐
            # （R3）。偏差超过 2 帧就视同失败，走同一条无运镜重跑路径。
            if camera_chain:
                actual = self._probe_output_duration(normalized_path)
                tolerance = 2.0 / max(1, video_info['target_fps'])
                if actual is not None and abs(actual - clip_duration) > tolerance:
                    clip_label = video_info.get('camera_label') or f"clip {index + 1}"
                    logger.warning(
                        f"[Thread {thread_id}] Camera motion shifted clip duration "
                        f"({actual:.3f}s vs {clip_duration:.3f}s); retrying without it"
                    )
                    warnings.append(
                        f"{clip_label}: the camera motion changed the clip length; "
                        f"rendered without motion"
                    )
                    retry_cmd = [
                        arg if arg != vf_params
                        else self._build_video_filter(scaling_params, "", fit_mode)
                        for arg in normalize_cmd
                    ]
                    result = self._run_tracked_ffmpeg(retry_cmd, progress_path, "normalization")
                    if result.returncode != 0:
                        error_msg = f"Normalization failed: {result.stderr}"
                        logger.error(f"[Thread {thread_id}] {error_msg}")
                        return {"success": False, "error": error_msg, "index": index, "warnings": warnings}

            logger.info(f"[Thread {thread_id}] Video {index + 1} normalized and clipped successfully")
            return {
                "success": True,
                "normalized_path": normalized_path,
                "used_duration": clip_duration,
                "index": index,
                "warnings": warnings,
            }

        except Exception as e:
            error_msg = f"Normalization error: {str(e)}"
            logger.error(f"[Thread {thread_id}] {error_msg}")
            return {"success": False, "error": error_msg, "index": index, "warnings": warnings}

    @staticmethod
    def _canvas_fit_failure(
        thread_id: Any, index: int, fit_mode: str, error: CanvasFitError
    ) -> Dict[str, Any]:
        """Normalization result for a fit filter that cannot be built.

        Deterministic, so it is not retried; rendering ``contain`` instead
        would silently differ from the preview (spec r2 §3.9.3).
        """
        error_msg = f"Canvas fit '{fit_mode}' failed: {error}"
        logger.error(f"[Thread {thread_id}] {error_msg}")
        return {"success": False, "error": error_msg, "index": index, "retryable": False}

    def _get_camera_config(self):
        """Process-level camera-motion config (config/camera-motion.yaml, D10)."""
        return load_camera_config()

    def _get_camera_caps(self, ffmpeg_path: str):
        """Process-level FFmpeg filter capability probe (§4.4.4 / R4)."""
        return probe_camera_filters(ffmpeg_path)

    def _probe_image_size(self, path: str) -> Tuple[int, int]:
        """Natural pixel size of an image file, or ``(0, 0)`` (camera-motion-stills §4.4.3).

        Three-step fallback (PIL header read → OpenCV decode → give up) and it
        NEVER raises: a corrupt or exotic image must cost that image its camera
        motion, not the user's whole export (R22 / G4).
        """
        try:
            from PIL import Image  # header-only read, no full decode
            with Image.open(path) as image:
                width, height = image.size
            if width > 0 and height > 0:
                return int(width), int(height)
        except Exception as exc:
            logger.warning(f"PIL could not read image size for {path}: {exc}")
        try:
            data = cv2.imread(path, cv2.IMREAD_UNCHANGED)
            if data is not None and getattr(data, 'size', 0):
                height, width = data.shape[:2]
                if width > 0 and height > 0:
                    return int(width), int(height)
        except Exception as exc:
            logger.warning(f"OpenCV could not read image size for {path}: {exc}")
        return (0, 0)

    def _record_composition_warnings(self, composition_id: str, warnings: List[str]) -> None:
        """Append de-duplicated warnings to the composition's status bucket (W2).

        The same sink the normalization workers use (see ``_compose_video_sync``),
        which is what carries a degraded still all the way to the user's bubble.
        """
        if not warnings or composition_id not in self.compositions:
            return
        bucket = self.compositions[composition_id].setdefault('warnings', [])
        for warning in warnings:
            if warning not in bucket:
                bucket.append(warning)

    def _probe_output_duration(self, video_path: str) -> Optional[float]:
        """Read a normalized clip's duration, same source as _get_video_properties."""
        try:
            cap = cv2.VideoCapture(video_path)
            fps = cap.get(cv2.CAP_PROP_FPS)
            frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            cap.release()
            if fps and fps > 0 and frames > 0:
                return frames / fps
        except Exception as exc:
            logger.warning(f"Could not probe normalized clip duration: {exc}")
        return None
    
    # Over 60 lines: every fail-fast request check runs before the status entry exists.
    def start_video_composition(self, request: VideoCompositionRequest,
                                prepared_cover: Optional[PreparedCover] = None) -> VideoCompositionResponse:
        """
        Start video composition asynchronously and return immediately with composition_id.
        """
        if request.required_cover is not None and prepared_cover is None:
            return VideoCompositionResponse(success=False, status='failed',
                message='封面尚未通过导出校验', error_code='COVER_EXPORT_FAILED')
        request = prepared_cover.request if prepared_cover else request.model_copy(deep=True)
        # Spec 03 §3.3 / §3.4 (V03-E) — fail fast on SSRF or local-path
        # attacks embedded in timeline JSON. We only validate the URL
        # shape here; per-call defense (FFmpeg protocol whitelist + path
        # resolution) is still applied downstream.
        try:
            self._guard_request_urls(request)
        except URLGuardError as guard_exc:
            if prepared_cover:
                prepared_cover.release()
            logger.warning(f"Composition request rejected by url_guard: {guard_exc}")
            return VideoCompositionResponse(
                success=False,
                message=f"Composition request rejected: {guard_exc}",
                composition_id="",
                status="failed",
                progress=0.0,
            )

        self._evict_settled_compositions()
        composition_id = str(uuid.uuid4())
        start_time = time.time()

        logger.info(f"Starting async video composition {composition_id} for task {request.task_id}")
        logger.info(f"Video items: {len(request.video_items)}, Audio items: {len(request.audio_items)}, Subtitle items: {len(request.subtitle_items)}")
        logger.info(f"Total composition duration: {request.total_duration}s")
        
        # Store composition info with initial status
        self.compositions[composition_id] = {
            "id": composition_id,
            "task_id": request.task_id,
            "status": "processing",
            "progress": 0.0,
            "stage": "queued",
            "start_time": start_time,
            "request": request,
            # camera-motion-2d-3d D14 (W2): non-fatal degrade notices raised by
            # the ASYNC normalize stage land here and travel out through
            # GET /compose/{id}/status. They CANNOT ride the compose response —
            # that one returns before normalization even begins.
            "warnings": [],
            # Round 2 S7: content that did not reach a completed export.
            "degradations": [],
            "strict_image_ids": {request.required_cover.image_item_id} if request.required_cover else set(),
            "prepared_cover": prepared_cover,
        }
        
        self._cancel_events.track(composition_id)
        # Start background processing
        try:
            threading.Thread(
                target=self._process_video_composition_async,
                args=(composition_id, request), daemon=True,
            ).start()
        except Exception:
            self._release_cover(composition_id)
            self._cancel_events.forget(composition_id)
            raise
        
        # Return immediately with processing status
        return VideoCompositionResponse(
            success=True,
            message="Video composition started successfully",
            composition_id=composition_id,
            status="processing",
            progress=0.0
        )
    
    def _process_video_composition_async(self, composition_id: str, request: VideoCompositionRequest):
        """
        Process video composition in background thread with concurrency control.
        """
        logger.info(f"Composition {composition_id} waiting for semaphore (max concurrent: 2)")
        if not self._acquire_composition_slot(composition_id):
            self._release_cover(composition_id)
            return
        try:
            logger.info(f"Background processing started for composition {composition_id}")

            result = self._compose_video_sync(composition_id, request)

            if result.success:
                logger.info(f"Async composition {composition_id} completed successfully")
            else:
                logger.error(f"Async composition {composition_id} failed: {result.message}")

        except Exception as e:
            error_msg = f"Async video composition failed: {str(e)}"
            logger.error(error_msg, exc_info=True)

            self._fail_composition(
                composition_id,
                error_details={"error_summary": error_msg, "composition_stage": "request"},
                progress=float(self.compositions.get(composition_id, {}).get("progress", 0.0)),
            )
        finally:
            self._release_cover(composition_id)
            self._composition_semaphore.release()
            self._cancel_events.forget(composition_id)
            logger.info(f"Composition {composition_id} released semaphore")

    def _release_cover(self, composition_id: str) -> None:
        prepared = self.compositions.get(composition_id, {}).pop('prepared_cover', None)
        if prepared:
            prepared.release()

    def _publish_cover_output(self, source: Path, destination: Path,
                              composition_id: str) -> None:
        """临时目录可跨磁盘；完整复制后原子发布，不暴露已知URL的半成品。"""
        pending = destination.with_suffix(f'.{uuid.uuid4().hex}.part')
        try:
            shutil.copyfile(source, pending)
            self._raise_if_cancelled(composition_id)
            os.replace(pending, destination)
        finally:
            remove_file(str(pending))

    def _acquire_composition_slot(self, composition_id: str) -> bool:
        """Wait for a slot, re-checking cancellation: False when cancelled while queued (RV3-13)."""
        while not self._composition_semaphore.acquire(timeout=_SLOT_POLL_SECONDS):
            if self._cancel_events.is_cancelled(composition_id):
                logger.info(f"Composition {composition_id} cancelled while queued")
                self._mark_cancelled(composition_id)
                self._cancel_events.forget(composition_id)
                return False
        self._set_stage(composition_id, "resolving")
        return True

    # Over 60 lines: the stage sequence shares one try/finally that owns the cleanup.
    def _compose_video_sync(self, composition_id: str, request: VideoCompositionRequest) -> VideoCompositionResponse:
        """
        Compose video from timeline data (synchronous processing).
        """
        start_time = time.time()
        
        logger.info(f"Starting video composition {composition_id} for task {request.task_id}")
        logger.info(f"Video items: {len(request.video_items)}, Audio items: {len(request.audio_items)}, Subtitle items: {len(request.subtitle_items)}, Image items: {len(request.image_items)}")
        logger.info(f"Frontend provided total duration: {request.total_duration}s")
        
        # Invalid clip windows are rejected up front (unchanged behaviour).
        clipped_video_durations = self._validate_clip_windows(request)
        # The export lasts until the timeline ends — not the sum of clip lengths,
        # which ignored overlapping tracks, gaps and images or audio running past
        # the last video (EXV-03).
        timeline_end = max(request.total_duration or 0.0, timeline_end_of(request))
        logger.info(
            f"Timeline end: {timeline_end:.3f}s "
            f"(frontend total_duration={request.total_duration}s)"
        )

        # 前端已确保正确的时间轴顺序，后端直接按接收到的顺序处理
        # 记录接收到的项目顺序以便调试
        logger.info("接收到的视频项目顺序（前端已排序）", extra={
            "video_items_order": [
                {
                    "index": i,
                    "id": item.id,
                    "name": item.name,
                    "start_time": item.start_time,
                    "duration": item.duration,
                    "track_id": item.track_id,
                    "clipped_duration": clipped_video_durations[i] if i < len(clipped_video_durations) else 0
                }
                for i, item in enumerate(request.video_items)
            ],
            "audio_items_order": [
                {
                    "index": i,
                    "id": item.id,
                    "name": item.name,
                    "start_time": item.start_time,
                    "duration": item.duration,
                    "track_id": item.track_id
                }
                for i, item in enumerate(request.audio_items)
            ],
            "image_items_order": [
                {
                    "index": i,
                    "id": item.id,
                    "name": item.name,
                    "start_time": item.start_time,
                    "duration": item.duration,
                    "track_id": item.track_id,
                    "position": item.position.__dict__ if hasattr(item.position, '__dict__') else item.position
                }
                for i, item in enumerate(request.image_items)
            ]
        })
        
        # Log individual video and audio items for debugging
        for i, video_item in enumerate(request.video_items):
            # 增强日志：包含裁剪信息 - 使用安全的属性访问
            clip_start = getattr(video_item, 'clip_start', None) or 0.0
            clip_end = getattr(video_item, 'clip_end', None) or video_item.duration
            is_trimmed = clip_start > 0.0 or clip_end != video_item.duration
            
            logger.info(f"Video item {i+1} (裁剪详情): "
                       f"timeline_start={video_item.start_time}s, "
                       f"timeline_duration={video_item.duration}s, "
                       f"timeline_end={video_item.start_time + video_item.duration}s, "
                       f"clip_start={clip_start}s, "
                       f"clip_end={clip_end}s, "
                       f"clip_duration={clip_end - clip_start}s, "
                       f"is_trimmed={is_trimmed}, "
                       f"url={video_item.url}")
                       
        for i, audio_item in enumerate(request.audio_items):
            # 增强日志：包含音频裁剪信息 - 使用安全的属性访问
            clip_start = getattr(audio_item, 'clip_start', None) or 0.0
            clip_end = getattr(audio_item, 'clip_end', None) or audio_item.duration
            is_trimmed = clip_start > 0.0 or clip_end != audio_item.duration
            
            logger.info(f"Audio item {i+1} (裁剪详情): "
                       f"timeline_start={audio_item.start_time}s, "
                       f"timeline_duration={audio_item.duration}s, "
                       f"timeline_end={audio_item.start_time + audio_item.duration}s, "
                       f"clip_start={clip_start}s, "
                       f"clip_end={clip_end}s, "
                       f"clip_duration={clip_end - clip_start}s, "
                       f"is_trimmed={is_trimmed}, "
                       f"url={audio_item.url}")
                       
        # Log individual image items for debugging
        for i, image_item in enumerate(request.image_items):
            logger.info(f"Image item {i+1} (叠加详情): "
                       f"timeline_start={image_item.start_time}s, "
                       f"timeline_duration={image_item.duration}s, "
                       f"timeline_end={image_item.start_time + image_item.duration}s, "
                       f"position={{x:{image_item.position.x}, y:{image_item.position.y}, w:{image_item.position.width}, h:{image_item.position.height}}}, "
                       f"opacity={image_item.opacity}, "
                       f"url={image_item.url}")
                       
        # 统计裁剪信息 - 使用安全的属性访问
        trimmed_video_count = sum(1 for item in request.video_items 
                                if (getattr(item, 'clip_start', None) and getattr(item, 'clip_start', 0.0) > 0.0) or
                                   (getattr(item, 'clip_end', None) and getattr(item, 'clip_end', item.duration) != item.duration))
        trimmed_audio_count = sum(1 for item in request.audio_items 
                                if (getattr(item, 'clip_start', None) and getattr(item, 'clip_start', 0.0) > 0.0) or
                                   (getattr(item, 'clip_end', None) and getattr(item, 'clip_end', item.duration) != item.duration))
                                   
        logger.info(f"裁剪统计: {trimmed_video_count}/{len(request.video_items)} 视频片段被裁剪, "
                   f"{trimmed_audio_count}/{len(request.audio_items)} 音频片段被裁剪, "
                   f"时间轴终点: {timeline_end}s")
        
        temp_dir = temp_dir_for(composition_id)
        output_filename = f"composed_{composition_id}.{request.output_format}"
        published_path = self.output_dir / output_filename
        strict_cover = bool(self.compositions.get(composition_id, {}).get('strict_image_ids'))
        output_path = Path(temp_dir) / output_filename if strict_cover else published_path
        # Every file a stage may leave next to the output; removed in `finally`
        # together with the temp dir, on success and on failure (EXO-13).
        intermediate_paths = _intermediate_paths_for(output_path)

        # One orchestration method on purpose: source-level contract tests pin the
        # stages it wires (normalize payload, overlay warning sinks).
        try:
            os.makedirs(temp_dir, exist_ok=True)
            # RV3-22: STORAGE_ROOT may not hold the export directory yet
            self.output_dir.mkdir(parents=True, exist_ok=True)
            self._raise_if_cancelled(composition_id)

            logger.info(f"Temp directory: {temp_dir}")
            logger.info(f"Output path: {output_path}")
            
            if composition_id in self.compositions:
                # The canvas stage interpolates its progress over the timeline (RV3-02)
                self.compositions[composition_id]["timeline_end"] = timeline_end
            self._set_stage(composition_id, "resolving", 0.1)
            
            # Download videos with retry mechanism and URL deduplication
            logger.info("Starting video downloads with retry mechanism and URL deduplication...")
            
            # Analyze video URLs to find duplicates
            url_to_indices = {}  # URL -> list of indices that use this URL
            unique_urls = []     # List of unique URLs to download
            # URL -> (source, source_id, cache_url) carried by the first item
            # that uses this URL. Drives composite-key cache reuse + write-back.
            url_to_meta = {}

            for i, item in enumerate(request.video_items):
                url = item.url
                if url not in url_to_indices:
                    url_to_indices[url] = []
                    unique_urls.append(url)
                    url_to_meta[url] = (
                        getattr(item, "source", None),
                        getattr(item, "source_id", None),
                        getattr(item, "cache_url", None),
                    )
                url_to_indices[url].append(i)
            
            # Log URL analysis results
            total_videos = len(request.video_items)
            unique_count = len(unique_urls)
            duplicate_count = total_videos - unique_count
            
            logger.info(f"URL deduplication analysis: {total_videos} total videos, {unique_count} unique URLs, {duplicate_count} duplicates")
            for url, indices in url_to_indices.items():
                if len(indices) > 1:
                    logger.info(f"URL '{url}' used by video indices: {indices}")
            
            downloaded_videos = [None] * len(request.video_items)  # Pre-allocate with correct size
            failed_downloads = []
            url_to_downloaded_path = {}  # URL -> downloaded file path mapping

            # Persistent cache lookup: any URL with a ready CachedMaterial entry
            # can skip the network download entirely. Must populate
            # url_to_downloaded_path BEFORE submitting downloads so we don't
            # re-fetch already-cached assets.
            # An image/audio-only export has no video to resolve (EXO-06).
            material_svc = get_material_download_service() if unique_urls else None
            # Spec 05 §2.3: the export pipeline is LOCAL-ONLY. Each unique URL
            # must resolve to a local file via the persistent cache OR the local
            # media resolver. There is NO silent download fallback — a URL that
            # is neither cached nor locally resolvable is a hard error telling
            # the user to localize the material first. `resolve_local_media`
            # encapsulates the cache-hit / local-resolver / explicit-error order
            # and reuses local_media_resolver's whitelist (no reimplementation).
            def _cache_lookup(url: str) -> Optional[str]:
                src, sid, cache_url = url_to_meta.get(url, (None, None, None))
                cached_path = material_svc.resolve_cached_path(
                    url=url, source=src, source_id=sid, cache_url=cache_url
                )
                if cached_path and os.path.exists(cached_path):
                    return cached_path
                return material_svc.lookup_by_url(url)

            for url in unique_urls:
                try:
                    resolved = resolve_local_media(url, cache_lookup=_cache_lookup)
                    url_to_downloaded_path[url] = resolved.local_path
                    logger.info(
                        f"Resolved local media for {url} -> {resolved.local_path} "
                        f"(origin={resolved.origin})"
                    )
                except NonLocalMediaError as resolve_exc:
                    logger.error(f"Non-local media reference in export: {resolve_exc}")
                    for video_index in url_to_indices[url]:
                        video_item = request.video_items[video_index]
                        failed_downloads.append(VideoProcessingError(
                            video_index=video_index,
                            video_id=video_item.id,
                            video_name=video_item.name,
                            video_url=video_item.url,
                            stage=VideoProcessingStage.DOWNLOAD,
                            attempts=1,
                            max_retries=1,
                            error_message=str(resolve_exc),
                            last_error=str(resolve_exc),
                            timeline_position=video_item.start_time,
                            duration=video_item.duration,
                        ))

            cache_hits = len(unique_urls) - len(failed_downloads)
            logger.info(
                f"Local media resolution: {cache_hits}/{len(unique_urls)} URLs "
                f"resolved locally, {len(failed_downloads)} unresolved (no download)"
            )
            
            # Check if any downloads failed
            if failed_downloads:
                error_details = CompositionErrorDetails(
                    failed_videos=failed_downloads,
                    total_videos=len(request.video_items),
                    successful_videos=total_videos - len(failed_downloads),
                    composition_stage="media_resolution",
                    error_summary=f"{len(failed_downloads)} out of {len(request.video_items)} videos could not be resolved to a local file",
                    recovery_suggestions=[
                        "Localize the material first (re-import or download it into the editor)",
                        "Remove materials that reference remote-only URLs from the timeline",
                        "Contact support if the issue persists"
                    ]
                )

                # Return detailed error response
                logger.error(f"Video composition failed: {len(failed_downloads)} videos could not be resolved locally")
                self._fail_composition(
                    composition_id,
                    error_details=error_details.model_dump(mode="json"),
                    progress=0.3,
                )

                return VideoCompositionResponse(
                    success=False,
                    message=error_details.error_summary,
                    composition_id=composition_id,
                    status="failed",
                    progress=0.3,
                    error_details=error_details
                )
            
            # Clips cut from one source all read that one file: normalization only
            # reads its input, and a copy per clip filled the temp disk (EX3-03).
            for url, indices in url_to_indices.items():
                if url in url_to_downloaded_path:
                    for video_index in indices:
                        downloaded_videos[video_index] = url_to_downloaded_path[url]

            # Verify all videos are assigned
            missing_videos = [i for i, path in enumerate(downloaded_videos) if path is None]
            if missing_videos:
                message = f"Internal error: missing downloaded videos for indices {missing_videos}"
                logger.error(message)
                self._fail_composition(
                    composition_id,
                    error_details={"error_summary": message, "composition_stage": "media_resolution"},
                    progress=0.3,
                )
                return VideoCompositionResponse(
                    success=False,
                    message=message,
                    composition_id=composition_id,
                    status="failed",
                    progress=0.3
                )

            logger.info(f"Video download completed with URL deduplication", extra={
                "total_videos": total_videos,
                "unique_downloads": unique_count,
                "duplicates_handled": duplicate_count,
                "downloaded_order": [
                    {"index": i, "path": path.split('/')[-1] if path else None} 
                    for i, path in enumerate(downloaded_videos)
                ]
            })
            
            self._set_stage(composition_id, "normalizing", 0.4)
            
            # Get target video parameters from request
            target_fps = request.output_fps
            target_aspect_ratio = request.aspect_ratio
            
            logger.info(f"Target composition parameters: aspect_ratio={target_aspect_ratio}, fps={target_fps}")
            
            # Normalize videos
            logger.info("Starting video normalization...")
            ffmpeg_path = self._get_ffmpeg_path()
            
            video_tasks = []
            for i, video_path in enumerate(downloaded_videos):
                # 获取对应的视频项目以获取剪辑信息
                video_item = request.video_items[i] if i < len(request.video_items) else None
                
                video_info = {
                    'video_path': video_path,
                    'index': i,
                    'temp_dir': temp_dir,
                    'target_fps': target_fps,
                    'ffmpeg_path': ffmpeg_path,
                    # 新增：剪辑参数 - 使用安全的属性访问
                    'clip_start': getattr(video_item, 'clip_start', None) or 0.0 if video_item else 0.0,
                    'clip_end': getattr(video_item, 'clip_end', None) if video_item else None,
                    # 时间轴起点：帧数按累积边界取整，连续片段段不累计漂移（EXV-10）
                    'timeline_start': getattr(video_item, 'start_time', 0.0) if video_item else 0.0,
                    # 新增：目标宽高比
                    'target_aspect_ratio': target_aspect_ratio,
                    # 新增：运镜配置 + 用于 warning 文案的片段名（camera-motion-2d-3d §4.4.2）
                    'camera_motion': getattr(video_item, 'camera_motion', None) if video_item else None,
                    'camera_label': getattr(video_item, 'name', None) if video_item else None,
                    # 画布适配（spec r2 §3.9.3）：整个工程统一一个值
                    'fit_mode': request.fit_mode,
                }
                video_tasks.append(video_info)
                
                # 记录剪辑信息
                if video_item:
                    clip_start = getattr(video_item, 'clip_start', None) or 0.0
                    clip_end = getattr(video_item, 'clip_end', None) or video_item.duration
                    logger.info(f"Video {i+1} clipping: {clip_start:.2f}s - {clip_end:.2f}s")
            
            normalized_videos = []
            failed_normalizations = []
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = {}
                for task in video_tasks:
                    self._raise_if_cancelled(composition_id, futures)
                    futures[executor.submit(self._normalize_video_with_retry, task)] = task['index']
                
                # 收集结果并保持原始顺序
                norm_results = {}
                for future in as_completed(futures):
                    self._raise_if_cancelled(composition_id, futures)
                    original_index = futures[future]
                    result = future.result()
                    # W2: worker threads MUST NOT write the shared composition
                    # dict — returning warnings with the result and appending
                    # them here, on the collecting thread, is the only
                    # thread-safe path (camera-motion-2d-3d §4.4.5).
                    for warning in result.get('warnings') or []:
                        bucket = self.compositions[composition_id].setdefault('warnings', [])
                        if warning not in bucket:
                            bucket.append(warning)
                    if result['success']:
                        norm_results[original_index] = result['normalized_path']
                        logger.info(f"Normalized video {len(norm_results)}/{len(video_tasks)} (index: {original_index})")
                    else:
                        # Record detailed failure information
                        video_item = request.video_items[original_index]
                        failed_normalization = VideoProcessingError(
                            video_index=original_index,
                            video_id=video_item.id,
                            video_name=video_item.name,
                            video_url=video_item.url,
                            stage=VideoProcessingStage.NORMALIZATION,
                            attempts=result.get('attempts', 1),
                            max_retries=3,
                            error_message=result.get('error', 'Unknown normalization error'),
                            last_error=result.get('last_error', 'Unknown error'),
                            timeline_position=video_item.start_time,
                            duration=video_item.duration
                        )
                        failed_normalizations.append(failed_normalization)
                        logger.error(f"Video normalization failed permanently at index {original_index}: {result['error']}")
                    completed = len(norm_results) + len(failed_normalizations)
                    self._set_stage(
                        composition_id, "normalizing", 0.4 + 0.3 * completed / len(video_tasks),
                    )
                
                # Check if any normalizations failed
                if failed_normalizations:
                    error_details = CompositionErrorDetails(
                        failed_videos=failed_normalizations,
                        total_videos=len(request.video_items),
                        successful_videos=len(norm_results),
                        composition_stage="video_normalization",
                        error_summary=f"{len(failed_normalizations)} out of {len(request.video_items)} videos failed to normalize after 3 retry attempts",
                        recovery_suggestions=[
                            "Check if the downloaded video files are corrupted",
                            "Verify that FFmpeg is properly installed and accessible",
                            "Try reducing the target resolution or frame rate",
                            "Ensure there is enough disk space for video processing"
                        ]
                    )
                    
                    # Return detailed error response
                    logger.error(f"Video composition failed: {len(failed_normalizations)} videos failed to normalize")
                    self._fail_composition(
                        composition_id,
                        error_details=error_details.model_dump(mode="json"),
                        progress=0.6,
                    )

                    return VideoCompositionResponse(
                        success=False,
                        message=error_details.error_summary,
                        composition_id=composition_id,
                        status="failed",
                        progress=0.6,
                        error_details=error_details
                    )
                
                # 按原始顺序添加到列表
                for i in range(len(video_tasks)):
                    normalized_videos.append(norm_results[i])
                    
            logger.info(f"Video normalization completed in correct order", extra={
                "normalized_order": [
                    {"index": i, "path": path.split('/')[-1]} 
                    for i, path in enumerate(normalized_videos)
                ]
            })
            
            self._raise_if_cancelled(composition_id)
            self._set_stage(composition_id, "compositing", 0.7)

            # Round 2 S6: one canvas composite places every clip at its real
            # start on a black canvas as long as the timeline. Only a plain
            # single track uses the concat demuxer, and a failed composite fails
            # the export instead of concatenating every track (EXV-07).
            output_resolution = request.output_resolution or self._get_aspect_ratio_info(
                request.aspect_ratio
            )
            self._compose_videos_filtergraph(
                request, normalized_videos, output_path, ffmpeg_path,
                output_resolution, timeline_end, temp_dir,
            )

            self._raise_if_cancelled(composition_id)
            self._set_stage(composition_id, "mixing", 0.9)

            # Extract embedded audio from video tracks
            video_audio_paths = self._extract_video_audio_tracks(
                request, temp_dir, ffmpeg_path,
                composition_id=composition_id, local_paths=downloaded_videos,
            )

            # Handle audio if present (independent audio tracks or video embedded audio)
            if request.audio_items or video_audio_paths:
                self._mix_audio_into_output(
                    _AudioMergeJob(
                        composition_id, request, output_path, temp_dir, ffmpeg_path, timeline_end,
                    ),
                    video_audio_paths,
                )
            else:
                logger.info("No audio tracks to process")
            self._set_stage(composition_id, "mixing", 0.93)

            self._raise_if_cancelled(composition_id)
            self._set_stage(composition_id, "overlays", 0.97)

            # Process image overlays and subtitles
            # When both exist, merge into a single FFmpeg pass to avoid redundant re-encoding
            all_image_items = list(request.image_items)
            has_images = bool(all_image_items)
            has_subtitles = bool(request.subtitle_items)

            if has_images and has_subtitles:
                # P0 optimization: merge image overlays + subtitles into ONE FFmpeg call
                logger.info(f"Merging {len(all_image_items)} image overlays and {len(request.subtitle_items)} subtitles into single encoding pass")
                try:
                    merged_output_path = str(output_path).replace('.mp4', '_merged.mp4')
                    success, overlay_warnings = self._process_overlays_and_subtitles_combined(
                        all_image_items,
                        request.subtitle_items,
                        str(output_path),
                        merged_output_path,
                        temp_dir,
                        request.output_resolution,
                        target_fps,
                        composition_id=composition_id,
                    )
                    # Still-motion warnings share the normalization bucket (W2)
                    # so they reach the user through the same status poll.
                    self._record_composition_warnings(composition_id, overlay_warnings)
                    if success:
                        if os.path.exists(merged_output_path):
                            os.replace(merged_output_path, str(output_path))
                            logger.info("Image overlays and subtitles added in single pass")
                        else:
                            require_strict_images(self.compositions.get(composition_id),
                                all_image_items, '封面叠加没有生成输出文件')
                    else:
                        require_strict_images(self.compositions.get(composition_id),
                            all_image_items, '封面合并叠加失败')
                        logger.warning("Merged processing failed, falling back to sequential processing")
                        # Fallback to sequential processing — its warnings must
                        # come back too (P1-1), and each pass that still fails is
                        # recorded as a degradation inside it.
                        self._record_composition_warnings(
                            composition_id,
                            self._process_overlays_sequential(
                                all_image_items, request, output_path, temp_dir,
                                composition_id=composition_id,
                            ),
                        )
                except CoverCompositionError:
                    raise
                except Exception as e:
                    require_strict_images(self.compositions.get(composition_id),
                        all_image_items, f'封面合并处理失败：{e}')
                    logger.error(f"Merged overlay+subtitle processing error: {str(e)}", exc_info=True)
                    logger.warning("Falling back to sequential processing")
                    self._record_composition_warnings(
                        composition_id,
                        self._process_overlays_sequential(
                            all_image_items, request, output_path, temp_dir,
                            composition_id=composition_id,
                        ),
                    )
            elif has_images:
                logger.info(f"Processing {len(all_image_items)} image overlay tracks...")
                video_with_images_path = str(output_path).replace('.mp4', '_with_images.mp4')
                try:
                    success, overlay_warnings = self._process_image_overlays(
                        all_image_items,
                        str(output_path),
                        video_with_images_path,
                        temp_dir,
                        request.output_resolution,
                        target_fps,
                        composition_id=composition_id,
                    )
                    self._record_composition_warnings(composition_id, overlay_warnings)
                    if success and os.path.exists(video_with_images_path):
                        os.replace(video_with_images_path, str(output_path))
                        logger.info("Image overlays successfully added to video")
                    else:
                        require_strict_images(self.compositions.get(composition_id),
                            all_image_items, '封面叠加失败或缺少输出文件')
                except OSError as e:
                    logger.error(f"Image overlay output could not replace the video: {e}", exc_info=True)
                    self._record_degradation(composition_id, "image_overlay", all_image_items, str(e))
            elif has_subtitles:
                logger.info(f"Processing {len(request.subtitle_items)} subtitle tracks...")
                self._burn_subtitles_into_output(
                    composition_id, request.subtitle_items, output_path, temp_dir
                )
            else:
                logger.info("No image overlays or subtitle tracks to process")

            self._set_stage(composition_id, "finalizing")
            self._raise_if_cancelled(composition_id)
            # Final processing
            processing_time = time.time() - start_time
            file_size = output_path.stat().st_size
            if strict_cover:
                self._publish_cover_output(output_path, published_path, composition_id)
                output_path = published_path
            self.compositions[composition_id].update({
                "status": "completed",
                "progress": 1.0,
                "output_file_path": str(output_path),
                "output_file_size": file_size,
                "processing_time": processing_time,
                "completed_at": datetime.utcnow(),
            })

            logger.info(f"Video composition completed: {output_filename}")
            logger.info(f"File size: {file_size / 1024 / 1024:.2f}MB")
            logger.info(f"Processing time: {processing_time:.2f}s")

            return VideoCompositionResponse(
                success=True,
                message="Video composition completed successfully",
                composition_id=composition_id,
                status="completed",
                progress=1.0,
                output_file_path=str(output_path),
                output_file_size=file_size,
                processing_time=processing_time
            )

        except CompositionCancelled:
            logger.info(f"Composition {composition_id} cancelled by the user")
            return self._cancelled_response(composition_id, output_path)
        except CoverCompositionError as e:
            self.compositions[composition_id]['error_code'] = e.code
            return self._composition_failure_response(composition_id, request, e.stage, e.summary)
        except CompositionStageError as e:
            logger.error(f"Video composition failed in stage '{e.stage}': {e.summary}")
            return self._composition_failure_response(composition_id, request, e.stage, e.summary)
        except Exception as e:
            error_msg = f"Video composition failed: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return self._composition_failure_response(
                composition_id, request, "finalization", error_msg
            )
        finally:
            # Temp inputs, graph scripts and every intermediate go on success and
            # failure alike (EXO-13).
            shutil.rmtree(temp_dir, ignore_errors=True)
            self._remove_intermediates(intermediate_paths, output_path)
            if self.compositions.get(composition_id, {}).get('status') != 'completed':
                remove_file(str(output_path))
            self._release_cover(composition_id)
            # The request payload is only needed while composing (EX3-06)
            self.compositions.get(composition_id, {}).pop("request", None)

    def get_composition_status(self, composition_id: str) -> Optional[Dict[str, Any]]:
        """A status snapshot with live FFmpeg activity and canvas progress (RV3-02)."""
        info = self.compositions.get(composition_id)
        return status_snapshot(composition_id, info) if info is not None else None
    
    def get_download_info(self, composition_id: str) -> Optional[Dict[str, Any]]:
        """Get download information for a completed composition."""
        composition = self.compositions.get(composition_id)
        if not composition or composition["status"] != "completed":
            return None
        
        output_path = Path(composition["output_file_path"])
        if not output_path.exists():
            return None
        
        return {
            "file_path": str(output_path),
            "file_name": output_path.name,
            "file_size": output_path.stat().st_size,
            "composition_id": composition_id
        } 

    def cancel_composition(self, composition_id: str) -> str:
        """``"cancelling"``, ``"settled"`` or ``"not_found"``; the worker stops at its next
        stage boundary and removes its files (EXO-07)."""
        info = self.compositions.get(composition_id)
        if info is None:
            return "not_found"
        if info.get("status") in SETTLED_STATUSES:
            return "settled"
        self._cancel_events.request(composition_id)
        logger.info(f"Cancellation requested for composition {composition_id}")
        return "cancelling"

    def _raise_if_cancelled(self, composition_id: str, futures: Iterable[Any] = ()) -> None:
        self._cancel_events.raise_if_cancelled(composition_id, futures)

    def _mark_cancelled(self, composition_id: str) -> None:
        """Settle a cancelled composition as failed in stage ``cancelled``."""
        info = self.compositions.get(composition_id, {})
        info.pop("request", None)
        self._fail_composition(
            composition_id,
            error_details={"error_summary": CANCELLED_SUMMARY, "composition_stage": "cancelled"},
            progress=float(info.get("progress", 0.0)),
        )

    def _cancelled_response(self, composition_id: str, output_path: Path) -> VideoCompositionResponse:
        """Settle a composition cancelled mid-pipeline and drop its partial output."""
        remove_file(str(output_path))
        self._mark_cancelled(composition_id)
        return VideoCompositionResponse(
            success=False, message=CANCELLED_SUMMARY, composition_id=composition_id,
            status="failed", progress=float(self.compositions[composition_id].get("progress", 0.0)),
        )

    def _set_stage(self, composition_id: str, stage: str, progress: Optional[float] = None) -> None:
        set_stage(self.compositions.get(composition_id), stage, progress)

    def _evict_settled_compositions(self) -> int:
        """Forget compositions settled over an hour ago and delete their exports (EX3-06)."""
        evicted = evict_settled(self.compositions)
        for info in evicted:
            remove_file(info.get("output_file_path"))
        if evicted:
            logger.info(f"Evicted {len(evicted)} settled compositions and their exports")
        return len(evicted)
    # Backend service root: backend-services/basic-service/. Resolved from this
    # file's location instead of CWD so the path holds whether uvicorn is launched
    # from repo root, the basic-service directory, or anywhere else.
    _SERVICE_ROOT = Path(__file__).resolve().parents[2]

    def _audio_prefix_dirs(self) -> dict[str, list[Path]]:
        """generated/subtitles audio URL prefix → candidate on-disk dirs.

        Canonical (persistent, writable STORAGE_ROOT) first, then the legacy
        service-install dir (B2 fallback). This is the same anchor the static
        mounts (app/main.py) and the shared resolver use, so a packaged-desktop
        install no longer writes audio to a volatile/read-only dir that export
        then fails to find. See
        docs/diagnoses/preview-seek-blackscreen-and-packaged-export-r3 (Bug B).
        """
        return {
            '/api/audio/generated/': [audio_generated_dir(), legacy_audio_generated_dir()],
            '/api/audio/subtitles/': [audio_subtitle_dir(), legacy_audio_subtitle_dir()],
        }

    def _guard_request_urls(self, request: VideoCompositionRequest) -> None:
        """Validate every user-controlled URL in a composition request.

        For http(s) URLs we delegate to :func:`validate_external_url` so
        SSRF targets are rejected before any worker thread spins up. For
        same-origin storage URLs (``/api/storage/files/...`` etc.) and
        bare local paths we defer validation to ``_convert_url_to_local_path``
        — those are the cheap branches that get hit per-clip anyway.

        Raises :class:`URLGuardError` on the first offending URL.
        """
        # Only audio items still reach FFmpeg as http(s) URLs. Videos and images
        # are read from local files or reported as non-local without any network
        # access, so a DNS check on them only broke exports on fake-ip or offline
        # networks (N-14).
        for items, opened_remotely in (
            (request.video_items, False),
            (request.audio_items, True),
            (request.image_items, False),
        ):
            for item in items:
                url = getattr(item, "url", None)
                if not isinstance(url, str) or not url:
                    continue
                lower = url.lower().strip()
                if lower.startswith("http://") or lower.startswith("https://"):
                    # Loopback same-origin references to local media routes are
                    # NOT external SSRF targets — the packaged desktop shell
                    # emits http://127.0.0.1:PORT/api/storage/files/... when a
                    # material field already holds an absolute same-origin URL.
                    # Defer them to per-clip resolution (which strips the host
                    # and still containerises via validate_local_path_for_ffmpeg)
                    # so the front door agrees with the resolver. See
                    # docs/diagnoses/video-export-packaged-desktop-loopback-ssrf.
                    if not opened_remotely or _is_loopback_local_reference(url):
                        continue
                    validate_external_url(url)
                    continue
                # Explicitly reject sketchy schemes inline so the error
                # message names the source.
                for forbidden in ("file:", "ftp:", "rtsp:", "rtmp:",
                                  "gopher:", "data:", "blob:", "javascript:"):
                    if lower.startswith(forbidden):
                        raise URLGuardError(
                            f"item url '{url}' uses disallowed scheme '{forbidden}'"
                        )

    def _ffmpeg_allowed_local_roots(self) -> list[Path]:
        """Spec 03 §3.4 (V03-E) — directories an FFmpeg input may live under.

        Includes the backend service root (covers static/uploads, the
        per-mount audio/subtitle dirs, and composed outputs), the
        configured STORAGE_ROOT, the media-proxy hot cache, the configured
        temp dir, and the system temp dir (used by ``tempfile.gettempdir``
        in the composition pipeline).
        """
        roots: list[Path] = [self._SERVICE_ROOT]
        for raw in (
            settings.storage.root,
            settings.media_proxy.hot_cache_dir,
            settings.temp_dir,
            tempfile.gettempdir(),
            str(self.output_dir),
        ):
            if not raw:
                continue
            p = Path(raw)
            if not p.is_absolute():
                p = self._SERVICE_ROOT / p
            roots.append(p)
        return roots

    def _convert_url_to_local_path(self, url: str) -> str:
        """
        Convert a server URL to local file path.
        Handles both local file paths and server URLs like /api/audio/generated/filename.mp3.
        Resolves relative paths against the backend service root rather than the
        process CWD, matching the static-file mounts in app/main.py.
        """
        logger.info(f"Converting URL to local path: {url}")

        try:
            resolved = resolve_media_reference(url, allow_remote=False)
            logger.info("Resolved local media reference", {
                "original_url": url,
                "local_path": str(resolved.path),
                "source_kind": resolved.source_kind,
            })
            return str(resolved.path)
        except LocalMediaResolveError:
            pass

        for prefix, candidate_dirs in self._audio_prefix_dirs().items():
            if url.startswith(prefix):
                filename = url[len(prefix):]
                for base in candidate_dirs:
                    local_path = str(base / filename)
                    if os.path.exists(local_path):
                        logger.info(f"Converted server URL to local path", {
                            'original_url': url,
                            'local_path': local_path,
                            'exists': True,
                        })
                        return local_path

                # None of the candidate roots held the file — point the error at
                # the canonical (STORAGE_ROOT) location.
                canonical_path = str(candidate_dirs[0] / filename)
                logger.error(f"Local file does not exist: {canonical_path}")
                raise FileNotFoundError(f"Audio file not found: {canonical_path}")

        # /api/storage/files/ is mounted at settings.storage.root (configurable via STORAGE_ROOT)
        storage_prefix = '/api/storage/files/'
        if url.startswith(storage_prefix):
            filename = url[len(storage_prefix):]
            storage_root = settings.storage.root
            # If storage_root is relative, anchor to service root for consistency.
            if not os.path.isabs(storage_root):
                local_path = str(self._SERVICE_ROOT / storage_root / filename)
            else:
                local_path = os.path.join(storage_root, filename)

            logger.info(f"Converted storage URL to local path", {
                'original_url': url,
                'local_path': local_path,
                'exists': os.path.exists(local_path)
            })

            if not os.path.exists(local_path):
                logger.error(f"Local file does not exist: {local_path}")
                raise FileNotFoundError(f"Audio file not found: {local_path}")

            return local_path

        if url.startswith('http://') or url.startswith('https://'):
            # Spec 03 §3.3 (V03-E) — even for "pass-through" FFmpeg input
            # URLs, run url_guard so attacker-controlled timeline JSON
            # cannot smuggle ``http://127.0.0.1/...`` or
            # ``http://169.254.169.254`` past the composition pipeline.
            try:
                safe_url = validate_external_url(url)
            except URLGuardError as guard_exc:
                logger.warning(f"Video composition URL rejected: {guard_exc}")
                raise FileNotFoundError(
                    f"URL rejected by security guard: {guard_exc}"
                ) from guard_exc
            logger.info(f"Using HTTP URL directly: {safe_url}")
            return safe_url

        # Assume it's already a local file path. Anchor relative paths to the
        # service root so callers don't have to depend on CWD.
        logger.info(f"Using local file path: {url}")
        if os.path.isabs(url):
            local_path = url
        else:
            local_path = str(self._SERVICE_ROOT / url)
            if not os.path.exists(local_path) and os.path.exists(url):
                # Fallback to CWD-relative for backward compatibility.
                local_path = url

        if not os.path.exists(local_path):
            logger.error(f"Local file does not exist: {local_path}")
            raise FileNotFoundError(f"Audio file not found: {local_path}")

        # Spec 03 §3.4 (V03-E) — block ``/etc/passwd`` and similar absolute
        # paths from sneaking into FFmpeg via timeline JSON. Validate against
        # the union of legitimate roots (STORAGE_ROOT, cached materials,
        # temp dirs, service root). On failure we raise FileNotFoundError to
        # match the existing contract of this helper.
        try:
            validated = validate_local_path_for_ffmpeg(
                local_path, self._ffmpeg_allowed_local_roots()
            )
            local_path = str(validated)
        except URLGuardError as guard_exc:
            logger.warning(f"Video composition local path rejected: {guard_exc}")
            raise FileNotFoundError(
                f"Path rejected by security guard: {guard_exc}"
            ) from guard_exc

        return local_path

    def _mix_audio_into_output(self, job: _AudioMergeJob, video_audio_paths: list) -> None:
        """Mix every audio source and mux the mix into the output video.

        Audio items that cannot be mixed are reported as degradations (EXO-03).
        Losing ALL audio still fails the export: a video without its sound is not
        a usable result.
        """
        logger.info("Processing audio tracks...")
        mix = self._process_audio_tracks(
            job.request, job.temp_dir, job.ffmpeg_path, job.timeline_end,
            extra_audio_paths=video_audio_paths,
        )
        for dropped in mix.dropped:
            self._record_degradation(
                job.composition_id, "audio_item",
                [SimpleNamespace(id=dropped.item_id, name=dropped.name)], dropped.reason,
            )
        if not mix.path:
            audio_count = len(job.request.audio_items) if job.request.audio_items else 0
            extra_count = len(video_audio_paths) if video_audio_paths else 0
            raise RuntimeError(
                "Audio merge skipped: no audio could be mixed "
                f"(audio_items={audio_count}, video_audio_paths={extra_count}). "
                "See earlier logs for FileNotFoundError or FFmpeg stderr details."
            )

        logger.info("Adding mixed audio to video...")
        output_path = str(job.output_path)
        video_with_audio_path = output_path.replace('.mp4', '_with_audio.mp4')
        audio_video_cmd = [
            job.ffmpeg_path,
            '-y',
            '-i', output_path,
            '-i', mix.path,
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-map', '0:v:0',  # Map video from first input
            '-map', '1:a:0',  # Map audio from second input (our processed audio)
            # No '-shortest': the mix already lasts until the timeline end, and
            # -shortest used to truncate the video when the audio was shorter.
            video_with_audio_path
        ]
        logger.info(f"Running audio-video merge command: {' '.join(audio_video_cmd)}")
        result = self._run_tracked_ffmpeg(
            audio_video_cmd, progress_file_path(job.temp_dir, "merge"), "audio",
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"FFmpeg audio-video merge failed (returncode={result.returncode}): "
                f"{last_stderr_line(result.stderr) or 'no stderr'}"
            )
        if not os.path.exists(video_with_audio_path):
            raise RuntimeError(
                "Audio-video merge output file was not created "
                f"(expected at {video_with_audio_path})"
            )
        os.replace(video_with_audio_path, output_path)
        logger.info("Audio successfully added to video")

    def _extract_video_audio_tracks(
        self,
        request: VideoCompositionRequest,
        temp_dir: str,
        ffmpeg_path: str,
        composition_id: Optional[str] = None,
        local_paths: Optional[Sequence[Optional[str]]] = None,
    ) -> list:
        """
        Extract embedded audio from video items that have audio streams.
        Returns a list of dicts matching processed_audio_paths format:
        [{'path': str, 'start_time': float, 'name': str, 'track_id': str}]

        A clip whose file cannot be probed or extracted is reported as an
        ``embedded_audio`` degradation; a clip without an audio stream is simply
        silent (EXO-03).
        """
        video_audio_paths = []

        for i, video_item in enumerate(request.video_items):
            # Spec 01 §2.4 / spec 05 §2.4: a detached video clip contributes
            # NO embedded audio — its audio plays from the derived
            # independent audio item, so extracting here would double it.
            if getattr(video_item, 'audio_detached', None):
                logger.info(
                    f"Video {i+1} ({video_item.name}) audio is detached; "
                    f"skipping embedded-audio extraction"
                )
                continue
            try:
                entry, failure = self._extract_one_video_audio(
                    i, video_item, temp_dir, ffmpeg_path, _nth_or_none(local_paths, i),
                )
            except OSError as exc:
                entry, failure = None, str(exc)
            if failure:
                logger.warning(f"Failed to extract audio from video item {video_item.name}: {failure}")
                self._record_degradation(composition_id, "embedded_audio", [video_item], failure)
            elif entry:
                video_audio_paths.append(entry)
                logger.info(f"Successfully extracted audio from video {i+1}: {video_item.name}")

        logger.info(f"Extracted {len(video_audio_paths)} audio tracks from {len(request.video_items)} video items")
        return video_audio_paths

    # Over 60 lines: the audio-stream probe and the extraction report failures in one shape.
    def _extract_one_video_audio(
        self, index: int, video_item: VideoCompositionItem, temp_dir: str, ffmpeg_path: str,
        local_path: Optional[str] = None,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """``(entry, None)``; ``(None, None)`` without an audio stream; ``(None, reason)``.
        Prefers the video stage's ``local_path``: re-resolving lost cached clips' sound (N-14)."""
        if not local_path:
            try:
                local_path = self._convert_url_to_local_path(video_item.url)
            except _MEDIA_RESOLVE_ERRORS as exc:
                return None, str(exc)

        # Use ffprobe to check if the video has an audio stream
        ffprobe_path = ffprobe_path_for(ffmpeg_path)
        probe_cmd = [
            ffprobe_path,
            '-v', 'error',
            '-select_streams', 'a',
            '-show_entries', 'stream=codec_type',
            '-of', 'csv=p=0',
            local_path
        ]
        probe_result = subprocess.run(probe_cmd, capture_output=True, text=True)
        if probe_result.returncode != 0:
            # An unreadable file is not a silent clip: its sound would go missing.
            return None, last_stderr_line(probe_result.stderr) or "the audio stream could not be probed"
        if not probe_result.stdout.strip():
            logger.info(f"Video {index+1} ({video_item.name}) has no audio stream, skipping")
            return None, None

        logger.info(f"Video {index+1} ({video_item.name}) has audio stream, extracting with volume={video_item.volume}")
        clip_start = getattr(video_item, 'clip_start', None) or 0.0
        clip_end = getattr(video_item, 'clip_end', None) or video_item.duration
        # Volume: model stores 0-2 (already a multiplier)
        vol = video_item.volume if video_item.volume is not None else 1.0
        extracted_path = os.path.join(temp_dir, f"video_audio_{index}.wav")

        extract_cmd = [ffmpeg_path, '-y']
        if clip_start > 0:
            extract_cmd.extend(['-ss', str(clip_start)])
        extract_cmd.extend([
            '-i', local_path,
            '-t', str(clip_end - clip_start),
            '-vn',
            '-af', f'volume={vol}',
            '-ar', '44100',
            '-ac', '2',
            extracted_path
        ])
        logger.info(f"Extracting video audio: {' '.join(extract_cmd)}")
        result = self._run_tracked_ffmpeg(
            extract_cmd, progress_file_path(temp_dir, f"embedded_audio_{index}"), "audio",
        )
        if result.returncode != 0:
            return None, last_stderr_line(result.stderr) or "the embedded audio could not be extracted"
        return {
            'path': extracted_path,
            'start_time': video_item.start_time,
            'name': f'{video_item.name} (embedded audio)',
            'track_id': video_item.track_id
        }, None

    def _process_audio_tracks(
        self,
        request: VideoCompositionRequest,
        temp_dir: str,
        ffmpeg_path: str,
        timeline_end: float,
        extra_audio_paths: Optional[list] = None,
    ) -> AudioMixResult:
        """Mix the request's audio items (plus extracted clip audio) into one file.

        Returns the mixed file (``path=None`` when nothing could be mixed) and
        every audio item that had to be left out, so the caller reports it
        instead of shipping a silently incomplete export (EXO-03). The mix lasts
        until ``timeline_end`` (EXV-03).
        """
        has_audio_items = bool(request.audio_items)
        has_extra_audio = bool(extra_audio_paths)

        if not has_audio_items and not has_extra_audio:
            logger.info("No audio items to process")
            return AudioMixResult(path=None)

        if has_audio_items:
            logger.info(f"Processing {len(request.audio_items)} audio tracks", {
                'audio_items': [
                    {
                        'id': item.id,
                        'name': item.name,
                        'url': item.url,
                        'start_time': item.start_time,
                        'duration': item.duration,
                        'volume': item.volume
                    }
                    for item in request.audio_items
                ]
            })
        if has_extra_audio:
            logger.info(f"Also processing {len(extra_audio_paths)} extra audio tracks (from video embedded audio)")

        audio_mix_path = os.path.join(temp_dir, "audio_mix.wav")
        try:
            if has_audio_items and len(request.audio_items) == 1 and not has_extra_audio:
                return self._mix_single_audio_item(
                    request.audio_items[0], audio_mix_path, temp_dir, ffmpeg_path, timeline_end
                )
            return self._mix_audio_sources(
                request, list(extra_audio_paths or []), audio_mix_path, ffmpeg_path, timeline_end
            )
        except CompositionStageError:
            raise
        except Exception as e:
            logger.error(f"Audio processing failed with exception: {str(e)}", exc_info=True)
            return AudioMixResult(path=None)

    # Over 60 lines: the delayed-start and immediate-start commands differ in shape.
    def _mix_single_audio_item(
        self, audio_item: Any, audio_mix_path: str, temp_dir: str, ffmpeg_path: str,
        timeline_end: float,
    ) -> AudioMixResult:
        """One audio item and no clip audio: position it without an amix graph."""
        try:
            local_audio_path = self._convert_url_to_local_path(audio_item.url)
        except _MEDIA_RESOLVE_ERRORS as resolve_exc:
            logger.error(
                f"Failed to resolve single audio path for '{audio_item.name}': {resolve_exc}",
                exc_info=True,
            )
            return AudioMixResult(path=None, dropped=[_dropped_audio(audio_item, str(resolve_exc))])

        logger.info(f"Processing single audio track: {audio_item.name} at {audio_item.start_time}s")
        logger.info(f"Audio item details: duration={audio_item.duration}s, volume={audio_item.volume}")
        # 安全获取音频裁剪参数
        audio_clip_start = getattr(audio_item, 'clip_start', None) or 0.0
        audio_clip_end = getattr(audio_item, 'clip_end', None) or audio_item.duration
        clip_duration = audio_clip_end - audio_clip_start
        logger.info(f"Audio clipping: start={audio_clip_start}s, end={audio_clip_end}s; timeline end {timeline_end}s")

        if audio_item.start_time > 0:
            # Audio starts later: clip it, then prepend silence up to its start.
            logger.info("Audio starts after video beginning, creating padded audio track")
            temp_audio_path = os.path.join(temp_dir, "temp_audio.wav")
            audio_segment_cmd = [ffmpeg_path, '-y']
            if audio_clip_start > 0:
                audio_segment_cmd.extend(['-ss', str(audio_clip_start)])
            audio_segment_cmd.extend([
                '-i', local_audio_path,
                '-t', str(min(audio_item.duration, clip_duration)),
                '-af', f'volume={audio_item.volume}',
                '-ar', '44100',
                '-ac', '2',
                temp_audio_path
            ])
            logger.info(f"Creating audio segment: {' '.join(audio_segment_cmd)}")
            result = self._run_tracked_ffmpeg(
                audio_segment_cmd, progress_file_path(temp_dir, "audio_segment"), "audio",
            )
            if result.returncode != 0:
                logger.error(f"Audio segment creation failed: {result.stderr}")
                return AudioMixResult(
                    path=None, dropped=[_dropped_audio(audio_item, last_stderr_line(result.stderr))]
                )
            final_cmd = [
                ffmpeg_path,
                '-y',
                '-f', 'lavfi',
                '-i', 'anullsrc=r=44100:cl=stereo',
                '-i', temp_audio_path,
                '-filter_complex', f'[0:a]atrim=duration={audio_item.start_time}[silence];[silence][1:a]concat=n=2:v=0:a=1[out]',
                '-map', '[out]',
                '-t', str(timeline_end),
                audio_mix_path
            ]
        else:
            final_cmd = [ffmpeg_path, '-y']
            if audio_clip_start > 0:
                final_cmd.extend(['-ss', str(audio_clip_start)])
            final_cmd.extend([
                '-i', local_audio_path,
                '-af', f'volume={audio_item.volume}',
                '-ar', '44100',
                '-ac', '2',
                '-t', str(min(timeline_end, clip_duration)),  # Use clipped duration
                audio_mix_path
            ])

        logger.info(f"Running final audio command: {' '.join(final_cmd)}")
        result = self._run_tracked_ffmpeg(
            final_cmd, progress_file_path(temp_dir, "audio_mix"), "audio",
        )
        if result.returncode != 0:
            logger.error("Single audio processing failed", {
                'command': ' '.join(final_cmd),
                'stderr': result.stderr,
            })
            return AudioMixResult(
                path=None, dropped=[_dropped_audio(audio_item, last_stderr_line(result.stderr))]
            )
        if not os.path.exists(audio_mix_path):
            logger.error("Audio processing completed but output file not found")
            return AudioMixResult(
                path=None, dropped=[_dropped_audio(audio_item, "the mixed audio file was not created")]
            )
        logger.info(f"Single audio track processed successfully, output size: {os.path.getsize(audio_mix_path)} bytes")
        return AudioMixResult(path=audio_mix_path)

    def _mix_audio_sources(
        self, request: VideoCompositionRequest, extra_audio_paths: list, audio_mix_path: str,
        ffmpeg_path: str, timeline_end: float,
    ) -> AudioMixResult:
        """Pre-process every audio item, then position and mix all sources with amix."""
        temp_dir = os.path.dirname(audio_mix_path)
        total_audio_count = len(request.audio_items) + len(extra_audio_paths)
        logger.info(f"Mixing {total_audio_count} audio tracks with independent volume control")

        processed_audio_paths: List[Dict[str, Any]] = []
        dropped: List[DroppedAudio] = []
        for i, audio_item in enumerate(request.audio_items):
            processed_path = os.path.join(temp_dir, f"processed_audio_{i}.wav")
            label = f"{i+1}/{len(request.audio_items)}"
            entry, failure = self._preprocess_audio_item(audio_item, processed_path, ffmpeg_path, label)
            if failure:
                dropped.append(_dropped_audio(audio_item, failure))
            elif entry:
                processed_audio_paths.append(entry)

        # Merge extra audio paths (from video embedded audio)
        if extra_audio_paths:
            processed_audio_paths.extend(extra_audio_paths)
            logger.info(f"Merged {len(extra_audio_paths)} video embedded audio tracks into mix")

        if not processed_audio_paths:
            logger.error("No audio tracks were successfully pre-processed")
            return AudioMixResult(path=None, dropped=dropped)

        # Volume and routing (mute / audio_detached drop) are already applied
        # upstream, so the shared builder only positions + pads + mixes + trims.
        parts: List[Dict[str, Any]] = []
        try:
            sources = processed_audio_paths
            if len(sources) > MAX_MIX_INPUTS:
                parts = self._mix_audio_chunks(sources, temp_dir, ffmpeg_path, timeline_end)
                sources = parts
            mixed = bool(sources) and self._run_audio_mix(sources, audio_mix_path, ffmpeg_path, timeline_end)
        finally:
            self._remove_preprocessed_audio(processed_audio_paths + parts)

        if not mixed:
            return AudioMixResult(path=None, dropped=dropped)
        logger.info(f"Audio mixing completed successfully, output size: {os.path.getsize(audio_mix_path)} bytes")
        return AudioMixResult(path=audio_mix_path, dropped=dropped)

    def _mix_audio_chunks(
        self, sources: List[Dict[str, Any]], temp_dir: str, ffmpeg_path: str, timeline_end: float,
    ) -> List[Dict[str, Any]]:
        """Mix ``sources`` in ``MAX_MIX_INPUTS`` chunks, ``[]`` when one fails (EX3-04). Float
        chunk samples: a chunk summing above 0 dBFS must not clip before the final mix (RV3-14)."""
        parts: List[Dict[str, Any]] = []
        for number, indices in enumerate(chunk_sources(len(sources))):
            part_path = os.path.join(temp_dir, f"mix_part_{number}.wav")
            chunk = [sources[index] for index in indices]
            if not self._run_audio_mix(chunk, part_path, ffmpeg_path, timeline_end, float_samples=True):
                self._remove_preprocessed_audio(parts)
                return []
            parts.append({'path': part_path, 'start_time': 0.0, 'name': f'audio mix part {number + 1}'})
        logger.info(f"Mixed {len(sources)} audio sources in {len(parts)} chunks")
        return parts

    def _run_audio_mix(
        self, sources: List[Dict[str, Any]], output_path: str, ffmpeg_path: str,
        timeline_end: float, float_samples: bool = False,
    ) -> bool:
        """Position ``sources`` on the timeline and mix them into ``output_path``."""
        temp_dir = os.path.dirname(output_path)
        mix_filter = build_audio_mix(
            [AudioSource(start_time=info['start_time']) for info in sources], timeline_end,
        ).filter_complex
        mix_cmd = [ffmpeg_path, '-y']
        for audio_info in sources:
            mix_cmd.extend(['-i', audio_info['path']])
        mix_cmd.extend(filter_complex_args(mix_filter, temp_dir, ffmpeg_path))
        mix_cmd.extend(['-map', '[out]', '-t', str(timeline_end), '-ar', '44100', '-ac', '2'])
        if float_samples:
            mix_cmd.extend(['-c:a', 'pcm_f32le'])
        mix_cmd.append(output_path)
        logger.info(f"Running audio mix of {len(sources)} inputs into {os.path.basename(output_path)}")
        stem = os.path.splitext(os.path.basename(output_path))[0]
        result = self._run_tracked_ffmpeg(mix_cmd, progress_file_path(temp_dir, stem), "audio")
        if result.returncode != 0:
            logger.error("Audio mixing failed", {'command': ' '.join(mix_cmd), 'stderr': result.stderr})
            return False
        if not os.path.exists(output_path):
            logger.error(f"Audio mixing completed but {output_path} was not created")
            return False
        return True

    def _preprocess_audio_item(
        self, audio_item: Any, processed_path: str, ffmpeg_path: str, label: str,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """Bake volume and clip window into one file: ``(entry, None)`` or ``(None, reason)``."""
        try:
            local_audio_path = self._convert_url_to_local_path(audio_item.url)
        except _MEDIA_RESOLVE_ERRORS as exc:
            logger.error(f"Failed to pre-process audio item {audio_item.name}: {exc}")
            return None, str(exc)

        # 安全获取音频裁剪参数
        audio_clip_start = getattr(audio_item, 'clip_start', None) or 0.0
        audio_clip_end = getattr(audio_item, 'clip_end', None) or audio_item.duration
        logger.info(f"Pre-processing audio {label}: {audio_item.name}", {
            'volume': audio_item.volume,
            'start_time': audio_item.start_time,
            'clip_start': audio_clip_start,
            'clip_end': audio_clip_end,
            'track_id': audio_item.track_id
        })

        process_cmd = [ffmpeg_path, '-y']
        if audio_clip_start > 0:
            process_cmd.extend(['-ss', str(audio_clip_start)])
        process_cmd.extend([
            '-i', local_audio_path,
            '-af', f'volume={audio_item.volume}',
            '-t', str(audio_clip_end - audio_clip_start),
            '-ar', '44100',
            '-ac', '2',
            processed_path
        ])
        logger.info(f"Audio pre-process command: {' '.join(process_cmd)}")
        result = subprocess.run(process_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error(f"Audio pre-processing failed for {audio_item.name}", {
                'command': ' '.join(process_cmd),
                'stderr': result.stderr,
            })
            return None, last_stderr_line(result.stderr) or "audio pre-processing failed"

        logger.info(f"Successfully pre-processed audio: {audio_item.name}")
        return {
            'path': processed_path,
            'start_time': audio_item.start_time,
            'name': audio_item.name,
            'track_id': audio_item.track_id
        }, None

    @staticmethod
    def _remove_preprocessed_audio(processed_audio_paths: List[Dict[str, Any]]) -> None:
        for audio_info in processed_audio_paths:
            try:
                if os.path.exists(audio_info['path']):
                    os.remove(audio_info['path'])
            except OSError as e:
                logger.warning(f"Failed to clean up processed audio file {audio_info['path']}: {str(e)}")

    def _get_aspect_ratio_info(self, aspect_ratio: AspectRatio) -> Dict[str, Any]:
        """Get aspect ratio information including resolution and ratio value."""
        return get_aspect_ratio_info(aspect_ratio)

    def _calculate_video_scaling(self,
                                source_width: int,
                                source_height: int,
                                target_width: int,
                                target_height: int,
                                fit_mode: str = "contain") -> Dict[str, Any]:
        """Calculate scale/pad parameters maintaining aspect ratio (letter/pillarbox)."""
        return calculate_video_scaling(
            source_width, source_height, target_width, target_height, fit_mode
        )

    def _build_video_filter(
        self,
        scaling_params: Dict[str, Any],
        camera_chain: str = "",
        fit_mode: str = "contain",
    ) -> str:
        """Build FFmpeg video filter string for aspect ratio conversion.

        ``camera_chain`` (camera-motion-2d-3d D4) is injected after ``scale`` and
        before ``pad``; an empty chain leaves the output byte-identical to the
        pre-feature behaviour.
        """
        return build_video_filter(scaling_params, camera_chain, fit_mode)

    def _process_subtitle_tracks(self, subtitle_items: List[SubtitleCompositionItem],
                               video_path: str, temp_dir: str) -> Optional[str]:
        """Burn subtitle items into ``video_path``, each item in its own style.

        Returns the subtitled file written next to ``video_path``, or None when
        no item has text to burn. Raises :class:`CompositionStageError` when the
        burn-in fails; callers record a ``subtitles`` degradation (S7). There is
        no fixed timeout: a long export must not lose its subtitles (EXO-16).
        """
        width, height, _fps = self._get_video_properties(video_path)
        if not width or not height:
            raise CompositionStageError(
                "subtitles", f"cannot read the video size of {os.path.basename(video_path)}"
            )
        text_files_dir = os.path.join(temp_dir, "subtitle_text")
        os.makedirs(text_files_dir, exist_ok=True)
        filters = self.subtitle_service.build_drawtext_filters_for_items(
            subtitle_items, width, height, text_files_dir
        )
        if not filters:
            logger.info("No subtitle item has text to burn in")
            return None
        subtitled_path = video_path.replace('.mp4', '_with_subtitles.mp4')
        self.subtitle_service.burn_drawtext_filters(
            video_path, subtitled_path, filters, temp_dir, timeout=None,
            progress_path=progress_file_path(temp_dir, "subtitles"),
        )
        return subtitled_path

    def _burn_subtitles_into_output(
        self, composition_id: Optional[str], subtitle_items: List[SubtitleCompositionItem],
        output_path: Path, temp_dir: str,
    ) -> None:
        """Replace the output with its subtitled version; a failure is a degradation."""
        try:
            subtitled_path = self._process_subtitle_tracks(subtitle_items, str(output_path), temp_dir)
            if subtitled_path and os.path.exists(subtitled_path):
                os.replace(subtitled_path, str(output_path))
                logger.info("Subtitles successfully added to video")
        except CompositionStageError as exc:
            self._record_degradation(composition_id, "subtitles", subtitle_items, exc.summary)
        except OSError as exc:
            logger.error(f"Subtitle burn-in output could not be written: {exc}", exc_info=True)
            self._record_degradation(composition_id, "subtitles", subtitle_items, str(exc))

    def _process_overlays_sequential(
        self, all_image_items: List, request, output_path, temp_dir: str,
        composition_id: Optional[str] = None,
    ) -> List[str]:
        """Fallback: process image overlays and subtitles sequentially (two encoding passes).

        Returns the overlay warnings so the caller can put them in the status
        bucket (camera-motion-stills P1-1 / R28). This is the path a user reaches
        only after the merged pass already failed — i.e. exactly the path that
        most needs to explain itself — so swallowing warnings here would leave
        them with a silently motion-less export and no clue why. A pass that
        fails here as well is recorded as a degradation (S7).
        """
        warnings: List[str] = []
        video_with_images_path = str(output_path).replace('.mp4', '_with_images.mp4')
        try:
            success, overlay_warnings = self._process_image_overlays(
                all_image_items, str(output_path), video_with_images_path,
                temp_dir, request.output_resolution, request.output_fps,
                composition_id=composition_id,
            )
            warnings.extend(overlay_warnings)
            if success and os.path.exists(video_with_images_path):
                os.replace(video_with_images_path, str(output_path))
                logger.info("Image overlays added (sequential fallback)")
            else:
                require_strict_images(self.compositions.get(composition_id),
                    all_image_items, '封面顺序叠加失败或缺少输出文件')
        except OSError as e:
            logger.error(f"Image overlay error in fallback: {e}", exc_info=True)
            self._record_degradation(composition_id, "image_overlay", all_image_items, str(e))

        self._burn_subtitles_into_output(
            composition_id, request.subtitle_items, output_path, temp_dir
        )
        return warnings

    def _resolve_overlay_image(self, url: str) -> Tuple[Optional[str], Optional[str]]:
        """``(local_path, None)`` or ``(None, reason)`` — never downloads (EXO-18).

        Export is local-only: a remote image is reported instead of fetched with
        an unbounded ``requests.get``, and one bad image no longer aborts the
        whole overlay batch (EXO-04); nor does one undecodable image (EX3-05).
        """
        try:
            local_path = self._convert_url_to_local_path(url)
        except _MEDIA_RESOLVE_ERRORS as exc:
            return None, str(exc)
        if local_path.startswith(("http://", "https://")):
            return None, "remote image is not available locally"
        if not os.path.exists(local_path):
            return None, "image file not found"
        if not self._is_decodable_image(local_path):
            return None, "image file cannot be decoded"
        return local_path, None

    @staticmethod
    def _is_decodable_image(path: str) -> bool:
        try:
            from PIL import Image
        except ImportError:
            return cv2.imread(path) is not None
        try:
            with Image.open(path) as image:
                image.verify()
            return True
        except Exception as exc:
            logger.warning(f"Image overlay {path} cannot be decoded: {exc}")
            return False

    def _build_still_overlay_inputs(
        self, image_items: List, video_path: str, temp_dir: str,
        output_resolution: Dict[str, int], output_fps: int, ffmpeg_path: str,
        *, disable_camera: bool = False,
    ) -> Tuple[List[str], List[Dict[str, Any]], List[str], List[SkippedImage]]:
        """Resolve every image and lay out the FFmpeg inputs in ONE pass (D27).

        The pass has to be single because ``-loop`` / ``-t`` / ``-framerate`` are
        INPUT options: they only mean anything immediately before the ``-i`` they
        modify. The previous two-pass shape (resolve + ``-i`` first, geometry and
        timing later) left no place to put them — appending them on the second
        pass would attach them to the NEXT input, or to the output, rewriting the
        whole command's meaning (R26). Merging the passes also keeps the entry
        index — which becomes ``[k:v]`` / ``[imgN]`` — in lockstep with input
        order.

        Images are laid out by z-index, then request order — the order the
        preview draws them (EXO-02). A fully transparent image is left out on
        purpose; an image that cannot be resolved locally is returned in
        ``skipped`` so the caller reports it.

        Returns ``(cmd_prefix, entries, warnings, skipped)`` where ``cmd_prefix``
        already holds the base video plus every image input, and ``entries``
        carries the per-image plan and pixel position for the filtergraph step.
        """
        cmd: List[str] = [ffmpeg_path, '-y', '-i', video_path]
        entries: List[Dict[str, Any]] = []
        warnings: List[str] = []
        skipped: List[SkippedImage] = []

        video_width = output_resolution['width']
        video_height = output_resolution['height']
        caps = self._get_camera_caps(ffmpeg_path)
        config = self._get_camera_config()
        stacking = sorted(
            enumerate(image_items), key=lambda pair: (_image_stack_key(pair[1]), pair[0])
        )

        for i, item in stacking:
            opacity = _image_opacity(item)
            if opacity <= _HIDDEN_IMAGE_OPACITY:
                logger.info(f"Image overlay {item.id} is fully transparent; not rendered")
                continue
            local_image_path, skip_reason = self._resolve_overlay_image(item.url)
            if skip_reason:
                logger.warning(f"Image overlay {item.id} skipped: {clip_reason(skip_reason)}")
                skipped.append(SkippedImage(item=item, reason=skip_reason))
                continue

            # Handle position from either image_position (video track items) or position (dedicated image items)
            pos = getattr(item, 'image_position', None) or getattr(item, 'position', None)
            if not pos:
                logger.warning(f"No position information for image item {item.id}, using default position")
                pos = type('Position', (), {
                    'x': 0.1, 'y': 0.1, 'width': 0.3, 'height': 0.3, 'z_index': 10
                })()

            # Calculate actual pixel positions
            x = int(pos.x * video_width)
            y = int(pos.y * video_height)
            w = int(pos.width * video_width)
            h = int(pos.height * video_height)

            # Ensure dimensions are even for H.264 encoding
            even_w, even_h = self._ensure_even_dimensions(w, h)

            motion = None if disable_camera else getattr(item, 'camera_motion', None)
            # Only decode a header when the answer can change something: an image
            # with no motion keeps the pre-feature cost profile exactly (D17).
            nat_w, nat_h = self._probe_image_size(local_image_path) if motion is not None else (0, 0)

            plan = build_still_overlay_plan(
                motion,
                nat_w=nat_w, nat_h=nat_h,
                box_w=even_w, box_h=even_h,
                fps=output_fps,
                duration=item.duration,
                start_time=item.start_time,
                caps=caps,                                   # D26: never implicit
                label=getattr(item, 'name', None) or f"image {i + 1}",
                ffmpeg_path=ffmpeg_path,
                config=config,
                opacity=opacity,
            )
            warnings.extend(plan.warnings)

            logger.info(
                f"Image overlay {len(entries) + 1}: position=({x},{y}) "
                f"size=({even_w}x{even_h}) time={item.start_time}s-"
                f"{item.start_time + item.duration}s opacity={opacity} "
                f"camera={'yes' if plan.animated else 'no'}"
            )

            cmd.extend(plan.input_args)          # must stay adjacent to its -i
            cmd.extend(['-i', local_image_path])
            entries.append({'item': item, 'plan': plan, 'x': x, 'y': y})

        return cmd, entries, warnings, skipped

    def _build_still_overlay_filters(
        self, entries: List[Dict[str, Any]],
    ) -> Tuple[List[str], str]:
        """Filtergraph fragments for the image inputs laid out by the single pass.

        With no camera motion every image chain is character-identical to the
        inline f-strings this replaced (D16 / C11). The overlay window is
        half-open, so two adjacent images never share a boundary frame (RV-09).
        """
        filter_parts: List[str] = []
        base_input = "[0:v]"
        for i, entry in enumerate(entries):
            item = entry['item']
            plan = entry['plan']
            input_idx = i + 1  # +1 because [0] is the video
            start_time = item.start_time
            end_time = item.start_time + item.duration

            filter_parts.append(f"[{input_idx}:v]{plan.chain}[img{i}]")

            previous = base_input if i == 0 else f"[v{i-1}]"
            filter_parts.append(
                f"{previous}[img{i}]overlay={entry['x']}:{entry['y']}"
                f":enable='gte(t,{start_time})*lt(t,{end_time})'{plan.overlay_suffix}[v{i}]"
            )
        final_output = f"[v{len(entries)-1}]" if entries else ""
        return filter_parts, final_output

    @staticmethod
    def _camera_retry_warnings(entries: List[Dict[str, Any]]) -> List[str]:
        """One per-clip note for D22's motion-free retry (§6.1: name first)."""
        return [
            f"{getattr(entry['item'], 'name', None) or 'image'}: rendering the "
            f"camera motion failed; rendered without motion"
            for entry in entries if entry['plan'].animated
        ]

    # Over 60 lines: image inputs, the drawtext merge and the motion-free retry build one command.
    def _process_overlays_and_subtitles_combined(
        self, image_items: List, subtitle_items: List,
        video_path: str, output_path: str, temp_dir: str,
        output_resolution: Dict[str, int], output_fps: int = 30,
        *, composition_id: Optional[str] = None,
    ) -> Tuple[bool, List[str]]:
        """
        Merge image overlays and subtitle drawtext filters into a single FFmpeg encoding pass.
        This eliminates one full re-encoding compared to processing them sequentially.

        Returns ``(success, warnings)``; ``success`` with no output file means
        there was nothing to render. Camera motion is injected here through
        exactly the same constructor as the image-only branch (D16): if only one
        of the two branches knew about motion, adding a subtitle would silently
        delete every still's camera motion (H3 / R17). Every subtitle keeps its
        own style (EXO-01) and unresolvable images are recorded, not fatal.
        """
        warnings: List[str] = []
        try:
            ffmpeg_path = self._get_ffmpeg_path()

            # --- Build image overlay inputs and filter chain (single pass, D27) ---
            cmd, entries, plan_warnings, skipped = self._build_still_overlay_inputs(
                image_items, video_path, temp_dir, output_resolution,
                output_fps, ffmpeg_path,
            )
            warnings.extend(plan_warnings)
            self._record_skipped_images(composition_id, skipped)
            filter_parts, last_overlay_output = self._build_still_overlay_filters(entries)

            # --- Build subtitle drawtext filters straight from the items ---
            text_files_dir = os.path.join(temp_dir, "merged_subtitle_text")
            os.makedirs(text_files_dir, exist_ok=True)
            drawtext_filters = self.subtitle_service.build_drawtext_filters_for_items(
                subtitle_items, output_resolution['width'], output_resolution['height'],
                text_files_dir,
            )
            if not drawtext_filters and not entries:
                logger.info("Nothing to overlay: no renderable image and no subtitle text")
                return True, warnings

            def assemble(cmd_prefix: List[str], parts: List[str], last_label: str) -> List[str]:
                """Tail of the command for a given set of image inputs.

                A motion-free retry (D22) changes the INPUT ARGUMENTS too, not
                just one filter string, so the whole command has to be rebuilt
                — the video side's "swap the single -vf element" trick does not
                apply here.
                """
                if not drawtext_filters:
                    logger.warning("No drawtext filters generated, proceeding with image overlays only")
                    merged_complex = ";".join(parts)
                    merged_output = last_label
                elif parts:
                    # Merge: chain drawtext filters onto the last overlay output
                    merged_parts = list(parts)
                    merged_parts.append(f"{last_label}{','.join(drawtext_filters)}[vout]")
                    merged_complex = ";".join(merged_parts)
                    merged_output = "[vout]"
                else:
                    # No valid image items but have subtitles - use drawtext only via filter_complex
                    merged_complex = f"[0:v]{','.join(drawtext_filters)}[vout]"
                    merged_output = "[vout]"
                full = list(cmd_prefix)
                full.extend(filter_complex_args(merged_complex, temp_dir, ffmpeg_path))
                full.extend([
                    '-map', merged_output,
                    '-map', '0:a?',
                    '-c:a', 'copy',
                ])
                full.extend(self._get_encoding_params("fast"))
                full.append(output_path)
                return full

            cmd = assemble(cmd, filter_parts, last_overlay_output)

            logger.info(f"Running merged overlay+subtitle command")
            result = self._run_tracked_ffmpeg(cmd, progress_file_path(temp_dir, "overlays"), "overlays")

            if result.returncode != 0 and any(e['plan'].animated for e in entries):
                # D22 / G4: camera motion is a garnish — it must never be the
                # reason an export fails. Rebuild the entire command with the
                # motion stripped and try exactly once more.
                logger.warning(
                    "Merged overlay pass with camera motion failed; retrying "
                    f"without motion: {last_stderr_line(result.stderr)}"
                )
                retry_cmd, retry_entries, _, retry_skipped = self._build_still_overlay_inputs(
                    image_items, video_path, temp_dir, output_resolution,
                    output_fps, ffmpeg_path, disable_camera=True,
                )
                self._record_skipped_images(composition_id, retry_skipped)
                retry_parts, retry_last = self._build_still_overlay_filters(retry_entries)
                retry_result = self._run_tracked_ffmpeg(
                    assemble(retry_cmd, retry_parts, retry_last),
                    progress_file_path(temp_dir, "overlays"), "overlays",
                )
                if retry_result.returncode == 0:
                    warnings.extend(self._camera_retry_warnings(entries))
                result = retry_result

            if result.returncode == 0:
                logger.info("Merged overlay+subtitle processing completed successfully")
                return True, warnings
            logger.error(f"Merged processing failed: {last_stderr_line(result.stderr)}")
            require_strict_images(self.compositions.get(composition_id),
                image_items, last_stderr_line(result.stderr))
            return False, warnings

        except CoverCompositionError:
            raise
        except Exception as e:
            # The caller falls back to the sequential passes, which record any
            # loss that persists as a degradation.
            logger.error(f"Error in merged overlay+subtitle processing: {str(e)}", exc_info=True)
            require_strict_images(self.compositions.get(composition_id), image_items, str(e))
            return False, warnings

    # Over 60 lines: image inputs and the motion-free retry build one command.
    def _process_image_overlays(
        self, image_items: List, video_path: str, output_path: str, temp_dir: str,
        output_resolution: Dict[str, int], output_fps: int = 30,
        *, composition_id: Optional[str] = None,
    ) -> Tuple[bool, List[str]]:
        """
        Process image overlays and add them to the video.

        Args:
            image_items: List of video items that are actually image overlays
            video_path: Path to the input video file
            output_path: Path for the output video with overlays
            temp_dir: Temporary directory for processing
            output_resolution: Video output resolution dict with 'width' and 'height'
            output_fps: Composition frame rate; the loop rate of animated stills
            composition_id: Status entry that receives image degradations

        Returns:
            ``(success, warnings)`` — the warnings explain any still whose camera
            motion was degraded, and the caller forwards them to the status
            channel so the user sees WHY the picture is not moving. Images that
            could not be rendered are recorded as ``image_overlay`` degradations.
        """
        warnings: List[str] = []
        try:
            logger.info(f"Starting image overlay processing for {len(image_items)} image items")

            # Get FFmpeg path
            ffmpeg_path = self._get_ffmpeg_path()

            # Resolve, probe, plan and lay out every input in one pass (D27)
            cmd, entries, plan_warnings, skipped = self._build_still_overlay_inputs(
                image_items, video_path, temp_dir, output_resolution,
                output_fps, ffmpeg_path,
            )
            warnings.extend(plan_warnings)
            self._record_skipped_images(composition_id, skipped)

            if len(entries) == 0:
                logger.warning("No renderable image items to overlay")
                return False, warnings

            # Build filter complex for image overlays
            filter_parts, final_output = self._build_still_overlay_filters(entries)

            def assemble(cmd_prefix: List[str], parts: List[str], last_label: str) -> List[str]:
                full = list(cmd_prefix)
                full.extend(filter_complex_args(";".join(parts), temp_dir, ffmpeg_path))
                full.extend([
                    '-map', last_label,
                    '-map', '0:a?',  # Copy audio if it exists
                    '-c:a', 'copy',  # Copy audio codec
                ])
                full.extend(self._get_encoding_params("fast"))
                full.append(output_path)
                return full

            cmd = assemble(cmd, filter_parts, final_output)

            logger.info(f"Image overlay filter complex: {';'.join(filter_parts)}")
            logger.info(f"Running image overlay command with {len(entries)} images")

            result = self._run_tracked_ffmpeg(cmd, progress_file_path(temp_dir, "overlays"), "overlays")

            if result.returncode != 0 and any(e['plan'].animated for e in entries):
                # D22 / G4: strip every camera chain and try once more. The retry
                # rebuilds the WHOLE command because the input arguments change
                # too (`-loop 1 -t ...` disappears), not just one filter string.
                logger.warning(
                    "Image overlay pass with camera motion failed; retrying "
                    f"without motion: {last_stderr_line(result.stderr)}"
                )
                retry_cmd, retry_entries, _, retry_skipped = self._build_still_overlay_inputs(
                    image_items, video_path, temp_dir, output_resolution,
                    output_fps, ffmpeg_path, disable_camera=True,
                )
                self._record_skipped_images(composition_id, retry_skipped)
                retry_parts, retry_last = self._build_still_overlay_filters(retry_entries)
                retry_result = self._run_tracked_ffmpeg(
                    assemble(retry_cmd, retry_parts, retry_last),
                    progress_file_path(temp_dir, "overlays"), "overlays",
                )
                if retry_result.returncode == 0:
                    warnings.extend(self._camera_retry_warnings(entries))
                result = retry_result

            if result.returncode == 0:
                logger.info(f"Image overlay processing completed successfully")
                return True, warnings
            reason = last_stderr_line(result.stderr)
            logger.error(f"Image overlay processing failed: {reason}")
            self._record_degradation(
                composition_id, "image_overlay", [entry['item'] for entry in entries], reason
            )
            return False, warnings

        except CoverCompositionError:
            raise
        except Exception as e:
            logger.error(f"Error processing image overlays: {str(e)}", exc_info=True)
            self._record_degradation(composition_id, "image_overlay", image_items, str(e))
            return False, warnings
