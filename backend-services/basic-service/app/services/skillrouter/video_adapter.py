"""AI-video shim: gateway jobs presented in the ARK shape (spec §4.5).

The rest of the video pipeline (task contexts, config revision, artifact
collection, cache registration, frontend state machine) keeps consuming the
ARK-shaped dictionaries it always did; this module translates at the boundary.

Invariants:

* the submit POST is sent exactly once (the gateway has no idempotency key); a
  fault after the request left the machine is ``generation_submission_unknown``
  (sticky) - never retried and never silently re-submitted;
* gateway jobs are exposed as ``sr_<jobId>`` so polling dispatches by prefix and
  an in-flight job survives a later mode switch;
* nothing here reads the Ark credentials or the ``ark_video`` settings.
"""

from __future__ import annotations

import re
import uuid
import hashlib
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence, Tuple

from app.models.ark_video_models import ArkVideoGenerateRequest
from app.services.ark_video_artifacts import MAX_VIDEO_BYTES
from app.services.ark_video_config import VideoRuntimeConfig
from app.services.ark_video_payload import normalize_images
from app.services.ark_video_profiles import VIDEO_MODELS, VideoModelSpec
from app.services.credential_errors import CredentialNotConfigured, VideoError
from app.services.skillrouter.assets import asset_url, download_asset
from app.services.skillrouter.catalog import capability_entry, capability_limits, ensure_limits
from app.services.skillrouter.client import TIMEOUT_MEDIA, TIMEOUT_POLL, AsyncRouterClient
from app.services.skillrouter.config import RouterSnapshot, get_snapshot, require_ready
from app.services.skillrouter.constants import VIDEO_JOB_PREFIX
from app.services.skillrouter.errors import RouterError
from app.services.skillrouter.video_frames import fit_body_async, resolve_frame_fields

INTEGRATION = "skillrouter"
#: Profiles the app understands; anything else is downgraded to ``text_only``.
KNOWN_PROFILES = frozenset({"first_frame", "seedance_2", "seedance_2_fast", "seedance_2_mini"})
_MODES = ("description", "keyframe", "reference")
_JOB_ID = re.compile(r"[A-Za-z0-9_-]{1,120}")
#: A 5xx with one of these gateway codes is a clean refusal (nothing was started).
_DEFINITIVE_REFUSALS = frozenset({"capability_not_configured", "capability_unavailable"})
#: Job-level error codes -> the codes the existing pipeline already exposes.
_JOB_ERRORS = {
    "upstream_generation_failed": "video_generation_failed",
    "asset_download_failed": "video_download_failed",
    "submission_unknown": "generation_submission_unknown",
    "content_rejected": "content_rejected",
}

Fetcher = Callable[[Path], Awaitable[None]]


def is_router_task(task_id: Optional[str]) -> bool:
    """True for ids minted by this module (``sr_`` prefix)."""
    return bool(task_id) and task_id.startswith(VIDEO_JOB_PREFIX)


def router_revision(snapshot: RouterSnapshot) -> str:
    """Opaque config revision in UUID form (the request models are ``UUID``-typed).

    Deterministic in ``snapshot.revision``, so it changes exactly when the
    routing configuration changes and leaks nothing secret.
    """
    digest = hashlib.sha256(f"video|{snapshot.revision}".encode("utf-8")).hexdigest()
    return str(uuid.UUID(digest[:32]))


def _ready_snapshot() -> RouterSnapshot:
    try:
        return require_ready()
    except RouterError:
        raise CredentialNotConfigured(INTEGRATION) from None


# --- error translation ------------------------------------------------------

def to_video_error(error: RouterError, operation: str) -> VideoError:
    """Whitelisted ``VideoError`` carrying the Ecliptrix router error code."""
    details: Dict[str, Any] = dict(error.public_details())
    details.update(operation=operation, integration_id=INTEGRATION, retryable=error.is_retryable)
    return VideoError(error.error_code, error.response_status, **details)


def _submission_unknown() -> VideoError:
    return VideoError("generation_submission_unknown", 502, retryable=False, sticky=True)


def _is_submission_unknown(error: RouterError) -> bool:
    if error.code == "router_bad_response":
        return True
    if error.code in _DEFINITIVE_REFUSALS:
        return False
    return bool(error.details.get("request_sent"))


def _submit_error(error: RouterError) -> Exception:
    if error.code == "router_key_missing":
        return CredentialNotConfigured(INTEGRATION)
    if _is_submission_unknown(error):
        return _submission_unknown()
    return to_video_error(error, "submit")


def _status_error(error: RouterError) -> Exception:
    if error.code == "router_key_missing":
        return CredentialNotConfigured(INTEGRATION)
    if error.code == "not_found":
        return VideoError("video_task_not_found", 404, operation="status", retryable=False)
    return to_video_error(error, "status")


# --- model catalogue --------------------------------------------------------

