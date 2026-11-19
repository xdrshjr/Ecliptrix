"""AI video through the SkillRouter shim, against the real HTTP fake gateway.

Real ffmpeg / ffprobe validate the downloaded artifact; the gateway is a real
local server (tests/skillrouter_fake.py), not a stub of ``AsyncRouterClient``.
"""
import asyncio
import json
import shutil
import subprocess
import uuid

import httpx
import pytest

from app.config import settings
from app.models.ark_video_models import ArkVideoGenerateRequest
from app.services import ark_video_artifacts as artifacts
from app.services import ark_video_service as service
from app.services import material_download_service as material_module
from app.services.ark_video_task_context import VideoTaskContexts
from app.services.credential_errors import CredentialNotConfigured, VideoError
from app.services.integration_credentials_service import integration_credentials
from app.services.skillrouter import client as client_module
from app.services.skillrouter import video_adapter, video_frames
from tests import skillrouter_fake

SUBMIT = "/api/v1/media/videos/generations"


@pytest.fixture
def video_env(monkeypatch, tmp_path, integration_db):
    """Storage root + cache service on a temp dir and a private task registry."""
    monkeypatch.setattr(settings.storage, "root", str(tmp_path))
    cache = material_module.MaterialDownloadService()
    cache._session_factory = integration_db
    monkeypatch.setattr(cache, "_ensure_loop", lambda: asyncio.get_running_loop())
    monkeypatch.setattr(material_module, "get_material_download_service", lambda: cache)
    manager = VideoTaskContexts()
    monkeypatch.setattr(service, "video_task_contexts", manager)
    yield tmp_path


@pytest.fixture
def mp4_bytes(tmp_path):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("real ffmpeg and ffprobe are required")
    path = tmp_path / "gateway.mp4"
    subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
        "testsrc2=size=64x96:rate=10:duration=1.2", "-c:v", "libx264", "-y", str(path),
    ], check=True, capture_output=True)
    return path.read_bytes()


def body_of(gateway, path=SUBMIT):
    return json.loads(gateway.last("POST", path)["body"])


def done_script(gateway, mp4):
    asset_id = gateway.add_asset(mp4, "video/mp4")
    return [
        {"status": "running", "phase": "generating"},
        {"status": "succeeded", "phase": "ready", "asset": gateway.asset_dto(asset_id, "video")},
    ]


# --- request mapping --------------------------------------------------------

@pytest.mark.asyncio
async def test_text_request_maps_to_gateway_body(fake_gateway, video_env):
    submission = await service.create_task(ArkVideoGenerateRequest(
        prompt="a paper boat", duration=6, aspect_ratio="9:16", resolution="480p",
        watermark=True))
    body = body_of(fake_gateway)
    assert body == {
        "prompt": "a paper boat", "mode": "description", "duration": 6, "aspectRatio": "9:16",
        "resolution": "480p", "watermark": True, "cameraFixed": False,
    }
    assert submission.task_id == "sr_job1"
    assert submission.model_id == "doubao-seedance-2-0-260128"
    assert fake_gateway.last("POST", SUBMIT)["headers"]["x-api-key"] == fake_gateway.api_key
    assert fake_gateway.count("POST", SUBMIT) == 1
    await service.video_task_contexts.close()


@pytest.mark.asyncio
async def test_router_mode_needs_no_ark_key(fake_gateway, video_env):
    from app.services.ark_video_config import resolve_video_config
    config = resolve_video_config()
    assert config.integration_id == "skillrouter" and config.api_key == ""
    await service.video_task_contexts.close()


@pytest.mark.asyncio
async def test_local_frame_is_inlined_as_data_uri(fake_gateway, video_env):
    from PIL import Image
    frames = video_env / "frames"
    frames.mkdir()
    Image.new("RGB", (640, 480), "blue").save(frames / "a.png")
    await service.create_task(ArkVideoGenerateRequest(
        prompt="zoom", image_url="/api/storage/files/frames/a.png"))
    body = body_of(fake_gateway)
    assert body["mode"] == "keyframe"
    assert body["firstFrameUrl"].startswith("data:image/png;base64,")
    assert "lastFrameUrl" not in body and "referenceImageUrls" not in body
    await service.video_task_contexts.close()


