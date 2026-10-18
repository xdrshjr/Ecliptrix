"""
Service for managing system settings stored in PostgreSQL.

Provides an in-memory cache for fast synchronous reads and async write-through
to the database. Handles hot-reload by updating the cache immediately after DB writes.

Audit logging is integrated — every mutation records a SettingsAuditLog entry.
"""

import os
import copy
from typing import Any, Dict, List, Optional

import yaml
from sqlalchemy import select
from pydantic import BaseModel

from app.models.db_models import SystemSetting, SettingsAuditLog
from app.database import async_session_factory
from app.logger import get_logger

logger = get_logger(__name__)


# ── Pydantic response model for API consumption ──

class SystemSettingInternal(BaseModel):
    """Internal response model for a single system setting (service layer).

    Includes id and category fields for internal use. The API-level
    SystemSettingResponse in system_settings_models.py is a slimmed-down
    version without these fields.
    """
    id: str
    category: str
    key: str
    value: Any
    default_value: Any
    value_type: str
    description: Optional[str] = None
    updated_at: Optional[str] = None
    updated_by: Optional[str] = None


# ── YAML-to-DB mapping ──
# Maps each YAML config file to (yaml_root_key, [(yaml_section, db_category, db_key), ...])
# yaml_root_key is the top-level key in the YAML file (None if keys are at root level)

RESEARCH_DEFAULTS = {
    "enabled": True, "browser_enabled": True, "downloads_enabled": True,
    "respect_robots": True, "use_research_model": False,
    # v2 评审裁定：默认 128000 与被替代的 agent.ts 硬编码持平，
    # 不得借本设计把既有纯剪辑回合的默认上下文静默减半（R-V2-04）。
    "context_window_tokens": 128000,
    # 研究模型独立窗口，默认 32768 与整合输入推导上限匹配（R-V2-03）。
    "research_context_window_tokens": 32768,
    "global_concurrency": 3, "max_sources": 4,
    "proxy_mode": "auto", "custom_proxy_url": "",
    "artifact_retention_days": 7, "tavily_api_keys": None,
}


def research_settings():
    """未保存键使用出厂值；None 凭证表示继承 env。"""
    values = RESEARCH_DEFAULTS.copy()
    values.update(system_settings_service.get_category("web_research"))
    return values


