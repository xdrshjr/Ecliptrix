"""In-process fake SkillRouter gateway for tests (real HTTP on 127.0.0.1).

Behaviour is taken from aragon-router (README section 16 and the adapters):
envelope ``{data}`` / ``{error:{message,code}}``, ``x-api-key`` auth, relative
asset URLs that need the key, six capabilities with ``limits`` and ``quota``.

Tests use the ``fake_gateway`` fixture (see ``conftest.py``): it starts the
server, points the ``skillrouter`` credential row at it (router mode) and gives
back a :class:`FakeGateway` to inspect ``requests`` or inject failures::

    fake_gateway.fail("POST", "/api/v1/media/audio/speech", 429, "too_many_inflight")
    assert fake_gateway.count("POST", "/api/v1/media/images/generations") == 1
"""

from __future__ import annotations

import base64
import socket
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

API_KEY = "ar-test-key-0123456789"

# 1x1 transparent PNG
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)

LIMITS: Dict[str, Dict[str, Any]] = {
    "ai_image": {
        "sizes": ["1024x1024", "2048x2048", "1280x720", "720x1280", "1024x576", "576x1024"],
        "defaultSize": "2048x2048", "maxCount": 4, "promptMaxChars": 2000,
        "maxReferenceImages": 1, "watermarkDefault": True, "models": ["doubao-seedream-5-0-260128"],
    },
    "ai_video": {
        "models": [{
            "id": "doubao-seedance-2-0-260128", "label": "Seedance 2.0", "profile": "seedance_2",
            "modes": ["description", "keyframe", "reference"], "resolutions": ["480p", "720p", "1080p"],
            "maxRefImages": 4, "supportsLastFrame": True, "supportsCameraFixed": False,
        }],
        "duration": {"min": 4, "max": 12, "default": 5},
        "aspectRatios": ["16:9", "9:16", "1:1"], "promptMaxChars": 2000,
    },
    "tts": {
        "voices": [{"id": "zh_female_vv_uranus_bigtts", "name": "Vivi", "language": "zh",
                    "generation": "2.0", "category": "general"}],
        "defaultVoice": "zh_female_vv_uranus_bigtts", "maxChars": 1000,
        "speed": {"min": 0.5, "max": 2, "default": 1}, "formats": ["mp3"],
    },
    "image_search": {"perPage": {"max": 30, "default": 20},
                     "orientations": ["landscape", "portrait", "squarish"], "colors": [], "orderBy": ["relevant", "latest"]},
    "video_search": {"perPage": {"max": 80, "default": 20}, "orientations": ["landscape", "portrait", "mixed"]},
    "audio_search": {"perPage": {"max": 150, "default": 20}, "audioTypes": [], "sorts": ["score"],
                     "duration": {"minSeconds": 0, "maxSeconds": 3600}},
}
UNITS = {"ai_image": "image", "ai_video": "video", "tts": "thousand_chars",
         "image_search": "search", "video_search": "search", "audio_search": "search"}


