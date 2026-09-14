"""Composition pipeline modules split out of video_composition_service.

Spec 05 §2.5 (D10) decomposes the 2700-line composition service into focused,
unit-testable modules:

- ``media_resolution``  — resolve composition item URLs to local files (cache
  hit / local resolver / explicit non-local error). Reuses
  ``local_media_resolver``; does NOT reimplement the whitelist.
- ``filtergraph_builder`` — build the ``-filter_complex`` canvas graph: a black
  base of the timeline length with each track's contiguous clip runs overlaid
  at their real start times (``eof_action=pass``), fades / dissolves as alpha
  ramps and per-clip opacity. Mirrors the preview compositor (spec 02) so
  export is what-you-see-is-what-you-get.
- ``audio_mix`` — build the amix filtergraph honouring item/track volume, track
  mute, and ``audio_detached`` (detached video tracks contribute no audio).
- ``encode`` — GPU encoder detection + encoding parameter selection.
- ``video_scaling`` — aspect-ratio resolution + per-clip scale/pad filter math
  (letterbox / pillarbox geometry, even-dimension rounding, ``-vf`` builder).
- ``media_download`` — URL classification predicates. Export never downloads
  overlay images: a remote image is reported instead (round 2, EXO-18).
- ``composition_outcome`` — what an export reports besides its file: the
  ``CompositionStageError`` of a stage without a correct fallback, the
  de-duplicated ``degradations`` entries and the per-item losses of the audio
  mix and the image overlay inputs (round 2, S6 / S7).
- ``ffmpeg_args`` — long filter graphs reach FFmpeg through a script file
  instead of the Windows-limited command line (round 2, EXO-05).
- ``camera_motion`` — 2D / 3D camera motion (camera-motion-2d-3d): the Python
  mirror of the frontend math kernel, the FFmpeg ``zoompan`` / ``perspective`` /
  ``rotate`` chain builder injected between ``scale`` and ``pad``, the filter
  capability probe, and the 0.1s dry-run pre-flight that catches bad expressions
  before a 4K transcode starts. Stills reuse all of it through
  ``build_still_overlay_plan`` (camera-motion-stills), the single constructor
  for an image's overlay branch.
"""

from app.services.composition.camera_motion import (  # noqa: F401
    CameraFilterCaps,
    CameraMotionConfig,
    StillOverlayPlan,
    build_camera_filter_chain,
    build_still_overlay_plan,
    contain_fit,
    dry_run_chain,
    load_camera_config,
    probe_camera_filters,
    still_static_chain,
)

__all__ = [
    "CameraFilterCaps",
    "CameraMotionConfig",
    "StillOverlayPlan",
    "build_camera_filter_chain",
    "build_still_overlay_plan",
    "contain_fit",
    "dry_run_chain",
    "load_camera_config",
    "probe_camera_filters",
    "still_static_chain",
]
