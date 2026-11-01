"""Guard: runtime code reads integration credentials ONLY via the resolver
(setup-wizard-full-capability-coverage §3.3, E2).

The forbidden patterns are generated from the integration registry, so a new
integration field whose read point was never migrated turns this test red
without anyone having to remember to update it.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import List, Tuple

from app.services.integration_registry import (
    NON_CREDENTIAL_SETTINGS,
    REGISTRY,
)

APP_ROOT = Path(__file__).resolve().parents[1] / "app"
EXEMPT = {"config.py", "integration_registry.py", "integration_credentials_service.py"}


def _forbidden_patterns() -> List[Tuple[str, "re.Pattern[str]"]]:
    patterns: List[Tuple[str, "re.Pattern[str]"]] = []
    for spec in REGISTRY:
        for field in spec.fields:
            ref = field.baseline
            if ref is None:
                continue
            if ref.settings_attr and ref.settings_attr not in NON_CREDENTIAL_SETTINGS:
                patterns.append((
                    f"settings.{ref.settings_attr}",
                    re.compile(rf"\bsettings\.{re.escape(ref.settings_attr)}\b"),
                ))
            if ref.env_var:
                patterns.append((
                    f'env "{ref.env_var}"',
                    re.compile(rf"""["']{re.escape(ref.env_var)}["']"""),
                ))
    return patterns


def _scanned_files() -> List[Path]:
    files = list((APP_ROOT / "services").rglob("*.py"))
    files += list((APP_ROOT / "routers").glob("*.py"))
    return [path for path in files if path.name not in EXEMPT]


def test_patterns_are_generated_from_every_registry_field():
    names = {name for name, _ in _forbidden_patterns()}
    assert "settings.ark_api_key" in names
    assert "settings.volcano_tts_resource_id" in names
    assert "settings.volcano_voice_clone_tts_resource_id" in names
    assert 'env "UNSPLASH_ACCESS_KEYS"' in names
    assert "settings.volcano_voice_clone_speaker_id_prefix" not in names


def test_no_runtime_module_reads_a_credential_directly():
    offenders: List[str] = []
    for path in _scanned_files():
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if line.lstrip().startswith("#"):
                continue
            for name, pattern in _forbidden_patterns():
                if pattern.search(line):
                    offenders.append(f"{path.relative_to(APP_ROOT)}:{number} reads {name}")
    assert offenders == [], (
        "Read credentials through integration_credentials (see "
        "integration_credentials_service.py):\n" + "\n".join(offenders)
    )


def test_the_voice_clone_speaker_prefix_is_the_only_allowed_settings_read():
    source = (APP_ROOT / "services" / "voice_clone_service.py").read_text(encoding="utf-8")
    assert "settings.volcano_voice_clone_speaker_id_prefix" in source
