"""Credential store + resolver for external integrations.

(setup-wizard-full-capability-coverage §3.2 / §3.3.) This module is the ONLY
place runtime code and the capability probes read integration credentials
from. Resolution order, per field: app database > environment baseline >
code default. Placeholder / empty values count as "layer absent".

Reads are synchronous and I/O free (an in-memory copy-on-write cache), so
worker threads and synchronous service constructors can call them without an
event loop. Writes validate first, persist second and swap the cache last, so
a failed write never leaves a half-applied entry behind.

Zero-secret rule: no value is ever logged, audited or put in an exception
message. Database errors are logged by type only because SQLAlchemy embeds
bound parameters (i.e. the credential) in its messages.
"""

from __future__ import annotations

import asyncio
import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple, Union
from uuid import uuid4

from sqlalchemy import select

from app.constants import LOCAL_OWNER_NAME
from app.database import async_session_factory
from app.logger import get_logger
from app.models.db_models import IntegrationCredential, SettingsAuditLog
from app.services.integration_registry import (
    FieldSpec,
    IntegrationSpec,
    get_spec,
    LEGACY_CREDENTIAL_BASELINES,
)
from app.services.ark_video_profiles import (
    InvalidModelConfiguration, validate_custom_model, validate_model_configuration,
)
from app.services.secret_values import is_placeholder, is_usable_secret

logger = get_logger(__name__)

FieldValue = Union[str, List[str]]

_SECRET_MIN_LENGTH = 8
_SECRET_MAX_LENGTH = 512
_TEXT_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_UNSAFE_CHARS = re.compile(r"[\s\x00-\x1f\x7f]")
_LIST_SEPARATORS = re.compile(r"[\s,;，；]+")


class CredentialValidationError(Exception):
    """A patch value was rejected. ``code`` is a stable API error code.

    The message carries the code and field name only - never the value.
    """

    def __init__(self, code: str, field_name: str) -> None:
        super().__init__(f"{code}: {field_name}")
        self.code = code
        self.field_name = field_name


class UnknownIntegrationError(Exception):
    """The integration id is not in the registry."""

    def __init__(self, integration_id: str) -> None:
        super().__init__(f"unknown integration: {integration_id!r}")
        self.integration_id = integration_id


class IntegrationSaveFailed(Exception):
    """The database write failed; the cache was left unchanged."""

    def __init__(self, integration_id: str) -> None:
        super().__init__(f"integration_save_failed: {integration_id}")
        self.integration_id = integration_id


class IntegrationLoadFailed(Exception):
    """加载状态未知时禁止媒体读写，避免环境回退掩盖数据库故障。"""

    def __init__(self, integration_id: str) -> None:
        self.integration_id = integration_id
        self.code = "integration_load_failed"
        super().__init__(self.code)


@dataclass(frozen=True)
class ResolvedField:
    """One resolved field. ``value``/``values`` are secrets: never log them."""

    name: str
    kind: str
    required: bool
    source: str  # database | environment | default | none
    configured: bool
    count: int = 0
    value: str = field(default="", repr=False)
    values: Tuple[str, ...] = field(default=(), repr=False)
    choices: Tuple[str, ...] = ()


@dataclass(frozen=True)
class ResolvedIntegration:
    """Resolution result of a whole integration."""

    id: str
    fields: Tuple[ResolvedField, ...]
    usable: bool
    source: str  # database | environment | none
    filled_required: int
    total_required: int
    configuration_warning: Optional[str] = None

    def field(self, name: str) -> Optional[ResolvedField]:
        for item in self.fields:
            if item.name == name:
                return item
        return None


def _baseline_reader(spec_field: FieldSpec) -> FieldValue:
    """Read the environment layer of one field (test seam, see §3.2).

    A missing settings attribute reads as empty so stubbed settings objects
    (SimpleNamespace in tests) never raise.
    """
    ref = spec_field.baseline
    is_list = spec_field.kind == "secret_list"
    if ref is None:
        return [] if is_list else ""
    raw: Any = ""
    if ref.settings_attr:
        from app import config as config_module

        raw = getattr(config_module.settings, ref.settings_attr, "")
    if not raw and ref.env_var:
        raw = os.environ.get(ref.env_var, "")
    if is_list:
        if isinstance(raw, str):
            raw = raw.split(",")
        return [item for item in (raw or []) if isinstance(item, str)]
    return raw if isinstance(raw, str) else ""


