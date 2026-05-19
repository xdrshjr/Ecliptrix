"""URL / local-path guards for external-process callers.

Spec: ``docs/plans/high-risk-security-fixes/specs/03-external-process-injection.md``.

This module gives the rest of the backend a single place to fence off SSRF
and local-file-read footguns before user-controlled strings are handed to
``yt-dlp``, ``ffmpeg``, or the media/preview proxy.

Two entry points:

* :func:`validate_external_url` — for anything that goes out over the
  network. Enforces ``http``/``https`` scheme, rejects userinfo
  (``user:pass@host``), DNS-resolves the host and refuses private /
  loopback / link-local / reserved addresses, plus a small belt-and-braces
  blocklist for common SSRF targets (``localhost``, cloud metadata hosts).
* :func:`validate_local_path_for_ffmpeg` — for anything fed to ffmpeg as a
  local input. Rejects ``file://`` / ``http(s)://`` schemes outright and
  forces the resolved path to live inside one of the caller-supplied
  allow-listed roots (with symlink targets re-checked).

Two convenience constants are exported for callers that build ``ffmpeg``
command lines:

* :data:`FFMPEG_REMOTE_PROTOCOL_WHITELIST` — ``"http,https,tcp,tls,crypto"``
  for commands whose input is a validated remote URL.
* :data:`FFMPEG_LOCAL_PROTOCOL_WHITELIST` — ``"file,crypto,pipe"`` for
  commands whose input is a validated local path. **Never** mix the two on
  the same invocation (see spec §3.4).

Toggle ``URL_GUARD_ALLOW_PRIVATE=1`` (mirrored on
``settings.url_guard_allow_private``) to bypass the private-IP check in
local dev; production must leave it off.
"""

from __future__ import annotations

import ipaddress
import os
import socket
from pathlib import Path
from typing import Iterable, Optional, Sequence
from urllib.parse import urlparse, urlunparse

# Reasonable default to keep DNS resolution from stalling request handlers.
# Each getaddrinfo call is wrapped in this budget via ``socket.setdefaulttimeout``
# inside :func:`_resolve_addresses` (Python doesn't expose a per-call timeout).
_DNS_TIMEOUT_SECONDS = 5.0

# FFmpeg protocol allow-lists. Spec §3.4 mandates a strict split:
#   - remote commands MUST NOT include ``file`` (no local read after SSRF).
#   - local-path commands MUST NOT include ``http(s)`` (no exfil channel).
FFMPEG_REMOTE_PROTOCOL_WHITELIST = "http,https,tcp,tls,crypto"
FFMPEG_LOCAL_PROTOCOL_WHITELIST = "file,crypto,pipe"

ALLOWED_SCHEMES = frozenset({"http", "https"})

# Hostnames that should never be reachable through user-controlled URLs even
# if DNS happens to point them at a public IP (defensive belt-and-braces;
# DNS resolution would normally short-circuit these too).
_BLOCKED_HOSTS = frozenset(
    {
        "localhost",
        "localhost.localdomain",
        "ip6-localhost",
        "ip6-loopback",
        "metadata",
        "metadata.google.internal",
        "metadata.aws.amazonaws.com",
        "169.254.169.254",
        "100.100.100.200",  # Alibaba Cloud ECS metadata
        "fd00:ec2::254",    # AWS IMDSv6
    }
)


class URLGuardError(ValueError):
    """Raised when a URL or local path fails defensive validation.

    Callers in router layers should convert this into a 400/403 HTTP
    response; service layers should let it propagate so the router handler
    can render the error envelope.
    """


# ---------------------------------------------------------------------------
# External URL validation
# ---------------------------------------------------------------------------


def _allow_private_override() -> bool:
    """Return True when the dev-only private-IP bypass is active.

    Checked once per call (not cached) so tests can monkeypatch the env
    var. We prefer the env var over the settings object because url_guard
    is imported by ``app.security`` before ``app.config.settings`` is
    fully built in some import orders.
    """
    raw = os.getenv("URL_GUARD_ALLOW_PRIVATE", "")
    if raw and raw.lower() in {"1", "true", "yes", "on"}:
        return True
    # Soft import — avoids a hard dependency on settings during early boot.
    try:
        from app.config import settings  # type: ignore

        return bool(getattr(settings, "url_guard_allow_private", False))
    except Exception:  # noqa: BLE001
        return False


