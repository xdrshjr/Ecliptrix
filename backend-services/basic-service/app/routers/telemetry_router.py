"""
Playback telemetry intake (spec 08 §5.1).

Accepts batched events from the v2 playback frontend SDK and writes them to
the structured ``logs/app.log`` stream. No persistent storage: spec 08 §一
explicitly defers Prometheus / Sentry integration.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, status
from pydantic import BaseModel, Field

from app.logger import get_logger

router = APIRouter(prefix="/telemetry", tags=["Telemetry"])
logger = get_logger(__name__)


class PlaybackTelemetryEvent(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    value: Optional[float] = None
    tags: Optional[Dict[str, Any]] = None
    ts: int


class PlaybackTelemetryPayload(BaseModel):
    sessionId: str = Field(..., min_length=1, max_length=128)
    taskId: str = Field(default="", max_length=128)
    flagVariant: str = Field(..., pattern="^(v2|legacy)$")
    userId: Optional[str] = None
    events: List[PlaybackTelemetryEvent]


@router.post("/playback", status_code=status.HTTP_204_NO_CONTENT)
async def ingest_playback_telemetry(payload: PlaybackTelemetryPayload) -> None:
    if not payload.events:
        return None
    # Structured log line per event so any future log shipper can extract
    # them. We keep the message short and rely on extra fields for the
    # metric values.
    for ev in payload.events:
        logger.info(
            "playback.telemetry",
            extra={
                "metric": ev.name,
                "value": ev.value,
                "tags": ev.tags or {},
                "ts": ev.ts,
                "session_id": payload.sessionId,
                "task_id": payload.taskId,
                "flag_variant": payload.flagVariant,
                "user_id": payload.userId,
            },
        )
    return None