def _image_environment() -> Tuple[str, bool]:
    spec = get_spec("ark_image").field("api_key")
    current = _baseline_reader(spec)
    if is_usable_secret(current):
        return current.strip(), False
    legacy = _baseline_reader(FieldSpec("api_key", "secret", baseline=LEGACY_CREDENTIAL_BASELINES[0]))
    return (legacy.strip(), True) if is_usable_secret(legacy) else ("", False)


def _clean_list(raw: Any) -> List[str]:
    """Strip, drop placeholders/empties and de-duplicate, keeping order."""
    seen: List[str] = []
    for item in raw or []:
        if not isinstance(item, str):
            continue
        stripped = item.strip()
        if is_usable_secret(stripped) and stripped not in seen:
            seen.append(stripped)
    return seen


def _resolve_scalar(spec_field: FieldSpec, stored: Dict[str, Any]) -> ResolvedField:
    """Resolve a secret/text field: database > environment > default."""
    base = dict(name=spec_field.name, kind=spec_field.kind, required=spec_field.required)
    from_db = stored.get(spec_field.name)
    if isinstance(from_db, str) and is_usable_secret(from_db):
        return ResolvedField(**base, source="database", configured=True, value=from_db.strip())
    from_env = _baseline_reader(spec_field)
    if spec_field.baseline and spec_field.baseline.settings_attr == "ark_image_api_key":
        from_env = _image_environment()[0]
    if isinstance(from_env, str) and is_usable_secret(from_env):
        return ResolvedField(**base, source="environment", configured=True, value=from_env.strip())
    return ResolvedField(**base, source="none", configured=False)


def _resolve_choice(spec_field: FieldSpec, stored: Dict[str, Any]) -> ResolvedField:
    """Resolve a choice field. The default never counts as user-filled."""
    base = dict(
        name=spec_field.name, kind="choice", required=spec_field.required,
        choices=spec_field.choices,
    )
    from_db = stored.get(spec_field.name)
    strict_video = spec_field.baseline and spec_field.baseline.settings_attr.startswith("ark_video_")
    if strict_video and isinstance(from_db, str) and from_db.strip():
        return ResolvedField(**base, source="database", configured=from_db in spec_field.choices, value=from_db)
    if from_db in spec_field.choices:
        return ResolvedField(**base, source="database", configured=True, value=from_db)
    from_env = _baseline_reader(spec_field)
    if strict_video and isinstance(from_env, str) and from_env.strip():
        return ResolvedField(**base, source="environment", configured=from_env in spec_field.choices, value=from_env)
    if from_env in spec_field.choices and from_env != spec_field.default:
        return ResolvedField(**base, source="environment", configured=True, value=from_env)
    return ResolvedField(**base, source="default", configured=True, value=spec_field.default)


def _resolve_list(spec_field: FieldSpec, stored: Dict[str, Any]) -> ResolvedField:
    """Resolve a secret_list field: a stored list replaces the env list."""
    base = dict(name=spec_field.name, kind="secret_list", required=spec_field.required)
    from_db = _clean_list(stored.get(spec_field.name))
    if from_db:
        return ResolvedField(
            **base, source="database", configured=True,
            count=len(from_db), values=tuple(from_db),
        )
    from_env = _clean_list(_baseline_reader(spec_field))
    if from_env:
        return ResolvedField(
            **base, source="environment", configured=True,
            count=len(from_env), values=tuple(from_env),
        )
    return ResolvedField(**base, source="none", configured=False)


def _resolve_field(spec_field: FieldSpec, stored: Dict[str, Any]) -> ResolvedField:
    if spec_field.kind == "choice":
        return _resolve_choice(spec_field, stored)
    if spec_field.kind == "secret_list":
        return _resolve_list(spec_field, stored)
    return _resolve_scalar(spec_field, stored)


def _validate_secret(raw: Any, field_name: str) -> str:
    if not isinstance(raw, str):
        raise CredentialValidationError("credential_malformed", field_name)
    stripped = raw.strip()
    if is_placeholder(stripped):
        raise CredentialValidationError("credential_placeholder", field_name)
    if not _SECRET_MIN_LENGTH <= len(stripped) <= _SECRET_MAX_LENGTH:
        raise CredentialValidationError("credential_malformed", field_name)
    if _UNSAFE_CHARS.search(stripped):
        raise CredentialValidationError("credential_malformed", field_name)
    return stripped


