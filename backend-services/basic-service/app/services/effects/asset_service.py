"""Independent input snapshots and durable, immutable output identities."""

import asyncio
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlsplit
from uuid import UUID, uuid4

from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.effects_db_models import EffectAsset, EffectRenderJob
from app.models.effects_models import EffectError
from app.services.local_media_resolver import resolve_media_reference
from app.services.storage_service import storage_service
from .project_locks import project_key, project_lock, require_project

MAX_BYTES = 512 * 1024 * 1024
_active_staging: set[str] = set()


def storage_root() -> Path:
    return Path(storage_service.root).resolve()


def effect_path(*parts: str) -> Path:
    """Reject links in every ancestor before writing or reclaiming effects."""
    root = storage_root() / "effects"
    path = root.joinpath(*parts)
    if path.resolve() != path or not path.is_relative_to(root):
        raise EffectError("EFFECT_INPUT_NOT_LOCAL", "资源目录含软链接", 409)
    return path


def project_directory(project_id: str | UUID) -> Path:
    """Return a bounded path without creating a possibly deleted project."""
    return effect_path("projects", project_key(project_id))


def project_path(project_id: str | UUID, *parts: str) -> Path:
    """Check the complete generated path, including inputs/work/output links."""
    directory = project_directory(project_id)
    path = effect_path("projects", project_key(project_id), *parts)
    if not path.is_relative_to(directory):
        raise EffectError("EFFECT_INPUT_NOT_LOCAL", status=409)
    return path


def asset_path(row: EffectAsset) -> Path:
    path = storage_root() / row.storage_key
    if (path.resolve() != path
            or not path.is_relative_to(project_directory(row.project_id))):
        raise EffectError("EFFECT_INPUT_NOT_LOCAL", status=409)
    return path


def resolve_source(reference: str) -> Path:
    """Only explicit same-origin storage references may become inputs."""
    parsed = urlsplit(reference)
    suffix = unquote(parsed.path.removeprefix("/api/storage/files/"))
    if (parsed.scheme or parsed.netloc or parsed.query or parsed.fragment
            or not parsed.path.startswith("/api/storage/files/")
            or "\\" in suffix or ":" in suffix
            or ".." in Path(suffix).parts):
        raise EffectError("EFFECT_INPUT_NOT_LOCAL", status=409)
    try:
        path = resolve_media_reference(reference, allow_remote=False).path
    except ValueError as exc:
        raise EffectError("EFFECT_INPUT_NOT_LOCAL", status=409) from exc
    if not path.resolve().is_relative_to(storage_root()):
        raise EffectError("EFFECT_INPUT_NOT_LOCAL", status=409)
    return path


def run_media_command(arguments: list[str], timeout: int = 30) -> bytes:
    """Run bundled PATH-resolved media tools off the event loop."""
    try:
        result = subprocess.run(arguments, capture_output=True,
                                timeout=timeout, check=False,
                                creationflags=0x08000000 if os.name == "nt"
                                else 0)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise EffectError("EFFECT_MEDIA_DECODE_FAILED", "媒体探测失败", 422) \
            from exc
    if result.returncode:
        raise EffectError("EFFECT_MEDIA_DECODE_FAILED", "媒体无法解码", 422)
    return result.stdout


def probe_video(path: Path, *, count_frames: bool = False) -> dict:
    arguments = ["ffprobe", "-v", "error", "-show_streams", "-show_format",
                 "-of", "json"]
    if count_frames:
        arguments.append("-count_frames")
    try:
        probe = json.loads(run_media_command(arguments + [str(path)]))
        stream = next(item for item in probe["streams"]
                      if item["codec_type"] == "video")
        width, height = int(stream["width"]), int(stream["height"])
        rotation = float(stream.get("tags", {}).get("rotate", 0))
        for side in stream.get("side_data_list", []):
            rotation = float(side.get("rotation", rotation))
        if round(rotation) % 180:
            width, height = height, width
        rate = stream["avg_frame_rate"].split("/")
        fps = int(rate[0]) / max(1, int(rate[1]))
        return {"width": width, "height": height,
                "duration_seconds": float(stream.get("duration")
                                          or probe["format"]["duration"]),
                "fps": fps, "codec": stream["codec_name"],
                "pixel_format": stream.get("pix_fmt"),
                "frames": int(stream.get("nb_read_frames")
                              or stream.get("nb_frames") or 0),
                "has_audio": any(item["codec_type"] == "audio"
                                 for item in probe["streams"])}
    except (ValueError, KeyError, StopIteration, ZeroDivisionError) as exc:
        raise EffectError("EFFECT_SOURCE_RANGE_INVALID", status=422) from exc


