"""Damaged optional runtime resources must not stop the editing backend."""

import json

import pytest

from app.services.effects.catalog import CATALOG_HASH
from app.services.effects.job_service import EffectRenderService
from app.services.effects.runtime_client import EffectsRuntimeClient


def valid_manifest():
    return {"protocolVersion": 1, "engineVersion": "4.0.544",
            "catalogHash": CATALOG_HASH, "supportedTemplates": 24,
            "runtimeFingerprint": "a" * 64, "fontHash": "b" * 64,
            "bundleHash": "c" * 64}


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
