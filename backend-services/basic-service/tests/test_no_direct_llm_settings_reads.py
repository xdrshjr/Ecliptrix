"""Guard: runtime code reads LLM configuration ONLY via model_settings_service
(SkillRouter spec §4.1, same idea as ``test_no_direct_credential_reads.py``).

A service that reads ``settings.llm_*`` directly ignores the model-settings
panel in manual mode and the gateway in router mode. Everything must resolve at
call time through ``model_settings_service`` (``llm_call_config`` is the thin
helper for services). ``model_settings_service.py`` is the resolver itself and
``config.py`` defines the fields; both are exempt.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import List, Tuple

APP_ROOT = Path(__file__).resolve().parents[1] / "app"
EXEMPT = {"model_settings_service.py"}

_GROUPS = r"(?:llm|fast_llm|vl_llm|video_cut_llm|research_llm)"
_ENV_GROUPS = r"(?:LLM|FAST_LLM|VL_LLM|VIDEO_CUT_LLM|RESEARCH_LLM)"
_FORBIDDEN: List[Tuple[str, "re.Pattern[str]"]] = [
    ("settings.<llm field>", re.compile(rf"\b\w*settings\w*(?:\(\))?\.{_GROUPS}_\w+")),
    ("getattr(settings, '<llm field>')",
     re.compile(rf"""getattr\(\s*\w*settings\w*\s*,\s*["']{_GROUPS}_""")),
    ("environment variable",
     re.compile(rf"""["']{_ENV_GROUPS}_(?:API_KEY|API_URL|MODEL|API_TYPE)["']""")),
]


def _scanned_files() -> List[Path]:
    files = list((APP_ROOT / "services").rglob("*.py"))
    files += list((APP_ROOT / "routers").rglob("*.py"))
    return [path for path in files if path.name not in EXEMPT]


def _violations() -> List[str]:
    found: List[str] = []
    for path in _scanned_files():
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if line.lstrip().startswith("#"):
                continue
            for label, pattern in _FORBIDDEN:
                if pattern.search(line):
                    found.append(f"{path.relative_to(APP_ROOT)}:{number} [{label}] {line.strip()}")
    return found


def test_no_service_or_router_reads_llm_settings_directly():
    violations = _violations()
    assert not violations, (
        "Resolve LLM config through model_settings_service / llm_call_config "
        "(at call time), never settings.*llm*:\n" + "\n".join(violations)
    )


def test_guard_patterns_catch_the_forms_it_is_meant_to_forbid():
    samples = [
        "key = settings.llm_api_key",
        "url = get_settings().fast_llm_api_url",
        "model = self.settings.video_cut_llm_model",
        'getattr(settings, "vl_llm_api_url")',
        'os.getenv("LLM_API_KEY")',
        "os.environ['VIDEO_CUT_LLM_API_URL']",
    ]
    for sample in samples:
        assert any(p.search(sample) for _, p in _FORBIDDEN), sample


def test_guard_ignores_unrelated_settings_and_prose():
    clean = [
        "root = settings.storage.root",
        "key = settings.ark_image_api_key",
        'raise ValueError("VL_LLM_API_KEY and VL_LLM_API_URL must be set")',
        'os.getenv("CODING_LLM_API_URL")',
    ]
    for sample in clean:
        assert not any(p.search(sample) for _, p in _FORBIDDEN), sample


def test_exempt_resolver_is_the_only_reader():
    resolver = (APP_ROOT / "services" / "model_settings_service.py").read_text(encoding="utf-8")
    assert "settings.llm_api_url" in resolver  # the guard's whitelist is not vacuous
