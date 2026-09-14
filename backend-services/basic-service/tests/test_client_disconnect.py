"""Work stops when the HTTP client disconnects (AM2-04).

The helper listens with ``request.receive()``: under the packaged starlette
0.27 behind ``BaseHTTPMiddleware``, ``request.is_disconnected()`` never sees
the disconnect. The receive channel is driven by events, never by sleeps.
"""

import asyncio

import pytest
from starlette.requests import Request

from app.utils.client_disconnect import (
    ClientDisconnectedError,
    run_until_client_disconnects,
)


def _request(disconnect: asyncio.Event) -> Request:
    """A request whose ASGI receive reports a disconnect once ``disconnect`` is set."""

    async def receive():
        await disconnect.wait()
        return {"type": "http.disconnect"}

    scope = {"type": "http", "method": "POST", "path": "/", "headers": []}
    return Request(scope, receive)


@pytest.mark.asyncio
async def test_work_is_cancelled_when_client_disconnects():
    disconnect = asyncio.Event()
    started = asyncio.Event()
    never_finishes = asyncio.Event()
    outcome = {}

    async def work():
        started.set()
        try:
            await never_finishes.wait()
        except asyncio.CancelledError:
            outcome["cancelled"] = True
            raise

    runner = asyncio.ensure_future(
        run_until_client_disconnects(_request(disconnect), work())
    )
    await started.wait()
    disconnect.set()

    with pytest.raises(ClientDisconnectedError):
        await runner
    assert outcome == {"cancelled": True}


@pytest.mark.asyncio
async def test_result_is_returned_when_client_stays_connected():
    stays_connected = asyncio.Event()

    async def work():
        return 42

    result = await run_until_client_disconnects(_request(stays_connected), work())

    assert result == 42