@dataclass
class FakeGateway:
    """Handle returned by the ``fake_gateway`` fixture."""

    base_url: str = ""
    api_key: str = API_KEY
    requests: List[Dict[str, Any]] = field(default_factory=list)
    failures: Dict[Tuple[str, str], Tuple[int, str, Dict[str, str], int]] = field(default_factory=dict)
    unavailable: Dict[str, str] = field(default_factory=dict)  # capability -> reason
    models: List[Dict[str, Any]] = field(default_factory=lambda: [
        {"id": "gpt-4o-mini", "object": "model", "owned_by": "x", "provider": "openai"},
        {"id": "claude-sonnet-4", "object": "model", "owned_by": "x", "provider": "anthropic"},
        {"id": "ecliptrix-chat", "object": "model", "owned_by": "route", "provider": "route",
         "display_name": "Ecliptrix Chat"},
    ])
    jobs: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    job_script: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    assets: Dict[str, Tuple[bytes, str]] = field(default_factory=dict)
    speech_bytes: bytes = b"ID3-fake-mp3"
    image_bytes: bytes = PNG_BYTES
    search_total: int = 100
    redirect_paths: Dict[str, str] = field(default_factory=dict)
    submit_patch: Dict[str, Any] = field(default_factory=dict)  # merged into a new video job (202 body)
    _asset_seq: int = 0
    _job_seq: int = 0

    def fail(self, method: str, path: str, status: int, code: str,
             retry_after: Optional[int] = None, after: int = 0):
        """Fail ``method path`` once ``after`` earlier requests to it have succeeded."""
        headers = {"retry-after": str(retry_after)} if retry_after is not None else {}
        self.failures[(method.upper(), path)] = (status, code, headers, after)

    def count(self, method: str, path: str) -> int:
        return sum(1 for r in self.requests if r["method"] == method.upper() and r["path"] == path)

    def last(self, method: str, path: str) -> Optional[Dict[str, Any]]:
        matches = [r for r in self.requests if r["method"] == method.upper() and r["path"] == path]
        return matches[-1] if matches else None

    def add_asset(self, data: bytes, mime: str) -> str:
        self._asset_seq += 1
        asset_id = f"asset{self._asset_seq}"
        self.assets[asset_id] = (data, mime)
        return asset_id

    def asset_dto(self, asset_id: str, kind: str) -> Dict[str, Any]:
        data, mime = self.assets[asset_id]
        return {"id": asset_id, "kind": kind, "mime": mime, "bytes": len(data), "width": None,
                "height": None, "durationMs": None, "url": f"/api/v1/media/assets/{asset_id}",
                "title": None, "origin": "generated", "createdAt": 0, "expiresAt": None, "attribution": None}


def _error(status: int, code: str, message: str = "", headers: Optional[dict] = None):
    return JSONResponse({"error": {"message": message or code, "code": code}},
                        status_code=status, headers=headers or {})


