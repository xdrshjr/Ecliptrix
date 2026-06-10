"""Derived-file cache governance (spec 06 — persistence + cache GC).

This service owns two cold-path cleanup duties for the local desktop editor's
derived artefacts (filmstrip/poster thumbnails and audio waveforms), both
keyed by the **directory convention** (method A) — no DB migration:

  * ``static/video/thumbnails/{key}/``   (poster.jpg + strip_*.jpg)
  * ``static/audio/waveforms/{key}.json``

Two operations:

  1. :meth:`delete_material` — delete-联动: when the user deletes a material,
     remove its source file (when known) AND cascade-delete its derived
     thumbnail dir + waveform JSON. Poster dirs are keyed by the stored-file
     stem while filmstrip dirs are keyed by the frontend materialId, so the
     caller may pass ``extra_keys`` to cascade both key spaces.

  2. :meth:`reclaim` — orphan reclaim: given the set of *referenced* material
     keys (the live material library ∪ every key referenced by a local
     project), delete the derived thumbnail dirs / waveform files whose key is
     NOT in that set.

ORPHAN-RECLAIM SAFETY (the load-bearing invariant of this spec):
  An *empty* or *abnormal* (non-set / ``None``) referenced set is treated as
  "I do not know what is live" → :meth:`reclaim` SKIPS entirely and deletes
  NOTHING. Mass-deleting on an incomplete reference集 would destroy users'
  thumbnails/waveforms, so "when unsure, keep." A ``dry_run`` mode logs the
  intended deletions without touching the filesystem.

The startup entry (:meth:`run_startup_reclaim`) is rate-limited (one pass per
process within a cooldown) and runs the scan off the event loop via a thread
executor so it never blocks application startup.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Set

from app.config import settings
from app.logger import get_logger
from app.services.storage_service import storage_service as _default_storage
from app.services.thumbnail_service import thumbnail_service as _default_thumbnails
from app.services.waveform_service import waveform_service as _default_waveforms

logger = get_logger(__name__)


# Minimum seconds between two startup reclaim passes in one process. Orphan
# reclaim is a cold-path sweep; running it more than once per app lifetime adds
# no value and only risks racing in-flight generation.
_DEFAULT_RECLAIM_COOLDOWN_SECONDS = 6 * 60 * 60  # 6 hours

# Relative roots (under STORAGE_ROOT) kept in lockstep with the thumbnail /
# waveform services so enumeration stays consistent.
_THUMBNAILS_REL = "static/video/thumbnails"
_WAVEFORMS_REL = "static/audio/waveforms"


class DerivedGcService:
    """Reclaim orphaned derived files and cascade-delete a material's files."""

    def __init__(
        self,
        storage: Any = None,
        thumbnail_service: Any = None,
        waveform_service: Any = None,
        root: Optional[str] = None,
        cooldown_seconds: int = _DEFAULT_RECLAIM_COOLDOWN_SECONDS,
    ) -> None:
        """Initialize the GC service.

        Args:
            storage: ``StorageService`` for source-file deletion. Defaults to
                the module singleton.
            thumbnail_service: ``ThumbnailService`` (delete/list hooks).
            waveform_service: ``WaveformService`` (delete/list hooks).
            root: STORAGE_ROOT override (tests). Defaults to
                ``settings.storage.root``.
            cooldown_seconds: Minimum spacing between startup reclaim passes.
        """
        self._storage = storage or _default_storage
        self._thumbnails = thumbnail_service or _default_thumbnails
        self._waveforms = waveform_service or _default_waveforms
        root_value = root or getattr(
            getattr(settings, "storage", None), "root", "static/uploads"
        )
        self._root = Path(root_value)
        self._cooldown = max(0, int(cooldown_seconds))
        self._last_reclaim_at: float = 0.0
        self._reclaim_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Delete-联动 cascade
    # ------------------------------------------------------------------

    async def delete_material(
        self,
        material_id: str,
        source_path: Optional[str] = None,
        extra_keys: Optional[Iterable[str]] = None,
    ) -> Dict[str, Any]:
        """Delete a material's source file + cascade its derived files.

        Args:
            material_id: Frontend material identifier (filmstrip + waveform key).
            source_path: STORAGE_ROOT-relative path of the source media to
                delete, when known. ``None`` skips source deletion (the source
                may be a shared cached_material).
            extra_keys: Additional thumbnail dir keys to cascade (e.g. the
                stored-file poster stem, which differs from ``material_id``).

        Returns:
            ``{deleted: {source: bool, thumbnails: int, waveform: bool}}``.
            ``thumbnails`` is the total frame count removed across all keys.
        """
        source_deleted = False
        if source_path:
            try:
                result = await self._storage.delete_file(source_path)
                source_deleted = bool(result.get("success"))
            except (OSError, ValueError) as exc:
                logger.warning("Source deletion failed during cascade", {
                    "material_id": material_id, "source_path": source_path,
                    "error": str(exc),
                })

        keys: List[str] = [material_id]
        for extra in extra_keys or []:
            if extra and extra not in keys:
                keys.append(extra)

        thumbnails_removed = 0
        for key in keys:
            thumbnails_removed += self._delete_thumbnail_dir(key)

        waveform_removed = self._waveforms.delete_by_material(material_id) > 0

        logger.info("Material derived files cascade-deleted", {
            "material_id": material_id,
            "keys": keys,
            "source_deleted": source_deleted,
            "thumbnails_removed": thumbnails_removed,
            "waveform_removed": waveform_removed,
        })
        return {
            "deleted": {
                "source": source_deleted,
                "thumbnails": thumbnails_removed,
                "waveform": waveform_removed,
            }
        }

    def _delete_thumbnail_dir(self, key: str) -> int:
        """Delete one thumbnail dir, returning the frame count removed."""
        result = self._thumbnails.delete_by_material(key)
        return int(result.get("removed", 0)) if result.get("success") else 0

    # ------------------------------------------------------------------
    # Orphan reclaim
    # ------------------------------------------------------------------

    def reclaim(
        self,
        referenced: Optional[Set[str]],
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        """Reclaim derived files whose key is not in *referenced*.

        SAFETY: an empty or abnormal (``None`` / non-set) *referenced* set is
        treated as unsafe — reclaim SKIPS and deletes nothing ("when unsure,
        keep"). This is the threshold that protects users from a bug that would
        otherwise wipe every thumbnail/waveform.

        Args:
            referenced: The set of material keys still in use (live library ∪
                project references). Must be a non-empty set to delete anything.
            dry_run: When True, log the intended deletions but touch nothing.

        Returns:
            ``{dirs, files, bytes, skipped, dry_run}`` — counts of thumbnail
            dirs and waveform files removed (or that *would* be removed under
            dry-run), the byte total, and whether the pass was skipped.
        """
        empty_report = {
            "dirs": 0, "files": 0, "bytes": 0,
            "skipped": True, "dry_run": dry_run,
        }
        if not isinstance(referenced, set) or len(referenced) == 0:
            logger.warning(
                "Orphan reclaim SKIPPED — referenced set is empty/abnormal; "
                "keeping all derived files (safety threshold).",
                {"referenced_type": type(referenced).__name__},
            )
            return empty_report

        orphan_dirs = self._orphan_thumbnail_keys(referenced)
        orphan_files = self._orphan_waveform_keys(referenced)

        reclaimed_bytes = 0
        dirs_removed = 0
        files_removed = 0

        for key in orphan_dirs:
            size = self._dir_size(self._thumbnail_dir(key))
            if dry_run:
                logger.info("Orphan reclaim (dry-run) would delete thumbnail dir", {
                    "key": key, "bytes": size,
                })
                dirs_removed += 1
                reclaimed_bytes += size
                continue
            result = self._thumbnails.delete_by_material(key)
            if result.get("success") and result.get("removed", 0) >= 0:
                dirs_removed += 1
                reclaimed_bytes += size

        for key in orphan_files:
            path = self._waveform_file(key)
            size = self._file_size(path)
            if dry_run:
                logger.info("Orphan reclaim (dry-run) would delete waveform", {
                    "key": key, "bytes": size,
                })
                files_removed += 1
                reclaimed_bytes += size
                continue
            if self._waveforms.delete_by_material(key) > 0:
                files_removed += 1
                reclaimed_bytes += size

        report = {
            "dirs": dirs_removed,
            "files": files_removed,
            "bytes": reclaimed_bytes,
            "skipped": False,
            "dry_run": dry_run,
        }
        logger.info("Orphan reclaim complete", report)
        return report

    def _orphan_thumbnail_keys(self, referenced: Set[str]) -> List[str]:
        """Thumbnail dir keys present on disk but not referenced."""
        try:
            existing = self._thumbnails.list_material_dirs()
        except OSError as exc:
            logger.warning("Listing thumbnail dirs failed", {"error": str(exc)})
            return []
        return [key for key in existing if key not in referenced]

    def _orphan_waveform_keys(self, referenced: Set[str]) -> List[str]:
        """Waveform file keys present on disk but not referenced."""
        wf_dir = self._root / _WAVEFORMS_REL
        if not wf_dir.is_dir():
            return []
        try:
            stems = [p.stem for p in wf_dir.iterdir()
                     if p.is_file() and p.suffix == ".json"]
        except OSError as exc:
            logger.warning("Listing waveform files failed", {"error": str(exc)})
            return []
        return [stem for stem in stems if stem not in referenced]

    # ------------------------------------------------------------------
    # Startup entry — rate-limited, non-blocking
    # ------------------------------------------------------------------

    async def run_startup_reclaim(
        self,
        referenced_provider: Callable[[], Set[str]],
        dry_run: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """Run one orphan-reclaim pass at startup (rate-limited, off-loop).

        The pass runs at most once per ``cooldown_seconds`` per process and
        executes the (synchronous, filesystem-bound) reclaim in a thread
        executor so it never blocks the startup coroutine.

        Args:
            referenced_provider: Zero-arg callable returning the referenced
                key set. Called inside the cooldown guard so an empty / failing
                provider cannot trigger a mass delete (reclaim's own safety
                threshold also guards this).
            dry_run: Forwarded to :meth:`reclaim`.

        Returns:
            The reclaim report, or ``None`` when skipped by the cooldown.
        """
        async with self._reclaim_lock:
            now = time.monotonic()
            if self._last_reclaim_at and (now - self._last_reclaim_at) < self._cooldown:
                logger.info("Startup reclaim skipped (within cooldown)")
                return None
            self._last_reclaim_at = now

        try:
            referenced = referenced_provider()
        except Exception as exc:  # provider is caller-supplied — never crash startup
            logger.warning("Reference provider failed; skipping reclaim", {
                "error": str(exc),
            })
            return None

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self._reclaim_for_report, referenced, dry_run
        )

    def _reclaim_for_report(
        self, referenced: Optional[Set[str]], dry_run: bool
    ) -> Dict[str, Any]:
        """Thread-executor target: run reclaim and return its report."""
        return self.reclaim(referenced, dry_run=dry_run)

    # ------------------------------------------------------------------
    # Filesystem helpers
    # ------------------------------------------------------------------

    def _thumbnail_dir(self, key: str) -> Path:
        return self._root / _THUMBNAILS_REL / key

    def _waveform_file(self, key: str) -> Path:
        return self._root / _WAVEFORMS_REL / f"{key}.json"

    @staticmethod
    def _dir_size(path: Path) -> int:
        """Total byte size of every file under *path* (0 when absent)."""
        if not path.is_dir():
            return 0
        total = 0
        try:
            for p in path.rglob("*"):
                if p.is_file():
                    total += p.stat().st_size
        except OSError:
            return total
        return total

    @staticmethod
    def _file_size(path: Path) -> int:
        """Byte size of *path* (0 when absent)."""
        try:
            return path.stat().st_size if path.is_file() else 0
        except OSError:
            return 0


# Module-level singleton (matches storage/thumbnail/waveform service pattern).
derived_gc_service = DerivedGcService()
