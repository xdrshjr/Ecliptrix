"""
Unit tests for the media-proxy service helpers (spec 05 §四 / §八).

Live HTTP / FastAPI exercise lives in
``tests/test_media_proxy_integration.py`` which boots httpx mocks; the
helpers covered here are pure-Python and need no event loop.
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

from app.config import MediaProxyConfig
from app.services.media_proxy_service import (
    MediaProxyError,
    MediaProxyService,
    _is_private_ip,
    _match_wildcard,
)


def _build_config(**overrides) -> MediaProxyConfig:
    base = MediaProxyConfig(
        allowed_domains=[
            "*.pexels.com",
            "*.unsplash.com",
            "ark-content-generation*.tos-cn-*.volces.com",
        ],
        signed_url_domains=["ark-content-generation*.tos-cn-*.volces.com"],
        fetch_timeout_seconds=10,
        upstream_connect_timeout_seconds=2,
        max_size_mb=4,
        concurrent_downloads=4,
        hot_cache_dir="static/uploads/cached_materials",
        enable_http=False,
        per_ip_rate_limit_per_min=5,
        stream_chunk_size=4096,
    )
    return base.model_copy(update=overrides)


class _StubMaterialService:
    """Minimum surface used by MediaProxyService in these tests."""

    def __init__(self) -> None:
        self.stored: list[tuple[str, str, str, str]] = []

    async def store_external_download_async(
        self, url: str, local_path: str, source: str, source_id: str
    ) -> None:
        self.stored.append((url, local_path, source, source_id))

    async def lookup_async(self, **_kwargs):
        return None


@pytest.fixture
def proxy_service(tmp_path) -> MediaProxyService:
    cfg = _build_config(hot_cache_dir=str(tmp_path / "hot"))
    return MediaProxyService(config=cfg, material_service=_StubMaterialService())


# ---------------------------------------------------------------------------
# wildcard host matching
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "pattern,host,expected",
    [
        ("*.pexels.com", "videos.pexels.com", True),
        ("*.pexels.com", "PEXELS.COM", False),
        ("*.pexels.com", "pexels.com", False),
        ("ark-content-generation*.tos-cn-*.volces.com",
         "ark-content-generation-shanghai.tos-cn-shanghai.volces.com", True),
        ("ark-content-generation*.tos-cn-*.volces.com",
         "other-prefix.tos-cn-cn.volces.com", False),
        ("foo.com", "foo.com", True),
        ("*", "anything.com", False),  # bare star always rejected
        ("", "foo.com", False),
    ],
)
def test_match_wildcard(pattern, host, expected):
    assert _match_wildcard(pattern, host) is expected


# ---------------------------------------------------------------------------
# SSRF — private IP detection
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "addr,expected",
    [
        ("127.0.0.1", True),
        ("10.1.2.3", True),
        ("192.168.0.1", True),
        ("172.16.5.5", True),
        ("169.254.169.254", True),
        ("::1", True),
        ("fc00::1", True),
        ("8.8.8.8", False),
        ("203.0.113.7", False),
        ("not-an-ip", True),  # parse error treated as unsafe
    ],
)
def test_is_private_ip(addr, expected):
    assert _is_private_ip(addr) is expected


# ---------------------------------------------------------------------------
# resolve_target — URL validation + classification
# ---------------------------------------------------------------------------


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_resolve_target_rejects_non_whitelisted_host(proxy_service):
    async def _go():
        with pytest.raises(MediaProxyError) as excinfo:
            await proxy_service.resolve_target("https://malicious.example.com/foo.mp4")
        assert excinfo.value.status_code == 403
        assert excinfo.value.error_code == "proxy.domain_not_allowed"

    asyncio.new_event_loop().run_until_complete(_go())


def test_resolve_target_rejects_plain_http_when_disabled(proxy_service):
    async def _go():
        with pytest.raises(MediaProxyError) as excinfo:
            await proxy_service.resolve_target("http://videos.pexels.com/foo.mp4")
        assert excinfo.value.status_code == 400

    asyncio.new_event_loop().run_until_complete(_go())


def test_resolve_target_classifies_pexels(proxy_service):
    async def _go():
        with patch(
            "app.services.media_proxy_service.asyncio.get_running_loop"
        ) as mock_loop:
            # Pretend DNS returns a public address.
            class _FakeLoop:
                async def getaddrinfo(self, host, port, type):
                    return [(None, None, None, None, ("203.0.113.10", 0))]

            mock_loop.return_value = _FakeLoop()
            t = await proxy_service.resolve_target(
                "https://videos.pexels.com/12345/foo.mp4"
            )
            assert t.source == "pexels"
            assert t.source_id == "12345"
            assert t.is_signed is False
            assert t.resolved_ip == "203.0.113.10"

    asyncio.new_event_loop().run_until_complete(_go())


def test_resolve_target_rejects_private_ip(proxy_service):
    async def _go():
        class _FakeLoop:
            async def getaddrinfo(self, host, port, type):
                return [(None, None, None, None, ("10.0.0.1", 0))]

        with patch(
            "app.services.media_proxy_service.asyncio.get_running_loop",
            return_value=_FakeLoop(),
        ):
            with pytest.raises(MediaProxyError) as excinfo:
                await proxy_service.resolve_target(
                    "https://videos.pexels.com/12345/foo.mp4"
                )
        assert excinfo.value.status_code == 403

    asyncio.new_event_loop().run_until_complete(_go())


def test_resolve_target_marks_signed_domain(proxy_service):
    async def _go():
        class _FakeLoop:
            async def getaddrinfo(self, host, port, type):
                return [(None, None, None, None, ("203.0.113.10", 0))]

        with patch(
            "app.services.media_proxy_service.asyncio.get_running_loop",
            return_value=_FakeLoop(),
        ):
            t = await proxy_service.resolve_target(
                "https://ark-content-generation-shanghai.tos-cn-shanghai.volces.com/"
                "cgt-abc/video.mp4?sig=xxx"
            )
        assert t.is_signed is True
        assert t.source == "ark"
        assert t.source_id == "cgt-abc"

    asyncio.new_event_loop().run_until_complete(_go())


# ---------------------------------------------------------------------------
# rate limiting
# ---------------------------------------------------------------------------


def test_rate_limit_blocks_after_threshold(proxy_service):
    async def _go():
        for _ in range(proxy_service.config.per_ip_rate_limit_per_min):
            await proxy_service.check_rate_limit("1.2.3.4")
        with pytest.raises(MediaProxyError) as excinfo:
            await proxy_service.check_rate_limit("1.2.3.4")
        assert excinfo.value.status_code == 429
        # Different IP is still allowed.
        await proxy_service.check_rate_limit("9.9.9.9")

    asyncio.new_event_loop().run_until_complete(_go())


# ---------------------------------------------------------------------------
# cache path + local URL derivation
# ---------------------------------------------------------------------------


def test_cache_path_for_safe_filename(proxy_service):
    from app.services.media_proxy_service import ProxyTarget

    target = ProxyTarget(
        raw_url="https://videos.pexels.com/12345/foo bar.mp4",
        normalized_url="https://videos.pexels.com/12345/foo bar.mp4",
        host="videos.pexels.com",
        resolved_ip="203.0.113.10",
        source="pexels",
        source_id="12345!@#",
        is_signed=False,
    )
    cache_path = proxy_service.cache_path_for(target)
    assert cache_path.suffix == ".mp4"
    # Source-id punctuation stripped.
    assert "12345" in cache_path.name
    assert "!" not in cache_path.name


def test_local_url_for_target(proxy_service):
    from app.services.media_proxy_service import ProxyTarget

    target = ProxyTarget(
        raw_url="https://videos.pexels.com/12345/foo.mp4",
        normalized_url="https://videos.pexels.com/12345/foo.mp4",
        host="videos.pexels.com",
        resolved_ip="203.0.113.10",
        source="pexels",
        source_id="12345",
        is_signed=False,
    )
    url = proxy_service.local_url_for_target(target, "12345.mp4")
    assert url == "/api/storage/files/cached_materials/pexels/12345.mp4"