YAML_TO_DB_MAPPING: List[Dict[str, Any]] = [
    {"file": "web-research-config.yaml", "root_key": "web_research",
     "mappings": [{"yaml_keys": [key], "category": "web_research",
                   "db_key": key, "is_nested": True, "scalar": True,
                   "value_type": "scalar", "description": key}
                  for key in RESEARCH_DEFAULTS]},
    {
        "file": "batch_tts_config.yaml",
        "root_key": "batch_tts",
        "mappings": [
            {
                "yaml_keys": ["concurrent_threads", "max_concurrent_threads", "request_timeout", "batch_timeout"],
                "category": "tts",
                "db_key": "concurrency",
                "value_type": "object",
                "description": "TTS concurrent processing and timeout settings",
            },
            {
                "yaml_keys": ["retry"],
                "category": "tts",
                "db_key": "retry",
                "value_type": "object",
                "description": "TTS retry configuration",
                "is_nested": True,
            },
            {
                "yaml_keys": ["logging"],
                "category": "tts",
                "db_key": "logging",
                "value_type": "object",
                "description": "TTS logging configuration",
                "is_nested": True,
            },
            {
                "yaml_keys": ["limits"],
                "category": "tts",
                "db_key": "limits",
                "value_type": "object",
                "description": "TTS resource limits",
                "is_nested": True,
            },
        ],
    },
    {
        "file": "batch_tts_config.yaml",
        "root_key": "voice_types",
        "mappings": [
            {
                "yaml_keys": ["volcano"],
                "extract_path": "voices",
                "category": "tts",
                "db_key": "voices",
                "value_type": "array",
                "description": "TTS voice list (Volcano engine voices)",
            },
        ],
    },
    {
        "file": "youtube.yaml",
        "root_key": None,
        "mappings": [
            {"yaml_keys": ["download"], "category": "youtube", "db_key": "download", "value_type": "object", "description": "YouTube download configuration", "is_nested": True},
            {"yaml_keys": ["upload"], "category": "youtube", "db_key": "upload", "value_type": "object", "description": "YouTube upload configuration", "is_nested": True},
            {"yaml_keys": ["quality"], "category": "youtube", "db_key": "quality", "value_type": "object", "description": "YouTube quality configuration", "is_nested": True},
            {"yaml_keys": ["file_management"], "category": "youtube", "db_key": "file_management", "value_type": "object", "description": "YouTube file management configuration", "is_nested": True},
            {"yaml_keys": ["logging"], "category": "youtube", "db_key": "logging", "value_type": "object", "description": "YouTube logging configuration", "is_nested": True},
        ],
    },
    {
        "file": "upload-config.yaml",
        "root_key": None,
        "mappings": [
            {"yaml_keys": ["concurrent_upload"], "category": "upload", "db_key": "concurrent_upload", "value_type": "object", "description": "Concurrent upload settings", "is_nested": True},
            {"yaml_keys": ["file_size_limits"], "category": "upload", "db_key": "file_size_limits", "value_type": "object", "description": "File size limits", "is_nested": True},
            {"yaml_keys": ["retry"], "category": "upload", "db_key": "retry", "value_type": "object", "description": "Upload retry configuration", "is_nested": True},
            {"yaml_keys": ["thumbnail"], "category": "upload", "db_key": "thumbnail", "value_type": "object", "description": "Thumbnail generation configuration", "is_nested": True},
            {"yaml_keys": ["temp_file_management"], "category": "upload", "db_key": "temp_file_management", "value_type": "object", "description": "Temporary file management configuration", "is_nested": True},
            {"yaml_keys": ["logging"], "category": "upload", "db_key": "logging", "value_type": "object", "description": "Upload logging configuration", "is_nested": True},
        ],
    },
    {
        "file": "watermark_removal_config.yaml",
        "root_key": "watermark_removal",
        "mappings": [
            {
                "yaml_keys": ["concurrent_threads", "max_concurrent_threads", "batch_size", "batch_timeout"],
                "category": "watermark",
                "db_key": "removal",
                "value_type": "object",
                "description": "Watermark removal processing configuration",
            },
            {
                "yaml_keys": ["logging"],
                "category": "watermark",
                "db_key": "logging",
                "value_type": "object",
                "description": "Watermark removal logging configuration",
                "is_nested": True,
            },
        ],
    },
    {
        "file": "video-analysis-config.yaml",
        "root_key": None,
        "mappings": [
            {"yaml_keys": ["queue_management"], "category": "video_analysis", "db_key": "queue_management", "value_type": "object", "description": "Video analysis queue management configuration", "is_nested": True},
            {"yaml_keys": ["vlm_processing"], "category": "video_analysis", "db_key": "vlm_processing", "value_type": "object", "description": "VLM processing configuration", "is_nested": True},
            {"yaml_keys": ["frame_extraction"], "category": "video_analysis", "db_key": "frame_extraction", "value_type": "object", "description": "Frame extraction configuration with duration-based strategy", "is_nested": True},
            {"yaml_keys": ["performance"], "category": "video_analysis", "db_key": "performance", "value_type": "object", "description": "Video analysis performance configuration", "is_nested": True},
            {"yaml_keys": ["temp_files"], "category": "video_analysis", "db_key": "temp_files", "value_type": "object", "description": "Video analysis temporary file configuration", "is_nested": True},
            {"yaml_keys": ["logging"], "category": "video_analysis", "db_key": "logging", "value_type": "object", "description": "Video analysis logging configuration", "is_nested": True},
        ],
    },
]


