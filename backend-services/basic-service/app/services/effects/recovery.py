"""Immutable work snapshots, verified publication and crash recovery."""

import asyncio
import copy
import hashlib
import json
import os
import shutil
import struct
import time
from pathlib import Path
from uuid import NAMESPACE_URL, UUID, uuid5

from PIL import ImageFont
from sqlalchemy import select

from app.models.effects_db_models import EffectAsset, EffectRenderJob
from app.models.effects_models import EffectError
from . import asset_service as assets
from .catalog import ACTIVE, document_hash
from .project_locks import project_lock, require_project


def file_hash(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            checksum.update(chunk)
    return checksum.hexdigest()


def validate_text_layout(document: dict, resource_root: Path) -> None:
    """Check the minimum accepted font size before admitting a render."""
    files = {"sans": "NotoSansSC[wght].ttf",
             "serif": "NotoSerifSC[wght].ttf",
             "mono": "NotoSansMono[wdth,wght].ttf"}
    width, height = (document["canvas"][key] for key in ("width", "height"))
    for key, ratio in (("title", 0.07), ("subtitle", 0.035)):
        text = document["content"][key]
        if not text:
            continue
        size = (min(width, height) * ratio
                * document["typography"]["scale"] * 0.6)
        try:
            font = ImageFont.truetype(str(resource_root / "fonts" /
                 files[document["typography"]["family"]]), max(1, int(size)))
        except OSError as exc:
            raise EffectError("EFFECT_RUNTIME_UNAVAILABLE", status=503) from exc
        text_width = width * 0.88
        if document["template_id"].startswith("product-") and width >= height:
            text_width = width * 0.4
        elif document["template_id"].startswith("callout-"):
            text_width = width * 0.38
        elif document["template_id"].startswith("lower-"):
            text_width = width * 0.7
        lines, length = 1, 0.0
        for letter in text:
            measure = font.getlength(letter)
            if letter == "\n" or length + measure > text_width:
                lines += 1
                length = 0 if letter == "\n" else measure
            else:
                length += measure
        if lines * size * 1.3 > height * 0.35:
            raise EffectError("EFFECT_TEXT_OVERFLOW", "文字超出安全区", 422,
                              {"fields": [{"path": f"content.{key}"}]})


def validate_snapshot_inputs(document: dict, rows: list) -> list[dict]:
    """Reprobe stored bytes before granting admission."""
    result = []
    for row in rows:
        path = assets.asset_path(row)
        if not path.is_file() or file_hash(path) != row.sha256:
            raise EffectError("EFFECT_INPUT_NOT_LOCAL", status=409)
        probe = assets.probe_media(path)
        for binding in document["inputs"]:
            if (binding["asset_id"] == str(row.id)
                    and binding["kind"] == "video"):
                end = (binding["trim_start_seconds"]
                       + document["duration_frames"] / 30)
                if end > probe["duration_seconds"] + 1 / 30 + 1e-6:
                    raise EffectError("EFFECT_SOURCE_RANGE_INVALID", status=422)
        result.append({"asset_id": str(row.id), "sha256": row.sha256,
                       "storage_key": row.storage_key, "bytes": row.bytes,
                       "mime": row.mime, "kind": row.kind,
                       "width": row.width, "height": row.height,
                       "duration_seconds": row.duration_seconds,
                       "has_audio": probe.get("has_audio", False)})
    return result


def prepare_work(job: EffectRenderJob, deadline: float) -> list[dict]:
    """Copy checked inputs into a job-owned tree, never symlink source files."""
    if time.monotonic() > deadline:
        raise EffectError("EFFECT_RENDER_TIMEOUT")
    assets.project_path(job.project_id, ".work", str(job.id), "inputs") \
        .mkdir(parents=True, exist_ok=True)
    inputs = []
    for item in job.request_json["render_snapshot"]["inputs"]:
        source = assets.storage_root() / item["storage_key"]
        if (source.resolve() != source or not source.is_relative_to(
                assets.project_directory(job.project_id))):
            raise EffectError("EFFECT_INPUT_NOT_LOCAL", status=409)
        name = item["asset_id"] + source.suffix
        destination = assets.project_path(job.project_id, ".work", str(job.id),
                                           "inputs", name)
        _copy_work_input(source, destination, item, deadline)
        inputs.append({"assetId": item["asset_id"], "fileName": name,
                       "sha256": item["sha256"], "bytes": item["bytes"]})
    return inputs


def _copy_work_input(source: Path, destination: Path,
                      manifest: dict, deadline: float) -> None:
    checksum = hashlib.sha256()
    count = 0
    with source.open("rb") as original, destination.open("wb") as output:
        while chunk := original.read(1024 * 1024):
            if time.monotonic() > deadline:
                raise EffectError("EFFECT_RENDER_TIMEOUT")
            count += len(chunk)
            if count > manifest["bytes"]:
                raise EffectError("EFFECT_INPUT_NOT_LOCAL", status=409)
            checksum.update(chunk)
            output.write(chunk)
    if count != manifest["bytes"] or checksum.hexdigest() != manifest["sha256"]:
        raise EffectError("EFFECT_INPUT_NOT_LOCAL", status=409)


def _has_faststart(path: Path) -> bool:
    with path.open("rb") as source:
        while header := source.read(8):
            if len(header) != 8:
                return False
            size, name = struct.unpack(">I4s", header)
            if name == b"moov":
                return True
            if name == b"mdat" or (size < 8 and size != 1):
                return False
            if size == 1:
                size = struct.unpack(">Q", source.read(8))[0] - 8
            source.seek(size - 8, 1)
    return False


def validate_output(job: EffectRenderJob, result: dict) -> dict:
    """A worker success is provisional until the actual MP4 is checked."""
    video = assets.project_path(job.project_id, ".work", str(job.id),
                                "video.part.mp4")
    if result.get("outputFile") != video.name or not video.is_file():
        raise EffectError("EFFECT_MEDIA_DECODE_FAILED")
    if video.stat().st_size <= 0 or file_hash(video) != result.get("sha256"):
        raise EffectError("EFFECT_MEDIA_DECODE_FAILED")
    probe = assets.probe_video(video, count_frames=True)
    document = job.request_json["render_snapshot"]["document"]
    expected_audio = any(item["has_audio"] for item in
                         job.request_json["render_snapshot"]["inputs"]
                         if item["kind"] == "input-video")
    if (probe["codec"] != "h264" or probe["pixel_format"] != "yuv420p"
            or abs(probe["fps"] - 30) > 0.001
            or abs(probe["frames"] - document["duration_frames"]) > 1
            or probe["width"] != document["canvas"]["width"]
            or probe["height"] != document["canvas"]["height"]
            or probe["duration_seconds"] + 1e-6
            < document["duration_frames"] / 30
            or probe["has_audio"] != expected_audio
            or not _has_faststart(video)):
        raise EffectError("EFFECT_MEDIA_DECODE_FAILED", "输出校验不通过")
    thumbnail = assets.project_path(job.project_id, ".work", str(job.id),
                                    "thumbnail.jpg.part")
    assets.run_media_command(["ffmpeg", "-y", "-v", "error", "-ss",
        str(min(1, document["duration_frames"] / 60)), "-i", str(video),
        "-frames:v", "1", "-c:v", "mjpeg", "-f", "image2", str(thumbnail)])
    return {"probe": probe, "video_hash": file_hash(video),
            "thumbnail_hash": file_hash(thumbnail),
            "bytes": video.stat().st_size}


def _publish_files(job: EffectRenderJob, validated: dict) -> dict:
    output = assets.project_path(job.project_id, "outputs", str(job.id))
    output.mkdir(parents=True, exist_ok=True)
    for source, target in (("video.part.mp4", "video.mp4"),
                           ("thumbnail.jpg.part", "thumbnail.jpg")):
        os.replace(assets.project_path(job.project_id, ".work", str(job.id),
                                      source),
                   assets.project_path(job.project_id, "outputs", str(job.id),
                                       target))
    manifest = {"job_id": str(job.id), "request_hash": job.input_hash,
                "runtime_fingerprint": job.runtime_fingerprint,
                **validated, "provenance": assets.output_summary(job)[0]}
    partial = assets.project_path(job.project_id, "outputs", str(job.id),
                                  "complete.json.part")
    partial.write_text(json.dumps(manifest, ensure_ascii=False,
                                 allow_nan=False), encoding="utf-8")
    os.replace(partial, assets.project_path(job.project_id, "outputs",
                                            str(job.id), "complete.json"))
    return manifest


async def commit_success(db, job: EffectRenderJob, manifest: dict) -> None:
    """Attach the published identity and terminal job in one DB transaction."""
    identifier = uuid5(NAMESPACE_URL, f"effect:{job.project_id}:{job.id}")
    root_key = f"effects/projects/{job.project_id}/outputs/{job.id}"
    row = await db.get(EffectAsset, identifier)
    if row is None:
        probe = manifest["probe"]
        db.add(EffectAsset(id=identifier, project_id=job.project_id,
            kind="output-video", sha256=manifest["video_hash"],
            storage_key=root_key + "/video.mp4",
            thumbnail_key=root_key + "/thumbnail.jpg",
            bytes=manifest["bytes"], mime="video/mp4",
            width=probe["width"], height=probe["height"],
            duration_seconds=probe["duration_seconds"]))
    job.result_asset_id = identifier
    job.status, job.phase, job.progress = "succeeded", "done", 1
    from datetime import datetime, timezone
    job.finished_at = datetime.now(timezone.utc)
    job.error_code = None
    await db.commit()


async def publish_output(service, job_id: str, validated: dict) -> bool:
    async with service.session_factory() as db:
        job = await db.get(EffectRenderJob, UUID(job_id))
        async with project_lock(job.project_id):
            await require_project(db, job.project_id)
            await db.refresh(job)
            if job.cancel_requested or job.status != "running":
                return False
            manifest = await asyncio.to_thread(_publish_files, job, validated)
            await commit_success(db, job, manifest)
            return True


def read_complete(job: EffectRenderJob) -> dict | None:
    try:
        output = assets.project_path(job.project_id, "outputs", str(job.id))
        path = assets.project_path(job.project_id, "outputs", str(job.id),
                                   "complete.json")
        if not path.is_file():
            return None
        manifest = json.loads(path.read_text(encoding="utf-8"))
        if (manifest["job_id"] != str(job.id)
                or manifest["request_hash"] != job.input_hash
                or manifest["runtime_fingerprint"] != job.runtime_fingerprint
                or manifest["provenance"] != assets.output_summary(job)[0]
                or file_hash(output / "video.mp4") != manifest["video_hash"]
                or file_hash(output / "thumbnail.jpg")
                != manifest["thumbnail_hash"]):
            return None
        probe = assets.probe_video(output / "video.mp4", count_frames=True)
        if probe != manifest["probe"]:
            return None
        return manifest
    except (OSError, ValueError, KeyError, EffectError):
        return None


async def recover_jobs(service, *, startup: bool) -> None:
    """Run only after reset has confirmed old renderer children are gone."""
    async with service.session_factory() as db:
        rows = list((await db.execute(select(EffectRenderJob).where(
            EffectRenderJob.status.in_(ACTIVE)))).scalars())
    for previous in rows:
        if not startup and previous.status == "queued":
            continue
        await _recover_job(service, previous.id)


async def _recover_job(service, identifier: UUID) -> None:
    async with service.session_factory() as db:
        job = await db.get(EffectRenderJob, identifier)
        async with project_lock(job.project_id):
            try:
                await require_project(db, job.project_id)
            except EffectError as exc:
                if exc.code == "EFFECT_PROJECT_CLOSING":
                    return
                await db.delete(job)
                await db.commit()
                return
            manifest = await asyncio.to_thread(read_complete, job)
            if manifest and not job.cancel_requested:
                await commit_success(db, job, manifest)
            else:
                job.status = ("cancelled" if job.cancel_requested
                              else "interrupted")
                job.phase = job.status
                job.error_code = None if job.cancel_requested \
                    else "EFFECT_RENDER_INTERRUPTED"
                await db.commit()
        await cleanup_work(job)


async def cleanup_work(job: EffectRenderJob) -> None:
    try:
        path = assets.project_path(job.project_id, ".work", str(job.id))
    except EffectError:
        return  # An unsafe directory is never a cleanup target.
    await asyncio.to_thread(shutil.rmtree, path, True)


async def cleanup_stale(service) -> None:
    """Retain formal assets; reclaim only old staging and inactive work."""
    async with service.session_factory() as db:
        live = set(str(value) for value in (await db.execute(select(
            EffectRenderJob.id).where(EffectRenderJob.status.in_(ACTIVE))))
                   .scalars())
        outputs = set(str(value) for value in (await db.execute(select(
            EffectRenderJob.id).where(EffectRenderJob.status == "succeeded")))
                      .scalars())
    await asyncio.to_thread(_cleanup_stale_files, live, outputs)


def _cleanup_stale_files(live: set[str], outputs: set[str]) -> None:
    try:
        root = assets.effect_path()
    except EffectError:
        return
    cutoff = time.time() - 86400
    paths = list((root / ".staging").glob("*"))
    paths += list((root / "projects").glob("*/.work/*"))
    paths += list((root / "projects").glob("*/outputs/*"))
    for path in paths:
        if (path.name in live or path.name in outputs
                or path.name in assets._active_staging
                or path.resolve() != path):
            continue
        if path.is_dir() and path.stat().st_mtime < cutoff:
            shutil.rmtree(path)