def probe_media(path: Path) -> dict:
    """Identify real bytes rather than trusting file suffix or MIME hints."""
    try:
        with Image.open(path) as image:
            width, height = image.size
            if width * height > 40_000_000 or max(width, height) > 16384:
                raise EffectError("EFFECT_INPUT_TOO_LARGE", status=413)
            image.load()
            mime = Image.MIME.get(image.format, "image/png")
            extension = {"image/jpeg": ".jpg", "image/webp": ".webp",
                         "image/png": ".png"}.get(mime)
            if extension is None:
                raise EffectError("EFFECT_SOURCE_RANGE_INVALID", status=422)
            return {"kind": "input-image", "width": width, "height": height,
                    "mime": mime, "extension": extension,
                    "duration_seconds": None}
    except Image.DecompressionBombError as exc:
        raise EffectError("EFFECT_INPUT_TOO_LARGE", status=413) from exc
    except (UnidentifiedImageError, OSError):
        probe = probe_video(path)
        if min(probe["width"], probe["height"]) < 64:
            raise EffectError("EFFECT_SOURCE_RANGE_INVALID", status=422)
        return {**probe, "kind": "input-video", "mime": "video/mp4",
                "extension": ".mp4"}


def _copy_staging(source: Path, staging: Path) -> dict:
    if source.stat().st_size > MAX_BYTES:
        raise EffectError("EFFECT_INPUT_TOO_LARGE", status=413)
    staging.parent.mkdir(parents=True, exist_ok=True)
    checksum = hashlib.sha256()
    count = 0
    with source.open("rb") as original, staging.open("xb") as output:
        while chunk := original.read(1024 * 1024):
            count += len(chunk)
            if count > MAX_BYTES:
                raise EffectError("EFFECT_INPUT_TOO_LARGE", status=413)
            checksum.update(chunk)
            output.write(chunk)
    if count == 0:
        raise EffectError("EFFECT_SOURCE_RANGE_INVALID", status=422)
    return {**probe_media(staging), "bytes": count,
            "sha256": checksum.hexdigest()}


async def attach_input(db: AsyncSession, project_id: str, payload) -> tuple:
    """Stage without a project lease, then recheck before rename and commit."""
    await require_project(db, project_id)
    source = await asyncio.to_thread(resolve_source, payload.source_ref)
    upload_id = str(uuid4())
    staging = effect_path(".staging", upload_id, "input")
    _active_staging.add(upload_id)
    try:
        metadata = await asyncio.to_thread(_copy_staging, source, staging)
        async with project_lock(project_id):
            await require_project(db, project_id)
            row, replay = await _commit_input(
                db, project_id, (payload, staging, metadata))
            return await asset_data(db, row), replay
    finally:
        _active_staging.discard(upload_id)
        await asyncio.to_thread(shutil.rmtree, staging.parent, True)


async def _commit_input(db: AsyncSession, project_id: str,
                        prepared: tuple) -> tuple:
    payload, staging, metadata = prepared
    row = (await db.execute(select(EffectAsset).where(
        EffectAsset.project_id == UUID(project_id),
        EffectAsset.kind == metadata["kind"],
        EffectAsset.sha256 == metadata["sha256"],
    ))).scalar_one_or_none()
    if row:
        if not await asyncio.to_thread(asset_path(row).is_file):
            raise EffectError("EFFECT_INPUT_NOT_LOCAL", status=409)
        return row, True
    identifier = uuid4()
    destination = project_path(project_id, "inputs",
                               str(identifier) + metadata["extension"])
    await asyncio.to_thread(destination.parent.mkdir,
                            parents=True, exist_ok=True)
    await asyncio.to_thread(os.replace, staging, destination)
    row = EffectAsset(id=identifier, project_id=UUID(project_id),
                      origin_material_id=payload.origin_material_id,
                      storage_key=destination.relative_to(storage_root())
                      .as_posix(), **{key: metadata[key] for key in (
                          "kind", "sha256", "bytes", "mime", "width",
                          "height", "duration_seconds")})
    db.add(row)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        await asyncio.to_thread(destination.unlink, missing_ok=True)
        raise
    await db.refresh(row)
    return row, False


