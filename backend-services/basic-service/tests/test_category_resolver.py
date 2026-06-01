"""
Unit tests for ``resolve_category`` (spec 02 §2.3).

Verifies the load-bearing matching ORDER:
    auth → media_serving → ai_generation → normal

The critical invariant is that ``/api/audio/generated/`` and
``/api/audio/subtitles/`` resolve to ``media_serving`` and are NOT swallowed by
the ``ai_generation`` ``/api/audio/`` prefix that follows. ``/api/ai-mixed-editing``
resolves to ``ai_generation`` (Phase-2 Fix 2). ``/api/auth/validate-session`` is
deliberately ``normal`` (polled by every client; must not share the strict auth
bucket).
"""

from __future__ import annotations

import pytest

from app.services.rate_limiter import (
    CATEGORY_AI_GENERATION,
    CATEGORY_AUTH,
    CATEGORY_MEDIA_SERVING,
    CATEGORY_NORMAL,
    resolve_category,
)


# ---------------------------------------------------------------------------
# auth (exact paths, anti-brute-force, per-IP)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "path",
    ["/api/auth/login", "/api/auth/register"],
)
def test_auth_exact_paths(path):
    assert resolve_category(path) == CATEGORY_AUTH


def test_validate_session_is_not_auth():
    # Polled by every logged-in client → must NOT share the strict auth bucket.
    assert resolve_category("/api/auth/validate-session") == CATEGORY_NORMAL


def test_auth_logout_is_normal():
    assert resolve_category("/api/auth/logout") == CATEGORY_NORMAL


# ---------------------------------------------------------------------------
# media_serving (checked BEFORE ai_generation — critical ordering)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "path",
    [
        "/api/audio/generated/agent-segment-0_concatenated_1.mp3",
        "/api/audio/subtitles/agent-segment-0.srt",
        "/api/storage/files/foo.mp4",
        "/api/storage/files/sub/dir/clip.mov",
        "/static/anything.png",
    ],
)
def test_media_serving_prefixes(path):
    assert resolve_category(path) == CATEGORY_MEDIA_SERVING


def test_audio_generated_not_swallowed_by_ai_audio_prefix():
    """The decisive ordering case: ``/api/audio/generated/`` matches media
    BEFORE the ``/api/audio/`` ai_generation prefix could capture it."""
    assert resolve_category("/api/audio/generated/x.mp3") == CATEGORY_MEDIA_SERVING
    assert resolve_category("/api/audio/subtitles/x.srt") == CATEGORY_MEDIA_SERVING


# ---------------------------------------------------------------------------
# ai_generation (compute / third-party-quota heavy)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "path",
    [
        "/api/audio/transcribe",                 # /api/audio/ NOT generated/subtitles
        "/api/tts/synthesize",
        "/api/llm/chat",
        "/api/ark-video/generate",
        "/api/ark-image/generate",
        "/api/storyboard/create",
        "/api/voice-clone/upload",
        "/api/image-pack/build",
        "/api/image/search",
        "/api/workflow/ai-video-generate",
        "/api/workflow/video-export",
        "/api/video-editing-chat",
        "/api/video-understanding-script",
        "/api/convert-to-script",
    ],
)
def test_ai_generation_prefixes(path):
    assert resolve_category(path) == CATEGORY_AI_GENERATION


def test_ai_mixed_editing_is_ai_generation():
    """Phase-2 Fix 2: long-running AI mixed editing must be ai_generation."""
    assert resolve_category("/api/ai-mixed-editing") == CATEGORY_AI_GENERATION
    assert resolve_category("/api/ai-mixed-editing/run") == CATEGORY_AI_GENERATION


# ---------------------------------------------------------------------------
# normal (the default bucket)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "path",
    [
        "/api/workflow/list",
        "/api/video/search",
        "/api/projects",
        "/api/user/profile",
        "/api/model-settings/providers",
        "/api/system-settings/categories",
        "/api/rate-limit/config",
        "/api/health",
        "/some/unmapped/path",
    ],
)
def test_normal_default(path):
    assert resolve_category(path) == CATEGORY_NORMAL


def test_empty_path_is_normal():
    assert resolve_category("") == CATEGORY_NORMAL


# ---------------------------------------------------------------------------
# Ordering proof: a path matching multiple prefixes resolves to the FIRST in
# the auth → media → ai → normal precedence.
# ---------------------------------------------------------------------------
def test_storage_files_prefix_wins_over_normal():
    assert resolve_category("/api/storage/files/clip.mp4") == CATEGORY_MEDIA_SERVING


def test_only_exact_auth_paths_match_not_prefixes():
    # ``/api/auth/login-attempt`` is NOT the exact ``/api/auth/login`` → normal.
    assert resolve_category("/api/auth/login-attempt") == CATEGORY_NORMAL