def _validate_text(raw: Any, field_name: str) -> str:
    if not isinstance(raw, str):
        raise CredentialValidationError("credential_malformed", field_name)
    stripped = raw.strip()
    if is_placeholder(stripped):
        raise CredentialValidationError("credential_placeholder", field_name)
    if not _TEXT_PATTERN.match(stripped):
        raise CredentialValidationError("credential_malformed", field_name)
    return stripped


def _validate_list(raw: Any, spec_field: FieldSpec) -> List[str]:
    items = _LIST_SEPARATORS.split(raw) if isinstance(raw, str) else raw
    if not isinstance(items, list):
        raise CredentialValidationError("credential_malformed", spec_field.name)
    cleaned: List[str] = []
    for item in items:
        if isinstance(item, str) and not item.strip():
            continue
        value = _validate_secret(item, spec_field.name)
        if value not in cleaned:
            cleaned.append(value)
    if len(cleaned) > spec_field.max_items:
        raise CredentialValidationError("too_many_values", spec_field.name)
    return cleaned


def _is_clear_request(raw: Any) -> bool:
    if raw is None:
        return True
    if isinstance(raw, str):
        return not raw.strip()
    return isinstance(raw, list) and not any(
        isinstance(item, str) and item.strip() for item in raw
    )


def validate_patch(spec: IntegrationSpec, patch: Dict[str, Any]) -> Dict[str, Any]:
    """Validate one PUT body at the boundary; ``None`` marks "clear this field".

    Raises:
        CredentialValidationError: unknown field, placeholder, malformed
            value, too many list entries or an invalid choice.
    """
    cleaned: Dict[str, Any] = {}
    for name, raw in patch.items():
        spec_field = spec.field(name)
        if spec_field is None:
            raise CredentialValidationError("unknown_field", "unknown_field")
        if _is_clear_request(raw):
            cleaned[name] = None
        elif spec_field.kind == "choice":
            if raw not in spec_field.choices:
                if spec.id == "ark_video":
                    raise InvalidModelConfiguration(name)
                raise CredentialValidationError("invalid_choice", name)
            cleaned[name] = raw
        elif spec_field.kind == "secret_list":
            cleaned[name] = _validate_list(raw, spec_field)
        elif spec.id == "skillrouter" and spec_field.kind in ("text", "secret"):
            cleaned[name] = _validate_skillrouter_field(spec_field, raw)
        elif spec_field.kind == "text":
            cleaned[name] = validate_custom_model(raw) if spec.id == "ark_video" and name == "custom_model" else _validate_text(raw, name)
        else:
            cleaned[name] = _validate_secret(raw, name)
    return cleaned


def _validate_skillrouter_field(spec_field: FieldSpec, raw: Any) -> str:
    """Field rules of the gateway row live in ``skillrouter.validation``
    (lazy import: that package imports this module)."""
    from app.services.skillrouter import validation

    if spec_field.kind == "secret":
        return validation.validate_api_key(raw)
    return validation.validate_text_field(spec_field.name, raw)


