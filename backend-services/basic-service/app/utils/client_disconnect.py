"""Stop a request's work when the HTTP client goes away (AM2-04).

AI mixing and batch video analysis run for minutes (LLM repair rounds,
per-frame VLM calls). When the user cancels, the browser aborts its fetch and
the BFF aborts the upstream request, but a plain FastAPI handler keeps running
to completion. ``run_until_client_disconnects`` cancels the work instead.

Call it only after FastAPI has read the request body (the route declares a
body parameter), so the next ASGI message can only be ``http.disconnect``.
Do not poll ``request.is_disconnected()``: under the packaged starlette 0.27
behind ``BaseHTTPMiddleware`` it never reports the disconnect.

Cancellation lands at the work's next ``await``; synchronous code (cv2 frame
extraction) finishes its current step first. Tokens a model provider already
generated for an in-flight completion may still be billed.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Awaitable, TypeVar

from starlette.requests import Request

from app.logger import get_logger

logger = get_logger(__name__)

T = TypeVar("T")

#: nginx's "client closed request". Only logs see it: the client is gone.
CLIENT_CLOSED_REQUEST_STATUS = 499

_DISCONNECT_MESSAGE_TYPE = "http.disconnect"


class ClientDisconnectedError(Exception):
    """The client closed the connection before the work finished."""


async def _cancel_on_disconnect(request: Request, work: asyncio.Future) -> bool:
    """Wait for the client to disconnect, then cancel ``work``; True when it did."""
    while True:
        try:
            message = await request.receive()
        except Exception as error:
            # The work itself is unaffected; it only loses early cancellation.
            logger.warning(f"Stopped watching for a client disconnect: {error}")
            return False
        if message.get("type") == _DISCONNECT_MESSAGE_TYPE:
            work.cancel()
            return True


async def run_until_client_disconnects(request: Request, work: Awaitable[T]) -> T:
    """Await ``work``; raise ClientDisconnectedError if the client disconnects first."""
    task = asyncio.ensure_future(work)
    watcher = asyncio.ensure_future(_cancel_on_disconnect(request, task))
    try:
        return await task
    except asyncio.CancelledError:
        # The watcher cancels the task and returns in the same step, so it is
        # already done here; any other cancellation belongs to the caller.
        if watcher.done() and not watcher.cancelled() and watcher.result():
            raise ClientDisconnectedError() from None
        raise
    finally:
        watcher.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await watcher
