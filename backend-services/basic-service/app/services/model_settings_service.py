"""
Service for managing model settings stored in SQLite.
"""

import os
import time
import aiosqlite
from typing import Optional, List

import httpx

from app.models.model_settings_models import (
    ModelFunctionType,
    PresetModel,
    ProviderInfo,
    ModelSettingRequest,
    ModelSettingResponse,
    TestConnectionRequest,
    TestConnectionResponse,
    ResolvedConfigResponse,
    FetchModelsRequest,
    FetchModelsResponse,
)
from app.config import get_settings
from app.logger import get_logger

logger = get_logger(__name__)

# Database path
DB_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'data')
DB_PATH = os.path.join(DB_DIR, 'model_settings.db')

# Known providers with default API URLs
PROVIDERS: List[ProviderInfo] = [
    ProviderInfo(id="deepseek", name="DeepSeek",
                 default_api_url="https://api.deepseek.com/v1", region="domestic"),
    ProviderInfo(id="alibaba", name="Alibaba",
                 default_api_url="https://dashscope.aliyuncs.com/compatible-mode/v1", region="domestic"),
    ProviderInfo(id="zhipu", name="Zhipu AI",
                 default_api_url="https://open.bigmodel.cn/api/paas/v4", region="domestic"),
    ProviderInfo(id="openai", name="OpenAI",
                 default_api_url="https://api.openai.com/v1", region="international"),
    ProviderInfo(id="anthropic", name="Anthropic",
                 default_api_url="https://api.anthropic.com/v1", region="international"),
    ProviderInfo(id="google", name="Google",
                 default_api_url="https://generativelanguage.googleapis.com/v1beta/openai", region="international"),
]

# Keep preset models for backward compat (empty now, models fetched dynamically)
PRESET_MODELS: List[PresetModel] = []


def _mask_api_key(key: str) -> str:
    """Mask an API key showing first 4 and last 4 characters."""
    if not key or len(key) <= 8:
        return "****"
    return f"{key[:4]}{'*' * (len(key) - 8)}{key[-4:]}"