class IntegrationCredentialsService:
    """In-memory credential cache with a database write-through."""

    def __init__(self) -> None:
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._locks: Dict[str, asyncio.Lock] = {}
        self.load_failed = False
        self._video_revision = str(uuid4())
        self._video_signature: Optional[Tuple[str, ...]] = None

    def reset(self) -> None:
        """Drop all cached state (test isolation; never called in production)."""
        self._cache = {}
        self._locks = {}
        self.load_failed = False
        self._video_revision = str(uuid4())
        self._video_signature = None

    async def load_all(self) -> None:
        """Fill the cache from the database. Never raises: sets ``load_failed``."""
        from app.services import integration_credential_migration

        try:
            async with async_session_factory() as session:
                rows = (await session.execute(select(IntegrationCredential))).scalars().all()
                current_image = _baseline_reader(get_spec("ark_image").field("api_key"))
                await integration_credential_migration.migrate_media_credentials(
                    session, rows, is_usable_secret(current_image),
                )
                await session.commit()
                rows = (await session.execute(select(IntegrationCredential))).scalars().all()
            self._cache = {
                row.integration_id: dict(row.fields or {})
                for row in rows
                if get_spec(row.integration_id) is not None
            }
            self.load_failed = False
            self._video_revision = str(uuid4())
            self._video_signature = None
        except Exception as error:  # noqa: BLE001 - startup must not abort
            self.load_failed = True
            logger.error(
                "integration credentials load failed: %s", type(error).__name__
            )

    def _stored(self, integration_id: str) -> Dict[str, Any]:
        return self._cache.get(integration_id, {})

    def read(self, integration_id: str, field_name: str) -> FieldValue:
        """Resolved value of one field; list for secret_list, ``""`` if none."""
        self.require_loaded(integration_id)
        spec = get_spec(integration_id)
        spec_field = spec.field(field_name) if spec else None
        if spec_field is None:
            raise UnknownIntegrationError(f"{integration_id}.{field_name}")
        resolved = _resolve_field(spec_field, self._stored(integration_id))
        if spec_field.kind == "secret_list":
            return list(resolved.values)
        return resolved.value

    def value(self, integration_id: str, field_name: str) -> str:
        """Resolved scalar value of one field (``""`` when unavailable)."""
        result = self.read(integration_id, field_name)
        return result if isinstance(result, str) else ""

    def values(self, integration_id: str, field_name: str) -> List[str]:
        """Resolved list of a secret_list field (empty when unavailable)."""
        result = self.read(integration_id, field_name)
        return result if isinstance(result, list) else []

    def resolve(self, integration_id: str) -> ResolvedIntegration:
        """Resolve every field of an integration (no I/O)."""
        spec = get_spec(integration_id)
        if spec is None:
            raise UnknownIntegrationError(integration_id)
        stored = self._stored(integration_id)
        fields = tuple(_resolve_field(item, stored) for item in spec.fields)
        warning = None
        model_valid = True
        if integration_id == "ark_video":
            try:
                validate_model_configuration({item.name: item.value for item in fields})
            except InvalidModelConfiguration:
                warning, model_valid = "invalid_model_configuration", False
        elif integration_id == "ark_image" and fields[0].source == "environment" and _image_environment()[1]:
            warning = "legacy_image_environment"
        if integration_id in ("ark_image", "ark_video") and self.load_failed:
            warning, model_valid = "integration_load_failed", False
        required = [item for item in fields if item.required]
        filled = [item for item in required if item.configured]
        sources = {item.source for item in filled}
        if len(filled) < len(required) or not required:
            source = "none"
        else:
            source = "database" if "database" in sources else "environment"
        return ResolvedIntegration(
            id=integration_id, fields=fields, usable=len(filled) == len(required) and model_valid,
            source=source, filled_required=len(filled), total_required=len(required),
            configuration_warning=warning,
        )

    def require_loaded(self, integration_id: str) -> None:
        """媒体加载失败时不使用缓存或环境值继续运行。"""
        if self.load_failed and integration_id in ("ark_image", "ark_video"):
            raise IntegrationLoadFailed(integration_id)

    def video_config_revision(self) -> str:
        """仅有效视频配置变化时换 UUID；秘密不哈希、不公开。"""
        values = tuple(item.value for item in self.resolve("ark_video").fields)
        if self._video_signature != values:
            self._video_signature = values
            self._video_revision = str(uuid4())
        return self._video_revision

    def is_usable(self, integration_id: str) -> bool:
        """True when every required field has a usable value."""
        return self.resolve(integration_id).usable

    def _lock_for(self, integration_id: str) -> asyncio.Lock:
        lock = self._locks.get(integration_id)
        if lock is None:
            lock = self._locks[integration_id] = asyncio.Lock()
        return lock

    async def save(self, integration_id: str, patch: Dict[str, Any]) -> ResolvedIntegration:
        """Apply a validated patch (omitted = unchanged, ``""``/``None`` = clear).

        Raises:
            UnknownIntegrationError: id not in the registry.
            CredentialValidationError: a field value was rejected (nothing written).
            IntegrationSaveFailed: the database write failed (cache unchanged).
        """
        self.require_loaded(integration_id)
        spec = get_spec(integration_id)
        if spec is None:
            raise UnknownIntegrationError(integration_id)
        cleaned = validate_patch(spec, patch)
        async with self._lock_for(integration_id):
            merged = dict(self._stored(integration_id))
            for name, value in cleaned.items():
                if value is None:
                    merged.pop(name, None)
                else:
                    merged[name] = value
            if integration_id == "ark_video":
                validate_model_configuration({item.name: _resolve_field(item, merged).value for item in spec.fields})
            if integration_id == "skillrouter" and merged.get("mode") == "router":
                if not is_usable_secret(merged.get("api_key")):
                    raise CredentialValidationError("router_key_required", "mode")
            await self._commit(integration_id, merged)
        return self.resolve(integration_id)

    async def clear(self, integration_id: str) -> ResolvedIntegration:
        """Delete the app-level configuration and fall back to the environment."""
        self.require_loaded(integration_id)
        if get_spec(integration_id) is None:
            raise UnknownIntegrationError(integration_id)
        async with self._lock_for(integration_id):
            await self._commit(integration_id, {})
        return self.resolve(integration_id)

    async def _commit(self, integration_id: str, merged: Dict[str, Any]) -> None:
        """Persist ``merged`` then swap the cache (delete the row when empty)."""
        had_row = integration_id in self._cache
        if not merged and not had_row:
            return
        try:
            await self._write_row(integration_id, merged)
        except Exception as error:  # noqa: BLE001 - re-raised as a typed error
            logger.error(
                "integration save failed: id=%s error=%s",
                integration_id, type(error).__name__,
            )
            raise IntegrationSaveFailed(integration_id) from None
        updated = dict(self._cache)
        if merged:
            updated[integration_id] = merged
        else:
            updated.pop(integration_id, None)
        self._cache = updated
        if integration_id == "ark_video":
            self.video_config_revision()
        logger.info(
            "integration credentials updated: id=%s fields=%s",
            integration_id, sorted(merged),
        )

    async def _write_row(self, integration_id: str, merged: Dict[str, Any]) -> None:
        async with async_session_factory() as session:
            row = await session.get(IntegrationCredential, integration_id)
            if not merged:
                action = "delete"
                if row is not None:
                    await session.delete(row)
            elif row is None:
                action = "create"
                session.add(IntegrationCredential(integration_id=integration_id, fields=merged))
            else:
                action = "update"
                row.fields = merged
            session.add(SettingsAuditLog(
                setting_type="integration", category="credentials",
                key=integration_id, action=action, changed_by=LOCAL_OWNER_NAME,
            ))
            await session.commit()


