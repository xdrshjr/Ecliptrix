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
import yaml
import random
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field, replace
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse

import cv2

from app.logger import get_logger
from app.config import settings
from app.security.url_guard import (
    FFMPEG_LOCAL_PROTOCOL_WHITELIST,
    FFMPEG_REMOTE_PROTOCOL_WHITELIST,
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
    SubtitleAddRequest,
    VideoProcessingError,
    CompositionErrorDetails,
    VideoProcessingStage
)
from app.models.youtube_models import YoutubeVideoDownloadRequest
from app.services.subtitle_service import SubtitleService
from app.services.youtube_service import YouTubeService
from app.services.material_download_service import get_material_download_service
from app.services.local_media_resolver import (
    LOCAL_HOSTS,
    ROUTE_PREFIXES,
    LocalMediaResolveError,
    audio_generated_dir,
    audio_subtitle_dir,
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
    FiltergraphOptions,
    FiltergraphResult,
    build_filtergraph,
)
from app.services.composition.camera_motion_filters import CameraMotionUnsupportedError
from app.services.composition.camera_motion_overlay import (
    OverlayBox,
    OverlayMotion,
    OverlayTiming,
    overlay_motion_for_item,
)
from app.services.composition import ffmpeg_caps
from app.services.composition.audio_mix import AudioSource, build_audio_mix
from app.services.composition.overlay_box import (
    DEFAULT_IMAGE_POSITION,
    build_contain_pad_filter,
    quantise_overlay_box,
)
from app.services.composition.video_scaling import (
    build_video_filter,
    calculate_video_scaling,
    ensure_even_dimensions,
    get_aspect_ratio_info,
)
from app.services.composition.subtitle_prep import (
    create_srt_from_subtitle_items,
    seconds_to_srt_time,
)
from app.services.composition.media_download import (
    download_image,
    is_pexels_url,
    is_youtube_url,
)

logger = get_logger(__name__)

#: Above this many characters the ``-filter_complex`` goes into a script file
#: instead of an argv element. Windows funnels every argument through
#: ``CreateProcess`` (~32767-char limit) even without a shell, and a long
#: camera-motion graph is the only thing here that can approach it. 8 KB leaves
#: ample headroom for the input paths and encoder flags that share the line.
FILTER_COMPLEX_INLINE_LIMIT = 8192


class _StaticFramingCaps:
    """Capability view that forces the camera-motion builder to freeze the move.

    Wraps whatever the probe returned instead of copying it: the caps object is
    consumed duck-typed everywhere else, and a `dataclasses.replace` here would
    quietly couple this retry path to one concrete class.
    """

    def __init__(self, source: Any):
        self._source = source
        self.perspective_supports_eval_frame = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._source, name)


@dataclass(frozen=True)
class _OverlayEntry:
    """One still, fully resolved for the overlay filtergraph."""

    item: Any
    #: Local file the `-i` will read.
    path: str
    #: Top-left of the placement box in output pixels.
    x: int
    y: int
    box: OverlayBox
    timing: OverlayTiming
    motion: OverlayMotion


@dataclass
class OverlayPassContext:
    """Everything the image-overlay / subtitle passes need beyond their items.

    Bundled rather than added as three more positional parameters: the combined
    pass already carried six, and `output_fps` (P1-10) would have made seven.
    ``warnings`` is the return channel for non-fatal degradations — the passes
    run several layers below the composition record, and a warning that never
    reaches the status document is a silently-wrong export.
    """

    temp_dir: str
    output_resolution: Dict[str, int]
    output_fps: int = 30
    warnings: List[str] = field(default_factory=list)


@dataclass(frozen=True)
class FiltergraphOutcome:
    """Result of attempting the filtergraph composition path.

    ``composited`` False means "the caller may use concat"; it is NEVER returned
    for a failed render that involved camera motion, because concat would drop
    the effect and report success (L11).
    """

    composited: bool
    #: Non-fatal degradations to surface to the user via the status document.
    warnings: List[str]


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


