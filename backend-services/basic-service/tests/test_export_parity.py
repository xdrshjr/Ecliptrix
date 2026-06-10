"""Export ↔ preview parity test (spec 05 §6.7).

Parity here is SEMANTIC / PARAMETER alignment, not cross-language pixel diffing
(impractical and out of scope). For a timeline with two overlapping video tracks
+ one dissolve + one subtitle, we assert that the export filtergraph encodes the
SAME values the Phase-2 preview contract (spec 02) produces:

  - z-order = track order (bottom track drawn first, upper overlaid on top);
  - per-clip opacity → the colorchannelmixer `aa` value (the export analogue of
    the compositor's globalAlpha = item.opacity);
  - dissolve overlap-duration == transition.duration (the cross-dissolve window
    that TransitionLayer.alphaFor ramps over);
  - fade alpha at a sample time computed from the SAME arithmetic
    TransitionLayer.alphaFor uses, cross-checked against the ffmpeg fade params.

The preview contract lives in TypeScript (TransitionLayer.alphaFor /
assembleLayers). We re-express its arithmetic here in Python as the parity
oracle and assert the filtergraph parameters imply the identical curve. The
TS source of truth is `src/components/video/playback/TransitionLayer.ts`; any
change there must keep `_preview_alpha_for` below in sync (documented gap: the
two are kept aligned by review + this test, not auto-generated).
"""

from app.models.video_models import ClipTransition, VideoCompositionItem
from app.services.composition.filtergraph_builder import (
    _effective_transition_duration,
    build_filtergraph,
)


# --- Preview-contract oracle (mirror of TransitionLayer.alphaFor, spec 02) ----

TIME_EPSILON = 0.001  # == ClipTimeMapping.TIME_EPSILON / TransitionLayer's epsilon


def _preview_effective_duration(duration, clip_duration):
    """Mirror of TransitionLayer.effectiveDuration (TS)."""
    if not duration or duration <= 0:
        return 0.0
    return min(duration, clip_duration / 2.0)


def _preview_alpha_for(clip_start, clip_duration, fade_in, fade_out, t):
    """Mirror of TransitionLayer.alphaFor (TS) — the preview parity oracle."""
    start = clip_start
    end = clip_start + clip_duration
    if t < start - TIME_EPSILON or t > end + TIME_EPSILON:
        return 0.0
    fade_in_eff = _preview_effective_duration(fade_in, clip_duration)
    fade_out_eff = _preview_effective_duration(fade_out, clip_duration)
    alpha = 1.0
    if fade_in_eff > 0:
        into = t - start
        if into < fade_in_eff - TIME_EPSILON:
            alpha = min(alpha, into / fade_in_eff)
    if fade_out_eff > 0:
        until = end - t
        if until < fade_out_eff - TIME_EPSILON:
            alpha = min(alpha, until / fade_out_eff)
    return max(0.0, min(1.0, alpha))


# --- Parity timeline: two video tracks (overlap) + a dissolve + a subtitle -----


def _build_parity_timeline():
    """Bottom track (full opacity) + top track (opacity 0.5, dissolve)."""
    bottom = VideoCompositionItem(
        id="bottom", name="Bottom", url="/api/storage/files/video/bottom.mp4",
        start_time=0.0, duration=6.0, track_id="t_bottom",
        clip_start=0.0, clip_end=6.0, opacity=1.0, track_z=0,
    )
    top_a = VideoCompositionItem(
        id="top_a", name="TopA", url="/api/storage/files/video/topa.mp4",
        start_time=0.0, duration=4.0, track_id="t_top",
        clip_start=0.0, clip_end=4.0, opacity=0.5, track_z=1,
        transition_out=ClipTransition(type="dissolve", duration=1.0),
    )
    top_b = VideoCompositionItem(
        id="top_b", name="TopB", url="/api/storage/files/video/topb.mp4",
        start_time=3.0, duration=4.0, track_id="t_top",
        clip_start=0.0, clip_end=4.0, opacity=0.5, track_z=1,
        transition_in=ClipTransition(type="dissolve", duration=1.0),
    )
    return [bottom, top_a, top_b]