def _resolve_addresses(host: str, port: Optional[int]) -> list[str]:
    """Return all resolved IPs for ``host`` (IPv4 + IPv6).

    Uses ``socket.getaddrinfo`` with the global socket timeout temporarily
    set; this lets us cap DNS round-trip without dragging async DNS into
    every caller. Resolution failure raises :class:`URLGuardError` so the
    router layer can return a 400.
    """
    # Literal IPs short-circuit DNS — getaddrinfo would still resolve them
    # but doing it ourselves makes the failure mode unambiguous.
    try:
        return [str(ipaddress.ip_address(host))]
    except ValueError:
        pass

    prev = socket.getdefaulttimeout()
    socket.setdefaulttimeout(_DNS_TIMEOUT_SECONDS)
    try:
        infos = socket.getaddrinfo(host, port or 80, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise URLGuardError(f"DNS lookup failed for host '{host}': {exc}") from exc
    except OSError as exc:  # timeout shows up here on some platforms
        raise URLGuardError(f"DNS lookup error for host '{host}': {exc}") from exc
    finally:
        socket.setdefaulttimeout(prev)

    if not infos:
        raise URLGuardError(f"DNS returned no records for host '{host}'")
    # ``sockaddr[0]`` is the IP for both AF_INET and AF_INET6.
    return [info[4][0] for info in infos]


def _is_unsafe_ip(addr: str) -> bool:
    """Return True if ``addr`` falls in any disallowed range.

    Covers private (RFC1918 + ULA), loopback, link-local, multicast,
    reserved, and unspecified ranges. The ``ipaddress`` stdlib already
    bakes these classifications in, so we don't re-implement them by hand.
    """
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        # If we somehow ended up with a non-IP string here, treat it as
        # unsafe rather than silently allowing.
        return True
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def validate_external_url(
    url: str,
    *,
    allow_redirects_resolved: bool = True,  # noqa: ARG001 — kept for spec parity
    allow_schemes: Optional[Iterable[str]] = None,
) -> str:
    """Validate ``url`` is a safe external HTTP(S) target.

    Returns the (lightly-normalized) URL on success; raises
    :class:`URLGuardError` on any failure mode. Calls DNS so it can block
    deliberate misconfigurations where the hostname is publicly registered
    but resolves to a private IP (a classic SSRF dodge).

    ``allow_redirects_resolved`` is currently informational — yt-dlp and
    ffmpeg both follow redirects internally so we cannot intercept them
    here. Mitigation is documented in spec §7 (DNS rebinding caveat).
    """
    if not isinstance(url, str) or not url.strip():
        raise URLGuardError("URL is empty or not a string")
    raw = url.strip()
    if len(raw) > 4096:
        raise URLGuardError("URL exceeds maximum length")

    # ``urlparse`` does not raise on most malformed input, so we validate
    # each component ourselves below.
    try:
        parsed = urlparse(raw)
    except Exception as exc:  # pragma: no cover - defensive
        raise URLGuardError(f"unparseable URL: {exc}") from exc

    schemes = frozenset(s.lower() for s in (allow_schemes or ALLOWED_SCHEMES))
    scheme = (parsed.scheme or "").lower()
    if scheme not in schemes:
        raise URLGuardError(
            f"scheme '{scheme or '(none)'}' not allowed; expected one of {sorted(schemes)}"
        )

    # ``user:pass@host`` is a classic SSRF vector for credential reflection
    # against same-origin admin endpoints. Reject outright.
    if parsed.username or parsed.password or "@" in (parsed.netloc or ""):
        raise URLGuardError("URLs with embedded credentials are not allowed")

    host = (parsed.hostname or "").strip().lower()
    if not host:
        raise URLGuardError("URL has no host component")

    # Strip the trailing dot some attackers add to bypass naive host
    # comparisons (DNS treats ``localhost.`` and ``localhost`` identically).
    normalized_host = host.rstrip(".")
    if normalized_host in _BLOCKED_HOSTS:
        raise URLGuardError(f"host '{normalized_host}' is on the SSRF block-list")

    # IPv6 literals come back from ``hostname`` already stripped of brackets,
    # but we keep checking via the address parser below.
    if not _allow_private_override():
        for ip_str in _resolve_addresses(normalized_host, parsed.port):
            if _is_unsafe_ip(ip_str):
                raise URLGuardError(
                    f"host '{normalized_host}' resolves to disallowed address {ip_str}"
                )

    # Canonical form — lower-case scheme/host, preserve path/query/fragment
    # exactly so downstream signing or query parameters survive.
    normalized = urlunparse(
        (
            scheme,
            parsed.netloc.lower() if parsed.hostname else parsed.netloc,
            parsed.path or "",
            parsed.params or "",
            parsed.query or "",
            parsed.fragment or "",
        )
    )
    return normalized


# ---------------------------------------------------------------------------
# Local path validation
# ---------------------------------------------------------------------------


def validate_local_path_for_ffmpeg(
    path: str,
    allowed_roots: Sequence[os.PathLike[str] | str],
    *,
    must_exist: bool = True,
) -> Path:
    """Validate ``path`` is a local file safely inside one of ``allowed_roots``.

    Rejects any ``file://`` / ``http(s)://`` / other scheme prefix, then
    resolves the path (following symlinks) and asserts the result is
    contained within at least one ``allowed_roots`` entry (also resolved).

    ``must_exist`` defaults to True because ffmpeg invocations always read
    an existing input — set False only for tests or for output-path checks.
    """
    if not isinstance(path, str) or not path.strip():
        raise URLGuardError("local path is empty or not a string")
    raw = path.strip()

    # Reject all explicit URL schemes. ``foo://`` is the canonical
    # giveaway; even ``file://`` localhost paths are forbidden because the
    # ffmpeg call should use the bare path so we can apply
    # -protocol_whitelist file,... and lock everything else out.
    lower = raw.lower()
    for forbidden in ("file:", "http:", "https:", "ftp:", "rtsp:", "rtmp:",
                      "gopher:", "data:", "blob:", "javascript:"):
        if lower.startswith(forbidden):
            raise URLGuardError(
                f"local path must not include URL scheme prefix '{forbidden}'"
            )

    # NUL bytes can be used to truncate paths in C extensions reading the
    # value (yt-dlp / ffmpeg shell out to libavformat).
    if "\x00" in raw:
        raise URLGuardError("local path contains NUL byte")

    candidate = Path(raw)
    try:
        resolved = candidate.resolve(strict=must_exist)
    except FileNotFoundError as exc:
        raise URLGuardError(f"local path does not exist: {raw}") from exc
    except (OSError, RuntimeError) as exc:
        raise URLGuardError(f"failed to resolve local path '{raw}': {exc}") from exc

    if must_exist and not resolved.exists():
        raise URLGuardError(f"local path does not exist: {resolved}")

    # ``Path.is_relative_to`` was added in 3.9; we target 3.10+ per CLAUDE.md
    # so it's safe to use directly.
    if not allowed_roots:
        raise URLGuardError("validate_local_path_for_ffmpeg requires at least one allowed root")

    for root in allowed_roots:
        try:
            root_resolved = Path(root).resolve()
        except (OSError, RuntimeError):
            # Skip a root that can't be resolved; another might still match.
            continue
        try:
            if resolved.is_relative_to(root_resolved):
                return resolved
        except AttributeError:  # pragma: no cover - py<3.9 fallback
            try:
                resolved.relative_to(root_resolved)
                return resolved
            except ValueError:
                continue

    raise URLGuardError(
        f"local path '{resolved}' is outside the allowed roots: "
        f"{[str(Path(r).resolve()) for r in allowed_roots]}"
    )