class SystemSettingsService:
    """Service for managing system settings with in-memory cache and DB persistence.

    Cache structure: Dict[category, Dict[key, value]]
    Example:
        {
            "tts": {
                "concurrency": {"concurrent_threads": 3, ...},
                "voices": [...],
            },
            "youtube": {
                "download": {"max_concurrent_downloads": 20, ...},
            },
        }
    """

    def __init__(self):
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._loaded: bool = False

    # ── Cache loading ──

    async def load_all(self) -> None:
        """Load all settings from database into in-memory cache. Called at startup."""
        async with async_session_factory() as session:
            stmt = select(SystemSetting)
            result = await session.execute(stmt)
            settings = result.scalars().all()

        self._cache.clear()
        for setting in settings:
            if setting.category not in self._cache:
                self._cache[setting.category] = {}
            self._cache[setting.category][setting.key] = setting.value

        self._loaded = True
        total_keys = sum(len(v) for v in self._cache.values())
        logger.info(f"System settings loaded: {len(self._cache)} categories, {total_keys} keys")

    # ── Synchronous cache reads ──

    def get(self, category: str, key: str) -> Any:
        """Get a setting value from cache (synchronous).

        Returns None if category/key not found.
        """
        return self._cache.get(category, {}).get(key)

    def get_category(self, category: str) -> Dict[str, Any]:
        """Get all settings for a category from cache (synchronous).

        Returns empty dict if category not found.
        """
        return copy.deepcopy(self._cache.get(category, {}))

    # ── Async reads with metadata ──

    async def get_all(self) -> Dict[str, Dict[str, Any]]:
        """Get all settings. Loads from DB if not yet cached."""
        if not self._loaded:
            await self.load_all()
        return copy.deepcopy(self._cache)

    async def get_settings_by_category(self, category: str) -> List[SystemSettingInternal]:
        """Get all settings for a category with full metadata (for API responses)."""
        async with async_session_factory() as session:
            stmt = select(SystemSetting).where(SystemSetting.category == category)
            result = await session.execute(stmt)
            settings = result.scalars().all()

        return [
            SystemSettingInternal(
                id=str(s.id),
                category=s.category,
                key=s.key,
                value=s.value,
                default_value=s.default_value,
                value_type=s.value_type or "object",
                description=s.description,
                updated_at=s.updated_at.isoformat() if s.updated_at else None,
                updated_by=s.updated_by,
            )
            for s in settings
        ]

    # ── Mutations ──

    async def update_setting(self, category: str, key: str, value: Any, updated_by: str = "system") -> SystemSettingInternal:
        """Update a single setting: write DB -> refresh cache -> audit log.

        Raises ValueError if category+key not found.
        """
        async with async_session_factory() as session:
            stmt = select(SystemSetting).where(
                SystemSetting.category == category,
                SystemSetting.key == key,
            )
            result = await session.execute(stmt)
            setting = result.scalar_one_or_none()

            if not setting:
                raise ValueError(f"Setting not found: {category}.{key}")

            setting.value = value
            setting.updated_by = updated_by
            await session.commit()
            await session.refresh(setting)

            response = SystemSettingInternal(
                id=str(setting.id),
                category=setting.category,
                key=setting.key,
                value=setting.value,
                default_value=setting.default_value,
                value_type=setting.value_type or "object",
                description=setting.description,
                updated_at=setting.updated_at.isoformat() if setting.updated_at else None,
                updated_by=setting.updated_by,
            )

        # Refresh cache immediately
        if category not in self._cache:
            self._cache[category] = {}
        self._cache[category][key] = value

        # Audit log
        await self._log_audit("system_setting", category, key, "update", updated_by)

        # Sync to config.py Settings object for hot-reload
        await self.sync_to_settings_key(category, key, value)

        logger.info(f"Setting updated: {category}.{key} by {updated_by}")
        return response

    async def update_category(self, category: str, settings: Dict[str, Any], updated_by: str = "system") -> List[SystemSettingInternal]:
        """Batch update multiple settings within a category."""
        results = []
        for key, value in settings.items():
            try:
                result = await self.update_setting(category, key, value, updated_by)
                results.append(result)
            except ValueError:
                logger.warning(f"Skipping unknown setting during batch update: {category}.{key}")
        return results

    async def reset_to_defaults(self, category: str, updated_by: str = "system") -> List[SystemSettingInternal]:
        """Reset all settings in a category to their default values."""
        async with async_session_factory() as session:
            stmt = select(SystemSetting).where(SystemSetting.category == category)
            result = await session.execute(stmt)
            settings = result.scalars().all()

            responses = []
            for setting in settings:
                setting.value = setting.default_value
                setting.updated_by = updated_by

            await session.commit()

            # Refresh all
            for setting in settings:
                await session.refresh(setting)
                responses.append(SystemSettingInternal(
                    id=str(setting.id),
                    category=setting.category,
                    key=setting.key,
                    value=setting.value,
                    default_value=setting.default_value,
                    value_type=setting.value_type or "object",
                    description=setting.description,
                    updated_at=setting.updated_at.isoformat() if setting.updated_at else None,
                    updated_by=setting.updated_by,
                ))

        # Refresh cache — always initialize category dict even if load_all() wasn't called
        cat_cache = self._cache.setdefault(category, {})
        for resp in responses:
            cat_cache[resp.key] = resp.value

        # Audit log
        await self._log_audit("system_setting", category, None, "reset", updated_by)

        # Sync to config.py
        for resp in responses:
            await self.sync_to_settings_key(category, resp.key, resp.value)

        logger.info(f"Reset category '{category}' to defaults by {updated_by}")
        return responses

    async def reset_all_to_defaults(self, updated_by: str = "system") -> None:
        """Reset ALL settings to their default values."""
        async with async_session_factory() as session:
            stmt = select(SystemSetting)
            result = await session.execute(stmt)
            settings = result.scalars().all()

            for setting in settings:
                setting.value = setting.default_value
                setting.updated_by = updated_by

            await session.commit()

        # Reload entire cache
        await self.load_all()

        # Audit log
        await self._log_audit("system_setting", None, None, "reset", updated_by)

        # Sync all to config.py
        await self.sync_all_to_settings()

        logger.info(f"All settings reset to defaults by {updated_by}")

    # ── Default value seeding ──

    async def ensure_defaults_seeded(self) -> int:
        """Read YAML configs and insert missing settings with default values.

        Returns the number of newly inserted settings.
        Uses ON CONFLICT DO NOTHING for idempotency.
        """
        config_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'config')
        inserted_count = 0

        for file_group in YAML_TO_DB_MAPPING:
            yaml_path = os.path.join(config_dir, file_group["file"])
            yaml_data = self._load_yaml(yaml_path)
            if not yaml_data:
                logger.warning(f"YAML config file not found or empty: {file_group['file']}")
                continue

            root_key = file_group.get("root_key")
            source_data = yaml_data.get(root_key, {}) if root_key else yaml_data

            if not source_data:
                continue

            for mapping in file_group["mappings"]:
                category = mapping["category"]
                db_key = mapping["db_key"]
                value_type = mapping.get("value_type", "object")
                description = mapping.get("description", "")
                is_nested = mapping.get("is_nested", False)

                # Extract value from YAML
                if is_nested:
                    # Single nested key like "retry", "logging"
                    yaml_section_key = mapping["yaml_keys"][0]
                    value = source_data.get(yaml_section_key, {})
                elif mapping.get("extract_path"):
                    # Extract a sub-path (e.g., volcano.voices)
                    yaml_section_key = mapping["yaml_keys"][0]
                    nested = source_data.get(yaml_section_key, {})
                    value = nested.get(mapping["extract_path"], [])
                else:
                    # Multiple flat keys aggregated into a single object
                    value = {}
                    for k in mapping["yaml_keys"]:
                        if k in source_data:
                            value[k] = source_data[k]

                if not value and value != [] and not mapping.get("scalar"):
                    continue

                # Upsert: insert new rows, update default_value + description on existing rows.
                # This ensures version upgrades propagate new YAML defaults to the DB
                # while preserving user-configured `value`.
                async with async_session_factory() as session:
                    dialect = session.bind.dialect.name if session.bind else "postgresql"

                    if dialect == "sqlite":
                        # SQLite: use simple INSERT OR IGNORE + separate UPDATE for default_value
                        existing = await session.execute(
                            select(SystemSetting).where(
                                SystemSetting.category == category,
                                SystemSetting.key == db_key,
                            )
                        )
                        row = existing.scalar_one_or_none()
                        if row:
                            row.default_value = value
                            row.description = description
                        else:
                            session.add(SystemSetting(
                                category=category,
                                key=db_key,
                                value=value,
                                default_value=value,
                                value_type=value_type,
                                description=description,
                            ))
                            inserted_count += 1
                        await session.commit()
                    else:
                        # PostgreSQL: use efficient upsert
                        from sqlalchemy.dialects.postgresql import insert as pg_insert
                        insert_stmt = pg_insert(SystemSetting).values(
                            category=category,
                            key=db_key,
                            value=value,
                            default_value=value,
                            value_type=value_type,
                            description=description,
                        )
                        upsert_stmt = insert_stmt.on_conflict_do_update(
                            constraint="uq_system_settings_category_key",
                            set_={
                                "default_value": insert_stmt.excluded.default_value,
                                "description": insert_stmt.excluded.description,
                            },
                        )
                        result = await session.execute(upsert_stmt)
                        await session.commit()
                        if result.rowcount and result.rowcount > 0:
                            inserted_count += 1

        logger.info(f"Default settings seeding complete: {inserted_count} new entries inserted")
        return inserted_count

    # ── Settings sync to config.py ──

    async def sync_to_settings_key(self, category: str, key: str, value: Any) -> None:
        """Sync a single setting value back to the global config.py Settings object.

        This enables hot-reload: services that read settings.batch_tts.* etc.
        will get the updated value without restart.
        """
        if category == "web_research":
            from app.services.web_research.safe_http_client import get_safe_http_client
            from app.services.web_research.run_registry import run_registry
            if key == "global_concurrency":
                await get_safe_http_client().limiter.update(value)
            if key == "enabled" and not value:
                await run_registry.close()
            if key in {"browser_enabled", "downloads_enabled"} and not value:
                for run in list(run_registry.runs.values()):
                    for (call_id, action), _ in list(run.idempotency.items()):
                        if ((key == "browser_enabled" and action.startswith("browser"))
                                or (key == "downloads_enabled" and action == "download")):
                            await run_registry.cancel_call(run, call_id, reason="disabled")
                    if key == "browser_enabled" and run_registry.close_browser:
                        await run_registry.close_browser(run)
            return
        try:
            from app.config import settings as app_settings
            self._apply_setting_to_config(app_settings, category, key, value)
        except Exception as e:
            logger.warning(f"Failed to sync setting {category}.{key} to config: {e}")

    async def sync_all_to_settings(self) -> None:
        """Sync all cached settings to the config.py Settings object."""
        try:
            from app.config import settings as app_settings
            for category, keys in self._cache.items():
                for key, value in keys.items():
                    if category == "web_research":
                        await self.sync_to_settings_key(category, key, value)
                    else:
                        self._apply_setting_to_config(app_settings, category, key, value)
            logger.info("All settings synced to config.py Settings object")
        except Exception as e:
            logger.warning(f"Failed to sync all settings to config: {e}")

    def sync_to_settings(self, settings_obj: Any) -> None:
        """Synchronous version: sync all cached settings to the given Settings object.

        Called by downstream agents or during initialization.
        """
        for category, keys in self._cache.items():
            for key, value in keys.items():
                self._apply_setting_to_config(settings_obj, category, key, value)

    def _apply_setting_to_config(self, settings_obj: Any, category: str, key: str, value: Any) -> None:
        """Map a (category, key, value) to the corresponding Settings object attribute."""
        # TTS settings -> settings.batch_tts.*
        if category == "tts":
            if key == "concurrency" and isinstance(value, dict):
                tts = settings_obj.batch_tts
                for attr in ["concurrent_threads", "max_concurrent_threads", "request_timeout", "batch_timeout"]:
                    if attr in value:
                        setattr(tts, attr, value[attr])
            elif key == "retry" and isinstance(value, dict):
                for attr in ["max_attempts", "delay_seconds", "backoff_factor"]:
                    if attr in value:
                        setattr(settings_obj.batch_tts.retry, attr, value[attr])
            elif key == "logging" and isinstance(value, dict):
                for attr in ["enable_detailed_logs", "log_progress_interval", "log_level"]:
                    if attr in value:
                        setattr(settings_obj.batch_tts.logging, attr, value[attr])
            elif key == "limits" and isinstance(value, dict):
                for attr in ["max_segments_per_batch", "max_text_length_per_segment", "max_total_text_length"]:
                    if attr in value:
                        setattr(settings_obj.batch_tts.limits, attr, value[attr])
            # voices: not mapped to Settings object (read directly from cache by TTS service)

        # YouTube settings -> settings.youtube.*
        elif category == "youtube":
            if key == "download" and isinstance(value, dict):
                for attr in ["max_concurrent_downloads", "download_timeout", "max_retries", "retry_delay"]:
                    if attr in value:
                        setattr(settings_obj.youtube.download, attr, value[attr])
            elif key == "upload" and isinstance(value, dict):
                for attr in ["upload_timeout", "max_retries", "retry_delay"]:
                    if attr in value:
                        setattr(settings_obj.youtube.upload, attr, value[attr])
            elif key == "quality" and isinstance(value, dict):
                for attr in ["default_video_quality", "default_audio_quality", "default_format"]:
                    if attr in value:
                        setattr(settings_obj.youtube.quality, attr, value[attr])
            elif key == "file_management" and isinstance(value, dict):
                for attr in ["auto_cleanup", "temp_file_retention_hours", "generate_thumbnail"]:
                    if attr in value:
                        setattr(settings_obj.youtube.file_management, attr, value[attr])
            elif key == "logging" and isinstance(value, dict):
                for attr in ["enable_detailed_logging", "log_download_progress", "progress_log_interval"]:
                    if attr in value:
                        setattr(settings_obj.youtube.logging, attr, value[attr])

        # Upload settings -> settings.upload.*
        elif category == "upload":
            if key == "concurrent_upload" and isinstance(value, dict):
                for attr in ["max_concurrent_uploads", "max_queue_size", "upload_timeout", "enable_queue"]:
                    if attr in value:
                        setattr(settings_obj.upload.concurrent_upload, attr, value[attr])
            elif key == "file_size_limits" and isinstance(value, dict):
                for attr in ["max_video_size_mb", "max_audio_size_mb", "max_image_size_mb"]:
                    if attr in value:
                        setattr(settings_obj.upload.file_size_limits, attr, value[attr])
            elif key == "retry" and isinstance(value, dict):
                for attr in ["max_retries", "retry_delay", "exponential_backoff"]:
                    if attr in value:
                        setattr(settings_obj.upload.retry, attr, value[attr])
            elif key == "thumbnail" and isinstance(value, dict):
                for attr in ["auto_generate_video_thumbnail", "thumbnail_quality", "thumbnail_max_width", "thumbnail_max_height"]:
                    if attr in value:
                        setattr(settings_obj.upload.thumbnail, attr, value[attr])
            elif key == "temp_file_management" and isinstance(value, dict):
                for attr in ["auto_cleanup", "temp_file_retention_hours", "temp_file_directory"]:
                    if attr in value:
                        setattr(settings_obj.upload.temp_file_management, attr, value[attr])
            elif key == "logging" and isinstance(value, dict):
                for attr in ["enable_detailed_logging", "log_upload_progress", "progress_log_interval", "log_upload_statistics"]:
                    if attr in value:
                        setattr(settings_obj.upload.logging, attr, value[attr])

        # Watermark settings -> settings.watermark_removal.*
        elif category == "watermark":
            if key == "removal" and isinstance(value, dict):
                wr = settings_obj.watermark_removal
                for attr in ["concurrent_threads", "max_concurrent_threads", "batch_size", "batch_timeout"]:
                    if attr in value:
                        setattr(wr, attr, value[attr])
            elif key == "logging" and isinstance(value, dict):
                for attr in ["enable_detailed_logs", "log_progress_interval", "log_level", "enable_thread_logging"]:
                    if attr in value:
                        setattr(settings_obj.watermark_removal.logging, attr, value[attr])

        # Video analysis settings are read from YAML config by video_analysis_service directly
        # They don't map to settings.* attributes. Services should read from cache:
        #   system_settings_service.get("video_analysis", "queue_management")
        # No sync needed for video_analysis category.

    # ── Audit logging ──

    async def _log_audit(self, setting_type: str, category: Optional[str], key: Optional[str],
                         action: str, changed_by: str) -> None:
        """Write an audit log entry."""
        try:
            async with async_session_factory() as session:
                log_entry = SettingsAuditLog(
                    setting_type=setting_type,
                    category=category,
                    key=key,
                    action=action,
                    changed_by=changed_by,
                )
                session.add(log_entry)
                await session.commit()
        except Exception as e:
            # Audit logging should never break the main operation
            logger.error(f"Failed to write audit log: {e}")

    # ── Internal helpers ──

    @staticmethod
    def _load_yaml(path: str) -> dict:
        """Load and parse a YAML file. Returns empty dict on failure."""
        try:
            if os.path.exists(path):
                with open(path, 'r', encoding='utf-8') as f:
                    return yaml.safe_load(f) or {}
        except Exception as e:
            logger.warning(f"Failed to load YAML config: {path}: {e}")
        return {}


# Module-level singleton
system_settings_service = SystemSettingsService()
