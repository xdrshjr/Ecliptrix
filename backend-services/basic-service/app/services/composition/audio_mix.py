"""Audio-mix filtergraph builder (spec 05 §2.4 step 5 / §2.5).

PURE filter-string construction — no subprocess, no DOM — so the final
``amix`` semantics (delay-to-start, pad-to-duration, longest mix, trim) are
unit-testable without ffmpeg, AND are the SINGLE source of truth shared with
``video_composition_service._process_audio_tracks`` (the multi-source branch).

Pipeline contract (mirrors the existing audio pipeline exactly):
  - Each source is ALREADY pre-processed before it reaches this builder: its
    per-item / per-track volume has been baked into the source file (the
    pre-processing pass runs ``-af volume=<v>`` per item), and routing has
    already happened upstream — a MUTED track contributes no source, and a
    video clip with ``audio_detached=True`` contributes no embedded-audio
    source (its audio comes from the derived independent audio item instead).
    So this builder does NOT re-apply volume and does NOT re-route; it only
    positions each source on the timeline and mixes.
  - Each source is delayed to its timeline ``start_time`` (``adelay``) and
    padded to the full composition duration (``apad``).
  - All delayed sources feed one ``amix`` (longest duration, dropout
    transition 3, no normalization) trimmed to the composition duration.

This is a literal extraction of the inline mix-filter construction that lived
in ``_process_audio_tracks``; the filter string it emits is byte-for-byte the
string the inline code produced for the same ordered sources (asserted by the
parity test in ``tests/test_audio_mix.py``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

#: Sources one amix command takes. More are mixed in chunks (EX3-04): every
#: ``-i`` costs ~100 command-line characters and Windows caps the line at 32767.
MAX_MIX_INPUTS = 64


def chunk_sources(count: int, max_inputs: int = MAX_MIX_INPUTS) -> List[range]:
    """Consecutive source index ranges covering ``count``, none above ``max_inputs``.

    ``amix normalize=0`` is a plain sum and every chunk is padded to the timeline
    end, so mixing the chunks and then the chunk mixes equals one big mix — as
    long as the chunk files keep float samples (RV3-14).
    """
    if count <= 0:
        return []
    size = max(1, max_inputs)
    return [range(start, min(start + size, count)) for start in range(0, count, size)]


@dataclass(frozen=True)
class AudioSource:
    """One already-pre-processed audio input fed into the mix.

    Volume is already baked into the underlying file and routing (mute /
    ``audio_detached`` drop) has already removed non-contributing sources
    upstream, so only the timeline position is needed here.
    """

    start_time: float


@dataclass(frozen=True)
class AudioMixPlan:
    """Result of planning the mix: the contributing inputs + the filter string."""

    #: Number of ``-i`` inputs the mix consumes, in caller order.
    input_count: int
    #: The ``-filter_complex`` string, or '' when there is nothing to mix.
    filter_complex: str

    @property
    def has_audio(self) -> bool:
        return self.input_count > 0


def build_audio_mix(sources: List[AudioSource], total_duration: float) -> AudioMixPlan:
    """Build the multi-source amix filtergraph over `total_duration` seconds.

    Args:
        sources: ordered, already-pre-processed audio sources (volume baked in,
            non-contributing sources already dropped upstream). The Nth source
            corresponds to ffmpeg input index N.
        total_duration: composition duration in seconds (pad / trim target).

    Returns:
        An :class:`AudioMixPlan`. ``filter_complex`` is '' and ``input_count``
        is 0 when there are no sources to mix.
    """
    if not sources:
        return AudioMixPlan(input_count=0, filter_complex="")

    filter_parts: List[str] = []
    for i, source in enumerate(sources):
        delay_ms = int(source.start_time * 1000)
        if delay_ms > 0:
            filter_parts.append(
                f"[{i}:a]adelay={delay_ms}|{delay_ms},"
                f"apad=pad_dur={total_duration}[delayed{i}]"
            )
        else:
            filter_parts.append(
                f"[{i}:a]apad=pad_dur={total_duration}[delayed{i}]"
            )

    input_labels = [f"[delayed{i}]" for i in range(len(sources))]
    mix_filter = (
        f"{';'.join(filter_parts)};{' '.join(input_labels)}"
        f"amix=inputs={len(sources)}:duration=longest:dropout_transition=3:"
        f"normalize=0,atrim=duration={total_duration}[out]"
    )
    return AudioMixPlan(input_count=len(sources), filter_complex=mix_filter)
