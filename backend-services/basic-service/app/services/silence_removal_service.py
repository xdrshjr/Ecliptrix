"""
Silence detection and removal service.

Uses FFmpeg silencedetect filter to identify silent segments in video files.
Extracts a low-bitrate mono MP3 audio track for frontend wavesurfer.js rendering.
Provides async video cutting + concatenation to remove user-selected silence segments.
"""

import asyncio
import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

from app.config import settings
from app.logger import get_logger
from app.models.silence_removal_models import (
    SilenceDetectData,
    SilenceProgressData,
    SilenceRemoveRequest,
    SilenceRemoveResult,
    SilenceSegment,
)

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_VIDEO_DURATION_SECONDS = 1800  # 30 minutes

# Resolve storage root from settings (default: "static/uploads")
_storage_root = getattr(getattr(settings, "storage", None), "root", None) or "static/uploads"

# Directory for extracted audio files used by silence detection
# Placed under storage root so it's accessible via /api/storage/files/ proxy
SILENCE_DETECT_AUDIO_DIR = Path(_storage_root) / "audio" / "silence_detect"

# Directories for silence removal processing
SILENCE_REMOVAL_TEMP_DIR = Path("temp/silence_removal")
# Output under storage root so it's accessible via /api/storage/files/ proxy
SILENCE_REMOVED_OUTPUT_DIR = Path(_storage_root) / "video" / "silence_removed"

# Task expiry threshold (seconds) -- completed/failed tasks older than this are purged
TASK_EXPIRY_SECONDS = 3600  # 1 hour

# Minimum segment duration to bother cutting (seconds)
MIN_SEGMENT_DURATION = 0.001

# Regex patterns for FFmpeg silencedetect output
_RE_SILENCE_START = re.compile(r"silence_start:\s*([-\d.]+)")
_RE_SILENCE_END = re.compile(
    r"silence_end:\s*([-\d.]+)\s*\|\s*silence_duration:\s*([-\d.]+)"
)


# ---------------------------------------------------------------------------
# Task tracking
# ---------------------------------------------------------------------------

@dataclass
class TaskInfo:
    """In-memory state for an async silence-removal task."""

    task_id: str
    status: str = "pending"          # pending | processing | completed | failed
    progress: float = 0.0            # 0-100
    stage_message: str = ""
    result: Optional[SilenceRemoveResult] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)


