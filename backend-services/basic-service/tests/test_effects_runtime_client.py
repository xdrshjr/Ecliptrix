"""Damaged optional runtime resources must not stop the editing backend."""

import json
import hashlib
from pathlib import Path

import pytest

from app.services.effects.catalog import CATALOG_HASH
from app.models.effects_models import EffectError
from app.services.effects.job_service import EffectRenderService
from app.services.effects.runtime_client import EffectsRuntimeClient


def valid_manifest():
    layout = Path(__file__).resolve().parents[1] / "app/services/effects/text-layout.generated.json"
    content = layout.read_bytes()
    identity = hashlib.sha256(content).hexdigest()
    return {"protocolVersion": 1, "engineVersion": "4.0.544",
            "catalogHash": CATALOG_HASH, "supportedTemplates": 24,
            "runtimeFingerprint": "a" * 64, "fontHash": "b" * 64,
            "bundleHash": "c" * 64, "textLayoutHash": identity,
            "files": [{"path": "runtime/text-layout.json", "bytes": len(content), "sha256": identity}]}


@pytest.mark.asyncio
@pytest.mark.parametrize("manifest", [
    [], None, "invalid", 1,
    {key: value for key, value in valid_manifest().items()
     if key != "runtimeFingerprint"},
    {**valid_manifest(), "fontHash": None},
    {**valid_manifest(), "bundleHash": "invalid"},
])
async def test_malformed_manifest_disables_only_effects(tmp_path, manifest):
    (tmp_path / "manifest.json").write_text(json.dumps(manifest),
                                           encoding="utf-8")
    runtime = EffectsRuntimeClient()
    runtime.resource_root = tmp_path
    service = EffectRenderService(runtime=runtime)
    try:
        await service.start()
        capability = await service.capabilities()
        assert capability["ready"] is False
        assert capability["unavailable_reason"] == "EFFECT_RUNTIME_MISMATCH"
    finally:
        await service.close()


def test_valid_manifest_preserves_runtime_snapshot(tmp_path):
    manifest = valid_manifest()
    (tmp_path / "manifest.json").write_text(json.dumps(manifest),
                                           encoding="utf-8")
    runtime = EffectsRuntimeClient()
    runtime.resource_root = tmp_path
    assert runtime.load_manifest() == manifest


def health_payload(**overrides):
    body = {"protocolVersion": 1, "catalogHash": CATALOG_HASH,
            "runtimeFingerprint": "a" * 64, "ready": True,
            "restartRequired": False, "runtimeInstanceId": "instance"}
    body.update(overrides)
    return body


def client_with_health(tmp_path, payload):
    """A client whose manifest is valid and whose /v1/health is stubbed."""
    (tmp_path / "manifest.json").write_text(
        json.dumps(valid_manifest()), encoding="utf-8")
    runtime = EffectsRuntimeClient()
    runtime.resource_root = tmp_path

    async def request(method, path, body=None, *, timeout=10):
        assert path == "/v1/health"
        return payload

    runtime.request = request
    return runtime


@pytest.mark.asyncio
async def test_payload_gate_failure_keeps_the_runtime_verdict(tmp_path):
    """A rejected payload is not a version mismatch and says where it broke."""
    runtime = client_with_health(tmp_path, {
        "protocolVersion": 1, "ready": False,
        "errorCode": "EFFECT_RUNTIME_MISMATCH",
        "errorDetail": {"code": "EFFECT_RUNTIME_MISMATCH", "stage": "missing",
                        "path": "runtime/node_modules/x/dist/.gitkeep",
                        "fileCode": "ENOENT",
                        "resourceRoot": "C:/private/install"}})
    with pytest.raises(EffectError) as failure:
        await runtime.health()
    assert failure.value.code == "EFFECT_RUNTIME_MISMATCH"
    assert failure.value.details == {"runtime": {
        "stage": "missing",
        "payload_path": "runtime/node_modules/x/dist/.gitkeep",
        "file_code": "ENOENT"}}
    # The install root is private and must never leave the backend.
    assert "C:/private/install" not in json.dumps(failure.value.details)


@pytest.mark.asyncio
async def test_payload_gate_without_error_code_reports_unavailable(tmp_path):
    runtime = client_with_health(tmp_path, {"protocolVersion": 1,
                                           "ready": False})
    with pytest.raises(EffectError) as failure:
        await runtime.health()
    assert failure.value.code == "EFFECT_RUNTIME_UNAVAILABLE"


@pytest.mark.asyncio
async def test_different_catalog_hash_is_a_version_mismatch(tmp_path):
    runtime = client_with_health(tmp_path,
                                 health_payload(catalogHash="f" * 64))
    with pytest.raises(EffectError) as failure:
        await runtime.health()
    assert failure.value.code == "EFFECT_RUNTIME_MISMATCH"
    assert failure.value.details == {"health": "manifest-mismatch"}


class StubRuntime:
    """Runtime double: queued health answers, counted resets."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.resets = 0

    async def health(self):
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    async def reset(self):
        self.resets += 1
        return {"reset": True, "reverified": True}


@pytest.mark.asyncio
async def test_retry_reverifies_only_on_explicit_request():
    """The 5s monitor must not re-hash the payload; the retry button must."""
    rejected = EffectError("EFFECT_RUNTIME_MISMATCH", status=503)
    service = EffectRenderService(runtime=StubRuntime(
        [rejected, rejected, health_payload()]))
    with pytest.raises(EffectError):
        await service._probe_runtime(False)
    assert service.runtime.resets == 0
    assert (await service._probe_runtime(True))["ready"] is True
    assert service.runtime.resets == 1