@pytest.mark.asyncio
async def test_reference_mode_maps_to_reference_urls(fake_gateway, video_env):
    from PIL import Image
    for name in ("r1.png", "r2.png"):
        Image.new("RGB", (400, 400), "red").save(video_env / name)
    await service.create_task(ArkVideoGenerateRequest(
        prompt="p", mode="reference",
        image_urls=["/api/storage/files/r1.png", "/api/storage/files/r2.png"]))
    body = body_of(fake_gateway)
    assert body["mode"] == "reference" and len(body["referenceImageUrls"]) == 2
    assert "firstFrameUrl" not in body
    await service.video_task_contexts.close()


def noisy_frame(path, size):
    import os
    from PIL import Image
    Image.frombytes("RGB", size, os.urandom(size[0] * size[1] * 3)).save(path, "PNG")


@pytest.mark.asyncio
async def test_oversized_frame_is_reencoded_under_the_body_cap(fake_gateway, video_env):
    noisy_frame(video_env / "big.png", (2400, 2000))
    await service.create_task(ArkVideoGenerateRequest(
        prompt="p", image_url="/api/storage/files/big.png"))
    raw = fake_gateway.last("POST", SUBMIT)["body"]
    assert len(raw) <= video_frames.MAX_BODY_BYTES
    assert json.loads(raw)["firstFrameUrl"].startswith("data:image/jpeg;base64,")
    await service.video_task_contexts.close()


def test_body_that_cannot_shrink_enough_is_rejected(monkeypatch):
    from PIL import Image
    import base64
    from io import BytesIO
    buffer = BytesIO()
    Image.new("RGB", (800, 800), "green").save(buffer, "PNG")
    uri = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()
    monkeypatch.setattr(video_frames, "MAX_BODY_BYTES", 100)
    with pytest.raises(VideoError) as error:
        video_frames.fit_body({"prompt": "p", "firstFrameUrl": uri})
    assert error.value.code == "router_invalid_request"
    assert error.value.details["reason"] == "request_too_large"


@pytest.mark.asyncio
async def test_unknown_model_is_rejected_before_any_post(fake_gateway, video_env):
    with pytest.raises(VideoError) as error:
        await service.create_task(ArkVideoGenerateRequest(prompt="p", model="not-a-model"))
    assert error.value.code == "invalid_model_configuration" and error.value.status_code == 422
    assert fake_gateway.count("POST", SUBMIT) == 0
    await service.video_task_contexts.close()


@pytest.mark.asyncio
async def test_listed_model_is_forwarded(fake_gateway, video_env):
    await service.create_task(ArkVideoGenerateRequest(
        prompt="p", model="doubao-seedance-2-0-260128"))
    assert body_of(fake_gateway)["model"] == "doubao-seedance-2-0-260128"
    await service.video_task_contexts.close()


@pytest.mark.asyncio
async def test_last_frame_is_prechecked_against_model_limits(
        fake_gateway, video_env, monkeypatch):
    entry = skillrouter_fake.LIMITS["ai_video"]["models"][0]
    monkeypatch.setitem(entry, "supportsLastFrame", False)
    with pytest.raises(VideoError) as error:
        await service.create_task(ArkVideoGenerateRequest(
            prompt="p", mode="keyframe",
            first_frame_url="data:image/png;base64,AAAA", last_frame_url="data:image/png;base64,AAAA"))
    assert error.value.code == "video_parameters_unsupported"
    assert error.value.details["field"] == "last_frame_url"
    assert fake_gateway.count("POST", SUBMIT) == 0
    await service.video_task_contexts.close()


# --- config revision (409 without re-POST) ----------------------------------

