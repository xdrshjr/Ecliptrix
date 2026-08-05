"""Composition pipeline modules split out of video_composition_service.

Spec 05 §2.5 (D10) decomposes the 2700-line composition service into focused,
unit-testable modules:

- ``media_resolution``  — resolve composition item URLs to local files (cache
  hit / local resolver / explicit non-local error). Reuses
  ``local_media_resolver``; does NOT reimplement the whitelist.
- ``filtergraph_builder`` — build the ``-filter_complex`` graph: per-track clip
  trim/setpts, intra-track transitions (fade/xfade), inter-track overlay by
  z-order with per-clip opacity, subtitle burn-in. Mirrors the preview
  compositor (spec 02) so export is what-you-see-is-what-you-get.
- ``audio_mix`` — build the amix filtergraph honouring item/track volume, track
  mute, and ``audio_detached`` (detached video tracks contribute no audio).
- ``encode`` — GPU encoder detection + encoding parameter selection.
- ``video_scaling`` — aspect-ratio resolution + per-clip scale/pad filter math
  (letterbox / pillarbox geometry, even-dimension rounding, ``-vf`` builder).
- ``subtitle_prep`` — SRT serialization helpers (timestamp formatting + writing
  subtitle items to an SRT file) for the subtitle burn-in pass.
- ``media_download`` — URL classification predicates + standalone image fetch
  used by the overlay path.
- ``camera_motion`` — 2D / 3D camera motion (camera-motion-2d-3d): the Python
  mirror of the frontend math kernel, the FFmpeg ``zoompan`` / ``perspective`` /
  ``rotate`` chain builder injected between ``scale`` and ``pad``, the filter
  capability probe, and the 0.1s dry-run pre-flight that catches bad expressions
  before a 4K transcode starts.
"""