class SilenceRemovalService:
    """Service for detecting silence in video/audio files via FFmpeg."""

    def __init__(self) -> None:
        # Ensure all required directories exist on startup
        SILENCE_DETECT_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
        SILENCE_REMOVAL_TEMP_DIR.mkdir(parents=True, exist_ok=True)
        SILENCE_REMOVED_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        # In-memory task store (task_id -> TaskInfo)
        self._tasks: Dict[str, TaskInfo] = {}

        logger.info(
            "SilenceRemovalService initialized, "
            f"audio output dir: {SILENCE_DETECT_AUDIO_DIR}, "
            f"removal temp dir: {SILENCE_REMOVAL_TEMP_DIR}, "
            f"removal output dir: {SILENCE_REMOVED_OUTPUT_DIR}"
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def detect_silence(
        self,
        video_url: str,
        noise_threshold: float = -30.0,
        min_silence_duration: float = 0.5,
    ) -> SilenceDetectData:
        """
        Detect silent segments in a video file.

        Steps:
          1. Resolve *video_url* to a local filesystem path.
          2. Validate duration (<=30 min) and audio track existence via ffprobe.
          3. Extract mono 44.1 kHz 64 kbps MP3 audio.
          4. Run silencedetect filter and parse results.
          5. Return audio URL + silence segment list + statistics.

        Args:
            video_url: Video file URL or local path.
            noise_threshold: Silence threshold in dB (default -30).
            min_silence_duration: Minimum silence length in seconds (default 0.5).

        Returns:
            SilenceDetectData with audio URL, segments, and statistics.

        Raises:
            FileNotFoundError: Video file does not exist.
            ValueError: Video has no audio track or exceeds duration limit.
            RuntimeError: FFmpeg command failure.
        """
        # Step 1 -- resolve URL to local path
        local_path = self._resolve_video_path(video_url)
        logger.info(f"Resolved video path: {local_path}")

        # Step 2 -- probe: duration + audio track check
        audio_duration = await self._probe_duration(local_path)
        if audio_duration > MAX_VIDEO_DURATION_SECONDS:
            raise ValueError(
                f"Video duration ({audio_duration:.1f}s) exceeds "
                f"the {MAX_VIDEO_DURATION_SECONDS}s limit"
            )

        has_audio = await self._probe_has_audio(local_path)
        if not has_audio:
            raise ValueError("Video file does not contain an audio track")

        # Step 3 -- extract audio
        audio_filename = f"{uuid.uuid4().hex}.mp3"
        audio_output_path = SILENCE_DETECT_AUDIO_DIR / audio_filename
        await self._extract_audio(local_path, str(audio_output_path))

        # Step 4 -- silencedetect
        segments = await self._run_silence_detect(
            str(audio_output_path),
            noise_threshold,
            min_silence_duration,
            audio_duration,
        )

        # Step 5 -- build response payload
        total_silence = sum(seg.duration for seg in segments)
        silence_pct = (total_silence / audio_duration * 100) if audio_duration > 0 else 0.0

        # Build the audio URL that the frontend can fetch via the storage proxy
        audio_url = f"/api/storage/files/audio/silence_detect/{audio_filename}"

        logger.info(
            f"Silence detection complete: {len(segments)} segments, "
            f"total_silence={total_silence:.2f}s, "
            f"silence_pct={silence_pct:.1f}%"
        )

        return SilenceDetectData(
            audio_url=audio_url,
            audio_duration=round(audio_duration, 3),
            silence_segments=segments,
            total_silence_duration=round(total_silence, 3),
            silence_percentage=round(silence_pct, 2),
        )

    # ------------------------------------------------------------------
    # Public API: Silence Removal
    # ------------------------------------------------------------------

    async def remove_silence(self, request: SilenceRemoveRequest) -> str:
        """
        Create an async task to remove silence segments from a video.

        Returns the ``task_id`` immediately.  The caller should poll
        ``get_progress(task_id)`` for status updates.
        """
        # Purge expired tasks before creating a new one
        self._cleanup_expired_tasks()

        task_id = uuid.uuid4().hex
        task = TaskInfo(task_id=task_id)
        self._tasks[task_id] = task

        logger.info(
            f"Silence removal task created: task_id={task_id}, "
            f"segments_to_remove={len(request.segments_to_remove)}, "
            f"preserved_gap={request.preserved_gap}s, "
            f"fade_duration={request.fade_duration}s"
        )

        # Fire-and-forget the actual processing
        asyncio.create_task(self._execute_removal(task_id, request))

        return task_id

    def get_progress(self, task_id: str) -> Optional[SilenceProgressData]:
        """
        Return the current progress of a removal task.

        Returns ``None`` if the task_id is unknown.
        """
        task = self._tasks.get(task_id)
        if task is None:
            return None

        return SilenceProgressData(
            task_id=task.task_id,
            status=task.status,
            progress=task.progress,
            stage_message=task.stage_message,
            result=task.result,
            error=task.error,
        )

    # ------------------------------------------------------------------
    # Async removal execution
    # ------------------------------------------------------------------

    async def _execute_removal(
        self, task_id: str, request: SilenceRemoveRequest
    ) -> None:
        """
        Core async logic for cutting + concatenating a video.

        Stages:
          1 (0-10 %):  Prepare — resolve path, sort segments, compute keep_segments.
          2 (10-70 %): Cut — FFmpeg cut each keep segment to a temp file.
          3 (70-95 %): Concat — FFmpeg concat demuxer + optional audio fades.
          4 (95-100 %): Finalize — probe output, cleanup temps, update task.
        """
        task = self._tasks[task_id]
        task.status = "processing"
        task.stage_message = "Preparing..."
        task.progress = 0.0

        task_temp_dir = SILENCE_REMOVAL_TEMP_DIR / task_id
        temp_segment_paths: List[str] = []

        try:
            # ---- Stage 1: Prepare (0 → 10 %) ----
            task.progress = 2.0
            task.stage_message = "Resolving video path..."

            local_path = self._resolve_video_path(request.video_url)
            original_duration = await self._probe_duration(local_path)

            task.progress = 5.0
            task.stage_message = "Computing keep segments..."

            # Sort segments by start time
            sorted_segments = sorted(
                request.segments_to_remove, key=lambda s: s.start
            )

            keep_segments = self._compute_keep_segments(
                sorted_segments,
                original_duration,
                request.preserved_gap,
            )

            # Filter out trivially short or invalid segments
            keep_segments = [
                (s, e) for s, e in keep_segments if (e - s) >= MIN_SEGMENT_DURATION
            ]

            if not keep_segments:
                raise ValueError("NO_KEEP_SEGMENTS")

            # Count how many silence segments were actually removed
            # (a silence segment shorter than preserved_gap is fully preserved)
            actually_removed = 0
            for seg in sorted_segments:
                if (seg.end - seg.start) > request.preserved_gap:
                    actually_removed += 1

            task.progress = 10.0
            task.stage_message = f"Prepared {len(keep_segments)} keep segments"
            logger.info(
                f"[{task_id}] Stage 1 done: {len(keep_segments)} keep segments, "
                f"{actually_removed} segments will be trimmed"
            )

            # ---- Stage 2: Cut keep segments with per-segment fades (10 → 70 %) ----
            task_temp_dir.mkdir(parents=True, exist_ok=True)
            progress_per_segment = 60.0 / max(len(keep_segments), 1)
            fade_dur = request.fade_duration  # applied per-segment, not post-concat

            for idx, (seg_start, seg_end) in enumerate(keep_segments):
                seg_path = str(task_temp_dir / f"segment_{idx:04d}.mp4")
                temp_segment_paths.append(seg_path)

                task.stage_message = (
                    f"Cutting segment {idx + 1}/{len(keep_segments)} "
                    f"({seg_start:.2f}s - {seg_end:.2f}s)"
                )

                await self._ffmpeg_cut(
                    local_path, seg_path, seg_start, seg_end,
                    fade_duration=fade_dur,
                    is_first=(idx == 0),
                    is_last=(idx == len(keep_segments) - 1),
                )

                task.progress = 10.0 + progress_per_segment * (idx + 1)

            logger.info(f"[{task_id}] Stage 2 done: {len(temp_segment_paths)} segments cut")

            # ---- Stage 3: Concat (70 → 95 %) ----
            task.progress = 70.0
            task.stage_message = "Concatenating segments..."

            output_filename = f"{uuid.uuid4().hex}.mp4"
            output_path = SILENCE_REMOVED_OUTPUT_DIR / output_filename

            # Write concat file list
            filelist_path = str(task_temp_dir / "filelist.txt")
            await self._write_concat_filelist(filelist_path, temp_segment_paths)

            # Concat with -c copy (segments already re-encoded to uniform format)
            concat_output = str(output_path)
            await self._ffmpeg_concat(filelist_path, concat_output)

            task.progress = 95.0
            logger.info(f"[{task_id}] Stage 3 done: output at {output_path}")

            # ---- Stage 4: Finalize (95 → 100 %) ----
            task.stage_message = "Finalizing..."

            new_duration = await self._probe_duration(concat_output)
            time_saved = original_duration - new_duration

            video_url = f"/api/storage/files/video/silence_removed/{output_filename}"

            task.result = SilenceRemoveResult(
                video_url=video_url,
                original_duration=round(original_duration, 3),
                new_duration=round(new_duration, 3),
                removed_count=actually_removed,
                time_saved=round(max(time_saved, 0), 3),
            )
            task.status = "completed"
            task.progress = 100.0
            task.stage_message = "Completed"

            logger.info(
                f"[{task_id}] Stage 4 done: "
                f"original={original_duration:.2f}s, new={new_duration:.2f}s, "
                f"saved={time_saved:.2f}s"
            )

        except ValueError as exc:
            err_msg = str(exc)
            task.status = "failed"
            task.error = err_msg
            task.stage_message = f"Failed: {err_msg}"
            logger.error(f"[{task_id}] Removal failed (ValueError): {err_msg}")

        except RuntimeError as exc:
            err_msg = str(exc)
            task.status = "failed"
            task.error = err_msg
            task.stage_message = f"Failed: {err_msg}"
            logger.error(f"[{task_id}] Removal failed (RuntimeError): {err_msg}")

        except Exception as exc:
            err_msg = str(exc)
            task.status = "failed"
            task.error = err_msg
            task.stage_message = f"Failed: {err_msg}"
            logger.error(
                f"[{task_id}] Removal failed (unexpected): {err_msg}",
                exc_info=True,
            )

        finally:
            # Always clean up temp files
            self._cleanup_temp_dir(task_temp_dir)

    # ------------------------------------------------------------------
    # Keep-segment algorithm (Spec 02 Section 5)
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_keep_segments(
        sorted_segments: list,
        total_duration: float,
        preserved_gap: float,
    ) -> List[Tuple[float, float]]:
        """
        Given sorted silence segments and the video duration, compute the
        list of (start, end) pairs to *keep* in the output.

        For each silence segment to remove:
          1. Calculate center: ``silence_center = (start + end) / 2``
          2. Preserved gap boundaries clamped to the segment edges:
             ``gap_start = max(start, center - gap/2)``
             ``gap_end   = min(end,   center + gap/2)``
          3. Keep segment A (speech before silence): prev_end → seg.start
          4. Keep segment B (preserved gap at center): gap_start → gap_end
          5. Update prev_end = seg.end  (skip past the entire silence)
        After the loop, keep the final tail: prev_end → total_duration.

        If a silence segment's duration <= preserved_gap, the whole segment
        is preserved (equivalent to not removing it at all).
        """
        keep_segments: List[Tuple[float, float]] = []
        prev_end = 0.0

        for seg in sorted_segments:
            seg_start = seg.start
            seg_end = seg.end
            silence_duration = seg_end - seg_start

            # If the silence is shorter than the gap, preserve it entirely
            if silence_duration <= preserved_gap:
                # Nothing to remove -- the whole silence fits within the gap.
                # Just extend the current "kept" range through this segment.
                # We don't cut here; we keep [prev_end .. seg_end] intact.
                continue

            silence_center = (seg_start + seg_end) / 2.0
            gap_start = max(seg_start, silence_center - preserved_gap / 2.0)
            gap_end = min(seg_end, silence_center + preserved_gap / 2.0)

            # Keep segment A: speech (and any un-removed short silences)
            # from the last cut point up to where this silence starts.
            if seg_start > prev_end:
                keep_segments.append((prev_end, seg_start))

            # Keep segment B: the preserved gap in the center of this silence
            if gap_end > gap_start:
                keep_segments.append((gap_start, gap_end))

            # Advance past this silence entirely
            prev_end = seg_end

        # Final tail segment (speech after the last silence)
        if total_duration > prev_end:
            keep_segments.append((prev_end, total_duration))

        return keep_segments

    # ------------------------------------------------------------------
    # FFmpeg: cut a single segment
    # ------------------------------------------------------------------

    async def _ffmpeg_cut(
        self,
        input_path: str,
        output_path: str,
        start: float,
        end: float,
        fade_duration: float = 0.0,
        is_first: bool = False,
        is_last: bool = False,
    ) -> None:
        """
        Cut a segment from *input_path* using re-encoding for frame-accurate cuts.

        Audio fades are applied **per-segment** during the cut stage (not post-
        concat) to avoid the chained-afade bug where ``afade=t=out`` permanently
        silences audio beyond the fade range.

        - Non-first segments get a fade-in at their start
        - Non-last segments get a fade-out at their end
        - First/last segments of the whole video are left untouched at those edges
        """
        seg_duration = end - start

        # Build audio filter for per-segment fades
        af_parts: list[str] = []
        if fade_duration > 0 and seg_duration > fade_duration * 2:
            if not is_first:
                # Fade in at segment start (relative time 0)
                af_parts.append(f"afade=t=in:st=0:d={fade_duration:.6f}")
            if not is_last:
                # Fade out at segment end
                fade_out_start = max(0.0, seg_duration - fade_duration)
                af_parts.append(f"afade=t=out:st={fade_out_start:.6f}:d={fade_duration:.6f}")

        cmd = [
            "ffmpeg",
            "-y",
            "-i", input_path,
            "-ss", f"{start:.6f}",
            "-to", f"{end:.6f}",
            "-c:v", "libx264",
            "-preset", "fast",
            "-c:a", "aac",
        ]

        if af_parts:
            cmd += ["-af", ",".join(af_parts)]

        cmd += [
            "-avoid_negative_ts", "make_zero",
            output_path,
        ]
        try:
            await self._run_cmd(cmd, f"ffmpeg cut [{start:.3f}-{end:.3f}]")
        except RuntimeError as exc:
            raise RuntimeError(f"FFmpeg cut failed: {exc}") from exc

    # ------------------------------------------------------------------
    # FFmpeg: concat segments
    # ------------------------------------------------------------------

    async def _ffmpeg_concat(
        self,
        filelist_path: str,
        output_path: str,
    ) -> None:
        """
        Concatenate segments listed in *filelist_path* using the concat demuxer.

        Because all segments were re-encoded to a uniform H.264/AAC format,
        ``-c copy`` is safe and fast.
        """
        cmd = [
            "ffmpeg",
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", filelist_path,
            "-c", "copy",
            output_path,
        ]
        try:
            await self._run_cmd(cmd, "ffmpeg concat")
        except RuntimeError as exc:
            raise RuntimeError(f"FFmpeg concat failed: {exc}") from exc

    # ------------------------------------------------------------------
    # File helpers
    # ------------------------------------------------------------------

    @staticmethod
    async def _write_concat_filelist(
        filelist_path: str, segment_paths: List[str]
    ) -> None:
        """Write the concat-demuxer file list with absolute paths."""
        import aiofiles

        async with aiofiles.open(filelist_path, "w", encoding="utf-8") as f:
            for seg_path in segment_paths:
                # Use forward slashes and absolute paths for cross-platform safety
                abs_path = os.path.abspath(seg_path).replace("\\", "/")
                await f.write(f"file '{abs_path}'\n")

    @staticmethod
    def _cleanup_temp_dir(temp_dir: Path) -> None:
        """Remove a temporary directory and all its contents (best-effort)."""
        import shutil

        if temp_dir.exists():
            try:
                shutil.rmtree(str(temp_dir), ignore_errors=True)
                logger.debug(f"Cleaned up temp dir: {temp_dir}")
            except Exception as exc:
                logger.warning(f"Failed to clean temp dir {temp_dir}: {exc}")

    def _cleanup_expired_tasks(self) -> None:
        """Purge tasks that are completed/failed and older than TASK_EXPIRY_SECONDS."""
        now = time.time()
        expired_ids = [
            tid
            for tid, task in self._tasks.items()
            if task.status in ("completed", "failed")
            and (now - task.created_at) > TASK_EXPIRY_SECONDS
        ]
        for tid in expired_ids:
            del self._tasks[tid]

        if expired_ids:
            logger.info(f"Cleaned up {len(expired_ids)} expired task(s)")

    # ------------------------------------------------------------------
    # Path resolution
    # ------------------------------------------------------------------

    def _resolve_video_path(self, video_url: str) -> str:
        """
        Convert a video URL to a path that FFmpeg can consume.

        Supported URL formats:
        - ``/api/storage/files/video/xxx.mp4``  (strip prefix, join with STORAGE_ROOT)
        - ``http(s)://host/api/storage/files/video/xxx.mp4``  (same, after stripping origin)
        - ``http(s)://oss-domain/...``  (remote OSS/CDN URL — returned as-is for FFmpeg)
        - Bare local path  (returned as-is after existence check)

        FFmpeg natively supports HTTP(S) input, so remote URLs that do not
        belong to the local storage API are passed through directly.

        Raises:
            FileNotFoundError: If a local path does not exist on disk.
            ValueError: If a local path escapes the storage root (path traversal).
        """
        storage_root = getattr(settings, "storage", None)
        root_dir = storage_root.root if storage_root else "static/uploads"

        path = video_url
        resolved_from_storage = False
        is_remote = False

        # Handle full URL
        if path.startswith(("http://", "https://")):
            parsed = urlparse(path)
            # Check if this is a local storage API URL (same-origin or localhost)
            local_path_part = parsed.path  # e.g. "/api/storage/files/video/xxx.mp4"
            if local_path_part.startswith("/api/storage/files/"):
                path = local_path_part
            else:
                # Remote URL (OSS, CDN, etc.) — FFmpeg can handle it directly
                is_remote = True

        if is_remote:
            logger.info(f"Remote video URL detected, passing directly to FFmpeg: {video_url}")
            return video_url

        # Strip the static-file mount prefix that the frontend uses
        storage_prefix = "/api/storage/files/"
        if path.startswith(storage_prefix):
            relative = path[len(storage_prefix):]
            # Guard against path traversal (e.g. "../../etc/passwd")
            if ".." in relative:
                raise ValueError(f"Path traversal detected in video URL: {video_url}")
            path = os.path.join(root_dir, relative)
            resolved_from_storage = True

        # Normalize separators for the current OS
        path = os.path.normpath(path)

        # Final path traversal guard: ensure resolved path is under storage root
        if resolved_from_storage:
            root_resolved = os.path.normpath(os.path.abspath(root_dir))
            path_resolved = os.path.normpath(os.path.abspath(path))
            if not path_resolved.startswith(root_resolved):
                raise ValueError(f"Path traversal detected in video URL: {video_url}")

        if not os.path.isfile(path):
            raise FileNotFoundError(f"Video file not found: {path}")

        return path

    # ------------------------------------------------------------------
    # FFprobe helpers
    # ------------------------------------------------------------------

    async def _probe_duration(self, video_path: str) -> float:
        """Return the duration of the media file in seconds via ffprobe."""
        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            video_path,
        ]
        stdout, _ = await self._run_cmd(cmd, "ffprobe (duration)")
        try:
            data = json.loads(stdout)
            duration = float(data["format"]["duration"])
        except (json.JSONDecodeError, KeyError, ValueError) as exc:
            raise RuntimeError(
                f"Failed to parse duration from ffprobe output: {exc}"
            ) from exc
        logger.info(f"Video duration: {duration:.2f}s")
        return duration

    async def _probe_has_audio(self, video_path: str) -> bool:
        """Return True if the media file contains at least one audio stream."""
        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-select_streams", "a",
            "-show_entries", "stream=index",
            "-of", "csv=p=0",
            video_path,
        ]
        stdout, _ = await self._run_cmd(cmd, "ffprobe (audio check)")
        has_audio = bool(stdout.strip())
        logger.info(f"Video has audio track: {has_audio}")
        return has_audio

    # ------------------------------------------------------------------
    # FFmpeg: extract audio
    # ------------------------------------------------------------------

    async def _extract_audio(self, video_path: str, output_path: str) -> None:
        """
        Extract audio from *video_path* as mono 44.1 kHz 64 kbps MP3.

        Spec reference: ``ffmpeg -i {input} -vn -ac 1 -ar 44100 -b:a 64k -f mp3 {output}``
        """
        cmd = [
            "ffmpeg",
            "-y",           # overwrite output
            "-i", video_path,
            "-vn",          # drop video
            "-ac", "1",     # mono
            "-ar", "44100", # 44.1 kHz
            "-b:a", "64k",  # 64 kbps
            "-f", "mp3",
            output_path,
        ]
        await self._run_cmd(cmd, "ffmpeg (extract audio)")
        logger.info(f"Audio extracted to {output_path}")

    # ------------------------------------------------------------------
    # FFmpeg: silencedetect
    # ------------------------------------------------------------------

    async def _run_silence_detect(
        self,
        audio_path: str,
        noise_threshold: float,
        min_silence_duration: float,
        audio_duration: float,
    ) -> List[SilenceSegment]:
        """
        Run FFmpeg silencedetect and parse the stderr output.

        Spec reference:
            ``ffmpeg -i {audio} -af silencedetect=noise={threshold}dB:d={min_duration} -f null -``

        Edge cases handled:
        - Silence starting at 0.0 (video begins with silence).
        - Trailing silence with no ``silence_end`` (video ends with silence):
          uses *audio_duration* as the end timestamp.
        """
        cmd = [
            "ffmpeg",
            "-i", audio_path,
            "-af", f"silencedetect=noise={noise_threshold}dB:d={min_silence_duration}",
            "-f", "null",
            "-",
        ]
        # silencedetect writes to stderr
        _, stderr = await self._run_cmd(
            cmd, "ffmpeg (silencedetect)", allow_nonzero=True
        )

        segments = self._parse_silence_output(stderr, audio_duration)
        return segments

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_silence_output(
        stderr: str, audio_duration: float
    ) -> List[SilenceSegment]:
        """
        Parse ``silencedetect`` stderr output into a list of ``SilenceSegment``.

        The output contains interleaved lines like:
          [silencedetect ...] silence_start: 1.234
          [silencedetect ...] silence_end: 2.567 | silence_duration: 1.333

        When the audio ends with silence, only ``silence_start`` appears without
        a corresponding ``silence_end``.  In that case *audio_duration* is used.
        """
        segments: List[SilenceSegment] = []
        pending_start: float | None = None

        for line in stderr.splitlines():
            start_match = _RE_SILENCE_START.search(line)
            end_match = _RE_SILENCE_END.search(line)

            if end_match:
                # Pair with pending start
                end_time = float(end_match.group(1))
                if pending_start is not None:
                    duration = end_time - pending_start
                    segments.append(
                        SilenceSegment(
                            id=uuid.uuid4().hex,
                            start=round(pending_start, 3),
                            end=round(end_time, 3),
                            duration=round(duration, 3),
                        )
                    )
                    pending_start = None
            elif start_match:
                # New silence start; if a previous start was unmatched (shouldn't
                # happen normally), close it at this timestamp.
                if pending_start is not None:
                    # Edge: consecutive starts without end — treat previous as
                    # ending right before this one (defensive).
                    seg_end = float(start_match.group(1))
                    duration = seg_end - pending_start
                    if duration > 0:
                        segments.append(
                            SilenceSegment(
                                id=uuid.uuid4().hex,
                                start=round(pending_start, 3),
                                end=round(seg_end, 3),
                                duration=round(duration, 3),
                            )
                        )
                pending_start = float(start_match.group(1))

        # Handle trailing silence (only silence_start, no silence_end)
        if pending_start is not None:
            end_time = audio_duration
            duration = end_time - pending_start
            if duration > 0:
                segments.append(
                    SilenceSegment(
                        id=uuid.uuid4().hex,
                        start=round(pending_start, 3),
                        end=round(end_time, 3),
                        duration=round(duration, 3),
                    )
                )

        return segments

    # ------------------------------------------------------------------
    # Subprocess helper
    # ------------------------------------------------------------------

    async def _run_cmd(
        self,
        cmd: List[str],
        label: str,
        allow_nonzero: bool = False,
    ) -> Tuple[str, str]:
        """
        Run a subprocess asynchronously and return (stdout, stderr).

        Args:
            cmd: Command and arguments.
            label: Human-readable label for logging.
            allow_nonzero: If False, a non-zero return code raises RuntimeError.

        Raises:
            RuntimeError: On command failure when *allow_nonzero* is False.
        """
        logger.debug(f"Running [{label}]: {' '.join(cmd)}")

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_bytes, stderr_bytes = await process.communicate()
        stdout = stdout_bytes.decode("utf-8", errors="replace")
        stderr = stderr_bytes.decode("utf-8", errors="replace")

        if process.returncode != 0 and not allow_nonzero:
            logger.error(
                f"[{label}] exited with code {process.returncode}.\n"
                f"stderr: {stderr[:2000]}"
            )
            raise RuntimeError(
                f"FFmpeg/ffprobe command failed ({label}): {stderr[:500]}"
            )

        return stdout, stderr


# Module-level singleton (follows project convention, e.g. video_analysis_service)
silence_removal_service = SilenceRemovalService()
