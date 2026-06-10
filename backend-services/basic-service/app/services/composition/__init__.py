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
"""
