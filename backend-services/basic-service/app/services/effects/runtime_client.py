"""Authenticated private loopback protocol with bounded I/O and no retries."""

import asyncio
import hashlib
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from app.models.effects_models import EffectError
from .catalog import CATALOG_HASH


class EffectsRuntimeClient:
    """Only the desktop parent supplies runtime endpoints and credentials."""

    def __init__(self) -> None:
        self.url = os.getenv("EFFECTS_RUNTIME_URL", "").rstrip("/")
        self.token = os.getenv("EFFECTS_RUNTIME_TOKEN", "")
        self.resource_root = Path(os.getenv("EFFECTS_RESOURCE_ROOT", "."))
        self._client: httpx.AsyncClient | None = None

    def load_manifest(self) -> dict:
        """Reject a different engine/catalog instead of rendering old jobs."""
        try:
            manifest = json.loads((self.resource_root / "manifest.json")
                                  .read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise EffectError("EFFECT_RUNTIME_UNAVAILABLE", status=503) from exc
        if (not isinstance(manifest, dict)
                or manifest.get("protocolVersion") != 1
                or manifest.get("engineVersion") != "4.0.544"
                or manifest.get("catalogHash") != CATALOG_HASH
                or manifest.get("supportedTemplates") != 24
                or any(not isinstance(manifest.get(key), str)
                       or re.fullmatch(r"[0-9a-f]{64}", manifest[key]) is None
                       for key in ("runtimeFingerprint", "fontHash",
                                   "bundleHash", "textLayoutHash"))):
            raise EffectError("EFFECT_RUNTIME_MISMATCH", status=503)
        try:
            layout = Path(__file__).with_name("text-layout.generated.json").read_bytes()
            entries = [entry for entry in manifest["files"]
                       if entry["path"] == "runtime/text-layout.json"]
            if (hashlib.sha256(layout).hexdigest() != manifest["textLayoutHash"]
                    or len(entries) != 1
                    or entries[0]["sha256"] != manifest["textLayoutHash"]
                    or entries[0]["bytes"] != len(layout)):
                raise ValueError("layout mismatch")
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise EffectError("EFFECT_RUNTIME_MISMATCH", status=503) from exc
        return manifest

    async def request(self, method: str, path: str,
                       body: dict | None = None, *,
                       timeout: float = 10) -> dict:
        parsed = urlsplit(self.url)
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1"
                or parsed.path or not self.token):
            raise EffectError("EFFECT_RUNTIME_UNAVAILABLE", status=503)
        if self._client is None:
            self._client = httpx.AsyncClient(trust_env=False)
        try:
            response = await self._client.request(
                method, self.url + path, json=body, timeout=timeout,
                headers={"Authorization": f"Bearer {self.token}"})
            result = response.json()
            if not response.is_success:
                raise EffectError(result.get("errorCode",
                                  "EFFECT_RUNTIME_UNAVAILABLE"), status=503)
            return result
        except (httpx.HTTPError, ValueError) as exc:
            raise EffectError("EFFECT_RUNTIME_UNAVAILABLE", status=503) from exc

    async def health(self) -> dict:
        manifest = await asyncio.to_thread(self.load_manifest)
        health = await self.request("GET", "/v1/health", timeout=3)
        if (health.get("protocolVersion") != 1
                or health.get("catalogHash") != CATALOG_HASH
                or health.get("runtimeFingerprint")
                != manifest["runtimeFingerprint"]):
            raise EffectError("EFFECT_RUNTIME_MISMATCH", status=503)
        if not health.get("ready") or health.get("restartRequired"):
            raise EffectError("EFFECT_RUNTIME_UNAVAILABLE", status=503)
        return health

    async def reset(self) -> dict:
        return await self.request("POST", "/v1/reset", {}, timeout=10)

    async def submit(self, payload: dict) -> dict:
        return await self.request("POST", "/v1/jobs", payload)

    async def get(self, job_id: str) -> dict:
        return await self.request("GET", f"/v1/jobs/{job_id}")

    async def cancel(self, job_id: str) -> dict:
        return await self.request("POST", f"/v1/jobs/{job_id}/cancel", {})

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None
