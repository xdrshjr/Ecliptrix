"""本地验证后提交素材缓存，临时文件由当前调用独占。"""
import asyncio
import hashlib
import re
import tempfile
from pathlib import Path

from app.models.web_research_models import WebResearchError
from app.services.system_settings_service import research_settings
from .media_worker import image_async, probe_async, temporary_root
from .safe_http_client import (
    FetchPolicy, RequestSpec, get_safe_http_client, normalize_url)
from .provenance import display_url, source_record


async def download_material(request, run, source=None, client=None):
    if not research_settings()["downloads_enabled"]:
        raise WebResearchError("downloads_disabled", status_code=403)
    client = client or get_safe_http_client()
    kind, url = request.kind, request.url
    declared_page = getattr(request, "source_page_url", None)
    if declared_page:
        declared_page = normalize_url(declared_page)
    maximum = (10 if kind == "image" else 100) * 1024 * 1024
    policy = FetchPolicy(maximum, 30 if kind == "image" else 180,
                         research_settings()["respect_robots"])
    response = await client.fetch(policy, RequestSpec(url))
    if response.status != 200:
        raise WebResearchError("download_failed", status_code=502)
    if kind == "media" and not media_signature(response.body):
        raise WebResearchError("unsupported_media_type")
    with tempfile.TemporaryDirectory(dir=temporary_root()) as directory:
        raw = Path(directory) / "download.part"
        final = Path(directory) / "validated.part"
        try:
            # 最大 100 MiB：同步写入会独占 ASGI 事件循环（spec §3.8 CPU/IO 外移）。
            await asyncio.to_thread(raw.write_bytes, response.body)
        except OSError as error:
            # 目录不可写不得退化为 500 internal_error（D-16）。
            raise WebResearchError(
                "cache_commit_failed",
                message=f"download write failed: {error.errno}") from None
        if kind == "image":
            metadata = await image_async(raw, final)
        else:
            metadata = await probe_async(raw)
            raw.replace(final)
        provenance = (source or source_record(declared_page or url)).copy()
        provenance["source_page_verified"] = bool(
            source and source.get("source_page_verified"))
        provenance["final_url"] = display_url(response.url)
        return await _commit(request, run, final, metadata, provenance)


def file_digest(path):
    """流式 SHA-256：不把整个文件读进内存再哈希。"""
    hasher = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def media_signature(body):
    """播放列表和网页不进入 ffprobe，只接受本地文件容器。"""
    return (body[4:8] == b"ftyp" or body.startswith(b"\x1aE\xdf\xa3")
            or body.startswith(b"ID3")
            or (len(body) >= 2 and body[0] == 255 and body[1] & 224 == 224)
            or (body.startswith(b"RIFF") and body[8:12] == b"WAVE"))


async def _commit(request, run, path, metadata, source):
    from app.services.material_download_service import get_material_download_service
    from .run_registry import run_registry
    run_registry.ensure_active(run)
    digest = await asyncio.to_thread(file_digest, path)
    service = get_material_download_service()
    stored = await service.store_research_download_async(
        path, digest, metadata["format"], source["final_url"])
    run_registry.ensure_active(run)
    identifier = "web-" + digest[:24]
    name = re.sub(r"[\x00-\x1f<>:\"/\\|?*]", "", request.name or "网络素材")[:120]
    provenance = {"source_page_url": source["url"], "final_url": source["final_url"],
                  "title": source["title"], "author": source.get("author"),
                  "license_status": source.get("license_status", "unknown"),
                  "license_url": source.get("license_url"),
                  "retrieved_at": source["retrieved_at"], "sha256": digest,
                  "artifact_id": None}
    provenance["source_page_verified"] = source.get("source_page_verified", False)
    material = {"id": identifier, "name": name or "网络素材", **metadata,
                "size": stored["size"], "local_url": stored["local_url"],
                "url": stored["local_url"], "cacheUrl": stored["local_url"],
                "created_at": stored["created_at"],
                "provenance": provenance,
                "metadata": {"source": "web", "sourceId": source["id"],
                             "provenance": provenance}}
    if metadata["type"] == "image":
        material["thumbnailUrl"] = stored["local_url"]
    return {"status": "ready", "material": material, "reused": stored["reused"]}
