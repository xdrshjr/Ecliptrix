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


# ── agent_host（本机能力层，agent-general-assistant §4.9 / AC-G23） ──────


class TestAgentHostCategory:
    """新设置分类必须**可寻址**：漏登记 CATEGORY_METADATA 会让面板恒 404。"""

    def test_category_is_registered_for_routing(self) -> None:
        from app.routers.system_settings_router import _VALID_CATEGORIES

        assert "agent_host" in _VALID_CATEGORIES

    def test_defaults_cover_every_documented_key(self) -> None:
        from app.services.system_settings_service import AGENT_HOST_DEFAULTS

        assert len(AGENT_HOST_DEFAULTS) == 18

    def test_settings_loader_exposes_effective_roots(self) -> None:
        from app.services.agent_host.settings import agent_host_settings

        values = agent_host_settings()
        # 空数组 → 动态默认根（项目工作区 + 素材根），且**不含** ~ 展开的家目录。
        assert values["host_read_roots"]
        assert values["host_write_roots"]
        assert values["egress_mode"] in {"strict", "balanced", "open"}

    def test_stored_out_of_range_values_are_clamped_on_read(
            self, monkeypatch) -> None:
        """库里的越界值必须在读取时夹回（写入由校验器拒绝）。

        面板与所有闸门都读这一份快照：一条手改过的 `shell_timeout_s=99999`
        若原样漏到执行层，超时等于不存在。
        """
        from app.services import system_settings_service as module
        from app.services.agent_host.settings import agent_host_settings

        monkeypatch.setattr(module.system_settings_service, "get_category",
                            lambda category: {"shell_timeout_s": 99_999})
        assert agent_host_settings()["shell_timeout_s"] == 600


class TestAgentHostValidator:
    @pytest.mark.parametrize("key,value", [
        ("shell_timeout_s", 0),
        ("shell_timeout_s", 601),
        ("shell_max_output_kb", 4),
        ("fs_max_bytes", 512),
        ("egress_max_bytes", 1024),
        ("egress_max_per_turn", 0),
        ("egress_max_per_minute", 1200),
        ("audit_log_retention_days", 0),
    ])
    def test_out_of_range_ints_are_rejected(self, key, value) -> None:
        with pytest.raises(ValueError, match="setting_out_of_range"):
            validate_setting_payload("agent_host", key, value)

    def test_booleans_must_be_strict(self) -> None:
        validate_setting_payload("agent_host", "shell_enabled", True)
        with pytest.raises(ValidationError):
            validate_setting_payload("agent_host", "shell_enabled", "true")

    @pytest.mark.parametrize("mode", ["strict", "balanced", "open"])
    def test_egress_mode_accepts_the_three_tiers(self, mode) -> None:
        validate_setting_payload("agent_host", "egress_mode", mode)

    def test_unknown_egress_mode_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="setting_out_of_range"):
            validate_setting_payload("agent_host", "egress_mode", "yolo")

    def test_shell_scope_is_an_enum(self) -> None:
        validate_setting_payload("agent_host", "shell_scope", "host")
        with pytest.raises(ValueError, match="setting_out_of_range"):
            validate_setting_payload("agent_host", "shell_scope", "root")

    def test_ports_out_of_range_are_rejected(self) -> None:
        validate_setting_payload("agent_host", "egress_allow_ports", [8080])
        with pytest.raises(ValueError, match="setting_out_of_range"):
            validate_setting_payload("agent_host", "egress_allow_ports", [0])
        with pytest.raises(ValueError, match="setting_out_of_range"):
            validate_setting_payload("agent_host", "egress_allow_ports", [70000])

    def test_port_list_length_is_capped(self) -> None:
        with pytest.raises(ValueError, match="setting_out_of_range"):
            validate_setting_payload("agent_host", "egress_allow_ports",
                                     list(range(1, 23)))

    def test_invalid_fnmatch_pattern_is_rejected(self) -> None:
        validate_setting_payload("agent_host", "egress_allow_hosts",
                                 ["*.wikimedia.org"])
        with pytest.raises(ValueError, match="setting_out_of_range"):
            validate_setting_payload("agent_host", "egress_allow_hosts",
                                     ["bad host with spaces"])

    def test_host_roots_must_be_absolute(self) -> None:
        from pathlib import Path as _Path

        validate_setting_payload("agent_host", "host_read_roots",
                                 [str(_Path.cwd())])
        with pytest.raises(ValueError, match="setting_out_of_range"):
            validate_setting_payload("agent_host", "host_read_roots",
                                     ["relative/path"])

    def test_unknown_key_is_reported(self) -> None:
        with pytest.raises(ValueError, match="unknown_host_setting"):
            validate_setting_payload("agent_host", "sudo_mode", True)