integration_credentials = IntegrationCredentialsService()


ARK_NOT_CONFIGURED_MESSAGE = (
    "The Volcano Ark API key is not configured. Add it in Settings -> "
    "Services & asset libraries."
)


def ark_image_api_key() -> str:
    """当前独立图片凭证；允许图片的遗留环境兼容来源。"""
    return integration_credentials.value("ark_image", "api_key")


def ark_video_api_key() -> str:
    """当前独立视频凭证；永不回退到图片或遗留共享凭证。"""
    return integration_credentials.value("ark_video", "api_key")


class credential_property:  # noqa: N801 - descriptor, lowercase like ``property``
    """Class attribute that reads a credential at call time.

    The getter returns the live resolver value, so saving in the wizard takes
    effect without restarting. The setter stores a per-instance OVERRIDE and is
    a test seam only (existing tests assign ``service.api_key = ""`` to simulate
    "unconfigured"); production code never assigns. Override values are never
    logged. Constructors MUST NOT assign these attributes, otherwise the old
    constructor-time snapshot would silently come back as an override.
    """

    def __init__(self, integration_id: str, field_name: str) -> None:
        self.integration_id = integration_id
        self.field_name = field_name
        self._override_key = f"_cred_override_{field_name}"
        self.__doc__ = (
            f"Live credential {integration_id}.{field_name} (setter = test override)."
        )

    def __get__(self, instance: Any, owner: Any = None) -> Any:
        if instance is None:
            return self
        if self._override_key in instance.__dict__:
            return instance.__dict__[self._override_key]
        return integration_credentials.read(self.integration_id, self.field_name)

    def __set__(self, instance: Any, value: Any) -> None:
        instance.__dict__[self._override_key] = value