@pytest.mark.asyncio
async def test_expected_revision_mismatch_is_409_and_never_posts(fake_gateway, video_env):
    with pytest.raises(VideoError) as error:
        await service.create_task(ArkVideoGenerateRequest(
            prompt="p", expected_config_revision=uuid.uuid4()))
    assert error.value.code == "video_configuration_changed" and error.value.status_code == 409
    assert fake_gateway.count("POST", SUBMIT) == 0
    await service.video_task_contexts.close()


@pytest.mark.asyncio
async def test_matching_revision_is_accepted_and_changes_with_config(fake_gateway, video_env):
    from app.services.ark_video_config import resolve_video_config
    revision = resolve_video_config().config_revision
    uuid.UUID(revision)  # request models are UUID typed
    await service.create_task(ArkVideoGenerateRequest(
        prompt="p", expected_config_revision=uuid.UUID(revision)))
    await integration_credentials.save("skillrouter", {"manual_capabilities": "tts"})
    assert resolve_video_config().config_revision != revision
    await service.video_task_contexts.close()


# --- status translation ------------------------------------------------------

@pytest.mark.parametrize("job,expected_status,expected_code", [
    ({"status": "queued"}, "queued", None),
    ({"status": "running", "phase": "generating"}, "running", None),
    ({"status": "failed", "error": {"code": "upstream_generation_failed"}},
     "failed", "video_generation_failed"),
    ({"status": "failed", "error": {"code": "asset_download_failed"}},
     "failed", "video_download_failed"),
    ({"status": "failed", "error": {"code": "something_new"}}, "failed", "video_generation_failed"),
    ({"status": "expired", "error": {"code": "upstream_task_expired"}}, "expired", None),
    ({"status": "cancelled"}, "cancelled", None),
])
def test_job_to_ark_shape_table(job, expected_status, expected_code):
    from app.services.skillrouter.config import get_snapshot
    shim = video_adapter.job_to_ark_shape(get_snapshot(), {"model": "m", **job})
    assert shim["status"] == expected_status and shim["model"] == "m"
    assert shim.get("_error_code") == expected_code


@pytest.mark.asyncio
async def test_succeeded_job_url_is_absolute_on_the_gateway_origin(fake_gateway, video_env):
    asset_id = fake_gateway.add_asset(b"x", "video/mp4")
    job = {"status": "succeeded", "asset": fake_gateway.asset_dto(asset_id, "video")}
    from app.services.skillrouter.config import get_snapshot
    shim = video_adapter.job_to_ark_shape(get_snapshot(), job)
    assert shim["content"]["video_url"] == f"{fake_gateway.base_url}/api/v1/media/assets/{asset_id}"


@pytest.mark.asyncio
async def test_foreign_origin_asset_is_refused(fake_gateway, video_env):
    from app.services.skillrouter.config import get_snapshot
    job = {"status": "succeeded", "asset": {"url": "https://evil.example/a.mp4"}}
    with pytest.raises(VideoError) as error:
        video_adapter.job_to_ark_shape(get_snapshot(), job)
    assert error.value.code == "invalid_provider_response"


@pytest.mark.asyncio
@pytest.mark.parametrize("script,status,code", [
    ({"status": "queued"}, "queued", None),
    ({"status": "running", "phase": "generating"}, "running", None),
    ({"status": "failed", "error": {"code": "upstream_generation_failed", "message": "m"}},
     "failed", "video_generation_failed"),
    ({"status": "failed", "error": {"code": "asset_download_failed", "message": "m"}},
     "failed", "video_download_failed"),
    ({"status": "expired", "error": {"code": "upstream_task_expired", "message": "m"}},
     "timeout", "video_task_expired"),
    ({"status": "cancelled"}, "failed", "video_generation_failed"),
])
async def test_polling_translates_every_job_state(fake_gateway, video_env, script, status, code):
    submission = await service.create_task(ArkVideoGenerateRequest(prompt="p"))
    fake_gateway.job_script["job1"] = [script]
    result = await service.get_status(submission.task_id)
    assert result.status == status and result.error_code == code
    await service.video_task_contexts.close()


# --- sr_ dispatch and mode switching ----------------------------------------