class ModelSettingsService:
    """Service for CRUD operations on model settings stored in SQLite."""

    async def init_db(self):
        """Initialize SQLite database and create table if needed."""
        os.makedirs(DB_DIR, exist_ok=True)
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS model_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    function_type TEXT UNIQUE NOT NULL,
                    is_custom INTEGER NOT NULL DEFAULT 0,
                    provider TEXT,
                    model_name TEXT NOT NULL,
                    api_url TEXT NOT NULL,
                    api_key TEXT NOT NULL,
                    temperature REAL NOT NULL DEFAULT 0.7,
                    max_tokens INTEGER NOT NULL DEFAULT 2000,
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
            """)
            await db.commit()
        logger.info(f"Model settings database initialized at {DB_PATH}")

    async def get_all_settings(self) -> List[ModelSettingResponse]:
        """Get all saved model settings."""
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM model_settings")
            rows = await cursor.fetchall()
            return [self._row_to_response(row) for row in rows]

    async def get_setting(self, function_type: ModelFunctionType) -> Optional[ModelSettingResponse]:
        """Get a single model setting by function type."""
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM model_settings WHERE function_type = ?",
                (function_type.value,)
            )
            row = await cursor.fetchone()
            if row:
                return self._row_to_response(row)
            return None

    async def save_setting(self, request: ModelSettingRequest) -> ModelSettingResponse:
        """Save or update a model setting (upsert).

        If api_key is '__KEEP__', the existing key is preserved (for updates where user didn't change it).
        """
        api_key = request.api_key

        async with aiosqlite.connect(DB_PATH) as db:
            # If sentinel value, fetch existing key within same connection
            if api_key == '__KEEP__':
                db.row_factory = aiosqlite.Row
                cursor = await db.execute(
                    "SELECT api_key FROM model_settings WHERE function_type = ?",
                    (request.function_type.value,)
                )
                row = await cursor.fetchone()
                api_key = row["api_key"] if row else ""
                db.row_factory = None

            await db.execute("""
                INSERT INTO model_settings (function_type, is_custom, provider, model_name, api_url, api_key, temperature, max_tokens, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(function_type) DO UPDATE SET
                    is_custom = excluded.is_custom,
                    provider = excluded.provider,
                    model_name = excluded.model_name,
                    api_url = excluded.api_url,
                    api_key = excluded.api_key,
                    temperature = excluded.temperature,
                    max_tokens = excluded.max_tokens,
                    updated_at = datetime('now')
            """, (
                request.function_type.value,
                1 if request.is_custom else 0,
                request.provider,
                request.model_name,
                request.api_url,
                api_key,
                request.temperature,
                request.max_tokens,
            ))
            await db.commit()

        logger.info(f"Saved model setting for {request.function_type.value}: {request.model_name}")
        return await self.get_setting(request.function_type)

    async def delete_setting(self, function_type: ModelFunctionType) -> bool:
        """Delete a model setting (revert to env var defaults)."""
        async with aiosqlite.connect(DB_PATH) as db:
            cursor = await db.execute(
                "DELETE FROM model_settings WHERE function_type = ?",
                (function_type.value,)
            )
            await db.commit()
            deleted = cursor.rowcount > 0

        if deleted:
            logger.info(f"Deleted model setting for {function_type.value}, reverting to env defaults")
        return deleted

    async def test_connection(self, request: TestConnectionRequest) -> TestConnectionResponse:
        """Test a model connection by sending a minimal chat completion request."""
        api_key = request.api_key

        # If no key provided, look up saved key by function_type
        if not api_key and request.function_type:
            async with aiosqlite.connect(DB_PATH) as db:
                db.row_factory = aiosqlite.Row
                cursor = await db.execute(
                    "SELECT api_key FROM model_settings WHERE function_type = ?",
                    (request.function_type,)
                )
                row = await cursor.fetchone()
                api_key = row["api_key"] if row else ""
            if not api_key:
                return TestConnectionResponse(success=False, message="No saved API key found")

        start = time.time()
        try:
            url = request.api_url.rstrip('/')
            if not url.endswith('/chat/completions'):
                url = f"{url}/chat/completions"

            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": request.model_name,
                        "messages": [{"role": "user", "content": "hi"}],
                        "max_tokens": 5,
                    },
                )

            latency = int((time.time() - start) * 1000)

            if resp.status_code == 200:
                return TestConnectionResponse(success=True, message="Connection successful", latency_ms=latency)
            else:
                detail = resp.text[:200] if resp.text else f"HTTP {resp.status_code}"
                return TestConnectionResponse(success=False, message=f"Error: {detail}", latency_ms=latency)

        except httpx.TimeoutException:
            latency = int((time.time() - start) * 1000)
            return TestConnectionResponse(success=False, message="Connection timed out (15s)", latency_ms=latency)
        except Exception as e:
            latency = int((time.time() - start) * 1000)
            return TestConnectionResponse(success=False, message=f"Connection failed: {str(e)}", latency_ms=latency)

    async def get_effective_config(self, function_type: ModelFunctionType) -> ResolvedConfigResponse:
        """Get effective config: database setting if exists, else env var fallback."""
        # Try database first
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM model_settings WHERE function_type = ?",
                (function_type.value,)
            )
            row = await cursor.fetchone()

        if row:
            return ResolvedConfigResponse(
                success=True,
                source="database",
                api_url=row["api_url"],
                api_key=row["api_key"],
                model_name=row["model_name"],
                temperature=row["temperature"],
                max_tokens=row["max_tokens"],
            )

        # Fallback to env vars
        settings = get_settings()
        env_map = {
            ModelFunctionType.CHAT: (settings.llm_api_url, settings.llm_api_key, settings.llm_model),
            ModelFunctionType.FAST: (
                os.getenv("FAST_LLM_API_URL", settings.llm_api_url),
                os.getenv("FAST_LLM_API_KEY", settings.llm_api_key),
                os.getenv("FAST_LLM_MODEL", settings.llm_model),
            ),
            ModelFunctionType.VIDEO_CUT: (
                settings.video_cut_llm_api_url or settings.llm_api_url,
                ***REMOVED*** or settings.llm_api_key,
                settings.video_cut_llm_model,
            ),
            ModelFunctionType.VISION: (
                settings.vl_llm_api_url or settings.llm_api_url,
                settings.vl_llm_api_key or settings.llm_api_key,
                settings.vl_llm_model,
            ),
        }
        api_url, api_key, model_name = env_map.get(
            function_type, (settings.llm_api_url, settings.llm_api_key, settings.llm_model)
        )
        return ResolvedConfigResponse(
            success=True,
            source="environment",
            api_url=api_url,
            api_key=api_key,
            model_name=model_name,
            temperature=0.7,
            max_tokens=2000,
        )

    def get_preset_models(self) -> List[PresetModel]:
        """Return the list of preset models."""
        return PRESET_MODELS

    def get_providers(self) -> List[ProviderInfo]:
        """Return the list of known providers."""
        return PROVIDERS

    async def fetch_models(self, request: FetchModelsRequest) -> FetchModelsResponse:
        """Fetch available models from a provider's /models endpoint."""
        api_key = request.api_key

        # If no key provided or sentinel, look up saved key
        if (not api_key or api_key == '__USE_SAVED__') and request.function_type:
            async with aiosqlite.connect(DB_PATH) as db:
                db.row_factory = aiosqlite.Row
                cursor = await db.execute(
                    "SELECT api_key FROM model_settings WHERE function_type = ?",
                    (request.function_type,)
                )
                row = await cursor.fetchone()
                api_key = row["api_key"] if row else ""
            if not api_key:
                return FetchModelsResponse(success=False, message="No API key available")

        try:
            url = request.api_url.rstrip('/')
            if not url.endswith('/models'):
                url = f"{url}/models"

            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                )

            if resp.status_code != 200:
                detail = resp.text[:200] if resp.text else f"HTTP {resp.status_code}"
                return FetchModelsResponse(success=False, message=f"Error: {detail}")

            data = resp.json()
            models = []
            # OpenAI-compatible format: { "data": [{ "id": "model-name", ... }] }
            if isinstance(data, dict) and "data" in data:
                for item in data["data"]:
                    if isinstance(item, dict) and "id" in item:
                        models.append(item["id"])
            # Some APIs return a flat list
            elif isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and "id" in item:
                        models.append(item["id"])
                    elif isinstance(item, str):
                        models.append(item)

            models.sort()
            return FetchModelsResponse(
                success=True,
                message=f"Found {len(models)} models",
                models=models,
            )

        except httpx.TimeoutException:
            return FetchModelsResponse(success=False, message="Request timed out (15s)")
        except Exception as e:
            return FetchModelsResponse(success=False, message=f"Failed: {str(e)}")

    def _row_to_response(self, row) -> ModelSettingResponse:
        """Convert a database row to a ModelSettingResponse."""
        api_key = row["api_key"]
        return ModelSettingResponse(
            function_type=ModelFunctionType(row["function_type"]),
            is_custom=bool(row["is_custom"]),
            provider=row["provider"],
            model_name=row["model_name"],
            api_url=row["api_url"],
            api_key_masked=_mask_api_key(api_key),
            api_key_set=bool(api_key),
            temperature=row["temperature"],
            max_tokens=row["max_tokens"],
            updated_at=row["updated_at"],
        )


model_settings_service = ModelSettingsService()
