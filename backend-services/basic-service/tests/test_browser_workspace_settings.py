"""browser_workspace 设置类别的五处登记与校验（spec §4.7 / R2-6 / R1-4）。"""
from pathlib import Path

import pytest
import yaml

from app.models.system_settings_models import validate_setting_payload
from app.services import system_settings_service as service

CONFIG = Path(__file__).resolve().parents[1] / "config" / "browser-workspace-config.yaml"


def test_register_1_yaml_matches_defaults():
    loaded = yaml.safe_load(CONFIG.read_text(encoding="utf-8"))["browser_workspace"]
    assert loaded == service.BROWSER_WORKSPACE_DEFAULTS


def test_register_2_service_mapping_and_accessor():
    files = {entry["file"]: entry for entry in service.YAML_TO_DB_MAPPING}
    mapping = files["browser-workspace-config.yaml"]
    assert mapping["root_key"] == "browser_workspace"
    assert {m["db_key"] for m in mapping["mappings"]} == set(service.BROWSER_WORKSPACE_DEFAULTS)
    assert callable(service.browser_workspace_settings)


def test_register_3_validation_branch():
    validate_setting_payload("browser_workspace", "enabled", False)
    validate_setting_payload("browser_workspace", "max_tabs", 12)
    validate_setting_payload("browser_workspace", "search_engine", "baidu")
    validate_setting_payload("browser_workspace", "agent_deny_hosts", ["bank.test"])
    for key, value in [("max_tabs", 13), ("session_cookie_ttl_days", 91),
                       ("agent_profile_mode", "x"), ("enabled", "yes"),
                       ("agent_deny_hosts", ["bad host"]),
                       ("agent_deny_hosts", ["a.test"] * 101)]:
        with pytest.raises(Exception):
            validate_setting_payload("browser_workspace", key, value)


def test_consent_is_not_a_setting():
    """授权只存主进程 profiles.json：任何经设置写授权的尝试都被拒（R1-4）。"""
    for key in ("consent_granted_at", "agent_consent", "consent"):
        with pytest.raises(ValueError):
            validate_setting_payload("browser_workspace", key, 1)


def test_register_4_category_metadata_present():
    from app.routers import system_settings_router as router
    assert "browser_workspace" in {c.name for c in router.CATEGORY_METADATA}
    router._validate_category("browser_workspace")  # 缺登记会 404


def test_read_path_clamps_stale_rows(monkeypatch):
    monkeypatch.setattr(service.system_settings_service, "get_category",
                        lambda name: {"max_tabs": 99, "idle_release_seconds": 1})
    values = service.browser_workspace_settings()
    assert values["max_tabs"] == 12 and values["idle_release_seconds"] == 15
    assert values["search_engine"] == "bing"
