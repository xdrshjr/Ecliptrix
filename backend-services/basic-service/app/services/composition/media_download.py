"""URL classification helpers (spec 05 §2.5).

Two pure URL predicates extracted verbatim from VideoCompositionService. The
video download / retry orchestration stays in the service because it is bound
to instance collaborators (youtube_service, ffmpeg path) and is exercised via
instance-method patching in the test suite. Export never downloads images
(EXO-18): remote image URLs are reported as degradations instead.
"""

from __future__ import annotations


def is_youtube_url(url: str) -> bool:
    """Return True when the URL points at YouTube (youtube.com / youtu.be)."""
    return "youtube.com" in url or "youtu.be" in url


def is_pexels_url(url: str) -> bool:
    """Return True when the URL is a Pexels video URL (case-insensitive)."""
    return "pexels.com" in url.lower()
