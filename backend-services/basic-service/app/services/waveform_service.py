"""Local audio waveform service (spec 04 — 本地音频波形).

Extracts amplitude *peaks* from an audio (or audio-bearing video) asset using
the bundled FFmpeg, downsamples them to a fixed-per-second resolution, and
persists a compact JSON document the frontend canvas renderer consumes
directly without ever decoding audio in the browser.

On-disk schema (camelCase, frontend-direct):
    {
        "version": 1,
        "materialId": "<id>",
        "durationSec": <float>,
        "peaksPerSecond": <int>,
        "peaks": [<float 0..1>, ...]
    }
stored at ``STORAGE_ROOT/static/audio/waveforms/{materialId}.json`` and served
via the existing ``/api/storage/files`` mount.

REST helpers (:meth:`generate`, :meth:`get_waveform`) return **snake_case**
field names (``duration_sec``, ``peaks_per_second``) to match the project's
Pydantic response convention; only the persisted JSON uses camelCase.

Spec-06 cache-GC hooks (:meth:`list_material_files`, :meth:`delete_by_material`)
let the persistence/cleanup layer track and reclaim derived files by
``materialId``.
"""

from __future__ import annotations

import array
import asyncio
import json
import math
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiofiles

from app.config import settings
from app.logger import get_logger
from app.services.local_media_resolver import (
    LocalMediaResolveError,
    resolve_media_reference,
)

logger = get_logger(__name__)


# On-disk schema version. Bump only on a breaking change to the JSON shape so
# the frontend can detect and ignore stale documents.
WAVEFORM_SCHEMA_VERSION = 1

# Relative directory (under STORAGE_ROOT) where waveform JSON docs live. Kept
# in one place so spec-06 cleanup and the static-mount URL stay in lockstep.
WAVEFORM_REL_DIR = "static/audio/waveforms"

# Full-scale value of signed 16-bit PCM samples — the normalization divisor.
_INT16_FULL_SCALE = 32768.0

# Fixed PCM decode sample rate. Pinning ``-ar`` keeps the sample-count →
# duration fallback (used when ffprobe is unavailable) exact and deterministic
# instead of guessing the source rate. Analysis-only, so a single common rate
# is sufficient.
_DECODE_SAMPLE_RATE = 44100

# A materialId becomes a filename stem; it must not smuggle path separators or
# traversal. We accept the same conservative alphabet the project uses for ids
# (uuid hex, ark task ids, slugs) plus a few safe punctuation chars.
_SAFE_MATERIAL_ID_RE = re.compile(r"^[A-Za-z0-9._\-]+$")


