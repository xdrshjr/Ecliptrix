"""Integration registry: the single source of truth for external credentials.

(setup-wizard-full-capability-coverage §3.1.) Everything that needs to know
"which fields does integration X have" - the resolver, the HTTP router, the
capability probes, the guard test and the frontend contract fixture - reads
this module instead of keeping its own list.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

FIELD_KINDS = ("secret", "secret_list", "text", "choice")
VERIFY_LEVELS = ("free", "handshake", "billed_minimal", "none")


@dataclass(frozen=True)
class BaselineRef:
    """Where the environment layer of a field lives (read lazily, never cached).

    ``settings_attr`` is an attribute of ``app.config.settings`` and
    ``env_var`` is a raw environment variable; the settings attribute wins.
    """

    settings_attr: str = ""
    env_var: str = ""


@dataclass(frozen=True)
class FieldSpec:
    """One credential field of an integration."""

    name: str
    kind: str
    required: bool = False
    default: str = ""
    choices: Tuple[str, ...] = ()
    max_items: int = 1
    baseline: Optional[BaselineRef] = None


@dataclass(frozen=True)
class IntegrationSpec:
    """One credential form: its fields and the capabilities it unlocks."""

    id: str
    name: str
    fields: Tuple[FieldSpec, ...]
    capabilities: Tuple[str, ...]
    verify_level: str

    def field(self, name: str) -> Optional[FieldSpec]:
        for spec in self.fields:
            if spec.name == name:
                return spec
        return None

    @property
    def required_fields(self) -> Tuple[FieldSpec, ...]:
        return tuple(spec for spec in self.fields if spec.required)


_ASR_RESOURCES = (
    "volc.bigasr.sauc.duration",
    "volc.bigasr.sauc.concurrent",
    "volc.seedasr.sauc.duration",
    "volc.seedasr.sauc.concurrent",
)

REGISTRY: Tuple[IntegrationSpec, ...] = (
    IntegrationSpec(
        id="volcano_tts",
        name="Volcano Engine - Speech synthesis",
        fields=(
            FieldSpec(
                "api_key", "secret", required=True,
                baseline=BaselineRef("volcano_tts_api_key"),
            ),
            FieldSpec(
                "resource_id", "choice", default="seed-tts-2.0",
                choices=("seed-tts-2.0", "seed-tts-1.0", "seed-tts-1.0-concurr"),
                baseline=BaselineRef("volcano_tts_resource_id"),
            ),
        ),
        capabilities=("tts",),
        verify_level="billed_minimal",
    ),
    IntegrationSpec(
        id="volcano_asr",
        name="Volcano Engine - Speech recognition (subtitles)",
        fields=(
            FieldSpec(
                "appid", "text", required=True,
                baseline=BaselineRef("volcano_asr_appid"),
            ),
            FieldSpec(
                "access_token", "secret", required=True,
                baseline=BaselineRef("volcano_asr_access_token"),
            ),
            FieldSpec(
                "resource_id", "choice", default=_ASR_RESOURCES[0],
                choices=_ASR_RESOURCES,
                baseline=BaselineRef("volcano_asr_resource_id"),
            ),
        ),
        capabilities=("asr",),
        verify_level="handshake",
    ),
    IntegrationSpec(
        id="volcano_voice_clone",
        name="Volcano Engine - Voice cloning",
        fields=(
            FieldSpec(
                "app_key", "text", required=True,
                baseline=BaselineRef("volcano_voice_clone_app_key"),
            ),
            FieldSpec(
                "access_key", "secret", required=True,
                baseline=BaselineRef("volcano_voice_clone_access_key"),
            ),
            FieldSpec(
                "tts_resource_id", "choice", default="seed-icl-1.0",
                choices=("seed-icl-1.0", "seed-icl-1.0-concurr"),
                baseline=BaselineRef("volcano_voice_clone_tts_resource_id"),
            ),
        ),
        capabilities=("voice_clone",),
        verify_level="none",
    ),
    IntegrationSpec(
        id="ark",
        name="Volcano Ark (Seedream / Seedance)",
        fields=(
            FieldSpec(
                "api_key", "secret", required=True,
                baseline=BaselineRef("ark_api_key", "ARK_API_KEY"),
            ),
        ),
        capabilities=("ai_image", "ai_video"),
        verify_level="free",
    ),
    IntegrationSpec(
        id="pexels",
        name="Pexels (video library)",
        fields=(
            FieldSpec(
                "api_keys", "secret_list", required=True, max_items=5,
                baseline=BaselineRef("pexels_api_keys"),
            ),
        ),
        capabilities=("video_library",),
        verify_level="free",
    ),
    IntegrationSpec(
        id="unsplash",
        name="Unsplash (image library)",
        fields=(
            FieldSpec(
                "access_keys", "secret_list", required=True, max_items=5,
                baseline=BaselineRef(env_var="UNSPLASH_ACCESS_KEYS"),
            ),
        ),
        capabilities=("image_library",),
        verify_level="free",
    ),
    IntegrationSpec(
        id="freesound",
        name="Freesound (sound-effect library)",
        fields=(
            FieldSpec(
                "api_key", "secret", required=True,
                baseline=BaselineRef(env_var="FREESOUND_API_KEY"),
            ),
        ),
        capabilities=("audio_library",),
        verify_level="free",
    ),
)

INTEGRATIONS_BY_ID: Dict[str, IntegrationSpec] = {spec.id: spec for spec in REGISTRY}

#: Capabilities introduced by this registry (all ``extended`` tier).
INTEGRATION_CAPABILITIES: Tuple[str, ...] = tuple(
    capability for spec in REGISTRY for capability in spec.capabilities
)

#: Settings attributes / env vars that are NOT credentials but live next to
#: them; the direct-read guard test treats them as allowed.
NON_CREDENTIAL_SETTINGS = ("volcano_voice_clone_speaker_id_prefix",)


def get_spec(integration_id: str) -> Optional[IntegrationSpec]:
    """Return the spec for ``integration_id`` or ``None`` when unknown."""
    return INTEGRATIONS_BY_ID.get(integration_id)


def capability_integration(capability_id: str) -> Optional[IntegrationSpec]:
    """Return the integration that unlocks ``capability_id``."""
    for spec in REGISTRY:
        if capability_id in spec.capabilities:
            return spec
    return None


def baseline_patterns() -> List[str]:
    """Source snippets the guard test forbids outside the resolver."""
    patterns: List[str] = []
    for spec in REGISTRY:
        for field in spec.fields:
            ref = field.baseline
            if ref is None:
                continue
            if ref.settings_attr:
                patterns.append(f"settings.{ref.settings_attr}")
            if ref.env_var:
                patterns.append(ref.env_var)
    return sorted(set(patterns))


def serialize_registry(provider_preset_ids: List[str]) -> Dict[str, Any]:
    """Frontend contract fixture content (``integrations-schema.json``)."""
    return {
        "integrations": [
            {
                "id": spec.id,
                "capabilities": list(spec.capabilities),
                "verifyLevel": spec.verify_level,
                "fields": [
                    {
                        "name": field.name,
                        "kind": field.kind,
                        "required": field.required,
                        **({"choices": list(field.choices)} if field.choices else {}),
                        **(
                            {"maxItems": field.max_items}
                            if field.kind == "secret_list"
                            else {}
                        ),
                    }
                    for field in spec.fields
                ],
            }
            for spec in REGISTRY
        ],
        "extendedCapabilities": list(INTEGRATION_CAPABILITIES),
        "providerPresetIds": list(provider_preset_ids),
    }
