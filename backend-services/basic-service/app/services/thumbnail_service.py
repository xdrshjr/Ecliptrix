"""Local thumbnail (poster + filmstrip) service.

Implements TODO 03 of the local-video-editing-refactor. Owns the canonical
path scheme for per-material thumbnails and the persistence of filmstrip
frames produced by the frontend canvas extractor.

Landing scheme (served via the existing ``/api/storage/files`` mount)::

    STORAGE_ROOT/static/video/thumbnails/{material_id}/
        poster.jpg                       # single mid-point frame (backend)
        strip_{zoom_tier}_{t_ms}.jpg ... # filmstrip frames (frontend canvas)

The poster is generated at upload time by ``StorageService`` (mid-point
ffmpeg frame). Filmstrip frames are extracted on demand by the frontend and
``POST``-ed to ``/api/storage/thumbnail-frame``, which delegates here.

Spec 06 (persistence + cache GC) consumes :meth:`delete_by_material` (delete
联动) and :meth:`list_material_dirs` (orphan reclaim). Both are intentionally
synchronous, side-effect-local filesystem helpers so the GC pass can call
them without touching the request event loop.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import settings
from app.logger import get_logger
from app.services.storage_service import storage_service as _default_storage

logger = get_logger(__name__)

# Relative root (inside STORAGE_ROOT) for all per-material thumbnail dirs.
THUMBNAILS_ROOT_REL = "static/video/thumbnails"

# A filmstrip frame filename: strip_{zoom_tier}_{t_ms}.jpg
_FRAME_RE = re.compile(r"^strip_(?P<tier>[A-Za-z0-9]+)_(?P<tms>\d+)\.jpg$")

# Material ids and zoom tiers are caller-supplied; restrict them to a safe
# alphabet so they cannot inject path separators or traversal sequences. Any
# disallowed character is collapsed to ``_`` before it reaches the filesystem.
_SAFE_SEGMENT_RE = re.compile(r"[^A-Za-z0-9_-]")


class ThumbnailService:
    """Persist and manage local poster + filmstrip thumbnails.

    Args:
        storage: ``StorageService`` used for path validation and atomic
            writes inside ``STORAGE_ROOT``. Defaults to the module singleton.
        config: ``ThumbnailConfig`` (``settings.upload.thumbnail`` by
            default) supplying filmstrip slot width, quality and the
            per-material capacity cap.
    """

    def __init__(self, storage: Any = None, config: Any = None) -> None:
        """Initialize the service and ensure the thumbnails root exists."""
        self._storage = storage or _default_storage
        self.config = config or settings.upload.thumbnail
        self._root = Path(self._storage.root)
        self._thumbs_root = self._root / "static" / "video" / "thumbnails"

    # ------------------------------------------------------------------
    # Path scheme
    # ------------------------------------------------------------------

    def _safe_segment(self, value: str) -> str:
        """Reduce a caller-supplied id/tier to a path-safe segment.

        Replaces any character outside ``[A-Za-z0-9_-]`` with ``_`` so the
        value can never introduce a directory separator or ``..`` ladder.
        """
        cleaned = _SAFE_SEGMENT_RE.sub("_", str(value or ""))
        return cleaned or "unknown"

    def poster_relative_path(self, material_id: str) -> str:
        """Return the storage-relative path of a material's poster."""
        return f"{THUMBNAILS_ROOT_REL}/{self._safe_segment(material_id)}/poster.jpg"

    def frame_relative_path(self, material_id: str, zoom_tier: str, t_ms: int) -> str:
        """Return the storage-relative path of one filmstrip frame.

        Args:
            material_id: Material identifier (sanitised to a path segment).
            zoom_tier: Quantized zoom tier label, e.g. ``"1x"``.
            t_ms: Source frame time in whole milliseconds.
        """
        mat = self._safe_segment(material_id)
        tier = self._safe_segment(zoom_tier)
        return f"{THUMBNAILS_ROOT_REL}/{mat}/strip_{tier}_{int(t_ms)}.jpg"

    def poster_url(self, material_id: str) -> str:
        """Return the same-origin URL serving a material's poster."""
        return f"/api/storage/files/{self.poster_relative_path(material_id)}"

    def frame_url(self, material_id: str, zoom_tier: str, t_ms: int) -> str:
        """Return the same-origin URL serving one filmstrip frame."""
        return f"/api/storage/files/{self.frame_relative_path(material_id, zoom_tier, t_ms)}"

    # ------------------------------------------------------------------
    # Filmstrip frame persistence
    # ------------------------------------------------------------------

    async def save_frame(
        self,
        material_id: str,
        zoom_tier: str,
        t_ms: int,
        data: bytes,
        content_type: str = "image/jpeg",
    ) -> Dict[str, Any]:
        """Persist one filmstrip frame and return its same-origin URL.

        Writes the JPEG bytes to the canonical filmstrip path via the storage
        service (which re-validates the resolved path stays inside
        ``STORAGE_ROOT``). After a successful write the per-material capacity
        is enforced, evicting the least-recently-written zoom tier if needed.

        Args:
            material_id: Material the frame belongs to.
            zoom_tier: Quantized zoom tier label.
            t_ms: Source frame time in whole milliseconds.
            data: JPEG-encoded frame bytes.
            content_type: MIME type recorded in the write envelope.

        Returns:
            ``{success, url, relative_path}`` on success;
            ``{success: False, message}`` on failure.
        """
        if not data:
            return {"success": False, "message": "Frame payload is empty"}

        rel = self.frame_relative_path(material_id, zoom_tier, t_ms)
        write = await self._storage.write_to_well_known_slot(
            rel_path=rel, content=data, content_type=content_type,
        )
        if not write.get("success"):
            logger.warning("Filmstrip frame write failed", {
                "material_id": material_id, "rel": rel,
                "error": write.get("message"),
            })
            return {"success": False, "message": write.get("message", "write failed")}

        self._enforce_capacity(material_id)

        logger.info("Filmstrip frame persisted", {
            "material_id": material_id, "zoom_tier": zoom_tier, "t_ms": t_ms,
        })
        return {
            "success": True,
            "url": f"/api/storage/files/{write['file_path']}",
            "relative_path": write["file_path"],
        }

    def _material_dir(self, material_id: str) -> Path:
        """Return the on-disk directory for a material's thumbnails."""
        return self._thumbs_root / self._safe_segment(material_id)

    def _enforce_capacity(self, material_id: str) -> None:
        """Evict oldest zoom tiers once the per-material cap is exceeded.

        Frames are grouped by zoom tier and ordered by the freshest mtime in
        each tier. Whole tiers are removed (oldest first) until the total
        frame count fits within ``filmstrip_max_frames_per_material``. The
        poster is never counted nor evicted.
        """
        cap = int(getattr(self.config, "filmstrip_max_frames_per_material", 240))
        if cap <= 0:
            return
        mat_dir = self._material_dir(material_id)
        if not mat_dir.is_dir():
            return

        frames = [p for p in mat_dir.iterdir() if _FRAME_RE.match(p.name)]
        if len(frames) <= cap:
            return

        # Group frames by tier; track each tier's freshest mtime so we can
        # evict the least-recently-touched tier first (LRU at tier
        # granularity — keeps a coherent strip rather than holey gaps).
        tiers: Dict[str, List[Path]] = {}
        tier_mtime: Dict[str, float] = {}
        for p in frames:
            m = _FRAME_RE.match(p.name)
            tier = m.group("tier") if m else "unknown"
            tiers.setdefault(tier, []).append(p)
            tier_mtime[tier] = max(tier_mtime.get(tier, 0.0), p.stat().st_mtime)

        ordered_tiers = sorted(tier_mtime, key=lambda tr: tier_mtime[tr])
        remaining = len(frames)
        for tier in ordered_tiers:
            if remaining <= cap:
                break
            for p in tiers[tier]:
                try:
                    p.unlink()
                    remaining -= 1
                except OSError as exc:  # pragma: no cover - best-effort evict
                    logger.warning("Filmstrip eviction failed", {
                        "file": str(p), "error": str(exc),
                    })

    # ------------------------------------------------------------------
    # Enumeration
    # ------------------------------------------------------------------

    def list_material(self, material_id: str) -> Dict[str, Any]:
        """List the poster and all persisted filmstrip frames for a material.

        Returns:
            ``{poster: url|None, frames: [{zoom_tier, t_ms, url}, ...]}``.
            Frames are sorted by ``(zoom_tier, t_ms)`` for stable output.
        """
        mat_dir = self._material_dir(material_id)
        poster: Optional[str] = None
        frames: List[Dict[str, Any]] = []
        if not mat_dir.is_dir():
            return {"poster": None, "frames": []}

        if (mat_dir / "poster.jpg").is_file():
            poster = self.poster_url(material_id)

        for entry in mat_dir.iterdir():
            m = _FRAME_RE.match(entry.name)
            if not m:
                continue
            tier = m.group("tier")
            t_ms = int(m.group("tms"))
            frames.append({
                "zoom_tier": tier,
                "t_ms": t_ms,
                "url": self.frame_url(material_id, tier, t_ms),
            })

        frames.sort(key=lambda f: (f["zoom_tier"], f["t_ms"]))
        return {"poster": poster, "frames": frames}

    def list_material_dirs(self) -> List[str]:
        """Return every material id that owns a thumbnail directory.

        Spec 06 diffs this against the set of live material ids to reclaim
        orphaned thumbnail directories at startup.
        """
        if not self._thumbs_root.is_dir():
            return []
        return sorted(
            entry.name for entry in self._thumbs_root.iterdir() if entry.is_dir()
        )

    # ------------------------------------------------------------------
    # Deletion (spec 06 delete-联动 hook)
    # ------------------------------------------------------------------

    def delete_by_material(self, material_id: str) -> Dict[str, Any]:
        """Delete the entire thumbnail directory for a material.

        Used by spec 06 when a material is deleted (联动清理) and by orphan
        reclaim. Counts the files removed for the GC report. Missing
        directories are a no-op (``removed == 0``).

        Returns:
            ``{success, removed, material_id}``.
        """
        mat_dir = self._material_dir(material_id)
        if not mat_dir.is_dir():
            return {"success": True, "removed": 0, "material_id": material_id}

        removed = sum(1 for p in mat_dir.rglob("*") if p.is_file())
        try:
            shutil.rmtree(mat_dir)
        except OSError as exc:
            logger.error("Thumbnail dir deletion failed", {
                "material_id": material_id, "error": str(exc),
            })
            return {"success": False, "removed": 0, "message": str(exc)}

        logger.info("Thumbnail dir deleted", {
            "material_id": material_id, "removed": removed,
        })
        return {"success": True, "removed": removed, "material_id": material_id}


# Module-level singleton (matches storage_service pattern).
thumbnail_service = ThumbnailService()
