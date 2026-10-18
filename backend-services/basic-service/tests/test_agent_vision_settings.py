"""设置：范围校验、YAML 映射、类别登记、无破坏性 DDL（AC-26 / §6.4）。"""
import re
from pathlib import Path

import pytest

from app.models.system_settings_models import validate_setting_payload
from tests.agent_vision_support import vision_engine  # noqa: F401

APP_ROOT = Path(__file__).resolve().parents[1] / "app"


# ── 范围校验 ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("key,value", [
    ("enabled", True),
    ("probe_enabled", False),
    ("visual_spot_check", True),
    ("max_images_per_call", 6),
    ("max_image_side_px", 768),
    ("max_image_bytes", 409600),
    ("max_input_bytes", 8388608),
    ("frame_sample_count", 4),
    ("daily_call_cap", 120),
    ("daily_image_cap", 400),
    ("request_timeout_seconds", 45),
    ("cache_ttl_days", 0),
    ("probe", {"black_min_seconds": 0.3, "silence_min_seconds": 2.0,
               "loudness_target_lufs": -16, "loudness_tolerance": 4,
               "true_peak_max_dbtp": -1.0}),
])
def test_valid_values_pass(key, value):
    validate_setting_payload("agent_vision", key, value)


@pytest.mark.parametrize("key,value", [
    ("max_images_per_call", 7),
    ("max_image_side_px", 4096),
    ("max_image_bytes", 10),
    ("max_input_bytes", 1024),
    ("frame_sample_count", 0),
    ("daily_call_cap", 0),
    ("daily_image_cap", 99999),
    ("request_timeout_seconds", 5),
    ("cache_ttl_days", 31),
])
def test_out_of_range_is_setting_out_of_range(key, value):
    with pytest.raises(ValueError) as info:
        validate_setting_payload("agent_vision", key, value)
    assert str(info.value) == "setting_out_of_range"


def test_probe_sub_key_out_of_range():
    with pytest.raises(ValueError) as info:
        validate_setting_payload("agent_vision", "probe",
                                 {"black_min_seconds": 99})
    assert str(info.value) == "setting_out_of_range"


def test_unknown_key_is_rejected():
    with pytest.raises(ValueError) as info:
        validate_setting_payload("agent_vision", "lint_max_issues", 20)
    assert str(info.value) == "unknown_vision_setting"


def test_unknown_probe_sub_key_is_rejected():
    with pytest.raises(ValueError) as info:
        validate_setting_payload("agent_vision", "probe", {"nope": 1})
    assert str(info.value) == "unknown_vision_setting"


def test_boolean_must_be_strict():
    with pytest.raises(Exception):
        validate_setting_payload("agent_vision", "enabled", "yes")


# ── 设置合并 ──────────────────────────────────────────────────────────────


def test_settings_merge_probe_block_key_by_key(monkeypatch):
    from app.services import system_settings_service as module

    monkeypatch.setattr(module.system_settings_service, "get_category",
                        lambda category: {"probe": {"black_min_seconds": 1.5}})
    settings = module.agent_vision_settings()
    assert settings["probe"]["black_min_seconds"] == 1.5
    # 未覆盖的子键仍是出厂值（不能整块丢失）。
    assert settings["probe"]["silence_min_seconds"] == 2.0
    assert settings["max_image_side_px"] == 1280


def test_settings_defaults_match_the_yaml_file():
    import yaml

    from app.services import system_settings_service as module

    path = APP_ROOT.parent / "config" / "agent-vision-config.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))["agent_vision"]
    assert set(data) == set(module.AGENT_VISION_DEFAULTS)
    assert data["probe"] == module.AGENT_VISION_DEFAULTS["probe"]


def test_yaml_mapping_registers_every_key():
    from app.services.system_settings_service import (
        AGENT_VISION_DEFAULTS,
        YAML_TO_DB_MAPPING,
    )

    entry = next(item for item in YAML_TO_DB_MAPPING
                 if item["file"] == "agent-vision-config.yaml")
    assert entry["root_key"] == "agent_vision"
    keys = {mapping["db_key"] for mapping in entry["mappings"]}
    assert keys == set(AGENT_VISION_DEFAULTS)
    assert all(mapping["category"] == "agent_vision"
               for mapping in entry["mappings"])


def test_category_is_registered_for_the_settings_router():
    """不登记即 404（第二轮 R-03 的教训）。"""
    from app.routers.system_settings_router import (
        CATEGORY_METADATA,
        _VALID_CATEGORIES,
    )

    assert "agent_vision" in _VALID_CATEGORIES
    assert any(item.name == "agent_vision" for item in CATEGORY_METADATA)


# ── ORM / DDL ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_new_tables_are_created_by_create_all(vision_engine):
    from sqlalchemy import inspect

    async with vision_engine() as session:
        names = await session.run_sync(
            lambda sync: set(inspect(sync.get_bind()).get_table_names()))
    assert {"agent_vision_observations", "agent_vision_usage"} <= names


def test_init_db_imports_the_new_models_before_create_all():
    """AC-26：模型模块必须在 `create_all` 之前 import，否则表不建。"""
    source = (APP_ROOT / "database.py").read_text(encoding="utf-8")
    init_body = source.split("async def init_db", 1)[1]
    assert init_body.index("agent_vision_db_models") < init_body.index(
        "create_all")


def test_no_destructive_ddl_in_vision_sources():
    """AC-26：源码里不得出现 DROP/ALTER 语句（注释与 __pycache__ 除外）。"""
    targets = [
        APP_ROOT / "models" / "agent_vision_db_models.py",
        APP_ROOT / "models" / "agent_vision_models.py",
        APP_ROOT / "services" / "agent_vision",
        APP_ROOT / "routers" / "agent_vision_router.py",
    ]
    pattern = re.compile(r"\b(DROP\s+TABLE|DROP\s+COLUMN|ALTER\s+TABLE)\b",
                         re.IGNORECASE)
    offenders = []
    for target in targets:
        files = ([target] if target.is_file()
                 else list(target.rglob("*.py")))
        for path in files:
            for number, line in enumerate(
                    path.read_text(encoding="utf-8").splitlines(), start=1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if pattern.search(line):
                    offenders.append(f"{path.name}:{number}")
    assert offenders == []