class WaveformService:
    """Generate, persist, fetch and reclaim local audio waveform peaks."""

    def __init__(self) -> None:
        """Initialize the service and ensure the waveform directory exists."""
        self.config = settings.waveform
        self.root = Path(settings.storage.root)
        self.waveform_dir = self.root / WAVEFORM_REL_DIR
        self.waveform_dir.mkdir(parents=True, exist_ok=True)

        logger.info("WaveformService initialized", {
            "waveform_dir": str(self.waveform_dir.resolve()),
            "peaks_per_second": self.config.peaks_per_second,
        })

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _safe_stem(self, material_id: str) -> str:
        """Return a traversal-safe filename stem for *material_id*.

        Args:
            material_id: Caller-supplied material identifier.

        Returns:
            The validated identifier, safe to use as a filename stem.

        Raises:
            ValueError: When *material_id* is empty or contains path
                separators / traversal sequences / unsafe characters.
        """
        if not material_id or not str(material_id).strip():
            raise ValueError("material_id is empty")
        candidate = str(material_id).strip()
        if not _SAFE_MATERIAL_ID_RE.match(candidate):
            raise ValueError(
                "material_id contains characters that are not filename-safe"
            )
        if candidate in {".", ".."}:
            raise ValueError("material_id may not be a path component")
        return candidate

    def _json_path(self, material_id: str) -> Path:
        """Return the absolute on-disk JSON path for a validated material id."""
        return self.waveform_dir / f"{self._safe_stem(material_id)}.json"

    def _rel_path(self, material_id: str) -> str:
        """Return the STORAGE_ROOT-relative path (forward slashes)."""
        return f"{WAVEFORM_REL_DIR}/{self._safe_stem(material_id)}.json"

    def url_for(self, material_id: str) -> str:
        """Return the same-origin URL that serves a material's waveform JSON."""
        return f"/api/storage/files/{self._rel_path(material_id)}"

    def _probe_duration(self, audio_path: str) -> Optional[float]:
        """Probe the media duration in seconds via ffprobe.

        Args:
            audio_path: Absolute or relative path to the media file.

        Returns:
            Duration in seconds, or ``None`` when probing fails.
        """
        try:
            probe = subprocess.run(
                [
                    "ffprobe", "-v", "quiet", "-print_format", "json",
                    "-show_format", str(audio_path),
                ],
                capture_output=True, text=True,
                timeout=self.config.timeout_seconds,
            )
        except (FileNotFoundError, subprocess.SubprocessError) as exc:
            logger.warning("ffprobe duration probe failed", {"error": str(exc)})
            return None
        if probe.returncode != 0:
            return None
        try:
            raw = json.loads(probe.stdout).get("format", {}).get("duration")
            return float(raw) if raw is not None else None
        except (ValueError, json.JSONDecodeError):
            return None

    def _decode_mono_pcm(self, audio_path: str) -> array.array:
        """Decode *audio_path* to mono signed-16-bit PCM samples via ffmpeg.

        Args:
            audio_path: Path to the input media (audio or audio-bearing video).

        Returns:
            An ``array('h')`` of signed 16-bit samples (host byte order).

        Raises:
            RuntimeError: When ffmpeg exits non-zero or produces no audio.
            FileNotFoundError: When ffmpeg is not on PATH.
        """
        proc = subprocess.run(
            [
                "ffmpeg", "-v", "error",
                "-i", str(audio_path),
                "-ac", "1",            # mix down to mono
                "-ar", str(_DECODE_SAMPLE_RATE),  # pin rate → exact fallback
                "-f", "s16le",         # raw signed 16-bit little-endian PCM
                "-acodec", "pcm_s16le",
                "-",                   # write PCM to stdout
            ],
            capture_output=True,
            timeout=self.config.timeout_seconds,
        )
        if proc.returncode != 0:
            stderr = proc.stderr.decode(errors="replace")[:500] if proc.stderr else ""
            raise RuntimeError(f"ffmpeg PCM decode failed: {stderr}")

        samples = array.array("h")  # signed short
        samples.frombytes(proc.stdout)
        # ``s16le`` is little-endian; normalise to host order so abs() is correct
        # on big-endian hosts (a no-op on the common little-endian desktop).
        import sys as _sys
        if _sys.byteorder != "little":
            samples.byteswap()
        return samples

    def _downsample_peaks(
        self, samples: array.array, column_count: int
    ) -> List[float]:
        """Abs-peak downsample *samples* into *column_count* normalized peaks.

        Each output column is the maximum absolute sample within its slice of
        the PCM stream, normalized to ``0..1`` against 16-bit full scale.

        Args:
            samples: Mono PCM samples (signed 16-bit).
            column_count: Desired number of output peaks (≥ 1).

        Returns:
            A list of ``column_count`` floats in ``[0, 1]`` (rounded to 4 dp).
            All-zero when the source is silent / empty.
        """
        column_count = max(1, column_count)
        total = len(samples)
        if total == 0:
            return [0.0] * column_count

        peaks: List[float] = []
        # Use float stride so columns stay evenly spaced even when total is not
        # a clean multiple of column_count (avoids a fat final bucket).
        stride = total / column_count
        for col in range(column_count):
            start = int(col * stride)
            end = int((col + 1) * stride)
            if end <= start:
                end = start + 1
            if start >= total:
                peaks.append(0.0)
                continue
            window = samples[start:min(end, total)]
            peak = max((abs(s) for s in window), default=0)
            peaks.append(round(min(1.0, peak / _INT16_FULL_SCALE), 4))
        return peaks

    def _extract_peaks(self, audio_path: str) -> Dict[str, Any]:
        """Decode + downsample *audio_path* into a normalized peaks document.

        Args:
            audio_path: Path to the media file to analyse.

        Returns:
            A dict with ``duration_sec``, ``peaks_per_second`` and ``peaks``.

        Raises:
            RuntimeError / FileNotFoundError: propagated from the decode step.
        """
        pps = int(self.config.peaks_per_second)
        samples = self._decode_mono_pcm(audio_path)

        duration = self._probe_duration(audio_path)
        if duration is None or duration <= 0:
            # Derive duration from the decoded sample count if ffprobe was
            # unavailable. The decode pins the output rate to
            # ``_DECODE_SAMPLE_RATE`` (``-ar``), so this division is exact.
            duration = (
                len(samples) / float(_DECODE_SAMPLE_RATE) if samples else 0.0
            )

        column_count = max(1, round(duration * pps)) if duration > 0 else 1
        peaks = self._downsample_peaks(samples, column_count)
        return {
            "duration_sec": round(float(duration), 3),
            "peaks_per_second": pps,
            "peaks": peaks,
        }

    def _build_disk_payload(
        self, material_id: str, extracted: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Map an extracted (snake_case) result to the camelCase on-disk doc."""
        return {
            "version": WAVEFORM_SCHEMA_VERSION,
            "materialId": self._safe_stem(material_id),
            "durationSec": extracted["duration_sec"],
            "peaksPerSecond": extracted["peaks_per_second"],
            "peaks": extracted["peaks"],
        }

    @staticmethod
    def _disk_to_rest(payload: Dict[str, Any]) -> Dict[str, Any]:
        """Map a camelCase on-disk doc to the snake_case REST response shape."""
        return {
            "status": "ready",
            "duration_sec": payload.get("durationSec"),
            "peaks_per_second": payload.get("peaksPerSecond"),
            "peaks": payload.get("peaks"),
        }

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def generate(
        self, material_id: str, audio_url: str, force: bool = False
    ) -> Dict[str, Any]:
        """Generate (or reuse) the waveform peaks for a material.

        Idempotent: when a JSON document already exists for *material_id* it is
        returned as-is unless *force* is True.

        Args:
            material_id: Material identifier (filename-safe).
            audio_url: A same-origin ``/api/storage/files/...`` reference or a
                filesystem path to the source media.
            force: When True, re-extract even if a document already exists.

        Returns:
            A snake_case REST dict: ``{status, duration_sec?, peaks_per_second?,
            peaks?, url}``. ``status`` is ``"ready"`` on success and
            ``"failed"`` when extraction errored.

        Raises:
            ValueError: When *material_id* is not filename-safe.
        """
        json_path = self._json_path(material_id)

        if json_path.exists() and not force:
            existing = await self._read_disk(material_id)
            if existing is not None:
                result = self._disk_to_rest(existing)
                result["url"] = self.url_for(material_id)
                return result

        local_path = self._resolve_source_path(audio_url)
        if local_path is None:
            logger.warning("Waveform source could not be resolved", {
                "material_id": material_id, "audio_url": audio_url,
            })
            return {"status": "failed", "url": self.url_for(material_id)}

        loop = asyncio.get_event_loop()
        try:
            extracted = await loop.run_in_executor(
                None, self._extract_peaks, str(local_path)
            )
        except (RuntimeError, FileNotFoundError, subprocess.SubprocessError) as exc:
            logger.error("Waveform extraction failed", {
                "material_id": material_id, "error": str(exc),
            })
            return {"status": "failed", "url": self.url_for(material_id)}

        payload = self._build_disk_payload(material_id, extracted)
        await self._write_disk(material_id, payload)

        logger.info("Waveform generated", {
            "material_id": material_id,
            "duration_sec": extracted["duration_sec"],
            "peaks": len(extracted["peaks"]),
        })
        result = self._disk_to_rest(payload)
        result["url"] = self.url_for(material_id)
        return result

    async def get_waveform(self, material_id: str) -> Dict[str, Any]:
        """Fetch a material's persisted waveform peaks.

        Args:
            material_id: Material identifier (filename-safe).

        Returns:
            ``{status: "ready", duration_sec, peaks_per_second, peaks, url}``
            when present, else ``{status: "missing", peaks: None, url}``.

        Raises:
            ValueError: When *material_id* is not filename-safe.
        """
        payload = await self._read_disk(material_id)
        if payload is None:
            return {
                "status": "missing",
                "peaks": None,
                "url": self.url_for(material_id),
            }
        result = self._disk_to_rest(payload)
        result["url"] = self.url_for(material_id)
        return result

    def list_material_files(self, material_id: str) -> List[str]:
        """List STORAGE_ROOT-relative waveform files for *material_id* (spec 06).

        Args:
            material_id: Material identifier (filename-safe).

        Returns:
            A list with the relative JSON path when it exists, else empty.
        """
        try:
            json_path = self._json_path(material_id)
        except ValueError:
            return []
        if not json_path.exists():
            return []
        return [self._rel_path(material_id)]

    def delete_by_material(self, material_id: str) -> int:
        """Delete the persisted waveform JSON for *material_id* (spec 06).

        Args:
            material_id: Material identifier (filename-safe).

        Returns:
            The number of files removed (0 or 1).
        """
        try:
            json_path = self._json_path(material_id)
        except ValueError:
            return 0
        if not json_path.exists():
            return 0
        try:
            json_path.unlink()
            logger.info("Waveform deleted", {"material_id": material_id})
            return 1
        except OSError as exc:
            logger.error("Waveform deletion failed", {
                "material_id": material_id, "error": str(exc),
            })
            return 0

    # ------------------------------------------------------------------
    # Disk + source-path helpers
    # ------------------------------------------------------------------

    async def _read_disk(self, material_id: str) -> Optional[Dict[str, Any]]:
        """Read + parse the on-disk JSON doc, or ``None`` when absent/corrupt."""
        json_path = self._json_path(material_id)
        if not json_path.exists():
            return None
        try:
            async with aiofiles.open(json_path, "r", encoding="utf-8") as fp:
                raw = await fp.read()
            return json.loads(raw)
        except (OSError, ValueError) as exc:
            logger.warning("Waveform JSON read failed", {
                "material_id": material_id, "error": str(exc),
            })
            return None

    async def _write_disk(
        self, material_id: str, payload: Dict[str, Any]
    ) -> None:
        """Write the camelCase JSON doc to disk (compact separators)."""
        json_path = self._json_path(material_id)
        json_path.parent.mkdir(parents=True, exist_ok=True)
        body = json.dumps(payload, separators=(",", ":"))
        async with aiofiles.open(json_path, "w", encoding="utf-8") as fp:
            await fp.write(body)

    def _resolve_source_path(self, audio_url: str) -> Optional[Path]:
        """Resolve a same-origin media reference or path to a local file.

        Storage references are tried first (see ``_resolve_storage_path``).
        Anything else — notably TTS audio served at
        ``/api/audio/generated/<file>`` — falls back to the media resolver the
        export compositor uses, so "write == serve == resolve" also holds for
        waveforms. That resolver keeps ``allow_remote=False`` and its own path
        guard, so remote URLs are still rejected.

        Returns:
            An existing local ``Path``, else ``None``.
        """
        if not audio_url:
            return None
        resolved = self._resolve_storage_path(audio_url)
        if resolved is not None:
            return resolved
        try:
            return resolve_media_reference(str(audio_url).strip()).path
        except LocalMediaResolveError as exc:
            logger.warning("Waveform source not resolvable via media resolver", {
                "audio_url": audio_url,
                "error": str(exc),
            })
            return None

    def _resolve_storage_path(self, audio_url: str) -> Optional[Path]:
        """Resolve a same-origin storage reference or path to a local file.

        Accepts:
          * ``/api/storage/files/<rel>`` → ``STORAGE_ROOT/<rel>``
          * a bare ``STORAGE_ROOT``-relative path
          * an absolute filesystem path that exists

        Returns:
            An existing ``Path`` inside the storage root (or an existing
            absolute path), else ``None``.
        """
        ref = str(audio_url).strip()

        prefix = "/api/storage/files/"
        if ref.startswith(prefix):
            ref = ref[len(prefix):]
        elif ref.startswith(("http://", "https://")):
            # Only same-origin local references are resolvable to a file.
            marker = "/api/storage/files/"
            idx = ref.find(marker)
            if idx == -1:
                return None
            ref = ref[idx + len(marker):]

        # Strip any query string left on a storage URL.
        ref = ref.split("?", 1)[0]

        candidate = Path(ref)
        if candidate.is_absolute():
            return candidate if candidate.is_file() else None

        resolved = (self.root / ref).resolve()
        try:
            root_resolved = self.root.resolve()
            if not resolved.is_relative_to(root_resolved):
                return None
        except (OSError, ValueError):
            return None
        return resolved if resolved.is_file() else None


# Module-level singleton.
waveform_service = WaveformService()