def spec_from_limits(entry: Dict[str, Any], duration: Dict[str, Any]) -> VideoModelSpec:
    """Map one ``limits.models[]`` entry onto the app's capability record.

    An unknown profile is downgraded to ``text_only`` (never claims first-frame
    support it was not told about, so a storyboard frame is never dropped silently).
    """
    profile = str(entry.get("profile") or "")
    low, high = int(duration.get("min") or 4), int(duration.get("max") or 12)
    resolutions = tuple(str(r) for r in entry.get("resolutions") or ()) or ("720p",)
    common = dict(id=str(entry["id"]), display_name=str(entry.get("label") or entry["id"]),
                  resolutions=resolutions, duration_min=low, duration_max=high)
    if profile not in KNOWN_PROFILES:
        return VideoModelSpec(profile="text_only", modes=("description",), **common)
    modes = tuple(m for m in entry.get("modes") or () if m in _MODES) or ("description",)
    return VideoModelSpec(
        profile=profile, modes=modes, max_reference_images=int(entry.get("maxRefImages") or 0),
        supports_last_frame=bool(entry.get("supportsLastFrame")),
        supports_camera_fixed=bool(entry.get("supportsCameraFixed")), **common)


def specs_from_limits(limits: Dict[str, Any]) -> List[VideoModelSpec]:
    duration = limits.get("duration") if isinstance(limits.get("duration"), dict) else {}
    models = limits.get("models") if isinstance(limits.get("models"), list) else []
    return [spec_from_limits(m, duration) for m in models if isinstance(m, dict) and m.get("id")]


def router_runtime_config(model_override: Optional[str] = None) -> VideoRuntimeConfig:
    """Non-secret runtime config for a routed task (no Ark key, no network).

    The profile comes from the cached catalogue when present; it only feeds the
    local pre-checks of the storyboard path - the gateway stays the authority.
    """
    snapshot = _ready_snapshot()
    specs = specs_from_limits(capability_limits("ai_video"))
    override = (model_override or "").strip()
    spec = next((s for s in specs if s.id == override), None) or (specs[0] if specs else VIDEO_MODELS[0])
    return VideoRuntimeConfig(
        api_key="", model_id=override or spec.id, profile=spec,
        config_revision=router_revision(snapshot), integration_id=INTEGRATION)


async def models_response() -> Dict[str, Any]:
    """``/ark-video/models`` for router mode, in the existing contract."""
    snapshot = get_snapshot()
    revision = router_revision(snapshot)
    empty = {"configured": False, "default_model": None, "config_revision": revision,
             "configuration_warning": None, "models": []}
    if not snapshot.has_key:
        return empty
    specs = specs_from_limits(await ensure_limits("ai_video"))
    entry = capability_entry("ai_video")
    warning = None
    if entry is not None and entry.get("available") is False:
        warning = "router_capability_unavailable"
    elif not specs:
        warning = "router_catalog_unavailable"
    return {**empty, "configured": warning != "router_capability_unavailable",
            "default_model": specs[0].id if specs else None,
            "configuration_warning": warning, "models": [s.to_public() for s in specs]}


# --- request mapping ---------------------------------------------------------

def _unsupported(field: str, allowed: Any = None) -> VideoError:
    details: Dict[str, Any] = {"field": field}
    if allowed is not None:
        details["allowed"] = allowed
    return VideoError("video_parameters_unsupported", 422, **details)


def _candidate_specs(limits: Dict[str, Any], requested: Optional[str]) -> List[VideoModelSpec]:
    """Specs the request is checked against: the chosen model, else all (union)."""
    specs = specs_from_limits(limits)
    if not requested:
        return specs
    if not specs:
        return []  # catalogue unreachable: the gateway validates ``model`` itself
    chosen = [s for s in specs if s.id == requested]
    if not chosen:
        raise VideoError("invalid_model_configuration", 422, field="model",
                         integration_id=INTEGRATION)
    return chosen


def _check_capabilities(
    request: ArkVideoGenerateRequest, images: Sequence[Tuple[str, str]],
    mode: str, specs: Sequence[VideoModelSpec],
) -> None:
    """Pre-check what the gateway would refuse, with friendly field names."""
    if not specs:
        return
    checks = (
        ("mode", mode in {m for s in specs for m in s.modes}),
        ("resolution", request.resolution in {r for s in specs for r in s.resolutions}),
        ("duration", any(s.duration_min <= request.duration <= s.duration_max for s in specs)),
        ("last_frame_url", all(role != "last_frame" for _, role in images)
         or any(s.supports_last_frame for s in specs)),
        ("image_urls", sum(role == "reference_image" for _, role in images)
         <= max(s.max_reference_images for s in specs)),
        ("camera_fixed", not request.camera_fixed or any(s.supports_camera_fixed for s in specs)),
    )
    for field, satisfied in checks:
        if not satisfied:
            raise _unsupported(field)