def test_parity_z_order_matches_track_order():
    clips = _build_parity_timeline()
    result = build_filtergraph(clips, 1920, 1080)
    inputs = result.video_inputs
    # Bottom track (z=0) inputs come before the top track (z=1) inputs — the
    # same bottom→top order the compositor draws (assembleLayers z-ascending).
    assert inputs.index("bottom") < inputs.index("top_a")
    assert inputs.index("bottom") < inputs.index("top_b")
    assert "overlay=" in result.filter_complex


def test_parity_opacity_matches_colorchannelmixer_alpha():
    clips = _build_parity_timeline()
    result = build_filtergraph(clips, 1920, 1080)
    # The top track clips have opacity 0.5 → exactly the aa alpha the overlay
    # blends, mirroring the compositor's globalAlpha = item.opacity.
    assert "colorchannelmixer=aa=0.5" in result.filter_complex
    # The opaque bottom clip is not assigned an alpha multiplier.
    assert result.filter_complex.count("colorchannelmixer=aa=") == 2  # top_a + top_b


def test_parity_dissolve_overlap_equals_transition_duration():
    clips = _build_parity_timeline()
    result = build_filtergraph(clips, 1920, 1080)
    # Cross-dissolve overlap == transition duration (1.0s) — the same window
    # TransitionLayer.alphaFor ramps the two overlapping clips over.
    assert "xfade=transition=fade:duration=1.0" in result.filter_complex


def test_parity_fade_param_implies_preview_alpha_at_sample_time():
    # A single-track fade-in clip; assert the ffmpeg fade window implies the
    # SAME alpha the preview oracle computes at a sample time.
    fade_in = ClipTransition(type="fade", duration=1.0)
    clip = VideoCompositionItem(
        id="solo", name="Solo", url="/api/storage/files/video/solo.mp4",
        start_time=0.0, duration=4.0, track_id="t_top",
        clip_start=0.0, clip_end=4.0, opacity=0.5, track_z=1,
        transition_in=fade_in,
    )
    # Second track so the filtergraph path engages (not concat fallback).
    base = VideoCompositionItem(
        id="base", name="Base", url="/api/storage/files/video/base.mp4",
        start_time=0.0, duration=4.0, track_id="t_bottom",
        clip_start=0.0, clip_end=4.0, opacity=1.0, track_z=0,
    )
    result = build_filtergraph([base, clip], 1920, 1080)

    # ffmpeg fade=t=in:st=0:d=1.0 → alpha ramps 0→1 over [0,1]; at t=0.5 the
    # implied alpha is 0.5 — identical to the preview oracle.
    fade_window = _effective_transition_duration(fade_in, clip.duration)
    sample_t = 0.5
    implied_ffmpeg_alpha = min(1.0, sample_t / fade_window)
    preview_alpha = _preview_alpha_for(
        clip_start=0.0, clip_duration=4.0, fade_in=1.0, fade_out=None, t=sample_t
    )
    assert abs(implied_ffmpeg_alpha - preview_alpha) < 1e-9
    assert "fade=t=in:st=0:d=1.0" in result.filter_complex


def test_parity_effective_duration_matches_preview_clamp():
    # A long fade on a short clip is clamped to half the clip in BOTH the
    # export builder and the preview oracle (no alpha>1 mid-clip).
    long_fade = ClipTransition(type="fade", duration=10.0)
    export_window = _effective_transition_duration(long_fade, clip_duration=4.0)
    preview_window = _preview_effective_duration(10.0, 4.0)
    assert export_window == preview_window == 2.0


def test_parity_subtitle_position_uses_bottom_anchor_convention():
    # Subtitle burn-in is delegated to the existing drawtext chain whose default
    # position is 'bottom' — matching SubtitleLayer's default vAnchor (0.9,
    # i.e. lower portion of the frame). This documents the shared convention;
    # the actual drawtext y-pixel is produced by subtitle_service (reused).
    from app.models.video_models import SubtitleCompositionItem

    subtitle = SubtitleCompositionItem(
        id="s1", name="Caption", text="hello",
        start_time=0.0, duration=4.0, track_id="t_sub",
    )
    # Backend default subtitle position is 'bottom' — the preview SubtitleLayer
    # default vAnchor is 0.9 (bottom). Both anchor captions to the lower frame.
    assert subtitle.position == "bottom"