async def get_asset(db: AsyncSession, project_id: str,
                    asset_id: str) -> EffectAsset:
    await require_project(db, project_id, writable=False)
    row = await db.get(EffectAsset, UUID(str(asset_id)),
                       populate_existing=True)
    if row is None or str(row.project_id) != project_id:
        raise EffectError("EFFECT_NOT_FOUND", status=404)
    if not await asyncio.to_thread(asset_path(row).is_file):
        code = "EFFECT_OUTPUT_MISSING" if row.kind == "output-video" \
            else "EFFECT_NOT_FOUND"
        raise EffectError(code, status=410 if row.kind == "output-video"
                          else 404)
    return row


def output_summary(job: EffectRenderJob) -> tuple[dict, dict]:
    snapshot = job.request_json["render_snapshot"]
    document = snapshot["document"]
    provenance = {"job_id": str(job.id), "draft_id": str(job.draft_id),
                  "draft_version": job.draft_version,
                  "document_hash": snapshot["document_hash"],
                  "input_hash": job.input_hash,
                  "duration_frames": document["duration_frames"], "fps": 30,
                  "canvas": {key: document["canvas"][key]
                             for key in ("width", "height")}}
    base = next((binding for binding in document["inputs"]
                 if binding["slot"] == "base" and binding["kind"] == "video"),
                None)
    if base:
        source = next(item for item in snapshot["inputs"]
                      if item["asset_id"] == base["asset_id"])
        provenance["base_video"] = {
            "asset_id": source["asset_id"], "source_sha256": source["sha256"],
            "trim_start_frame": int(base["trim_start_seconds"] * 30 + 0.5),
            "source_frame_count": document["duration_frames"],
            "display_width": source["width"],
            "display_height": source["height"]}
    effects = {"schema_version": 1, "project_id": str(job.project_id),
               "draft_id": str(job.draft_id),
               "draft_version": job.draft_version, "job_id": str(job.id),
               "asset_id": str(job.result_asset_id),
               "template_id": document["template_id"],
               "template_version": document["template_version"],
               "document_hash": snapshot["document_hash"]}
    return provenance, effects


async def asset_data(db: AsyncSession, row: EffectAsset) -> dict:
    result = {"asset_id": str(row.id), "project_id": str(row.project_id),
              "kind": row.kind, "sha256": row.sha256,
              "url": "/api/storage/files/" + row.storage_key,
              "storage_key": row.storage_key,
              "thumbnail_url": "/api/storage/files/" + row.thumbnail_key
              if row.thumbnail_key else None,
              "bytes": row.bytes, "mime": row.mime,
              "width": row.width, "height": row.height,
              "duration_seconds": row.duration_seconds,
              "created_at": row.created_at.isoformat()}
    if row.kind == "output-video":
        job = (await db.execute(select(EffectRenderJob).where(
            EffectRenderJob.result_asset_id == row.id,
            EffectRenderJob.status == "succeeded"))).scalar_one_or_none()
        if job is None:
            raise EffectError("EFFECT_OUTPUT_MISSING", status=410)
        result["provenance"], result["effects"] = output_summary(job)
    return result


def material_data(asset: dict) -> dict:
    """Construct all file identities anew; never inherit source caches."""
    return {"id": "effect-material:" + asset["asset_id"],
            "name": "Remotion", "type": "video", "format": "mp4",
            "size": asset["bytes"], "width": asset["width"],
            "height": asset["height"],
            "duration": asset["duration_seconds"],
            "url": asset["url"], "serverUrl": asset["url"],
            "cacheUrl": asset["url"], "storageKey": asset["storage_key"],
            "thumbnailUrl": asset["thumbnail_url"],
            "createdAt": asset["created_at"],
            "metadata": {"source": "remotion", "storageKind": "local",
                         "storageKey": asset["storage_key"],
                         "localResolvedUrl": asset["url"],
                         "effects": _camel_effects(asset["effects"])}}


def _camel_effects(effects: dict) -> dict:
    names = {"schema_version": "schemaVersion", "project_id": "projectId",
             "draft_id": "draftId", "draft_version": "draftVersion",
             "job_id": "jobId", "asset_id": "assetId",
             "template_id": "templateId", "template_version": "templateVersion",
             "document_hash": "documentHash"}
    return {names[key]: value for key, value in effects.items()}


async def cleanup_project_files(project_id: str) -> None:
    await asyncio.to_thread(shutil.rmtree, project_directory(project_id), True)
