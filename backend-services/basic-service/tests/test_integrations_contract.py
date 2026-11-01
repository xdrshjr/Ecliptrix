"""Backend <-> frontend contract (setup-wizard-full-capability-coverage §3.1,
§3.2, §7.2).

The registry is serialised into a version-controlled fixture the frontend
tests read, and one placeholder sample table drives BOTH the Python and the
TypeScript predicate. Either side drifting turns a test red on that side.

Regenerate the schema fixture after a deliberate registry change with
``UPDATE_INTEGRATION_FIXTURE=1 pytest tests/test_integrations_contract.py``.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from app.services.integration_registry import (
    INTEGRATION_CAPABILITIES,
    REGISTRY,
    serialize_registry,
)
from app.services.model_settings_service import model_settings_service
from app.services.secret_values import is_usable_secret

FIXTURES = Path(__file__).resolve().parents[3] / "src" / "lib" / "api" / "__fixtures__"
SCHEMA_FIXTURE = FIXTURES / "integrations-schema.json"
SAMPLES_FIXTURE = FIXTURES / "placeholder-samples.json"


def _current_schema() -> dict:
    preset_ids = [item.id for item in model_settings_service.get_providers()]
    return serialize_registry(preset_ids)


def test_registry_matches_the_frontend_schema_fixture():
    current = _current_schema()
    if os.environ.get("UPDATE_INTEGRATION_FIXTURE") == "1":
        SCHEMA_FIXTURE.write_text(
            json.dumps(current, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    committed = json.loads(SCHEMA_FIXTURE.read_text(encoding="utf-8"))
    assert committed == current, (
        "integrations-schema.json is stale; rerun with UPDATE_INTEGRATION_FIXTURE=1 "
        "and update the frontend i18n / link / group tables to match."
    )


def test_the_fixture_lists_all_ten_provider_presets():
    committed = json.loads(SCHEMA_FIXTURE.read_text(encoding="utf-8"))
    assert len(committed["providerPresetIds"]) == 10


def test_every_extended_capability_belongs_to_exactly_one_integration():
    owners = [c for spec in REGISTRY for c in spec.capabilities]
    assert sorted(owners) == sorted(INTEGRATION_CAPABILITIES)
    assert len(set(owners)) == len(owners) == 8


def test_secret_fields_are_never_marked_with_a_default():
    for spec in REGISTRY:
        for field in spec.fields:
            if field.kind in ("secret", "secret_list", "text"):
                assert field.default == "", f"{spec.id}.{field.name}"


def test_placeholder_sample_table_agrees_with_the_python_predicate():
    samples = json.loads(SAMPLES_FIXTURE.read_text(encoding="utf-8"))
    assert len(samples) >= 14
    values = {row["value"]: row["usable"] for row in samples}
    # The cases the review (RV2-03) singled out must be in the shared table.
    assert values["your_volcano_tts_api_key"] is False
    assert values["your_llm_api_key_here"] is False
    assert values["<your-key>"] is False
    assert values["change-me"] is False
    assert values["sk-test-secret-123"] is True
    assert any("EXAMPLE" in value and usable for value, usable in values.items())
    mismatches = [
        row["value"] for row in samples if is_usable_secret(row["value"]) != row["usable"]
    ]
    assert mismatches == []


@pytest.mark.parametrize("blank", [None, "", "   "])
def test_blank_values_are_never_usable(blank):
    assert is_usable_secret(blank) is False
