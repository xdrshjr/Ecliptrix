"""
Playback telemetry intake (spec 08 §5.1, Phase 4 §3.2.5 / §4.1.3).

Accepts batched events from the v2 playback frontend SDK, validates the
PII shape of ``userId`` (must be the 12-hex-char hash produced by the
client SDK), feeds known metrics into the in-process aggregator, and
writes every event to the structured ``logs/app.log`` stream. Unknown
metric names are still logged (with ``unknown_metric=true``) — never
dropped, so the dashboard can surface "frontend forgot to register".
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Response, status
from pydantic import BaseModel, Field, field_validator

from app.logger import get_logger
from app.services.playback_metrics_aggregator import (
    PlaybackMetricsAggregator,
    get_playback_metrics_aggregator,
)

router = APIRouter(prefix="/telemetry", tags=["Telemetry"])
logger = get_logger(__name__)


_USER_ID_PATTERN = re.compile(r"^[0-9a-fA-F]{12}$")


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

    @field_validator("userId", mode="before")
    @classmethod
    def _strip_invalid_user_id(cls, v: Optional[str]) -> Optional[str]:
        """Drop anything that isn't the SDK-hashed 12-hex form (INV11)."""
        if v is None or v == "":
            return None
        if not isinstance(v, str) or not _USER_ID_PATTERN.match(v):
            return None
        return v.lower()


@router.post(
    "/playback",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def ingest_playback_telemetry(payload: PlaybackTelemetryPayload) -> Response:
    if not payload.events:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    aggregator: PlaybackMetricsAggregator = get_playback_metrics_aggregator()
    for ev in payload.events:
        is_known = PlaybackMetricsAggregator.is_known_metric(ev.name)
        if is_known:
            # Fire-and-forget into the aggregator; await keeps the lock
            # contention bounded (single-process, single-loop).
            try:
                await aggregator.record_event(name=ev.name, value=ev.value)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "playback.telemetry.aggregator_error",
                    extra={
                        "metric": ev.name,
                        "error": str(exc),
                    },
                )
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
                "unknown_metric": (not is_known),
            },
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