class VideoCompositionService:
    """
    Service for composing videos from timeline data.
    """
    
    def __init__(self):
        """Initialize the video composition service."""
        self.compositions: Dict[str, Dict[str, Any]] = {}
        self.output_dir = Path("static/video/composed")
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Load video download configuration
        self._load_video_download_config()
        
        # Initialize subtitle service for subtitle composition
        self.subtitle_service = SubtitleService()
        
        # Initialize YouTube service for YouTube video downloads
        self.youtube_service = YouTubeService()
        
        # Check ffmpeg availability
        self._check_ffmpeg()

        # Detect GPU encoder availability
        self._gpu_encoder = self._detect_gpu_encoder()

        # Concurrency control: limit simultaneous compositions to prevent CPU/memory overload
        self._composition_semaphore = threading.Semaphore(2)

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
    def _request_has_camera_motion(request: VideoCompositionRequest) -> bool:
        """Whether any clip in the request carries a 2D/3D camera motion."""
        return any(
            getattr(item, "camera_motion", None) is not None
            for item in (request.video_items or [])
        )

    def _run_filtergraph(
        self,
        plan: FiltergraphResult,
        input_paths: List[str],
        output_path: Path,
        ffmpeg_path: str,
        caps: Any = None,
    ) -> subprocess.CompletedProcess:
        """Invoke FFmpeg for one planned filtergraph.

        Very large graphs are handed over as a script file rather than an argv
        element: on Windows every argument still funnels through
        ``CreateProcess``, whose ~32767-character command-line limit a long
        camera-motion graph could otherwise breach with a confusing OS error
        (L7). The script file is removed afterwards regardless of outcome.

        The diversion is gated on the capability probe: a build without
        ``-filter_complex_script`` would reject it as an unknown option, and the
        camera-motion retry path would then blame ``eval=frame`` and hand the
        user a static framing for a reason that has nothing to do with the
        actual failure. Inlining stays correct in that case —
        ``FILTER_COMPLEX_INLINE_LIMIT`` is a self-imposed 8 KB, a quarter of the
        real OS ceiling.
        """
        cmd = [ffmpeg_path, '-y']
        for path in input_paths:
            cmd.extend(['-i', path])

        oversized = len(plan.filter_complex) > FILTER_COMPLEX_INLINE_LIMIT
        can_use_script = caps is None or bool(
            getattr(caps, "supports_filter_complex_script", True)
        )
        script_path: Optional[Path] = None
        if oversized and can_use_script:
            script_path = output_path.with_suffix('.filtergraph.txt')
            script_path.write_text(plan.filter_complex, encoding='utf-8')
            cmd.extend(['-filter_complex_script', str(script_path)])
            logger.info(
                "Filtergraph is %d chars; passing it as a script file (%s)",
                len(plan.filter_complex),
                script_path.name,
            )
        else:
            if oversized:
                logger.warning(
                    "Filtergraph is %d chars but this FFmpeg has no "
                    "-filter_complex_script; inlining it instead",
                    len(plan.filter_complex),
                )
            cmd.extend(['-filter_complex', plan.filter_complex])
        cmd.extend(['-map', plan.output_label])
        cmd.extend(self._get_encoding_params("fast"))
        cmd.append(str(output_path))

        try:
            return subprocess.run(cmd, capture_output=True, text=True)
        finally:
            if script_path is not None:
                try:
                    script_path.unlink()
                except OSError:
                    logger.debug("Could not remove filtergraph script %s", script_path)

    def _compose_videos_filtergraph(
        self,
        request: VideoCompositionRequest,
        normalized_videos: List[str],
        output_path: Path,
        ffmpeg_path: str,
        output_resolution: Dict[str, int],
    ) -> FiltergraphOutcome:
        """Compose normalized clips via the multi-track + transition filtergraph.

        Mirrors the preview compositor's z-order / opacity / transition / camera-
        motion semantics (spec 05 §2.4 + timeline-camera-motion). The normalized
        inputs are already clip-trimmed + scaled, so the builder runs with
        ``pre_trimmed=True``.

        ``composited`` is False only when the caller may legitimately fall back
        to concat — a degenerate timeline, or an encode failure on a request
        WITHOUT camera motion (the long-standing behaviour). When camera motion
        IS present, a failure never degrades quietly: the graph is retried once
        with animation disabled (a static framing plus a warning), and if that
        also fails the error is raised so the export is reported as failed.
        Silently emitting a "successful" video with the effect missing is the
        one outcome this feature must never produce (L11).

        Raises:
            RuntimeError: camera motion was requested but could not be rendered.
        """
        width = int(output_resolution["width"])
        height = int(output_resolution["height"])
        caps = ffmpeg_caps.probe(ffmpeg_path)
        has_motion = self._request_has_camera_motion(request)
        options = FiltergraphOptions(
            pre_trimmed=True,
            fps=int(getattr(request, "output_fps", 30) or 30),
            caps=caps,
        )

        try:
            plan = build_filtergraph(list(request.video_items), width, height, options)
        except CameraMotionUnsupportedError as exc:
            logger.error("Camera motion cannot be rendered by this FFmpeg: %s", exc)
            raise RuntimeError(str(exc)) from exc

        if plan.can_use_concat:
            logger.info("Filtergraph not needed (single track, no transitions); using concat")
            return FiltergraphOutcome(composited=False, warnings=[])

        # Map the planned input order (clip ids) back to normalized file paths.
        id_to_path = {
            item.id: normalized_videos[i]
            for i, item in enumerate(request.video_items)
            if i < len(normalized_videos)
        }
        input_paths: List[str] = []
        for clip_id in plan.video_inputs:
            path = id_to_path.get(clip_id)
            if not path:
                message = f"Filtergraph input '{clip_id}' has no normalized path"
                if has_motion:
                    raise RuntimeError(
                        f"{message}; refusing to fall back to concat because this "
                        f"export uses camera motion, which concat would drop."
                    )
                logger.warning("%s; using concat", message)
                return FiltergraphOutcome(composited=False, warnings=[])
            input_paths.append(path)

        logger.info("Running multi-track filtergraph composition")
        logger.info(f"Filtergraph: {plan.filter_complex}")
        result = self._run_filtergraph(plan, input_paths, output_path, ffmpeg_path, caps)
        if result.returncode == 0:
            logger.info("Multi-track filtergraph composition succeeded")
            return FiltergraphOutcome(composited=True, warnings=list(plan.warnings))

        if not has_motion:
            logger.error(
                f"Filtergraph composition failed, falling back to concat: {result.stderr}"
            )
            return FiltergraphOutcome(composited=False, warnings=[])

        logger.error(
            "Filtergraph composition with camera motion failed; retrying with a "
            "static framing before giving up: %s",
            result.stderr,
        )
        static_caps = _StaticFramingCaps(caps)
        retry_plan = build_filtergraph(
            list(request.video_items), width, height, replace(options, caps=static_caps)
        )
        retry = self._run_filtergraph(
            retry_plan, input_paths, output_path, ffmpeg_path, caps
        )
        if retry.returncode == 0:
            logger.warning("Static-framing camera-motion retry succeeded")
            return FiltergraphOutcome(
                composited=True,
                warnings=list(retry_plan.warnings)
                or [
                    "camera_motion_static: the animated camera move could not be "
                    "rendered, so a single fixed framing was used."
                ],
            )

        raise RuntimeError(
            "Camera motion could not be rendered by FFmpeg. Remove the camera "
            f"motion from the affected clips or update FFmpeg. Details: "
            f"{(retry.stderr or result.stderr or '').strip()[-800:]}"
        )

    def _concat_videos(
        self,
        normalized_videos: List[str],
        output_path: Path,
        temp_dir: str,
        ffmpeg_path: str,
    ) -> None:
        """Concatenate normalized clips (legacy single-track path / fallback)."""
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
        result = subprocess.run(concat_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.warning("Direct copy failed, trying re-encoding...")
            concat_cmd = [
                ffmpeg_path, '-y',
                '-f', 'concat', '-safe', '0',
                '-i', concat_list_path,
            ] + self._get_encoding_params("fast") + [str(output_path)]
            result = subprocess.run(concat_cmd, capture_output=True, text=True)
            if result.returncode != 0:
                raise Exception(f"Video concatenation failed: {result.stderr}")

    def _ensure_even_dimensions(self, width: int, height: int) -> Tuple[int, int]:
        """Ensure dimensions are even numbers (divisible by 2) for H.264 encoding."""
        return ensure_even_dimensions(width, height)
    
    def _load_video_download_config(self):
        """Load video download configuration from YAML file."""
        try:
            config_path = Path("config/video-download.yaml")
            if config_path.exists():
                with open(config_path, 'r', encoding='utf-8') as f:
                    self.video_download_config = yaml.safe_load(f)
                logger.info("Video download configuration loaded successfully")
            else:
                # Default configuration if file doesn't exist
                self.video_download_config = {
                    'pexels': {
                        'retry': {
                            'max_retries': 5,
                            'switch_api_key_on_retry': True,
                            'download_timeout': 120,
                            'retry_delay': 2.0
                        },
                        'download': {
                            'max_file_size_mb': 500,
                            'min_file_size_kb': 1
                        }
                    },
                    'general': {
                        'cleanup_temp_files': True,
                        'detailed_logging': True
                    }
                }
                logger.warning("Video download config file not found, using defaults")
        except Exception as e:
            logger.error(f"Failed to load video download configuration: {str(e)}")
            # Use default configuration
            self.video_download_config = {
                'pexels': {
                    'retry': {
                        'max_retries': 5,
                        'switch_api_key_on_retry': True,
                        'download_timeout': 120,
                        'retry_delay': 2.0
                    }
                }
            }
    
    def _is_youtube_url(self, url: str) -> bool:
        """Check if the URL is a YouTube URL."""
        return is_youtube_url(url)

    def _is_pexels_url(self, url: str) -> bool:
        """Check if URL is a Pexels video URL."""
        return is_pexels_url(url)
    
    def _get_video_properties(self, video_path: str) -> tuple:
        """Get video properties (width, height, fps)."""
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
            logger.error(f"Failed to get video properties: {str(e)}")
            return None, None, None
    
    def _download_video_with_retry(self, video_url: str, temp_dir: str, index: int, video_item: VideoCompositionItem, max_retries: int = 3) -> Dict[str, Any]:
        """Download a single video file with retry mechanism."""
        thread_id = threading.current_thread().ident
        video_name = f"video_{index}.mp4"
        video_path = os.path.join(temp_dir, video_name)
        
        logger.info(f"[Thread {thread_id}] Starting video download with retry: {video_url} (max_retries: {max_retries})")
        
        last_error = None
        
        for attempt in range(max_retries + 1):
            try:
                logger.info(f"[Thread {thread_id}] Download attempt {attempt + 1}/{max_retries + 1} for video {index}")
                
                # Call the existing download method
                result = self._download_video(video_url, temp_dir, index)
                
                if result.get('success'):
                    if attempt > 0:
                        logger.info(f"[Thread {thread_id}] Video download succeeded on retry attempt {attempt + 1}")
                    else:
                        logger.info(f"[Thread {thread_id}] Video download succeeded on first attempt")
                    return result
                else:
                    last_error = result.get('error', 'Unknown download error')
                    logger.warning(f"[Thread {thread_id}] Download attempt {attempt + 1} failed: {last_error}")
                    
                    if attempt >= max_retries:
                        break
                        
                    # Wait before retry with exponential backoff
                    wait_time = min(2 ** attempt, 10)  # Cap at 10 seconds
                    logger.info(f"[Thread {thread_id}] Waiting {wait_time}s before retry {attempt + 2}")
                    time.sleep(wait_time)
                    
            except Exception as e:
                last_error = str(e)
                logger.error(f"[Thread {thread_id}] Download attempt {attempt + 1} exception: {last_error}")
                
                if attempt >= max_retries:
                    break
                    
                # Wait before retry
                wait_time = min(2 ** attempt, 10)
                logger.info(f"[Thread {thread_id}] Waiting {wait_time}s before retry {attempt + 2}")
                time.sleep(wait_time)
        
        # All attempts failed
        error_details = {
            "success": False,
            "error": f"Video download failed after {max_retries + 1} attempts",
            "last_error": last_error,
            "attempts": max_retries + 1,
            "video_details": {
                "index": index,
                "id": video_item.id,
                "name": video_item.name,
                "url": video_url,
                "timeline_position": video_item.start_time,
                "duration": video_item.duration
            }
        }
        
        logger.error(f"[Thread {thread_id}] All download attempts failed for video {index}: {last_error}")
        return error_details

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
            "video_details": video_info
        }
        
        logger.error(f"All normalization attempts failed for video {video_info['index']}: {last_error}")
        return error_details
    
    def _download_video(self, video_url: str, temp_dir: str, index: int) -> Dict[str, Any]:
        """Download a single video file."""
        thread_id = threading.current_thread().ident
        video_name = f"video_{index}.mp4"
        video_path = os.path.join(temp_dir, video_name)
        
        logger.info(f"[Thread {thread_id}] Downloading video: {video_url}")
        
        # Check if it's a YouTube URL
        if self._is_youtube_url(video_url):
            logger.info(f"[Thread {thread_id}] Detected YouTube URL, using yt-dlp for download")
            return self._download_youtube_video(video_url, video_path, thread_id)
        # Check if it's a Pexels URL
        elif self._is_pexels_url(video_url):
            logger.info(f"[Thread {thread_id}] Detected Pexels URL, using retry logic with API key switching")
            return self._download_pexels_video_with_retry(video_url, video_path, thread_id)
        else:
            logger.info(f"[Thread {thread_id}] Using FFmpeg for direct video URL download")
            return self._download_video_with_ffmpeg(video_url, video_path, thread_id)
    
    def _download_youtube_video(self, video_url: str, target_path: str, thread_id: int) -> Dict[str, Any]:
        """Download YouTube video using YouTubeService."""
        try:
            # Create download request
            download_request = YoutubeVideoDownloadRequest(
                url=video_url,
                video_quality="720p",  # Use reasonable quality for composition
                format_type="mp4"
            )
            
            logger.info(f"[Thread {thread_id}] Starting YouTube download with yt-dlp")
            
            # Download using YouTube service
            result = self.youtube_service.download_video(download_request)
            
            if not result.success:
                error_msg = f"YouTube download failed: {result.error or result.message}"
                logger.error(f"[Thread {thread_id}] {error_msg}")
                return {"success": False, "error": error_msg}
            
            # Move downloaded file to target location
            if result.file_path and os.path.exists(result.file_path):
                try:
                    shutil.move(result.file_path, target_path)
                    file_size = os.path.getsize(target_path)
                    logger.info(f"[Thread {thread_id}] YouTube download successful: {file_size / 1024 / 1024:.2f}MB")
                    return {"success": True, "output_path": target_path}
                except Exception as e:
                    error_msg = f"Failed to move downloaded file: {str(e)}"
                    logger.error(f"[Thread {thread_id}] {error_msg}")
                    return {"success": False, "error": error_msg}
            else:
                error_msg = "Downloaded file not found"
                logger.error(f"[Thread {thread_id}] {error_msg}")
                return {"success": False, "error": error_msg}
                
        except Exception as e:
            error_msg = f"YouTube download error: {str(e)}"
            logger.error(f"[Thread {thread_id}] {error_msg}", exc_info=True)
            return {"success": False, "error": error_msg}
    
    def _download_pexels_video_with_retry(self, video_url: str, video_path: str, thread_id: int) -> Dict[str, Any]:
        """Download Pexels video with API key retry logic."""
        config = self.video_download_config.get('pexels', {})
        retry_config = config.get('retry', {})
        
        max_retries = retry_config.get('max_retries', 5)
        switch_api_key = retry_config.get('switch_api_key_on_retry', True)
        retry_delay = retry_config.get('retry_delay', 2.0)
        
        logger.info(f"[Thread {thread_id}] Starting Pexels video download with retry logic (max_retries: {max_retries})")
        
        # Get available API keys
        api_keys = getattr(settings, 'pexels_api_keys', [])
        if not api_keys:
            logger.error(f"[Thread {thread_id}] No Pexels API keys available for retry logic")
            return self._download_video_with_ffmpeg(video_url, video_path, thread_id)
        
        # Try with different API keys if configured
        used_keys = set()
        
        for attempt in range(max_retries + 1):
            try:
                # Select API key for this attempt
                if switch_api_key and len(api_keys) > 1:
                    # Get unused API keys
                    available_keys = [key for key in api_keys if key not in used_keys]
                    if not available_keys:
                        # If all keys used, reset and use all keys again
                        used_keys.clear()
                        available_keys = api_keys
                    
                    current_api_key = random.choice(available_keys)
                    used_keys.add(current_api_key)
                else:
                    current_api_key = api_keys[0] if api_keys else None
                
                if attempt > 0:
                    logger.info(f"[Thread {thread_id}] Retry attempt {attempt}/{max_retries} for Pexels download")
                    if switch_api_key:
                        logger.info(f"[Thread {thread_id}] Using API key: {current_api_key[:10]}...{current_api_key[-5:] if current_api_key else 'None'}")
                    time.sleep(retry_delay)
                
                # Attempt download with current configuration
                result = self._download_video_with_ffmpeg(video_url, video_path, thread_id)
                
                if result.get('success'):
                    if attempt > 0:
                        logger.info(f"[Thread {thread_id}] Pexels download succeeded on retry attempt {attempt}")
                    else:
                        logger.info(f"[Thread {thread_id}] Pexels download succeeded on first attempt")
                    return result
                else:
                    error_msg = result.get('error', 'Unknown error')
                    logger.warning(f"[Thread {thread_id}] Pexels download attempt {attempt + 1} failed: {error_msg}")
                    
                    # If this is the last attempt, return the error
                    if attempt >= max_retries:
                        logger.error(f"[Thread {thread_id}] All Pexels download attempts failed after {max_retries + 1} tries")
                        return result
                
            except Exception as e:
                error_msg = f"Pexels download attempt {attempt + 1} error: {str(e)}"
                logger.error(f"[Thread {thread_id}] {error_msg}")
                
                if attempt >= max_retries:
                    return {"success": False, "error": f"All retry attempts failed. Last error: {error_msg}"}
        
        # This should not be reached, but just in case
        return {"success": False, "error": "Maximum retry attempts exceeded"}
    
    def _download_video_with_ffmpeg(self, video_url: str, video_path: str, thread_id: int) -> Dict[str, Any]:
        """Download video using FFmpeg (for non-YouTube URLs)."""
        ffmpeg_path = self._get_ffmpeg_path()
        if not ffmpeg_path:
            return {"success": False, "error": "ffmpeg not available"}

        # Spec 03 §3.3 (V03-E) — gate the remote URL before letting
        # FFmpeg open it. Combined with the protocol whitelist below this
        # blocks file:// / rtsp:// / http://169.254.169.254 from sneaking
        # in via timeline JSON.
        try:
            video_url = validate_external_url(video_url)
        except URLGuardError as guard_exc:
            logger.warning(f"[Thread {thread_id}] FFmpeg download URL rejected: {guard_exc}")
            return {"success": False, "error": f"URL rejected: {guard_exc}"}

        # Use ffmpeg to download video — restrict to remote protocols only
        # (no file:// fallback even if the URL contains tricks).
        download_cmd = [
            ffmpeg_path,
            '-y',
            '-protocol_whitelist', FFMPEG_REMOTE_PROTOCOL_WHITELIST,
            '-i', video_url,
            '-c', 'copy',
            video_path
        ]
        
        try:
            logger.info(f"[Thread {thread_id}] Executing FFmpeg download command")
            result = subprocess.run(download_cmd, capture_output=True, 
                                  text=True, timeout=120)
            
            if result.returncode != 0:
                error_msg = f"FFmpeg download failed: {result.stderr}"
                logger.error(f"[Thread {thread_id}] {error_msg}")
                return {"success": False, "error": error_msg}
            
            # Check file exists and has reasonable size
            if not os.path.exists(video_path):
                return {"success": False, "error": "Downloaded file not found"}
            
            file_size = os.path.getsize(video_path)
            if file_size < 1024:  # Less than 1KB
                return {"success": False, "error": "Downloaded file too small"}
            
            logger.info(f"[Thread {thread_id}] FFmpeg download successful: {file_size / 1024 / 1024:.2f}MB")
            return {"success": True, "output_path": video_path}
            
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Download timeout"}
        except Exception as e:
            return {"success": False, "error": f"Download error: {str(e)}"}
    
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
        
        # Get video properties
        width, height, fps = self._get_video_properties(video_path)
        if width is None:
            return {"success": False, "error": f"Cannot get video properties: {video_path}", "index": index}
        
        # Get video duration
        cap = cv2.VideoCapture(video_path)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        original_duration = frame_count / fps if fps > 0 else 0
        cap.release()
        
        # 计算实际的剪辑参数
        actual_clip_start = max(0.0, clip_start)
        actual_clip_end = min(original_duration, clip_end) if clip_end is not None else original_duration
        clip_duration = actual_clip_end - actual_clip_start
        
        logger.info(f"[Thread {thread_id}] Video properties: {width}x{height}, {fps:.2f}fps, original={original_duration:.2f}s")
        logger.info(f"[Thread {thread_id}] Clipping: start={actual_clip_start:.2f}s, end={actual_clip_end:.2f}s, duration={clip_duration:.2f}s")
        
        # Validate clipping parameters
        if clip_duration <= 0:
            error_msg = f"Invalid clipping parameters: clip duration is {clip_duration:.2f}s"
            logger.error(f"[Thread {thread_id}] {error_msg}")
            return {"success": False, "error": error_msg, "index": index}
        
        # Normalize video with clipping
        normalized_path = os.path.join(temp_dir, f"normalized_{index}.mp4")
        
        # 获取目标视频的宽高比信息
        target_aspect_ratio = self._get_aspect_ratio_info(video_info['target_aspect_ratio'])
        target_width = target_aspect_ratio["width"]
        target_height = target_aspect_ratio["height"]
        
        # 计算缩放和填充参数
        scaling_params = self._calculate_video_scaling(width, height, target_width, target_height)
        vf_params = self._build_video_filter(scaling_params)
        
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
        
        # 如果需要限制时长
        if clip_duration < original_duration:
            normalize_cmd.extend(['-t', str(clip_duration)])
        
        normalize_cmd.extend([
            '-vf', vf_params,
            '-r', str(video_info['target_fps']),
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
            result = subprocess.run(normalize_cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                error_msg = f"Normalization failed: {result.stderr}"
                logger.error(f"[Thread {thread_id}] {error_msg}")
                return {"success": False, "error": error_msg, "index": index}
            
            logger.info(f"[Thread {thread_id}] Video {index + 1} normalized and clipped successfully")
            return {
                "success": True,
                "normalized_path": normalized_path,
                "used_duration": clip_duration,
                "index": index
            }
            
        except Exception as e:
            error_msg = f"Normalization error: {str(e)}"
            logger.error(f"[Thread {thread_id}] {error_msg}")
            return {"success": False, "error": error_msg, "index": index}
    
    def start_video_composition(self, request: VideoCompositionRequest) -> VideoCompositionResponse:
        """
        Start video composition asynchronously and return immediately with composition_id.
        """
        # Spec 03 §3.3 / §3.4 (V03-E) — fail fast on SSRF or local-path
        # attacks embedded in timeline JSON. We only validate the URL
        # shape here; per-call defense (FFmpeg protocol whitelist + path
        # resolution) is still applied downstream.
        try:
            self._guard_request_urls(request)
        except URLGuardError as guard_exc:
            logger.warning(f"Composition request rejected by url_guard: {guard_exc}")
            return VideoCompositionResponse(
                success=False,
                message=f"Composition request rejected: {guard_exc}",
                composition_id="",
                status="failed",
                progress=0.0,
            )

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
            "start_time": start_time,
            "request": request
        }
        
        # Start background processing
        threading.Thread(
            target=self._process_video_composition_async,
            args=(composition_id, request),
            daemon=True
        ).start()
        
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
        self._composition_semaphore.acquire()
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

            if composition_id in self.compositions:
                self.compositions[composition_id].update({
                    "status": "failed",
                    "error_details": {"error": error_msg},
                    "failed_at": datetime.utcnow()
                })
        finally:
            self._composition_semaphore.release()
            logger.info(f"Composition {composition_id} released semaphore")

    def _compose_video_sync(self, composition_id: str, request: VideoCompositionRequest) -> VideoCompositionResponse:
        """
        Compose video from timeline data (synchronous processing).
        """
        start_time = time.time()
        
        logger.info(f"Starting video composition {composition_id} for task {request.task_id}")
        logger.info(f"Video items: {len(request.video_items)}, Audio items: {len(request.audio_items)}, Subtitle items: {len(request.subtitle_items)}, Image items: {len(request.image_items)}")
        logger.info(f"Frontend provided total duration: {request.total_duration}s")
        
        # Calculate actual total duration from clipped video segments
        actual_total_duration = 0
        clipped_video_durations = []
        
        for i, video_item in enumerate(request.video_items):
            # Safely get clipping parameters with proper defaults
            clip_start = getattr(video_item, 'clip_start', None) or 0.0
            clip_end = getattr(video_item, 'clip_end', None) or video_item.duration
            
            # Validate clipping parameters
            if clip_start < 0:
                logger.warning(f"Video {i+1}: Invalid clip_start {clip_start}, setting to 0.0")
                clip_start = 0.0
                
            if clip_end <= clip_start:
                logger.warning(f"Video {i+1}: Invalid clip_end {clip_end} <= clip_start {clip_start}, using full duration")
                clip_end = video_item.duration
            
            clipped_duration = clip_end - clip_start
            
            # Validate calculated duration
            if clipped_duration <= 0:
                logger.error(f"Video {i+1}: Invalid clipped duration {clipped_duration}s, this will cause composition failure")
                raise ValueError(f"Video item {video_item.id} has invalid clipping parameters: start={clip_start}s, end={clip_end}s")
            
            clipped_video_durations.append(clipped_duration)
            actual_total_duration += clipped_duration
            
            logger.info(f"Video {i+1} duration calculation: "
                       f"clip_start={clip_start}s, clip_end={clip_end}s, "
                       f"clipped_duration={clipped_duration}s, "
                       f"original_duration={getattr(video_item, 'original_duration', 'N/A')}s")
        
        logger.info(f"Duration calculation summary: "
                   f"frontend_total={request.total_duration}s, "
                   f"actual_clipped_total={actual_total_duration}s, "
                   f"difference={actual_total_duration - request.total_duration}s")
        
        # Use actual_total_duration for all processing instead of request.total_duration
        # This ensures the final video and audio match the actual clipped content
        
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
                   f"将使用实际裁剪总时长: {actual_total_duration}s")
        
        try:
            # Create temporary directory
            temp_dir = os.path.join(tempfile.gettempdir(), f"video_compose_{composition_id}")
            os.makedirs(temp_dir, exist_ok=True)
            
            # Output file path
            output_filename = f"composed_{composition_id}.{request.output_format}"
            output_path = self.output_dir / output_filename
            
            logger.info(f"Temp directory: {temp_dir}")
            logger.info(f"Output path: {output_path}")
            
            # Update progress
            if composition_id in self.compositions:
                self.compositions[composition_id]["progress"] = 0.1
            
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
            material_svc = get_material_download_service()
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
                self.compositions[composition_id] = {
                    "status": "failed", 
                    "progress": 0.3,
                    "error": error_details.error_summary,
                    "error_details": error_details
                }
                
                return VideoCompositionResponse(
                    success=False,
                    message=error_details.error_summary,
                    composition_id=composition_id,
                    status="failed",
                    progress=0.3,
                    error_details=error_details
                )
            
            # Create file copies for videos with duplicate URLs
            logger.info("Creating file copies for duplicate URLs...")
            for url, indices in url_to_indices.items():
                if url in url_to_downloaded_path:
                    original_path = url_to_downloaded_path[url]
                    
                    for video_index in indices:
                        if video_index == indices[0]:
                            # First video uses the original downloaded file
                            downloaded_videos[video_index] = original_path
                        else:
                            # Create copy for duplicate URLs
                            copy_name = f"video_{video_index}.mp4"
                            copy_path = os.path.join(temp_dir, copy_name)
                            try:
                                shutil.copy2(original_path, copy_path)
                                downloaded_videos[video_index] = copy_path
                                logger.info(f"Created copy for video index {video_index} from URL: {url}")
                            except Exception as e:
                                logger.error(f"Failed to create copy for video index {video_index}: {str(e)}")
                                # Use original file as fallback
                                downloaded_videos[video_index] = original_path
            
            # Verify all videos are assigned
            missing_videos = [i for i, path in enumerate(downloaded_videos) if path is None]
            if missing_videos:
                logger.error(f"Missing downloaded videos for indices: {missing_videos}")
                return VideoCompositionResponse(
                    success=False,
                    message=f"Internal error: missing downloaded videos for indices {missing_videos}",
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
            
            # Update progress
            self.compositions[composition_id]["progress"] = 0.4
            
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
                    # 新增：目标宽高比
                    'target_aspect_ratio': target_aspect_ratio
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
                futures = {executor.submit(self._normalize_video_with_retry, task): task['index'] for task in video_tasks}
                
                # 收集结果并保持原始顺序
                norm_results = {}
                for future in as_completed(futures):
                    original_index = futures[future]
                    result = future.result()
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
                    self.compositions[composition_id] = {
                        "status": "failed", 
                        "progress": 0.6,
                        "error": error_details.error_summary,
                        "error_details": error_details
                    }
                    
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
            
            # Update progress
            self.compositions[composition_id]["progress"] = 0.7

            # Spec 05 §2.4: decide between the multi-track / transition
            # filtergraph (overlay + fade/xfade + per-clip opacity + 2D/3D 运镜,
            # mirroring the preview compositor) and the lightweight concat path.
            # The normalized clips are already trimmed + scaled to the canvas, so
            # the composite runs with pre_trimmed=True. A filtergraph failure
            # falls back to concat ONLY when no camera motion is involved — with
            # motion the helper raises instead, so a dropped effect can never be
            # delivered as a successful export.
            output_resolution = request.output_resolution or self._get_aspect_ratio_info(
                request.aspect_ratio
            )
            outcome = self._compose_videos_filtergraph(
                request, normalized_videos, output_path, ffmpeg_path, output_resolution
            )
            if outcome.warnings:
                existing = self.compositions[composition_id].get("warnings") or []
                self.compositions[composition_id]["warnings"] = existing + outcome.warnings
            if not outcome.composited:
                self._concat_videos(normalized_videos, output_path, temp_dir, ffmpeg_path)
            
            # Update progress
            self.compositions[composition_id]["progress"] = 0.9
            
            # Extract embedded audio from video tracks
            video_audio_paths = self._extract_video_audio_tracks(request, temp_dir, ffmpeg_path)

            # Handle audio if present (independent audio tracks or video embedded audio)
            if request.audio_items or video_audio_paths:
                logger.info("Processing audio tracks...")
                try:
                    # Create audio mix from audio items using actual video duration
                    audio_mix_path = os.path.join(temp_dir, "audio_mix.wav")

                    processed_audio_path = self._process_audio_tracks(request, temp_dir, ffmpeg_path, actual_total_duration, extra_audio_paths=video_audio_paths)

                    if processed_audio_path:
                        logger.info("Adding mixed audio to video...")
                        video_with_audio_path = str(output_path).replace('.mp4', '_with_audio.mp4')

                        audio_video_cmd = [
                            ffmpeg_path,
                            '-y',
                            '-i', str(output_path),
                            '-i', processed_audio_path,
                            '-c:v', 'copy',
                            '-c:a', 'aac',
                            '-map', '0:v:0',  # Map video from first input
                            '-map', '1:a:0',  # Map audio from second input (our processed audio)
                            # Removed '-shortest' to prevent video truncation when audio is shorter
                            # Audio is already processed to match video duration via total_duration
                            video_with_audio_path
                        ]

                        logger.info(f"Running audio-video merge command: {' '.join(audio_video_cmd)}")
                        logger.info(f"Input video: {output_path} (exists: {os.path.exists(output_path)})")
                        logger.info(f"Input audio: {processed_audio_path} (exists: {os.path.exists(processed_audio_path)})")
                        logger.info(f"Output path: {video_with_audio_path}")

                        result = subprocess.run(audio_video_cmd, capture_output=True, text=True)

                        logger.info(f"Audio-video merge result: returncode={result.returncode}")
                        if result.stdout:
                            logger.info(f"FFmpeg stdout: {result.stdout}")
                        if result.stderr:
                            logger.info(f"FFmpeg stderr: {result.stderr}")

                        if result.returncode == 0:
                            # Check if the output file was created and has content
                            if os.path.exists(video_with_audio_path):
                                output_size = os.path.getsize(video_with_audio_path)
                                logger.info(f"Audio-video merge output file created: {output_size} bytes")

                                # Replace original video with audio version
                                os.replace(video_with_audio_path, str(output_path))
                                logger.info("Audio successfully added to video")

                                # Verify final file
                                final_size = os.path.getsize(output_path)
                                logger.info(f"Final video file size: {final_size} bytes")
                            else:
                                raise RuntimeError(
                                    "Audio-video merge output file was not created "
                                    f"(expected at {video_with_audio_path})"
                                )
                        else:
                            raise RuntimeError(
                                f"FFmpeg audio-video merge failed (returncode={result.returncode}): "
                                f"{result.stderr.strip() if result.stderr else 'no stderr'}"
                            )
                    else:
                        # _process_audio_tracks returned None — the silent
                        # short-circuit that previously produced an audio-less
                        # MP4 while marking the composition completed. Surface
                        # it as a hard error so the outer handler marks the
                        # composition failed and the user actually sees it.
                        audio_count = len(request.audio_items) if request.audio_items else 0
                        extra_count = len(video_audio_paths) if video_audio_paths else 0
                        raise RuntimeError(
                            "Audio merge skipped: _process_audio_tracks returned None "
                            f"(audio_items={audio_count}, video_audio_paths={extra_count}). "
                            "See earlier logs for FileNotFoundError or FFmpeg stderr details."
                        )

                except Exception as e:
                    # Promote audio failures from silent warnings to hard errors:
                    # without audio the export is incorrect, so let the outer
                    # handler mark the composition as failed and propagate the
                    # error to the client instead of silently shipping a video
                    # with no sound.
                    logger.error(f"Audio processing error: {str(e)}", exc_info=True)
                    raise
            else:
                logger.info("No audio tracks to process")
            
            # Process image overlays and subtitles (see _apply_overlay_passes:
            # it owns the fallback ladder AND the no-silent-drop guard, which
            # can only live here because this is the only frame that can still
            # turn the composition into a `failed`).
            overlay_context = OverlayPassContext(
                temp_dir=temp_dir,
                # The resolved resolution, not `request.output_resolution`: the
                # request field is optional and the aspect-ratio fallback above
                # is what the video was actually rendered at, so the overlay
                # boxes have to be measured against the same frame.
                output_resolution=output_resolution,
                output_fps=int(getattr(request, "output_fps", 30) or 30),
            )
            self._apply_overlay_passes(request, output_path, overlay_context)
            if overlay_context.warnings:
                existing = self.compositions[composition_id].get("warnings") or []
                self.compositions[composition_id]["warnings"] = existing + overlay_context.warnings


            # Final processing
            processing_time = time.time() - start_time
            file_size = output_path.stat().st_size

            # Update composition info
            composition_update = {
                "status": "completed",
                "progress": 1.0,
                "output_file_path": str(output_path),
                "output_file_size": file_size,
                "processing_time": processing_time,
                "completed_at": datetime.utcnow(),
            }
            self.compositions[composition_id].update(composition_update)
            
            logger.info(f"Video composition completed: {output_filename}")
            logger.info(f"File size: {file_size / 1024 / 1024:.2f}MB")
            logger.info(f"Processing time: {processing_time:.2f}s")
            
            # Update composition status for successful completion
            if composition_id in self.compositions:
                final_update = {
                    "status": "completed",
                    "progress": 1.0,
                    "output_file_path": str(output_path),
                    "output_file_size": file_size,
                    "processing_time": processing_time,
                    "completed_at": datetime.utcnow(),
                }
                self.compositions[composition_id].update(final_update)
            
            # Clean up temp directory
            try:
                shutil.rmtree(temp_dir)
                logger.info(f"Cleaned up temp directory: {temp_dir}")
            except Exception as e:
                logger.warning(f"Failed to clean temp directory: {str(e)}")
            
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
            
        except Exception as e:
            error_msg = f"Video composition failed: {str(e)}"
            logger.error(error_msg, exc_info=True)
            
            # Create proper error details
            error_details = CompositionErrorDetails(
                failed_videos=[],
                total_videos=len(request.video_items),
                successful_videos=0,
                composition_stage="finalization",
                error_summary=error_msg,
                recovery_suggestions=[
                    "Check if all video files are accessible and not corrupted",
                    "Verify that FFmpeg is properly configured",
                    "Ensure there is enough disk space and memory",
                    "Try simplifying the composition or reducing video quality",
                    "Contact support if the issue persists"
                ]
            )
            
            # Update composition info
            self.compositions[composition_id].update({
                "status": "failed",
                "error": error_msg,
                "error_details": error_details,
                "failed_at": datetime.utcnow()
            })
            
            # Clean up temp directory on error
            if 'temp_dir' in locals():
                try:
                    shutil.rmtree(temp_dir)
                except Exception:
                    pass
            
            return VideoCompositionResponse(
                success=False,
                message=error_msg,
                composition_id=composition_id,
                status="failed",
                progress=0.0,
                error_details=error_details
            )
    
    def get_composition_status(self, composition_id: str) -> Optional[Dict[str, Any]]:
        """Get the status of a composition."""
        return self.compositions.get(composition_id)
    
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
        for items in (request.video_items, request.audio_items, request.image_items):
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
                    if _is_loopback_local_reference(url):
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

    def _extract_video_audio_tracks(self, request: VideoCompositionRequest, temp_dir: str, ffmpeg_path: str) -> list:
        """
        Extract embedded audio from video items that have audio streams.
        Returns a list of dicts matching processed_audio_paths format:
        [{'path': str, 'start_time': float, 'name': str, 'track_id': str}]
        """
        video_audio_paths = []

        for i, video_item in enumerate(request.video_items):
            try:
                # Spec 01 §2.4 / spec 05 §2.4: a detached video clip contributes
                # NO embedded audio — its audio plays from the derived
                # independent audio item, so extracting here would double it.
                if getattr(video_item, 'audio_detached', None):
                    logger.info(
                        f"Video {i+1} ({video_item.name}) audio is detached; "
                        f"skipping embedded-audio extraction"
                    )
                    continue

                local_path = self._convert_url_to_local_path(video_item.url)

                # Use ffprobe to check if the video has an audio stream
                ffprobe_path = os.path.join(os.path.dirname(ffmpeg_path), 'ffprobe') if os.path.dirname(ffmpeg_path) else 'ffprobe'
                probe_cmd = [
                    ffprobe_path,
                    '-v', 'error',
                    '-select_streams', 'a',
                    '-show_entries', 'stream=codec_type',
                    '-of', 'csv=p=0',
                    local_path
                ]
                probe_result = subprocess.run(probe_cmd, capture_output=True, text=True)

                if probe_result.returncode != 0 or not probe_result.stdout.strip():
                    logger.info(f"Video {i+1} ({video_item.name}) has no audio stream, skipping")
                    continue

                logger.info(f"Video {i+1} ({video_item.name}) has audio stream, extracting with volume={video_item.volume}")

                # Get clipping parameters
                clip_start = getattr(video_item, 'clip_start', None) or 0.0
                clip_end = getattr(video_item, 'clip_end', None) or video_item.duration
                clip_duration = clip_end - clip_start

                # Volume: model stores 0-2 (already a multiplier)
                vol = video_item.volume if video_item.volume is not None else 1.0

                extracted_path = os.path.join(temp_dir, f"video_audio_{i}.wav")

                extract_cmd = [ffmpeg_path, '-y']
                if clip_start > 0:
                    extract_cmd.extend(['-ss', str(clip_start)])
                extract_cmd.extend([
                    '-i', local_path,
                    '-t', str(clip_duration),
                    '-vn',
                    '-af', f'volume={vol}',
                    '-ar', '44100',
                    '-ac', '2',
                    extracted_path
                ])

                logger.info(f"Extracting video audio: {' '.join(extract_cmd)}")
                result = subprocess.run(extract_cmd, capture_output=True, text=True)

                if result.returncode != 0:
                    logger.warning(f"Failed to extract audio from video {i+1}: {result.stderr}")
                    continue

                video_audio_paths.append({
                    'path': extracted_path,
                    'start_time': video_item.start_time,
                    'name': f'{video_item.name} (embedded audio)',
                    'track_id': video_item.track_id
                })

                logger.info(f"Successfully extracted audio from video {i+1}: {video_item.name}")

            except Exception as e:
                logger.warning(f"Failed to extract audio from video item {video_item.name}: {str(e)}")
                continue

        logger.info(f"Extracted {len(video_audio_paths)} audio tracks from {len(request.video_items)} video items")
        return video_audio_paths

    def _process_audio_tracks(self, request: VideoCompositionRequest, temp_dir: str, ffmpeg_path: str, actual_total_duration: float, extra_audio_paths: Optional[list] = None) -> Optional[str]:
        """
        Process multiple audio tracks and create a mixed audio file.
        Returns the path to the mixed audio file, or None if processing failed.
        """
        has_audio_items = bool(request.audio_items)
        has_extra_audio = bool(extra_audio_paths)

        if not has_audio_items and not has_extra_audio:
            logger.info("No audio items to process")
            return None

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
            total_audio_count = len(request.audio_items) if has_audio_items else 0
            total_audio_count += len(extra_audio_paths) if has_extra_audio else 0

            if total_audio_count == 1 and has_audio_items and len(request.audio_items) == 1 and not has_extra_audio:
                # Single audio item with no video embedded audio - process it directly
                audio_item = request.audio_items[0]
                # Mirrors the per-item try/except in the multi-audio branch below.
                # Without it any FileNotFoundError from _convert_url_to_local_path
                # bubbled to the outer try and used to be swallowed silently.
                try:
                    local_audio_path = self._convert_url_to_local_path(audio_item.url)
                except Exception as resolve_exc:
                    logger.error(
                        f"Failed to resolve single audio path for '{audio_item.name}': {resolve_exc}",
                        exc_info=True,
                    )
                    return None

                logger.info(f"Processing single audio track: {audio_item.name} at {audio_item.start_time}s")
                logger.info(f"Audio item details: duration={audio_item.duration}s, volume={audio_item.volume}")
                # 安全获取音频裁剪参数
                audio_clip_start = getattr(audio_item, 'clip_start', None) or 0.0
                audio_clip_end = getattr(audio_item, 'clip_end', None) or audio_item.duration
                logger.info(f"Audio clipping: start={audio_clip_start}s, end={audio_clip_end}s")
                logger.info(f"Actual video duration: {actual_total_duration}s (was {request.total_duration}s from frontend)")
                
                # Calculate the actual duration we need
                if audio_item.start_time > 0:
                    # Audio starts later, need to pad with silence at the beginning
                    logger.info("Audio starts after video beginning, creating padded audio track")
                    
                    # First create the audio segment with clipping
                    temp_audio_path = os.path.join(temp_dir, "temp_audio.wav")
                    audio_segment_cmd = [
                        ffmpeg_path,
                        '-y'
                    ]
                    
                    # 添加音频剪辑参数
                    if audio_clip_start > 0:
                        audio_segment_cmd.extend(['-ss', str(audio_clip_start)])
                    
                    audio_segment_cmd.extend([
                        '-i', local_audio_path
                    ])
                    
                    # 计算实际的音频时长（考虑剪辑）
                    clip_duration = audio_clip_end - audio_clip_start
                    actual_duration = min(audio_item.duration, clip_duration)
                    
                    audio_segment_cmd.extend([
                        '-t', str(actual_duration),
                        '-af', f'volume={audio_item.volume}',
                        '-ar', '44100',
                        '-ac', '2',
                        temp_audio_path
                    ])
                    
                    logger.info(f"Creating audio segment: {' '.join(audio_segment_cmd)}")
                    result = subprocess.run(audio_segment_cmd, capture_output=True, text=True)
                    if result.returncode != 0:
                        logger.error(f"Audio segment creation failed: {result.stderr}")
                        return None
                    
                    # Then create silence and combine
                    silence_duration = audio_item.start_time
                    final_cmd = [
                        ffmpeg_path,
                        '-y',
                        '-f', 'lavfi',
                        '-i', f'anullsrc=r=44100:cl=stereo',
                        '-i', temp_audio_path,
                        '-filter_complex', f'[0:a]atrim=duration={silence_duration}[silence];[silence][1:a]concat=n=2:v=0:a=1[out]',
                        '-map', '[out]',
                        '-t', str(actual_total_duration),
                        audio_mix_path
                    ]
                else:
                    # Audio starts at the beginning, simpler processing with clipping
                    final_cmd = [
                        ffmpeg_path,
                        '-y'
                    ]
                    
                    # 添加音频剪辑参数
                    if audio_clip_start > 0:
                        final_cmd.extend(['-ss', str(audio_clip_start)])
                    
                    final_cmd.extend([
                        '-i', local_audio_path
                    ])
                    
                    # 计算实际的音频时长（考虑剪辑）
                    clip_duration = audio_clip_end - audio_clip_start
                    actual_duration = min(actual_total_duration, clip_duration)
                    
                    final_cmd.extend([
                        '-af', f'volume={audio_item.volume}',
                        '-ar', '44100',
                        '-ac', '2',
                        '-t', str(actual_duration),  # Use clipped duration
                        audio_mix_path
                    ])
                
                logger.info(f"Running final audio command: {' '.join(final_cmd)}")
                result = subprocess.run(final_cmd, capture_output=True, text=True)
                
                logger.info(f"Audio processing result: returncode={result.returncode}")
                if result.stdout:
                    logger.info(f"Audio FFmpeg stdout: {result.stdout}")
                if result.stderr:
                    logger.info(f"Audio FFmpeg stderr: {result.stderr}")
                
                if result.returncode != 0:
                    logger.error(f"Single audio processing failed", {
                        'command': ' '.join(final_cmd),
                        'stderr': result.stderr,
                        'stdout': result.stdout
                    })
                    return None
                else:
                    # Verify the output file
                    if os.path.exists(audio_mix_path):
                        audio_size = os.path.getsize(audio_mix_path)
                        logger.info(f"Single audio track processed successfully, output size: {audio_size} bytes")
                        return audio_mix_path
                    else:
                        logger.error("Audio processing completed but output file not found")
                        return None
                    
            else:
                # Multiple audio sources - create proper parallel mix
                logger.info(f"Mixing {total_audio_count} audio tracks with independent volume control")
                
                # Pre-process each audio item individually to apply volume and clipping
                processed_audio_paths = []
                for i, audio_item in enumerate(request.audio_items):
                    try:
                        local_audio_path = self._convert_url_to_local_path(audio_item.url)
                        processed_path = os.path.join(temp_dir, f"processed_audio_{i}.wav")
                        
                        # 安全获取音频裁剪参数
                        audio_clip_start = getattr(audio_item, 'clip_start', None) or 0.0
                        audio_clip_end = getattr(audio_item, 'clip_end', None) or audio_item.duration
                        
                        logger.info(f"Pre-processing audio {i+1}/{len(request.audio_items)}: {audio_item.name}", {
                            'volume': audio_item.volume,
                            'start_time': audio_item.start_time,
                            'clip_start': audio_clip_start,
                            'clip_end': audio_clip_end,
                            'track_id': audio_item.track_id
                        })
                        
                        # Calculate clipped duration for this audio item
                        clip_duration = audio_clip_end - audio_clip_start
                        
                        # Pre-process this audio item with volume and clipping
                        process_cmd = [
                            ffmpeg_path,
                            '-y'
                        ]
                        
                        # Add clipping parameters for the audio input
                        if audio_clip_start > 0:
                            process_cmd.extend(['-ss', str(audio_clip_start)])
                        
                        process_cmd.extend([
                            '-i', local_audio_path,
                            '-af', f'volume={audio_item.volume}',
                            '-t', str(clip_duration),
                            '-ar', '44100',
                            '-ac', '2',
                            processed_path
                        ])
                        
                        logger.info(f"Pre-processing audio command: {' '.join(process_cmd)}")
                        result = subprocess.run(process_cmd, capture_output=True, text=True)
                        
                        if result.returncode != 0:
                            logger.error(f"Audio pre-processing failed for item {i+1}", {
                                'command': ' '.join(process_cmd),
                                'stderr': result.stderr,
                                'audio_item': audio_item.name
                            })
                            continue
                        
                        processed_audio_paths.append({
                            'path': processed_path,
                            'start_time': audio_item.start_time,
                            'name': audio_item.name,
                            'track_id': audio_item.track_id
                        })
                        
                        logger.info(f"Successfully pre-processed audio: {audio_item.name}")
                        
                    except Exception as e:
                        logger.error(f"Failed to pre-process audio item {audio_item.name}: {str(e)}")
                        continue
                
                # Merge extra audio paths (from video embedded audio)
                if has_extra_audio:
                    processed_audio_paths.extend(extra_audio_paths)
                    logger.info(f"Merged {len(extra_audio_paths)} video embedded audio tracks into mix")

                if not processed_audio_paths:
                    logger.error("No audio tracks were successfully pre-processed")
                    return None

                # Now create the final mix using all processed audio files
                logger.info(f"Creating final mix with {len(processed_audio_paths)} processed audio tracks")
                
                # Log detailed timing information for debugging
                for i, audio_info in enumerate(processed_audio_paths):
                    logger.info(f"Audio track {i+1} timing details", {
                        'name': audio_info['name'],
                        'start_time': audio_info['start_time'],
                        'track_id': audio_info['track_id'],
                        'processed_path': audio_info['path']
                    })
                
                logger.info(f"Total video duration for audio mixing: {actual_total_duration}s")
                
                # Build the complex FFmpeg command for mixing
                mix_cmd = [ffmpeg_path, '-y']
                
                # Add all processed audio inputs
                for audio_info in processed_audio_paths:
                    mix_cmd.extend(['-i', audio_info['path']])
                
                # Build the mixing filtergraph via the shared composition module.
                # Volume and routing (mute / audio_detached drop) are already
                # applied upstream — the pre-processing pass bakes volume into
                # each file and muted/detached sources never reach this list —
                # so the builder only positions (adelay) + pads + mixes + trims.
                mix_sources = [
                    AudioSource(start_time=audio_info['start_time'])
                    for audio_info in processed_audio_paths
                ]
                mix_filter = build_audio_mix(mix_sources, actual_total_duration).filter_complex

                mix_cmd.extend([
                    '-filter_complex', mix_filter,
                    '-map', '[out]',
                    '-t', str(actual_total_duration),
                    '-ar', '44100',
                    '-ac', '2',
                    audio_mix_path
                ])
                
                logger.info(f"Running final mix command: {' '.join(mix_cmd)}")
                logger.info(f"Filter complex: {mix_filter}")
                
                result = subprocess.run(mix_cmd, capture_output=True, text=True)
                
                logger.info(f"Audio mixing result: returncode={result.returncode}")
                if result.stdout:
                    logger.info(f"Audio mixing stdout: {result.stdout}")
                if result.stderr:
                    logger.info(f"Audio mixing stderr: {result.stderr}")
                
                # Clean up processed audio files
                for audio_info in processed_audio_paths:
                    try:
                        if os.path.exists(audio_info['path']):
                            os.remove(audio_info['path'])
                    except Exception as e:
                        logger.warning(f"Failed to clean up processed audio file {audio_info['path']}: {str(e)}")
                
                if result.returncode != 0:
                    logger.error(f"Audio mixing failed", {
                        'command': ' '.join(mix_cmd),
                        'stderr': result.stderr,
                        'stdout': result.stdout
                    })
                    return None
                else:
                    # Verify the output file
                    if os.path.exists(audio_mix_path):
                        audio_size = os.path.getsize(audio_mix_path)
                        logger.info(f"Audio mixing completed successfully, output size: {audio_size} bytes")
                        return audio_mix_path
                    else:
                        logger.error("Audio mixing completed but output file not found")
                        return None
                    
        except Exception as e:
            logger.error(f"Audio processing failed with exception: {str(e)}")
            return None 

    def _get_aspect_ratio_info(self, aspect_ratio: AspectRatio) -> Dict[str, Any]:
        """Get aspect ratio information including resolution and ratio value."""
        return get_aspect_ratio_info(aspect_ratio)

    def _calculate_video_scaling(self,
                                source_width: int,
                                source_height: int,
                                target_width: int,
                                target_height: int) -> Dict[str, Any]:
        """Calculate scale/pad parameters maintaining aspect ratio (letter/pillarbox)."""
        return calculate_video_scaling(
            source_width, source_height, target_width, target_height
        )

    def _build_video_filter(self, scaling_params: Dict[str, Any]) -> str:
        """Build FFmpeg video filter string for aspect ratio conversion."""
        return build_video_filter(scaling_params)

    def _process_subtitle_tracks(self, subtitle_items: List[SubtitleCompositionItem], 
                               video_path: str, temp_dir: str) -> Optional[str]:
        """
        Process subtitle tracks and add them to the video.
        
        Based on the verified test script test_subtitle_aspect_ratio.py,
        this method uses consistent parameters for proper subtitle rendering
        with aspect ratio adaptation.
        
        Args:
            subtitle_items: List of subtitle items from the timeline
            video_path: Path to the video file to add subtitles to
            temp_dir: Temporary directory for processing
            
        Returns:
            Path to the video with subtitles added, or None if failed
        """
        try:
            logger.info(f"Starting subtitle processing for {len(subtitle_items)} subtitle items")
            logger.info(f"Using enhanced subtitle parameters based on test_subtitle_aspect_ratio.py")
            
            # Log subtitle details for debugging
            for i, subtitle in enumerate(subtitle_items):
                logger.info(f"Subtitle {i+1}: '{subtitle.text}' at {subtitle.start_time}s for {subtitle.duration}s")
                logger.debug(f"  Font size: {getattr(subtitle, 'font_size', 'default')}, "
                           f"Font color: {getattr(subtitle, 'font_color', 'default')}, "
                           f"Background color: {getattr(subtitle, 'background_color', 'default')}, "
                           f"Position: {getattr(subtitle, 'position', 'default')}")
            
            # Create SRT file from subtitle items
            srt_path = self._create_srt_from_subtitle_items(subtitle_items, temp_dir)
            
            if not srt_path or not os.path.exists(srt_path):
                logger.error("Failed to create SRT file from subtitle items")
                return None
            
            logger.info(f"Created SRT file: {srt_path}")
            
            # Use the first subtitle item's properties, with proper defaults from frontend
            first_subtitle = subtitle_items[0]
            
            # Get font size from frontend (respect user settings)
            font_family = getattr(first_subtitle, 'font_family', 'default')
            font_size = getattr(first_subtitle, 'font_size', 24)  # Use frontend value or standard default
            font_color = getattr(first_subtitle, 'font_color', '#FFFFFF')
            background_color = getattr(first_subtitle, 'background_color', None)
            position = getattr(first_subtitle, 'position', 'bottom')
            
            # Log the font size to verify it's being used correctly
            logger.info(f"Using subtitle font size from frontend: {font_size}px (user setting: {hasattr(first_subtitle, 'font_size')})")
            
            # Use semi-transparent black background as default (from test script)
            if not background_color:
                background_color = "#000000@0.5"
                logger.info("Using default semi-transparent black background for subtitles")
            
            # Create subtitle addition request with parameters matching test script
            subtitle_request = SubtitleAddRequest(
                video_file_path=video_path,
                subtitle_file_path=srt_path,
                font_family=font_family,
                font_size=font_size,
                font_color=font_color,
                background_color=background_color,
                border_width=2,  # Verified in test script
                border_color="#000000",  # Verified in test script
                position=position,
                margin_vertical=50,  # Verified in test script
                margin_horizontal=50  # Verified in test script
            )
            
            logger.info(f"Subtitle request configuration (enhanced): "
                       f"font_family={subtitle_request.font_family}, "
                       f"font_size={subtitle_request.font_size}, "
                       f"font_color={subtitle_request.font_color}, "
                       f"background_color={subtitle_request.background_color}, "
                       f"position={subtitle_request.position}, "
                       f"border_width={subtitle_request.border_width}, "
                       f"border_color={subtitle_request.border_color}, "
                       f"margin_vertical={subtitle_request.margin_vertical}, "
                       f"margin_horizontal={subtitle_request.margin_horizontal}")
            
            # Add subtitles to video using SubtitleService
            # Note: SubtitleService.add_subtitles is async, but we're in a sync context
            # We need to run it in an event loop
            import asyncio
            try:
                # Try to get the current event loop
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # If we're already in an event loop, we need to use run_in_executor
                    # But for now, let's use a simpler approach by creating a new thread
                    import concurrent.futures
                    with concurrent.futures.ThreadPoolExecutor() as executor:
                        future = executor.submit(asyncio.run, self.subtitle_service.add_subtitles(subtitle_request))
                        result = future.result()
                else:
                    # If no event loop is running, we can use asyncio.run
                    result = asyncio.run(self.subtitle_service.add_subtitles(subtitle_request))
            except RuntimeError:
                # If we can't get an event loop, create a new one
                result = asyncio.run(self.subtitle_service.add_subtitles(subtitle_request))
            
            if result.success:
                logger.info(f"Subtitle addition successful: {result.output_video_path}")
                logger.info(f"Processed {result.subtitle_count} subtitles in {result.processing_time:.2f}s")
                logger.info(f"Video dimensions: {result.video_width}x{result.video_height}")
                
                # Add aspect ratio information for better tracking
                if result.video_width and result.video_height:
                    aspect_ratio = result.video_width / result.video_height
                    video_type = "portrait" if aspect_ratio < 1.0 else "landscape"
                    logger.info(f"Video type: {video_type} (aspect ratio: {aspect_ratio:.2f})")
                
                logger.info(f"Output file size: {result.file_size} bytes")
                return result.output_video_path
            else:
                logger.error(f"Subtitle addition failed: {result.message}")
                return None
                
        except Exception as e:
            logger.error(f"Error processing subtitle tracks: {str(e)}", exc_info=True)
            return None
    
    def _create_srt_from_subtitle_items(self, subtitle_items: List[SubtitleCompositionItem],
                                      temp_dir: str) -> Optional[str]:
        """Create an SRT file from subtitle items."""
        return create_srt_from_subtitle_items(subtitle_items, temp_dir)

    def _seconds_to_srt_time(self, seconds: float) -> str:
        """Convert seconds to standard SRT time format (HH:MM:SS,mmm)."""
        return seconds_to_srt_time(seconds)

    def _overlay_caps(self) -> Any:
        """Camera-motion capabilities of the active FFmpeg binary (cached probe)."""
        return ffmpeg_caps.probe(self._get_ffmpeg_path() or "ffmpeg")

    def _probe_stream_fps(self, video_path: str) -> Optional[float]:
        """Measured frame rate of a file's first video stream, or None.

        `r_frame_rate` comes back as a rational (``30000/1001``); anything that
        does not parse is reported as unknown rather than guessed, so the caller
        can fall back explicitly and say so.
        """
        ffmpeg_path = self._get_ffmpeg_path() or 'ffmpeg'
        directory = os.path.dirname(ffmpeg_path)
        ffprobe_path = os.path.join(directory, 'ffprobe') if directory else 'ffprobe'
        try:
            result = subprocess.run(
                [
                    ffprobe_path, '-v', 'error', '-select_streams', 'v:0',
                    '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', video_path,
                ],
                capture_output=True, text=True,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            logger.warning(f"ffprobe frame-rate probe failed for {video_path}: {exc}")
            return None
        if result.returncode != 0:
            return None
        raw = (result.stdout or '').strip().splitlines()
        if not raw:
            return None
        try:
            numerator, _, denominator = raw[0].partition('/')
            value = float(numerator) / float(denominator or 1)
        except (TypeError, ValueError, ZeroDivisionError):
            return None
        return value if value > 0 else None

    def _resolve_overlay_fps(self, video_path: str, requested_fps: int) -> float:
        """Frame rate the overlay pass's `on` counter actually advances at (L3).

        `on` counts frames of the overlay branch, whose rate is dictated by the
        file being overlaid — NOT by the `output_fps` the request asked for. The
        two are equal on the normal path, but any frame-rate negotiation earlier
        in the pipeline makes the requested value a lie, and trusting it runs the
        whole move uniformly fast or slow: invisible in a per-frame SSIM, obvious
        on the timeline.
        """
        fallback = float(requested_fps if requested_fps and requested_fps > 0 else 30)
        measured = self._probe_stream_fps(video_path)
        if measured is None:
            logger.warning(
                f"Could not measure the overlay input frame rate for {video_path}; "
                f"falling back to the requested output_fps={requested_fps}"
            )
            return fallback
        if abs(measured - fallback) > 0.01:
            logger.warning(
                f"Overlay pass frame rate: measured {measured:.4f} on {video_path} but the "
                f"request asked for {requested_fps}; using the measured value for camera motion"
            )
        return measured

    def _prepare_image_overlay_entries(
        self, image_items: List, video_path: str, ctx: OverlayPassContext
    ) -> Optional[List["_OverlayEntry"]]:
        """Resolve every still's file, placement box and camera-motion filter.

        Args:
            image_items: The composition's image items.
            video_path: The file being overlaid (measured for the motion clock).
            ctx: Pass context; collects warnings.

        Returns:
            One entry per usable still, or ``None`` when a still that carries a
            camera motion had to be dropped. Dropping such a still would render
            a "successful" export missing the very effect the user applied, so
            L-I1 turns it into a failure of the whole pass instead.
        """
        video_width = ctx.output_resolution['width']
        video_height = ctx.output_resolution['height']
        wants_motion = any(
            getattr(item, 'camera_motion', None) is not None for item in image_items
        )
        # Only pay for the probe when a move actually needs a clock; a timeline
        # without motion must not gain a subprocess call it never had.
        fps = self._resolve_overlay_fps(video_path, ctx.output_fps) if wants_motion else 0.0
        caps = self._overlay_caps() if wants_motion else None

        entries: List[_OverlayEntry] = []
        for index, item in enumerate(image_items):
            image_url = item.url
            local_image_path = self._convert_url_to_local_path(image_url)
            if not os.path.exists(local_image_path):
                downloaded_image = self._download_image(image_url, ctx.temp_dir, index)
                if downloaded_image and downloaded_image.get('success'):
                    local_image_path = downloaded_image['output_path']
                elif getattr(item, 'camera_motion', None) is not None:
                    logger.error(
                        f"Failed to download image {image_url}, which carries a camera "
                        f"motion; failing the overlay pass instead of dropping the effect"
                    )
                    return None
                else:
                    logger.warning(f"Failed to download image {image_url}, skipping overlay")
                    continue

            box, x, y = self._overlay_placement(item, video_width, video_height)
            timing = OverlayTiming(start_time=item.start_time, duration=item.duration)
            motion = overlay_motion_for_item(item, box, timing, fps, caps)
            for warning in motion.warnings:
                if warning not in ctx.warnings:
                    ctx.warnings.append(warning)
            entries.append(
                _OverlayEntry(
                    item=item, path=local_image_path, x=x, y=y,
                    box=box, timing=timing, motion=motion,
                )
            )
        return entries

    def _overlay_placement(
        self, item: Any, video_width: int, video_height: int
    ) -> Tuple[OverlayBox, int, int]:
        """One still's box (even-sized) and top-left corner, in output pixels.

        The box is what the camera move acts on, so this is also the geometry the
        preview must agree with. The rule now lives in `overlay_box.py` and the
        preview replays that same rule through its TS twin, which is what makes
        the two sides identical BY CONSTRUCTION rather than on a hand-picked
        fixture (G4 / DD-1; N0's box-c read 1.166px before this).
        """
        pos = getattr(item, 'image_position', None) or getattr(item, 'position', None)
        if pos:
            placement = (pos.x, pos.y, pos.width, pos.height)
        else:
            logger.warning(
                f"No position information for image item {item.id}, using default position"
            )
            placement = DEFAULT_IMAGE_POSITION
        box = quantise_overlay_box(*placement, video_width, video_height)
        return OverlayBox(width=box.width, height=box.height), box.x, box.y

    def _image_overlay_filter_parts(
        self, entries: List["_OverlayEntry"]
    ) -> Tuple[List[str], str]:
        """The overlay filtergraph for a prepared still list, plus its output label.

        The ONE place the `scale → pad → (perspective) → overlay` chain is
        written. Both assembly points call it, so "two組装点 produce a
        byte-identical motion segment" holds by construction rather than by
        review (L1 / test 27).
        """
        parts: List[str] = []
        for index, entry in enumerate(entries):
            box = entry.box
            # 盒内 contain 的实现串由 `overlay_box.build_contain_pad_filter` 唯一持有，
            # 与它旁边那份可执行规范 `contain_rect_in_box`（预览据以复刻同一张整数表）
            # 放在一起，隔开就迟早对不上。
            chain = f"[{index + 1}:v]" + build_contain_pad_filter(box.width, box.height)
            if entry.motion.filter_text:
                chain += f",{entry.motion.filter_text}"
            parts.append(f"{chain}[img{index}]")

            base_input = "[0:v]" if index == 0 else f"[v{index - 1}]"
            start_time = entry.item.start_time
            end_time = entry.item.start_time + entry.item.duration
            parts.append(
                f"{base_input}[img{index}]overlay={entry.x}:{entry.y}"
                f":enable='between(t,{start_time},{end_time})'[v{index}]"
            )
        return parts, f"[v{len(entries) - 1}]"

    def _apply_overlay_passes(self, request, output_path, ctx: OverlayPassContext) -> None:
        """Run the image-overlay / subtitle passes and enforce the L-I2 guard.

        The fallback ladder is unchanged (combined → sequential); what is new is
        that its OUTCOME is judged. Before, an overlay pass that returned False
        or threw produced one log line and the composition went on to be marked
        `completed` — the user downloaded a video with no image on it and no
        indication anything had gone wrong. With a camera move on the still,
        that same path also swallows the effect they explicitly applied, which
        is the exact failure mode L1/L11 already forbid on the video side.

        Args:
            request: The composition request.
            output_path: The rendered video, replaced in place on success.
            ctx: Pass context; collects user-visible warnings.

        Raises:
            RuntimeError: every rung of the ladder failed for a still that
                carries a camera motion. The caller's handler marks the
                composition failed, which is the only honest outcome.
        """
        image_items = list(request.image_items or [])
        has_subtitles = bool(request.subtitle_items)

        if image_items and has_subtitles:
            overlays_ok = self._run_combined_overlay_pass(image_items, request, output_path, ctx)
        elif image_items:
            overlays_ok = self._run_image_overlay_pass(image_items, output_path, ctx)
        else:
            if has_subtitles:
                self._run_subtitle_only_pass(request, output_path, ctx)
            else:
                logger.info("No image overlays or subtitle tracks to process")
            return

        self._guard_overlay_outcome(image_items, overlays_ok)

    def _run_combined_overlay_pass(
        self, image_items: List, request, output_path, ctx: OverlayPassContext
    ) -> bool:
        """Images + subtitles in ONE encode, falling back to two on any failure."""
        logger.info(
            f"Merging {len(image_items)} image overlays and "
            f"{len(request.subtitle_items)} subtitles into single encoding pass"
        )
        merged_output_path = str(output_path).replace('.mp4', '_merged.mp4')
        try:
            success = self._process_overlays_and_subtitles_combined(
                image_items, request.subtitle_items, str(output_path), merged_output_path, ctx
            )
            if success and os.path.exists(merged_output_path):
                os.replace(merged_output_path, str(output_path))
                logger.info("Image overlays and subtitles added in single pass")
                logger.info(f"Final video file size: {os.path.getsize(output_path)} bytes")
                return True
            logger.warning("Merged processing failed, falling back to sequential processing")
        except CameraMotionUnsupportedError:
            # No ladder rung can help: the binary has no `perspective` at all.
            raise
        except Exception as exc:
            logger.error(f"Merged overlay+subtitle processing error: {exc}", exc_info=True)
            logger.warning("Falling back to sequential processing")
        return self._process_overlays_sequential(image_items, request, output_path, ctx)

    def _run_image_overlay_pass(
        self, image_items: List, output_path, ctx: OverlayPassContext
    ) -> bool:
        """Images only — no subtitles in this timeline."""
        logger.info(f"Processing {len(image_items)} image overlay tracks...")
        video_with_images_path = str(output_path).replace('.mp4', '_with_images.mp4')
        try:
            success = self._process_image_overlays(
                image_items, str(output_path), video_with_images_path, ctx
            )
        except CameraMotionUnsupportedError:
            raise
        except Exception as exc:
            logger.error(f"Image overlay processing error: {exc}", exc_info=True)
            return False
        if success and os.path.exists(video_with_images_path):
            os.replace(video_with_images_path, str(output_path))
            logger.info("Image overlays successfully added to video")
            return True
        return False

    def _run_subtitle_only_pass(self, request, output_path, ctx: OverlayPassContext) -> None:
        """Subtitles only. Unchanged behaviour: a failure warns and carries on."""
        logger.info(f"Processing {len(request.subtitle_items)} subtitle tracks...")
        try:
            subtitle_processed_path = self._process_subtitle_tracks(
                request.subtitle_items, str(output_path), ctx.temp_dir
            )
            if subtitle_processed_path and os.path.exists(subtitle_processed_path):
                os.replace(subtitle_processed_path, str(output_path))
                logger.info("Subtitles successfully added to video")
            else:
                logger.warning("Subtitle processing failed - continuing without subtitles")
        except Exception as exc:
            logger.error(f"Subtitle processing error: {exc}", exc_info=True)
            logger.warning("Continuing video composition without subtitles")

    @staticmethod
    def _items_with_camera_motion(image_items: List) -> List[str]:
        """Ids of the stills carrying a camera move (L-I1 / L-I2 subject set)."""
        return [
            str(getattr(item, "id", "?"))
            for item in image_items
            if getattr(item, "camera_motion", None) is not None
        ]

    def _guard_overlay_outcome(self, image_items: List, overlays_ok: bool) -> None:
        """Refuse to finish an export that quietly lost a camera move (L-I2).

        Scoped to stills that carry a motion on purpose. Failing every image
        overlay failure would be a much larger behaviour change than this round
        signed up for — but the pre-existing warning is kept so the regression is
        at least visible in the log.
        """
        if overlays_ok:
            return
        motion_ids = self._items_with_camera_motion(image_items)
        if not motion_ids:
            logger.warning("Image overlay processing did not produce output file")
            return
        raise RuntimeError(
            "Image overlay pass failed for clips carrying camera motion "
            f"({', '.join(motion_ids)}). Refusing to finish the export without the "
            "effect that was applied — see the FFmpeg errors above for the cause."
        )

    def _process_overlays_sequential(
        self, all_image_items: List, request, output_path, ctx: OverlayPassContext
    ) -> bool:
        """Fallback: image overlays then subtitles, in two encoding passes.

        Returns:
            Whether the IMAGE pass succeeded. Subtitles keep their historical
            best-effort semantics; the return value exists so the caller's L-I2
            guard can tell "recovered by the fallback" from "lost the effect on
            every rung" — the rung that used to swallow both silently.
        """
        images_ok = False
        try:
            video_with_images_path = str(output_path).replace('.mp4', '_with_images.mp4')
            success = self._process_image_overlays(
                all_image_items, str(output_path), video_with_images_path, ctx
            )
            if success and os.path.exists(video_with_images_path):
                os.replace(video_with_images_path, str(output_path))
                logger.info("Image overlays added (sequential fallback)")
                images_ok = True
        except CameraMotionUnsupportedError:
            raise
        except Exception as e:
            logger.error(f"Image overlay error in fallback: {e}", exc_info=True)

        try:
            subtitle_processed_path = self._process_subtitle_tracks(
                request.subtitle_items, str(output_path), ctx.temp_dir
            )
            if subtitle_processed_path and os.path.exists(subtitle_processed_path):
                os.replace(subtitle_processed_path, str(output_path))
                logger.info("Subtitles added (sequential fallback)")
        except Exception as e:
            logger.error(f"Subtitle error in fallback: {e}", exc_info=True)
        return images_ok

    def _process_overlays_and_subtitles_combined(
        self, image_items: List, subtitle_items: List,
        video_path: str, output_path: str, ctx: OverlayPassContext
    ) -> bool:
        """
        Merge image overlays and subtitle drawtext filters into a single FFmpeg encoding pass.
        This eliminates one full re-encoding compared to processing them sequentially.

        The image half is assembled by the SAME helpers the no-subtitle path uses
        (:meth:`_prepare_image_overlay_entries` /
        :meth:`_image_overlay_filter_parts`). They used to be two hand-kept
        copies, which is how "the camera move only works when the timeline also
        has a subtitle" would come about — a divergence nobody would think to
        look for (L1).
        """
        temp_dir = ctx.temp_dir
        try:
            ffmpeg_path = self._get_ffmpeg_path()

            entries = self._prepare_image_overlay_entries(image_items, video_path, ctx)
            if entries is None:
                return False

            # --- Build image overlay inputs and filter chain ---
            cmd = [ffmpeg_path, '-y', '-i', video_path]
            for entry in entries:
                cmd.extend(entry.motion.input_options)
                cmd.extend(['-i', entry.path])

            valid_items = [entry.item for entry in entries]
            filter_parts, _ = self._image_overlay_filter_parts(entries)

            # --- Build subtitle drawtext filters ---
            srt_path = self._create_srt_from_subtitle_items(subtitle_items, temp_dir)
            if not srt_path or not os.path.exists(srt_path):
                logger.error("Failed to create SRT file for merged processing")
                return False

            first_subtitle = subtitle_items[0]
            font_family = getattr(first_subtitle, 'font_family', 'default')
            font_size = getattr(first_subtitle, 'font_size', 24)
            font_color = getattr(first_subtitle, 'font_color', '#FFFFFF')
            background_color = getattr(first_subtitle, 'background_color', None)
            position = getattr(first_subtitle, 'position', 'bottom')
            if not background_color:
                background_color = "#000000@0.5"

            subtitle_request = SubtitleAddRequest(
                video_file_path=video_path,
                subtitle_file_path=srt_path,
                font_family=font_family,
                font_size=font_size,
                font_color=font_color,
                background_color=background_color,
                border_width=2,
                border_color="#000000",
                position=position,
                margin_vertical=50,
                margin_horizontal=50
            )

            text_files_dir = tempfile.mkdtemp(prefix="ecliptrix_merged_subs_")
            try:
                drawtext_filters, _, _ = self.subtitle_service.build_drawtext_filters(
                    subtitle_request, text_files_dir
                )

                if not drawtext_filters:
                    logger.warning("No drawtext filters generated, proceeding with image overlays only")
                    # Still do single pass with just overlays
                    if valid_items:
                        filter_complex = ";".join(filter_parts)
                        final_output = f"[v{len(valid_items)-1}]"
                    else:
                        return False
                else:
                    # Merge: chain drawtext filters onto the last overlay output
                    if valid_items:
                        last_overlay_label = f"[v{len(valid_items)-1}]"
                        drawtext_chain = f"{last_overlay_label}{','.join(drawtext_filters)}[vout]"
                        filter_parts.append(drawtext_chain)
                        filter_complex = ";".join(filter_parts)
                        final_output = "[vout]"
                    else:
                        # No valid image items but have subtitles - use drawtext only via filter_complex
                        filter_complex = f"[0:v]{','.join(drawtext_filters)}[vout]"
                        final_output = "[vout]"

                cmd.extend([
                    '-filter_complex', filter_complex,
                    '-map', final_output,
                    '-map', '0:a?',
                    '-c:a', 'copy',
                ])
                cmd.extend(self._get_encoding_params("fast"))
                cmd.append(output_path)

                logger.info(f"Running merged overlay+subtitle command")
                result = subprocess.run(cmd, capture_output=True, text=True)

                if result.returncode == 0:
                    logger.info("Merged overlay+subtitle processing completed successfully")
                    return True
                else:
                    logger.error(f"Merged processing failed: {result.stderr}")
                    return False
            finally:
                shutil.rmtree(text_files_dir, ignore_errors=True)

        except CameraMotionUnsupportedError:
            # Actionable and unrecoverable: swallowing it into a bare False would
            # trade "install an FFmpeg with `perspective`" for "the overlay pass
            # failed", and no ladder rung can fix it anyway.
            raise
        except Exception as e:
            logger.error(f"Error in merged overlay+subtitle processing: {str(e)}", exc_info=True)
            return False

    def _process_image_overlays(
        self, image_items: List, video_path: str, output_path: str, ctx: OverlayPassContext
    ) -> bool:
        """
        Process image overlays and add them to the video.

        Args:
            image_items: List of video items that are actually image overlays
            video_path: Path to the input video file
            output_path: Path for the output video with overlays
            ctx: Pass context (temp dir, output resolution, fps, warnings)

        Returns:
            True if processing succeeded, False otherwise
        """
        try:
            logger.info(f"Starting image overlay processing for {len(image_items)} image items")

            # Get FFmpeg path
            ffmpeg_path = self._get_ffmpeg_path()

            entries = self._prepare_image_overlay_entries(image_items, video_path, ctx)
            if entries is None:
                return False
            if len(entries) == 0:
                logger.warning("No valid image items to overlay")
                return False

            # Build FFmpeg command for image overlays
            cmd = [ffmpeg_path, '-y', '-i', video_path]
            for entry in entries:
                # Animated stills need `-loop 1 -framerate … -t …` BEFORE their
                # `-i`; a still image otherwise carries a single frame, so `on`
                # never advances and eval=frame renders one frozen framing.
                cmd.extend(entry.motion.input_options)
                cmd.extend(['-i', entry.path])

            filter_parts, final_output = self._image_overlay_filter_parts(entries)
            filter_complex = ";".join(filter_parts)

            logger.info(f"Image overlay filter complex: {filter_complex}")
            
            cmd.extend([
                '-filter_complex', filter_complex,
                '-map', final_output,
                '-map', '0:a?',  # Copy audio if it exists
                '-c:a', 'copy',  # Copy audio codec
            ])
            cmd.extend(self._get_encoding_params("fast"))
            cmd.append(output_path)
            
            logger.info(f"Running image overlay command: {' '.join(cmd)}")
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                logger.info(f"Image overlay processing completed successfully")
                logger.info(f"Output file: {output_path} (size: {os.path.getsize(output_path)} bytes)")
                return True
            else:
                logger.error(f"Image overlay processing failed: {result.stderr}")
                return False
                
        except CameraMotionUnsupportedError:
            # See the combined pass: actionable, unrecoverable, must not degrade
            # into an anonymous False.
            raise
        except Exception as e:
            logger.error(f"Error processing image overlays: {str(e)}", exc_info=True)
            return False

    def _download_image(self, image_url: str, temp_dir: str, index: int) -> Dict[str, Any]:
        """Download an image file from URL into temp_dir."""
        return download_image(image_url, temp_dir, index)
