"""
Tests for the per-category settings validators introduced for Bug #3
(web-bug-report-20260509-iter2).

The router now calls `validate_setting_payload(category, key, value)` before
mutating the DB. Out-of-range values must be rejected with HTTP 422; valid
values pass through. This file exercises the validator directly so the tests
can run without spinning up the full FastAPI app + DB.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.system_settings_models import (
    CATEGORY_KEY_VALIDATORS,
    TTSConcurrency,
    TTSLimits,
    TTSLoggingConfig,
    TTSRetry,
    validate_setting_payload,
)


# ── Direct validator behavior ──


class TestTTSConcurrency:
    def test_valid_values_pass(self) -> None:
        TTSConcurrency.model_validate({
            "concurrent_threads": 4,
            "max_concurrent_threads": 8,
            "request_timeout": 30,
            "batch_timeout": 300,
        })

    def test_concurrent_threads_too_high_rejected(self) -> None:
        with pytest.raises(ValidationError) as exc:
            TTSConcurrency.model_validate({
                "concurrent_threads": 99,
                "max_concurrent_threads": 8,
                "request_timeout": 30,
                "batch_timeout": 300,
            })
        assert any(
            "concurrent_threads" in (err.get("loc") or ())
            for err in exc.value.errors()
        )

    def test_request_timeout_too_low_rejected(self) -> None:
        with pytest.raises(ValidationError):
            TTSConcurrency.model_validate({
                "concurrent_threads": 4,
                "max_concurrent_threads": 8,
                "request_timeout": 0,
                "batch_timeout": 300,
            })

    def test_extra_fields_allowed(self) -> None:
        # Templates may add new fields ahead of validators — declared bounds
        # only, no rejection of unknown sub-keys.
        TTSConcurrency.model_validate({
            "concurrent_threads": 4,
            "max_concurrent_threads": 8,
            "request_timeout": 30,
            "batch_timeout": 300,
            "future_field_we_have_not_seen_yet": "anything",
        })


class TestTTSLimits:
    def test_max_segments_per_batch_above_cap_rejected(self) -> None:
        with pytest.raises(ValidationError):
            TTSLimits.model_validate({
                "max_segments_per_batch": 99999,
                "max_text_length_per_segment": 5000,
                "max_total_text_length": 100000,
            })

    def test_within_bounds_passes(self) -> None:
        TTSLimits.model_validate({
            "max_segments_per_batch": 50,
            "max_text_length_per_segment": 5000,
            "max_total_text_length": 100000,
        })


class TestTTSRetry:
    def test_max_attempts_negative_rejected(self) -> None:
        with pytest.raises(ValidationError):
            TTSRetry.model_validate({
                "max_attempts": -1,
                "delay_seconds": 5,
                "backoff_factor": 2,
            })

    def test_zero_attempts_allowed(self) -> None:
        TTSRetry.model_validate({
            "max_attempts": 0,
            "delay_seconds": 5,
            "backoff_factor": 2,
        })


class TestTTSLogging:
    def test_log_level_must_be_known(self) -> None:
        with pytest.raises(ValidationError):
            TTSLoggingConfig.model_validate({
                "enable_detailed_logs": True,
                "log_progress_interval": 10,
                "log_level": "TRACE",
            })

    def test_known_log_levels_pass(self) -> None:
        for level in ("DEBUG", "INFO", "WARNING", "ERROR"):
            TTSLoggingConfig.model_validate({
                "enable_detailed_logs": False,
                "log_progress_interval": 10,
                "log_level": level,
            })


# ── Dispatch via the public helper used by the router ──


class TestValidateSettingPayload:
    def test_unknown_category_is_noop(self) -> None:
        # A category we have not registered must not raise — keeps the
        # validator additive so panels can ship before bounds are declared.
        validate_setting_payload("not_a_real_category", "anything", {"x": 1})

    def test_unknown_key_within_known_category_is_noop(self) -> None:
        # 'voices' is intentionally unvalidated server-side — make sure
        # passing arbitrary content does not raise.
        validate_setting_payload("tts", "voices", [{"id": "v1"}])

    def test_known_key_with_invalid_value_raises(self) -> None:
        with pytest.raises(ValidationError):
            validate_setting_payload(
                "tts",
                "limits",
                {
                    "max_segments_per_batch": 99999,
                    "max_text_length_per_segment": 5000,
                    "max_total_text_length": 100000,
                },
            )

    def test_known_key_with_valid_value_passes(self) -> None:
        validate_setting_payload(
            "tts",
            "limits",
            {
                "max_segments_per_batch": 100,
                "max_text_length_per_segment": 5000,
                "max_total_text_length": 100000,
            },
        )

    def test_non_dict_value_for_known_key_raises_value_error(self) -> None:
        with pytest.raises(ValueError):
            validate_setting_payload("tts", "limits", "not-a-dict")


class TestValidatorRegistry:
    def test_tts_validators_registered(self) -> None:
        tts = CATEGORY_KEY_VALIDATORS.get("tts")
        assert tts is not None
        for key in ("concurrency", "retry", "limits", "logging"):
            assert key in tts, f"missing validator for tts.{key}"