@pytest.mark.asyncio
async def test_unknown_sr_task_is_recovered_from_the_gateway(fake_gateway, video_env):
    fake_gateway.jobs["jobX"] = {"id": "jobX", "status": "running", "phase": "generating",
                                 "model": "m", "error": None, "asset": None}
    result = await service.get_status("sr_jobX")
    assert result.status == "running" and result.phase == "generating"
    assert fake_gateway.count("GET", "/api/v1/media/jobs/jobX") == 1
    await service.video_task_contexts.close()


@pytest.mark.asyncio
async def test_in_flight_job_survives_switch_to_manual_mode(fake_gateway, video_env, mp4_bytes):
    submission = await service.create_task(ArkVideoGenerateRequest(prompt="p"))
    await integration_credentials.save("skillrouter", {"mode": "manual"})
    fake_gateway.job_script["job1"] = done_script(fake_gateway, mp4_bytes)
    first = await service.get_status(submission.task_id)
    assert first.status == "running"
    await service.get_status(submission.task_id)
    await service.video_task_contexts.by_task(submission.task_id).worker
    ready = await service.get_status(submission.task_id)
    assert ready.phase == "ready"
    await service.video_task_contexts.close()


@pytest.mark.asyncio
async def test_task_survives_registry_loss_after_mode_switch(fake_gateway, video_env):
    """Restart + manual mode + no Ark key: an sr_ id still polls the gateway."""
    submission = await service.create_task(ArkVideoGenerateRequest(prompt="p"))
    await service.video_task_contexts.close()
    await integration_credentials.save("skillrouter", {"mode": "manual"})
    fake_gateway.job_script["job1"] = [{"status": "running", "phase": "generating"}]
    result = await service.get_status(submission.task_id)
    assert result.status == "running"
    await service.video_task_contexts.close()


# --- artifact collection -----------------------------------------------------

@pytest.mark.asyncio
async def test_artifact_downloaded_with_key_and_cached_same_origin(
        fake_gateway, video_env, mp4_bytes):
    submission = await service.create_task(ArkVideoGenerateRequest(prompt="p"))
    fake_gateway.job_script["job1"] = done_script(fake_gateway, mp4_bytes)
    await service.get_status(submission.task_id)  # running
    downloading = await service.get_status(submission.task_id)
    assert downloading.phase == "downloading" and downloading.video_url is None
    await service.video_task_contexts.by_task(submission.task_id).worker
    ready = await service.get_status(submission.task_id)
    assert ready.status == "succeeded" and ready.phase == "ready"
    assert ready.video_url == "/api/storage/files/cached_materials/ark/sr_job1.mp4"
    assert (ready.width, ready.height) == (64, 96)
    download = fake_gateway.last("GET", "/api/v1/media/assets/asset1")
    assert download["headers"]["x-api-key"] == fake_gateway.api_key
    cached = await artifacts.lookup_cached("sr_job1")
    assert cached is not None and cached.read_bytes() == mp4_bytes
    await service.video_task_contexts.close()


@pytest.mark.asyncio
async def test_non_video_asset_fails_with_invalid_artifact(fake_gateway, video_env):
    submission = await service.create_task(ArkVideoGenerateRequest(prompt="p"))
    asset_id = fake_gateway.add_asset(b"<html>nope</html>", "video/mp4")
    fake_gateway.job_script["job1"] = [{
        "status": "succeeded", "phase": "ready",
        "asset": fake_gateway.asset_dto(asset_id, "video")}]
    await service.get_status(submission.task_id)
    await service.video_task_contexts.by_task(submission.task_id).worker
    failed = await service.get_status(submission.task_id)
    assert failed.status == "failed" and failed.error_code == "invalid_video_artifact"
    await service.video_task_contexts.close()