def _derive_mode(request: ArkVideoGenerateRequest, images: Sequence[Tuple[str, str]]) -> str:
    return "keyframe" if request.mode == "description" and images else request.mode


def _base_body(request: ArkVideoGenerateRequest, mode: str) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "prompt": request.prompt, "mode": mode, "duration": request.duration,
        "aspectRatio": request.aspect_ratio, "resolution": request.resolution,
        "watermark": request.watermark, "cameraFixed": request.camera_fixed,
    }
    if request.model:
        body["model"] = request.model
    return body


async def build_request_body(request: ArkVideoGenerateRequest) -> Dict[str, Any]:
    """Validate and map ``request`` to the gateway wire body (frames inlined, ≤8 MB)."""
    limits = await ensure_limits("ai_video")
    specs = _candidate_specs(limits, request.model)
    images = normalize_images(request)
    mode = _derive_mode(request, images)
    _check_capabilities(request, images, mode, specs)
    body = _base_body(request, mode)
    body.update(await resolve_frame_fields(images))
    return await fit_body_async(body)


# --- submit / read -----------------------------------------------------------

def _job_of(data: Any) -> Dict[str, Any]:
    job = data.get("job") if isinstance(data, dict) else None
    if not isinstance(job, dict) or not _JOB_ID.fullmatch(str(job.get("id") or "")):
        raise _submission_unknown()
    return job


def _reject_failed_job(job: Dict[str, Any]) -> None:
    """A 202 can carry an already-failed job (the gateway's ``submission_unknown``)."""
    if job.get("status") != "failed":
        return
    code = str((job.get("error") or {}).get("code") or "")
    if code == "submission_unknown":
        raise _submission_unknown()
    raise VideoError(_JOB_ERRORS.get(code, "video_generation_failed"), 502, retryable=False)


async def submit_job(request: ArkVideoGenerateRequest) -> Tuple[str, str]:
    """Create one gateway video job.

    Returns:
        ``(sr_<jobId>, model_id)``.

    Raises:
        VideoError: validation (422), gateway refusal, or ``generation_submission_unknown``.
        CredentialNotConfigured: no gateway key.
    """
    snapshot = _ready_snapshot()
    body = await build_request_body(request)
    try:
        data = await AsyncRouterClient(snapshot).post(
            "media/videos/generations", body, timeout=TIMEOUT_MEDIA, gate="ai_video_submit")
    except RouterError as error:
        raise _submit_error(error) from None
    job = _job_of(data)
    _reject_failed_job(job)
    return f"{VIDEO_JOB_PREFIX}{job['id']}", str(job.get("model") or request.model or "router")


def _shim_succeeded(snapshot: RouterSnapshot, job: Dict[str, Any]) -> Dict[str, Any]:
    asset = job.get("asset")
    relative = asset.get("url") if isinstance(asset, dict) else None
    if not isinstance(relative, str) or not relative:
        raise VideoError("invalid_provider_response", 502, operation="status", retryable=False)
    try:
        return {"content": {"video_url": asset_url(snapshot, relative)}}
    except RouterError:
        raise VideoError("invalid_provider_response", 502, operation="status",
                         retryable=False) from None


def job_to_ark_shape(snapshot: RouterSnapshot, job: Dict[str, Any]) -> Dict[str, Any]:
    """Translate a gateway job into the dict ``_apply_provider`` already consumes."""
    status = str(job.get("status") or "").lower()
    shim: Dict[str, Any] = {"_router": True, "status": status, "model": job.get("model")}
    if status == "succeeded":
        shim.update(_shim_succeeded(snapshot, job))
    elif status == "failed":
        code = str((job.get("error") or {}).get("code") or "")
        shim["_error_code"] = _JOB_ERRORS.get(code, "video_generation_failed")
    return shim


async def read_job(task_id: str) -> Dict[str, Any]:
    """Poll one ``sr_`` task. ``task_id`` already passed ``validate_task_id``.

    Raises:
        VideoError: ``router_key_invalid`` (409, task kept), not found, busy, upstream.
        CredentialNotConfigured: no gateway key.
    """
    try:
        client = AsyncRouterClient()
        data = await client.get(f"media/jobs/{task_id[len(VIDEO_JOB_PREFIX):]}", timeout=TIMEOUT_POLL)
    except RouterError as error:
        raise _status_error(error) from None
    job = data.get("job") if isinstance(data, dict) else None
    if not isinstance(job, dict):
        raise VideoError("invalid_provider_response", 502, operation="status", retryable=False)
    return job_to_ark_shape(client.snapshot, job)


def make_fetcher(url: str) -> Fetcher:
    """``source_fetcher`` for ``collect_artifact``: authenticated same-origin download."""
    async def fetch(destination: Path) -> None:
        await download_asset(get_snapshot(), url, destination, max_bytes=MAX_VIDEO_BYTES)
    return fetch