def build_app(state: FakeGateway) -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def gate(request: Request, call_next):
        body = await request.body()
        entry = {"method": request.method, "path": request.url.path,
                 "headers": {k.lower(): v for k, v in request.headers.items()},
                 "query": dict(request.query_params), "body": body}
        state.requests.append(entry)
        if request.url.path in state.redirect_paths:
            return Response(status_code=302, headers={"location": state.redirect_paths[request.url.path]})
        key = request.headers.get("x-api-key") or request.headers.get("authorization", "").removeprefix("Bearer ")
        if key != state.api_key:
            return _error(401, "authentication_error", "invalid api key")
        failure = state.failures.get((request.method, request.url.path))
        if failure:
            status, code, headers, after = failure
            if state.count(request.method, request.url.path) > after:
                return _error(status, code, headers=headers)
        return await call_next(request)

    def ok(data: Any, status: int = 200):
        return JSONResponse({"data": data}, status_code=status)

    @app.get("/api/v1/capabilities")
    async def capabilities():
        items = []
        for cap_id, limits in LIMITS.items():
            reason = state.unavailable.get(cap_id)
            items.append({
                "id": cap_id, "kind": "generate", "label": {"en": cap_id, "zh": cap_id},
                "enabled": reason != "capability_disabled", "available": reason is None,
                "unavailableReason": reason, "limits": limits,
                "quota": {"unit": UNITS[cap_id], "dailyLimit": 100, "used": 3,
                          "remaining": 97, "resetsAt": int((time.time() // 86400 + 1) * 86400 * 1000)},
            })
        return ok(items)

    @app.get("/api/v1/models")
    async def models():
        return JSONResponse({"object": "list", "data": state.models})

    @app.post("/api/v1/chat/completions")
    async def chat_completions():
        return JSONResponse({"id": "c1", "choices": [{"message": {"role": "assistant", "content": "pong"}}]})

    @app.post("/api/v1/messages")
    async def messages():
        return JSONResponse({"id": "m1", "type": "message", "role": "assistant",
                             "content": [{"type": "text", "text": "pong"}]})

    @app.post("/api/v1/media/images/generations")
    async def images(request: Request):
        body = await request.json()
        count = int(body.get("count") or 1)
        assets = [state.asset_dto(state.add_asset(state.image_bytes, "image/png"), "image") for _ in range(count)]
        return ok({"assets": assets, "failed": 0, "model": "doubao-seedream-5-0-260128", "latencyMs": 5})

    @app.post("/api/v1/media/audio/speech")
    async def speech(request: Request):
        asset_id = state.add_asset(state.speech_bytes, "audio/mpeg")
        return ok({"asset": state.asset_dto(asset_id, "audio"), "voice": "v", "durationMs": 1000})

    @app.post("/api/v1/media/videos/generations")
    async def videos(request: Request):
        body = await request.json()
        state._job_seq += 1
        job_id = f"job{state._job_seq}"
        state.jobs[job_id] = {"id": job_id, "capability": "ai_video", "status": "queued", "phase": None,
                              "model": body.get("model") or "doubao-seedance-2-0-260128",
                              "params": {"promptChars": len(body.get("prompt", ""))},
                              "error": None, "asset": None}
        state.jobs[job_id].update(state.submit_patch)
        return ok({"job": state.jobs[job_id]}, 202)

    @app.get("/api/v1/media/jobs/{job_id}")
    async def job(job_id: str):
        script = state.job_script.get(job_id)
        if script:
            state.jobs[job_id].update(script.pop(0))
        if job_id not in state.jobs:
            return _error(404, "not_found")
        return ok({"job": state.jobs[job_id]})

    def search_handler(kind: str):
        async def handler(request: Request):
            body = await request.json()
            per_page = min(int(body.get("perPage") or 20), LIMITS[f"{kind}_search"]["perPage"]["max"])
            start = int(body.get("cursor") or 0)
            end = min(start + per_page, state.search_total)
            items = [{"id": f"image-{i}" if kind == "image" else str(1000 + i), "description": f"{body.get('query')} {i}", "width": 1920,
                      "height": 1080, "durationMs": 5000, "thumbUrl": f"https://cdn.example/{kind}/{i}-t.jpg",
                      "previewUrl": f"https://cdn.example/{kind}/{i}-p.mp4",
                      "downloadUrl": f"https://cdn.example/{kind}/{i}.mp4", "name": f"{kind} {i}",
                      "tags": ["a"], "license": "CC0", "color": "#112233",
                      "author": {"name": "Ann", "url": "https://cdn.example/ann"},
                      "pageUrl": f"https://cdn.example/page/{i}",
                      "downloadLocation": f"https://cdn.example/dl/{i}"} for i in range(start, end)]
            return ok({"items": items, "total": state.search_total, "hasMore": end < state.search_total,
                       "nextCursor": str(end) if end < state.search_total else None,
                       "attribution": {"source": kind, "text": f"Photos by {kind}", "url": "https://cdn.example"}})
        return handler

    for kind, route in (("image", "images"), ("video", "videos"), ("audio", "sounds")):
        app.post(f"/api/v1/media/search/{route}")(search_handler(kind))

    @app.get("/api/v1/media/assets/{asset_id}")
    async def asset(asset_id: str):
        if asset_id not in state.assets:
            return _error(404, "not_found")
        data, mime = state.assets[asset_id]
        return Response(content=data, media_type=mime)

    return app


class _Server(uvicorn.Server):
    def install_signal_handlers(self) -> None:  # runs in a thread
        return


def start_gateway() -> Tuple[FakeGateway, _Server, threading.Thread]:
    """Start the fake on a free port; the caller stops it with ``server.should_exit``."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    state = FakeGateway(base_url=f"http://127.0.0.1:{port}")
    server = _Server(uvicorn.Config(build_app(state), host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.02)
    return state, server, thread
