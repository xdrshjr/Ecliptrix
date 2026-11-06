"""Seedance 单次提交、原任务读取及本地可用完成契约。"""
from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import httpx

from app.models.ark_video_models import ArkVideoGenerateRequest, ArkVideoStatusResponse
from app.services.ark_video_config import resolve_video_config
from app.services.ark_video_payload import build_payload, encode_payload, validate_remote_url
from app.services.ark_video_task_context import video_task_contexts, validate_task_id, VideoTaskContext
from app.services import ark_video_artifacts as artifacts
from app.services.credential_errors import VideoError, classify_generation_error

ARK_API_BASE = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"
_recovery_lock = asyncio.Lock()
_ARTIFACT_ERRORS = {"video_download_failed", "invalid_video_artifact", "video_cache_failed"}


@dataclass(frozen=True)
class VideoSubmission:
    task_id: str
    model_id: str
    config_revision: str


async def create_task(request: ArkVideoGenerateRequest, context_handle: str | None = None) -> VideoSubmission:
    """容量先原子预留；创建永不重试，不在响应时重新读设置。"""
    if context_handle:
        config = video_task_contexts.config_for(context_handle)
        if config is None:
            raise VideoError("video_task_expired", status_code=410)
    else:
        config = resolve_video_config(request.model, request.expected_config_revision)
        context_handle = (await video_task_contexts.reserve(config))[0]
    bound = False
    try:
        payload = await build_payload(request, config)
        ctx = video_task_contexts.context(context_handle)
        if ctx.finished_at is not None or time.monotonic() - ctx.created_at >= video_task_contexts.ttl:
            raise VideoError("video_task_expired", status_code=410)
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(ARK_API_BASE, content=encode_payload(payload), headers={
                "Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json",
            })
            response.raise_for_status()
            try:
                data = response.json()
                task_id = validate_task_id(data.get("id", ""))
            except (ValueError, AttributeError, TypeError, VideoError):
                raise VideoError("generation_submission_unknown", status_code=502, retryable=False, sticky=True) from None
        await video_task_contexts.bind(context_handle, task_id)
        bound = True
        return VideoSubmission(task_id, config.model_id, config.config_revision)
    except httpx.HTTPStatusError as error:
        raise classify_generation_error(
            error, "ark_video:contents/generations/tasks",
        ) from None
    except httpx.RequestError:
        # 队列直接调用服务，同样需要保留“可能已受理”的收费语义。
        raise VideoError(
            "generation_submission_unknown", status_code=502,
            retryable=False, sticky=True,
        ) from None
    finally:
        if not bound:
            await video_task_contexts.release(context_handle)


def status_error(response: httpx.Response | None = None) -> VideoError:
    status = response.status_code if response is not None else None
    details = {"operation": "status", "upstream_status": status, "retryable": False}
    code, local_status = "video_status_unavailable", 502
    if status in (401, 403):
        code = "provider_authentication"
    elif status == 404:
        code, local_status = "video_task_not_found", 404
    elif status == 429:
        code, local_status = "provider_rate_limited", 429
        details["retryable"] = True
    else:
        details["retryable"] = status is None or status >= 500
    if response is not None:
        identifier = response.headers.get("x-request-id") or response.headers.get("x-tt-logid") or ""
        if re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", identifier):
            details["provider_request_id"] = identifier
        retry_after = response.headers.get("retry-after", "")
        try:
            seconds = float(retry_after) if retry_after.isdigit() else (parsedate_to_datetime(retry_after) - datetime.now(timezone.utc)).total_seconds()
            details["retry_after_seconds"] = max(0, min(86400, int(seconds + 0.999)))
        except (ValueError, TypeError, OverflowError):
            pass
    return VideoError(code, status_code=local_status, **details)


