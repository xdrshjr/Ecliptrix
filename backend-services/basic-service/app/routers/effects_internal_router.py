"""Desktop-main-only drain; never proxied by the public effects BFF."""

import asyncio
import hmac
import os

from fastapi import APIRouter, Request

from app.models.effects_models import EffectError
from app.services.effects.job_service import effect_render_service
from .effects_router import response

router = APIRouter(prefix="/effects-internal", tags=["effects-internal"])


@router.post("/drain", include_in_schema=False)
async def drain(request: Request):
    expected = os.getenv("EFFECTS_RUNTIME_TOKEN", "")
    actual = request.headers.get("authorization", "")
    if not expected or not hmac.compare_digest(actual.encode("utf-8"),
                                              ("Bearer " + expected).encode()):
        raise EffectError("EFFECT_NOT_FOUND", status=404)
    try:
        await asyncio.wait_for(effect_render_service.close(), 10)
    except asyncio.TimeoutError as exc:
        raise EffectError("EFFECT_RUNTIME_UNAVAILABLE", status=503) from exc
    return response({"drained": True})
