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
- ``camera_motion`` — the 2D/3D 运镜 geometry kernel: the Python twin of
  ``CameraMotionLayer.ts``, compared against it on a frozen golden-vector
  fixture. Geometry only; nothing FFmpeg-shaped lives here.
- ``camera_motion_filters`` — turns that geometry into ``perspective``
  expressions (registers, raster corner order, transparent backdrop). Imports
  ``camera_motion``; never the reverse.
- ``ffmpeg_caps`` — per-binary capability probe driving the camera-motion
  degradation ladder, cached for the process lifetime.
"""