async def _read_provider(task_id: str, api_key: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(f"{ARK_API_BASE}/{task_id}", headers={"Authorization": f"Bearer {api_key}"})
        if response.status_code != 200:
            raise status_error(response)
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError
        return data
    except httpx.RequestError:
        raise status_error() from None
    except (ValueError, TypeError):
        raise VideoError("invalid_provider_response", status_code=502, operation="status", retryable=False) from None


def _response(ctx: VideoTaskContext) -> ArkVideoStatusResponse:
    return ArkVideoStatusResponse(
        success=ctx.status not in ("failed", "timeout"), message=ctx.error_code or ctx.status,
        status=ctx.status, phase=ctx.phase, ark_task_id=ctx.task_id, model=ctx.model,
        error=ctx.error_code, error_code=ctx.error_code,
        **{key: value for key, value in ctx.result.items() if not key.startswith("_")},
    )


def _start_artifact(ctx: VideoTaskContext, url: str | None, cached_path: Path | None = None, *, refresh_invalid_original: bool = False) -> None:
    if ctx.finished_at is not None:
        # 已完成文件的复验有独立本地期限，不继承旧生成任务的年龄。
        ctx.created_at = time.monotonic()
    ctx.status = "running"
    ctx.phase = "validating" if cached_path else "downloading"
    ctx.finished_at, ctx.error_code = None, None
    video_task_contexts.drop_secret(ctx.handle)

    async def collect() -> None:
        try:
            try:
                ctx.result = await artifacts.collect_artifact(
                    ctx.task_id, url, cached_path, phase=lambda value: setattr(ctx, "phase", value),
                )
            except VideoError as error:
                if not refresh_invalid_original or error.code != "invalid_video_artifact":
                    raise
                # 显式重新收取时，坏原件不能永久遮挡原任务的有效产物。
                data = await _read_provider(ctx.task_id, resolve_video_config().api_key)
                content = data.get("content")
                refreshed_url = content.get("video_url") if isinstance(content, dict) else None
                if data.get("status") != "succeeded":
                    raise VideoError("invalid_provider_response", status_code=502)
                validate_remote_url(refreshed_url)
                ctx.result = await artifacts.collect_artifact(
                    ctx.task_id, refreshed_url, phase=lambda value: setattr(ctx, "phase", value),
                )
            video_task_contexts.finish(ctx, "succeeded")
        except asyncio.CancelledError:
            raise
        except Exception as error:
            code = error.code if isinstance(error, VideoError) else "video_download_failed"
            video_task_contexts.finish(ctx, "failed", code)
        finally:
            ctx.worker = None

    ctx.worker = asyncio.create_task(collect())


async def _recover_context(task_id: str) -> VideoTaskContext:
    async with _recovery_lock:
        existing = video_task_contexts.by_task(task_id)
        if existing:
            return existing
        cached = await artifacts.lookup_cached(task_id)
        config = None if cached else resolve_video_config()
        handle = (await video_task_contexts.reserve(config))[0]
        ctx = await video_task_contexts.bind(handle, task_id)
        if cached:
            _start_artifact(ctx, None, cached)
        return ctx


async def _apply_provider(ctx: VideoTaskContext, data: dict) -> None:
    if ctx.finished_at is not None or time.monotonic() - ctx.created_at >= video_task_contexts.ttl:
        return
    status = str(data.get("status", "")).lower()
    if status in ("queued", "running"):
        ctx.status = status
        ctx.phase = "queued" if status == "queued" else "generating"
        return
    if status == "succeeded":
        content = data.get("content")
        url = content.get("video_url") if isinstance(content, dict) else None
        try:
            validate_remote_url(url)
        except (VideoError, TypeError):
            video_task_contexts.finish(ctx, "failed", "invalid_provider_response")
            return
        _start_artifact(ctx, url)
        return
    if status in ("expired", "timeout"):
        video_task_contexts.finish(ctx, "timeout", "video_task_expired")
    elif status in ("failed", "cancelled", "canceled", "error"):
        video_task_contexts.finish(ctx, "failed", "video_generation_failed")
    else:
        video_task_contexts.finish(ctx, "failed", "invalid_provider_response")


async def get_status(ark_task_id: str, retry_artifact: bool = False) -> ArkVideoStatusResponse:
    validate_task_id(ark_task_id)
    await video_task_contexts.reap()
    ctx = video_task_contexts.by_task(ark_task_id) or await _recover_context(ark_task_id)
    async with ctx.lock:
        if ctx.worker:
            return _response(ctx)
        if ctx.status == "succeeded":
            fingerprint = ctx.result.get("_fingerprint")
            try:
                unchanged = fingerprint and artifacts.file_fingerprint(Path(fingerprint[0])) == fingerprint
            except OSError:
                unchanged = False
            if not unchanged:
                cached = await artifacts.lookup_cached(ark_task_id)
                ctx.result = {}
                if cached:
                    _start_artifact(ctx, None, cached)
                else:
                    video_task_contexts.finish(ctx, "failed", "invalid_video_artifact")
            return _response(ctx)
        if ctx.status in ("failed", "timeout"):
            if not retry_artifact or ctx.error_code not in _ARTIFACT_ERRORS:
                return _response(ctx)
            now = time.monotonic()
            if now - ctx.retry_at < 30:
                raise VideoError("video_artifact_retry_cooldown", status_code=429, retryable=False)
            ctx.retry_at = now
            original = await artifacts.find_original(ark_task_id)
            ctx.created_at = now
            if original:
                _start_artifact(ctx, None, original, refresh_invalid_original=True)
                return _response(ctx)
            # 只读取同一个原生任务以刷新 URL，绝不创建新任务。
            config = resolve_video_config()
            data = await _read_provider(ark_task_id, config.api_key)
            ctx.finished_at = None
            await _apply_provider(ctx, data)
            return _response(ctx)
        config = video_task_contexts.config_for(ctx.handle)
        if config is None:
            video_task_contexts.finish(ctx, "timeout", "video_task_expired")
            return _response(ctx)
        try:
            data = await _read_provider(ark_task_id, config.api_key)
        except VideoError as error:
            if not error.details.get("retryable"):
                video_task_contexts.finish(ctx, "failed", error.code)
            raise
        await _apply_provider(ctx, data)
        return _response(ctx)
