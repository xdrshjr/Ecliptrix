"""
Alibaba Cloud OSS client — thin wrapper around oss2.

Provides both synchronous and asynchronous upload helpers:
- upload_file_sync()  — use in synchronous/threaded contexts (e.g. video composition)
- upload_file()       — async wrapper using asyncio.to_thread()

When OSS_ENABLED=false the module-level get_oss_client() returns None so all
callers can safely guard with ``if oss_client:``.
"""

import asyncio
import mimetypes
from app.config import get_settings
from app.logger import get_logger

logger = get_logger(__name__)


class OSSClient:
    """Alibaba Cloud OSS thin wrapper."""

    def __init__(self) -> None:
        import oss2  # deferred import so the module loads even without oss2 installed

        cfg = get_settings().oss
        auth = oss2.Auth(cfg.access_key_id, cfg.access_key_secret)
        self.bucket = oss2.Bucket(auth, f"https://{cfg.endpoint}", cfg.bucket_name)
        self.cfg = cfg
        logger.info("OSSClient initialised", {
            "endpoint": cfg.endpoint,
            "bucket": cfg.bucket_name,
            "cdn_domain": cfg.cdn_domain or "(none)",
            "key_prefix": cfg.key_prefix or "(none)",
        })

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def get_public_url(self, oss_key: str) -> str:
        """Return the public URL for an OSS key (CDN domain preferred)."""
        cfg = self.cfg
        if cfg.cdn_domain:
            return f"{cfg.cdn_domain.rstrip('/')}/{oss_key}"
        return f"https://{cfg.bucket_name}.{cfg.endpoint}/{oss_key}"

    def _make_key(self, relative_path: str) -> str:
        """Prepend the optional key prefix to relative_path."""
        prefix = self.cfg.key_prefix.strip("/")
        path = relative_path.lstrip("/")
        return f"{prefix}/{path}" if prefix else path

    # ------------------------------------------------------------------
    # Synchronous API  (use in threads / blocking contexts)
    # ------------------------------------------------------------------

    def upload_file_sync(
        self,
        local_path: str,
        relative_path: str,
        content_type: str = "",
    ) -> str:
        """Upload a local file to OSS and return its public URL (blocking)."""
        oss_key = self._make_key(relative_path)
        if not content_type:
            content_type, _ = mimetypes.guess_type(local_path)
            content_type = content_type or "application/octet-stream"
        headers = {"Content-Type": content_type}
        self.bucket.put_object_from_file(oss_key, local_path, headers=headers)
        url = self.get_public_url(oss_key)
        logger.info("OSS upload succeeded (sync)", {"key": oss_key, "url": url})
        return url

    def delete_object_sync(self, relative_path: str) -> bool:
        """Delete an OSS object (blocking)."""
        oss_key = self._make_key(relative_path)
        self.bucket.delete_object(oss_key)
        return True

    # ------------------------------------------------------------------
    # Async API  (use in async FastAPI handlers)
    # ------------------------------------------------------------------

    async def upload_file(
        self,
        local_path: str,
        relative_path: str,
        content_type: str = "",
    ) -> str:
        """Upload a local file to OSS and return its public URL (async)."""
        return await asyncio.to_thread(
            self.upload_file_sync, local_path, relative_path, content_type
        )

    async def delete_object(self, relative_path: str) -> bool:
        """Delete an OSS object (async)."""
        return await asyncio.to_thread(self.delete_object_sync, relative_path)


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_oss_client: "OSSClient | None" = None


def get_oss_client() -> "OSSClient | None":
    """Return the OSSClient singleton, or None when OSS is disabled."""
    settings = get_settings()
    if not settings.oss.enabled:
        return None
    global _oss_client
    if _oss_client is None:
        _oss_client = OSSClient()
    return _oss_client