@pytest.mark.asyncio
async def test_asset_404_surfaces_as_download_failure(fake_gateway, video_env):
    submission = await service.create_task(ArkVideoGenerateRequest(prompt="p"))
    fake_gateway.job_script["job1"] = [{
        "status": "succeeded", "phase": "ready",
        "asset": {"id": "gone", "url": "/api/v1/media/assets/gone"}}]
    await service.get_status(submission.task_id)
    await service.video_task_contexts.by_task(submission.task_id).worker
    failed = await service.get_status(submission.task_id)
    assert failed.status == "failed" and failed.error_code == "video_download_failed"
    await service.video_task_contexts.close()


# --- submission faults: paid POST is never retried ---------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("status,code", [
    (500, "upstream_unavailable"), (502, "invalid_provider_response"), (504, "upstream_timeout"),
])
async def test_5xx_after_send_is_submission_unknown_and_sent_once(
        fake_gateway, video_env, status, code):
    fake_gateway.fail("POST", SUBMIT, status, code)
    with pytest.raises(VideoError) as error:
        await service.create_task(ArkVideoGenerateRequest(prompt="p"))
    assert error.value.code == "generation_submission_unknown"
    assert error.value.details["sticky"] is True and error.value.details["retryable"] is False
    assert fake_gateway.count("POST", SUBMIT) == 1
    assert service.video_task_contexts.active_count == 0
    await service.video_task_contexts.close()


@pytest.mark.asyncio
async def test_read_timeout_after_send_is_submission_unknown(
        fake_gateway, video_env, monkeypatch):
    sent = []

    def handler(request):
        sent.append(request.url.path)
        raise httpx.ReadTimeout("slow", request=request)

    monkeypatch.setattr(client_module, "_async_client_factory", lambda timeout, **_: httpx.AsyncClient(
        transport=httpx.MockTransport(handler), timeout=timeout))
    with pytest.raises(VideoError) as error:
        await service.create_task(ArkVideoGenerateRequest(prompt="p"))
    assert error.value.code == "generation_submission_unknown"
    assert sent.count(SUBMIT) == 1
    await service.video_task_contexts.close()


@pytest.mark.asyncio
async def test_connect_failure_is_a_clean_refusal_not_unknown(
        fake_gateway, video_env, monkeypatch):
    def handler(request):
        raise httpx.ConnectError("refused", request=request)

    monkeypatch.setattr(client_module, "_async_client_factory", lambda timeout, **_: httpx.AsyncClient(
        transport=httpx.MockTransport(handler), timeout=timeout))
    with pytest.raises(VideoError) as error:
        await service.create_task(ArkVideoGenerateRequest(prompt="p"))
    assert error.value.code == "router_unreachable"
    await service.video_task_contexts.close()


@pytest.mark.asyncio
async def test_accepted_but_failed_submission_job_is_unknown(fake_gateway, video_env):
    fake_gateway.submit_patch = {"status": "failed", "error": {
        "code": "submission_unknown", "message": "outcome unknown"}}
    with pytest.raises(VideoError) as error:
        await service.create_task(ArkVideoGenerateRequest(prompt="p"))
    assert error.value.code == "generation_submission_unknown"
    assert error.value.details["sticky"] is True
    await service.video_task_contexts.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("status,gateway_code,expected,http", [
    (429, "too_many_jobs", "router_busy", 429),
    (429, "quota_exceeded", "router_quota_exceeded", 429),
    (403, "tier_denied", "router_capability_denied", 403),
    (503, "capability_not_configured", "router_capability_unavailable", 503),
    (422, "content_rejected", "content_rejected", 422),
    (400, "invalid_request", "router_invalid_request", 422),
    (401, "authentication_error", "router_key_invalid", 409),
])
async def test_definitive_refusals_keep_their_mapped_codes(
        fake_gateway, video_env, status, gateway_code, expected, http):
    fake_gateway.fail("POST", SUBMIT, status, gateway_code)
    with pytest.raises(VideoError) as error:
        await service.create_task(ArkVideoGenerateRequest(prompt="p"))
    assert error.value.code == expected and error.value.status_code == http
    assert fake_gateway.count("POST", SUBMIT) == 1
    await service.video_task_contexts.close()


# --- Key revoked while a task is in flight (RV-11) ---------------------------

