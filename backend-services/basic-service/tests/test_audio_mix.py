"""Tests for the audio-mix filtergraph builder (spec 05 §6.6).

Pins the multi-source ``amix`` filtergraph: per-source ``adelay`` to the
timeline start, ``apad`` to the full duration, the ``amix`` parameters, and the
final ``atrim``. Volume and routing (track mute, ``audio_detached`` drop) are
applied UPSTREAM in the service (volume baked into each pre-processed file;
muted / detached sources never reach the builder), so they are NOT this
builder's responsibility and are not asserted here.

The final test is an EQUIVALENCE PROOF: it reconstructs the exact inline
mix-filter string the service used to build by hand and asserts the wired
builder emits a byte-for-byte identical string for the same ordered sources.
"""

from app.services.composition.audio_mix import (
    AudioMixPlan,
    AudioSource,
    build_audio_mix,
)


def test_empty_sources_produce_no_mix():
    plan = build_audio_mix([], total_duration=10.0)
    assert plan.has_audio is False
    assert plan.input_count == 0
    assert plan.filter_complex == ""


def test_single_source_at_zero_pads_and_mixes():
    plan = build_audio_mix([AudioSource(start_time=0.0)], total_duration=10.0)
    assert plan.has_audio is True
    assert plan.input_count == 1
    # No delay at start_time 0; padded then single-input amix then trim.
    assert "adelay" not in plan.filter_complex
    assert "[0:a]apad=pad_dur=10.0[delayed0]" in plan.filter_complex
    assert "amix=inputs=1" in plan.filter_complex
    assert "atrim=duration=10.0[out]" in plan.filter_complex


def test_delayed_source_uses_adelay_at_start_time():
    plan = build_audio_mix([AudioSource(start_time=2.5)], total_duration=10.0)
    # 2.5s → 2500ms on both channels.
    assert "[0:a]adelay=2500|2500,apad=pad_dur=10.0[delayed0]" in plan.filter_complex


def test_multiple_sources_mix_with_correct_input_count():
    plan = build_audio_mix(
        [
            AudioSource(start_time=0.0),
            AudioSource(start_time=1.0),
            AudioSource(start_time=2.0),
        ],
        total_duration=12.0,
    )
    assert plan.input_count == 3
    assert "amix=inputs=3" in plan.filter_complex
    # Each labelled stream feeds the amix in order.
    assert "[delayed0] [delayed1] [delayed2]amix" in plan.filter_complex


def test_amix_parameters_match_pipeline_contract():
    plan = build_audio_mix(
        [AudioSource(start_time=0.0), AudioSource(start_time=1.5)],
        total_duration=8.0,
    )
    # The mix is longest-duration, dropout_transition=3, no normalization,
    # trimmed to the composition duration — the exact pipeline parameters.
    assert (
        "amix=inputs=2:duration=longest:dropout_transition=3:normalize=0,"
        "atrim=duration=8.0[out]" in plan.filter_complex
    )


def _inline_mix_filter(processed_audio_paths, actual_total_duration):
    """Verbatim copy of the ORIGINAL inline construction (pre-extraction).

    Kept here as the equivalence oracle: the live builder must emit exactly
    this string for the same ordered sources. Do NOT 'clean up' this helper —
    its value is being a faithful snapshot of the code that was replaced.
    """
    filter_parts = []
    for i, audio_info in enumerate(processed_audio_paths):
        delay_ms = int(audio_info['start_time'] * 1000)
        if delay_ms > 0:
            filter_parts.append(
                f'[{i}:a]adelay={delay_ms}|{delay_ms},'
                f'apad=pad_dur={actual_total_duration}[delayed{i}]'
            )
        else:
            filter_parts.append(
                f'[{i}:a]apad=pad_dur={actual_total_duration}[delayed{i}]'
            )
    input_labels = [f'[delayed{i}]' for i in range(len(processed_audio_paths))]
    return (
        f"{';'.join(filter_parts)};{' '.join(input_labels)}"
        f"amix=inputs={len(processed_audio_paths)}:duration=longest:"
        f"dropout_transition=3:normalize=0,"
        f"atrim=duration={actual_total_duration}[out]"
    )


def test_wired_builder_equals_inline_construction():
    """EQUIVALENCE PROOF: wired build_audio_mix == the replaced inline amix.

    Covers a mix of zero-delay and delayed sources at a realistic duration.
    """
    processed_audio_paths = [
        {'start_time': 0.0},
        {'start_time': 1.0},
        {'start_time': 2.5},
    ]
    actual_total_duration = 12.0

    expected = _inline_mix_filter(processed_audio_paths, actual_total_duration)
    plan: AudioMixPlan = build_audio_mix(
        [AudioSource(start_time=p['start_time']) for p in processed_audio_paths],
        actual_total_duration,
    )
    assert plan.filter_complex == expected


def test_wired_builder_equals_inline_for_single_zero_delay_source():
    """Equivalence at the single-source / zero-delay boundary."""
    processed_audio_paths = [{'start_time': 0.0}]
    actual_total_duration = 5.0
    expected = _inline_mix_filter(processed_audio_paths, actual_total_duration)
    plan = build_audio_mix([AudioSource(start_time=0.0)], actual_total_duration)
    assert plan.filter_complex == expected