@pytest.mark.asyncio
async def test_revoked_key_keeps_the_task_and_resumes_with_a_new_key(
        fake_gateway, video_env, mp4_bytes):
    submission = await service.create_task(ArkVideoGenerateRequest(prompt="p"))
    good_key = fake_gateway.api_key
    fake_gateway.api_key = "ar-rotated-by-operator-0000"  # the saved key is now rejected
    with pytest.raises(VideoError) as error:
        await service.get_status(submission.task_id)
    assert error.value.code == "router_key_invalid"
    assert error.value.details["retryable"] is False
    ctx = service.video_task_contexts.by_task(submission.task_id)
    assert ctx is not None and ctx.finished_at is None and ctx.status == "running"
    await integration_credentials.save("skillrouter", {"api_key": "ar-rotated-by-operator-0000"})
    fake_gateway.job_script["job1"] = done_script(fake_gateway, mp4_bytes)
    assert (await service.get_status(submission.task_id)).status == "running"
    assert good_key != fake_gateway.api_key
    await service.video_task_contexts.close()


# --- /ark-video/models -------------------------------------------------------

@pytest.mark.asyncio
async def test_models_endpoint_maps_gateway_limits_to_existing_contract(fake_gateway, video_env):
    from app.routers.ark_video_router import get_video_models
    data = json.loads(json.dumps((await get_video_models())["data"]))
    assert data["configured"] is True and data["default_model"] == "doubao-seedance-2-0-260128"
    uuid.UUID(data["config_revision"])
    assert data["models"] == [{
        "id": "doubao-seedance-2-0-260128", "display_name": "Seedance 2.0",
        "profile": "seedance_2", "modes": ["description", "keyframe", "reference"],
        "resolutions": ["480p", "720p", "1080p"], "duration_min": 4, "duration_max": 12,
        "max_reference_images": 4, "supports_last_frame": True, "supports_camera_fixed": False,
    }]


@pytest.mark.asyncio
async def test_unknown_profile_degrades_to_text_only(fake_gateway, video_env, monkeypatch):
    entry = skillrouter_fake.LIMITS["ai_video"]["models"][0]
    monkeypatch.setitem(entry, "profile", "holodeck_9")
    from app.routers.ark_video_router import get_video_models
    model = json.loads(json.dumps((await get_video_models())["data"]))["models"][0]
    assert model["profile"] == "text_only" and model["modes"] == ["description"]
    assert model["max_reference_images"] == 0 and model["supports_last_frame"] is False


@pytest.mark.asyncio
async def test_models_endpoint_reports_unavailable_capability(fake_gateway, video_env):
    fake_gateway.unavailable["ai_video"] = "capability_not_configured"
    from app.routers.ark_video_router import get_video_models
    data = (await get_video_models())["data"]
    assert data["configured"] is False
    assert data["configuration_warning"] == "router_capability_unavailable"


@pytest.mark.asyncio
async def test_manual_mode_models_endpoint_never_touches_the_gateway(
        fake_gateway_manual, video_env):
    from app.routers.ark_video_router import get_video_models
    data = (await get_video_models())["data"]
    assert data["default_model"] != "router"
    assert fake_gateway_manual.requests == []


def test_router_task_prefix_detection():
    assert video_adapter.is_router_task("sr_abc") and not video_adapter.is_router_task("cgt-1")
    assert not video_adapter.is_router_task(None)


@pytest.mark.asyncio
async def test_missing_key_is_credential_not_configured(fake_gateway, video_env, monkeypatch):
    from app.services.skillrouter import config as router_config
    from app.services.skillrouter.errors import RouterError
    monkeypatch.setattr(video_adapter, "require_ready",
                        lambda: (_ for _ in ()).throw(RouterError("router_key_missing", 409)))
    with pytest.raises(CredentialNotConfigured) as error:
        await video_adapter.submit_job(ArkVideoGenerateRequest(prompt="p"))
    assert error.value.integration_id == "skillrouter"
    assert router_config  # module imported for clarity of the patched seam
