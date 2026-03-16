"""
Service for managing model settings stored in SQLite.

Two-layer architecture:
  - model_providers: provider credentials (name, type, API URL, API key)
  - model_assignments: feature → provider+model mapping
"""

import os
import time
import aiosqlite
from contextlib import asynccontextmanager
from typing import Optional, List, AsyncIterator

import httpx

from app.models.model_settings_models import (
    ModelFunctionType,
    ProviderInfo,
    ModelProviderCreate,
    ModelProviderUpdate,
    ModelProviderResponse,
    ModelAssignmentRequest,
    ModelAssignmentResponse,
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


def _mask_api_key(key: str) -> str:
    """Mask an API key showing first 4 and last 4 characters."""
    if not key or len(key) <= 8:
        return "****"
    return f"{key[:4]}{'*' * (len(key) - 8)}{key[-4:]}"


class ModelSettingsService:
    """Service for managing provider credentials and feature model assignments."""

    @asynccontextmanager
    async def _connect(self) -> AsyncIterator[aiosqlite.Connection]:
        """Get a DB connection with foreign keys enabled."""
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("PRAGMA foreign_keys = ON")
            yield db

    async def init_db(self):
        """Initialize SQLite database, create tables, and migrate from old schema if needed."""
        os.makedirs(DB_DIR, exist_ok=True)
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("PRAGMA foreign_keys = ON")

            # Create new tables
            await db.execute("""
                CREATE TABLE IF NOT EXISTS model_providers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    provider_type TEXT NOT NULL,
                    api_url TEXT NOT NULL,
                    api_key TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS model_assignments (
                    function_type TEXT PRIMARY KEY,
                    provider_id INTEGER NOT NULL,
                    model_name TEXT NOT NULL,
                    temperature REAL NOT NULL DEFAULT 0.7,
                    max_tokens INTEGER NOT NULL DEFAULT 128000,
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (provider_id) REFERENCES model_providers(id) ON DELETE CASCADE
                )
            """)

            # Migrate from old schema if needed
            cursor = await db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='model_settings'"
            )
            old_table = await cursor.fetchone()

            if old_table:
                # Check if migration already done
                cursor = await db.execute("SELECT COUNT(*) FROM model_providers")
                count = (await cursor.fetchone())[0]

                if count == 0:
                    logger.info("Migrating from old model_settings table to new two-layer schema...")
                    db.row_factory = aiosqlite.Row
                    cursor = await db.execute("SELECT * FROM model_settings")
                    rows = await cursor.fetchall()
                    db.row_factory = None

                    # Deduplicate providers by (provider_type, api_url, api_key)
                    provider_map = {}  # (provider, api_url, api_key) -> provider_id
                    for row in rows:
                        provider_type = row["provider"] or "custom"
                        api_url = row["api_url"]
                        api_key = row["api_key"]
                        dedup_key = (provider_type, api_url, api_key)

                        if dedup_key not in provider_map:
                            # Generate a display name
                            func_type = row["function_type"]
                            provider_name = f"{provider_type} ({func_type})"
                            # Ensure unique name
                            existing = await db.execute(
                                "SELECT id FROM model_providers WHERE name = ?", (provider_name,)
                            )
                            if await existing.fetchone():
                                provider_name = f"{provider_type} ({func_type}_{int(time.time())})"

                            cursor = await db.execute(
                                """INSERT INTO model_providers (name, provider_type, api_url, api_key)
                                   VALUES (?, ?, ?, ?)""",
                                (provider_name, provider_type, api_url, api_key)
                            )
                            provider_map[dedup_key] = cursor.lastrowid
                            logger.info(f"  Migrated provider: {provider_name} (id={cursor.lastrowid})")

                        # Create assignment
                        provider_id = provider_map[dedup_key]
                        await db.execute(
                            """INSERT OR IGNORE INTO model_assignments
                               (function_type, provider_id, model_name, temperature, max_tokens)
                               VALUES (?, ?, ?, ?, ?)""",
                            (row["function_type"], provider_id, row["model_name"],
                             row["temperature"], row["max_tokens"])
                        )
                        logger.info(f"  Migrated assignment: {row['function_type']} -> provider {provider_id}")

                    logger.info(f"Migration complete: {len(provider_map)} providers, {len(rows)} assignments")

                # Drop old table after migration
                await db.execute("DROP TABLE IF EXISTS model_settings")
                logger.info("Dropped old model_settings table")

            await db.commit()
        logger.info(f"Model settings database initialized at {DB_PATH}")

    # ── Provider CRUD ──

    async def create_provider(self, request: ModelProviderCreate) -> ModelProviderResponse:
        """Create a new provider credential."""
        async with self._connect() as db:
            cursor = await db.execute(
                """INSERT INTO model_providers (name, provider_type, api_url, api_key)
                   VALUES (?, ?, ?, ?)""",
                (request.name, request.provider_type, request.api_url, request.api_key)
            )
            await db.commit()
            provider_id = cursor.lastrowid

        logger.info(f"Created provider: {request.name} (id={provider_id})")
        return await self.get_provider(provider_id)

    async def update_provider(self, provider_id: int, request: ModelProviderUpdate) -> Optional[ModelProviderResponse]:
        """Update a provider credential. Use '__KEEP__' for api_key to preserve existing."""
        async with self._connect() as db:
            # Fetch current values
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM model_providers WHERE id = ?", (provider_id,))
            row = await cursor.fetchone()
            db.row_factory = None

            if not row:
                return None

            name = request.name if request.name is not None else row["name"]
            provider_type = request.provider_type if request.provider_type is not None else row["provider_type"]
            api_url = request.api_url if request.api_url is not None else row["api_url"]

            # Handle __KEEP__ sentinel for API key
            if request.api_key is None or request.api_key == '__KEEP__':
                api_key = row["api_key"]
            else:
                api_key = request.api_key

            await db.execute(
                """UPDATE model_providers
                   SET name = ?, provider_type = ?, api_url = ?, api_key = ?, updated_at = datetime('now')
                   WHERE id = ?""",
                (name, provider_type, api_url, api_key, provider_id)
            )
            await db.commit()

        logger.info(f"Updated provider id={provider_id}")
        return await self.get_provider(provider_id)

    async def delete_provider(self, provider_id: int) -> bool:
        """Delete a provider and cascade-delete its assignments."""
        async with self._connect() as db:
            cursor = await db.execute("DELETE FROM model_providers WHERE id = ?", (provider_id,))
            await db.commit()
            deleted = cursor.rowcount > 0

        if deleted:
            logger.info(f"Deleted provider id={provider_id} (assignments cascade-deleted)")
        return deleted

    async def get_all_providers(self) -> List[ModelProviderResponse]:
        """Get all saved provider credentials (API keys masked)."""
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM model_providers ORDER BY id")
            rows = await cursor.fetchall()
            return [self._provider_row_to_response(row) for row in rows]

    async def get_provider(self, provider_id: int) -> Optional[ModelProviderResponse]:
        """Get a single provider by ID (API key masked)."""
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM model_providers WHERE id = ?", (provider_id,))
            row = await cursor.fetchone()
            if row:
                return self._provider_row_to_response(row)
            return None

    async def get_provider_api_key(self, provider_id: int) -> Optional[str]:
        """Get the raw API key for a provider (internal use only)."""
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT api_key FROM model_providers WHERE id = ?", (provider_id,))
            row = await cursor.fetchone()
            return row["api_key"] if row else None

    # ── Assignment CRUD ──

    async def get_all_assignments(self) -> List[ModelAssignmentResponse]:
        """Get all feature model assignments (joined with provider info)."""
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("""
                SELECT a.*, p.name as provider_name, p.provider_type
                FROM model_assignments a
                JOIN model_providers p ON a.provider_id = p.id
                ORDER BY a.function_type
            """)
            rows = await cursor.fetchall()
            return [self._assignment_row_to_response(row) for row in rows]

    async def save_assignment(self, request: ModelAssignmentRequest) -> Optional[ModelAssignmentResponse]:
        """Save or update a feature model assignment (upsert by function_type)."""
        # Verify provider exists
        provider = await self.get_provider(request.provider_id)
        if not provider:
            return None

        async with self._connect() as db:
            await db.execute("""
                INSERT INTO model_assignments (function_type, provider_id, model_name, temperature, max_tokens, updated_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(function_type) DO UPDATE SET
                    provider_id = excluded.provider_id,
                    model_name = excluded.model_name,
                    temperature = excluded.temperature,
                    max_tokens = excluded.max_tokens,
                    updated_at = datetime('now')
            """, (
                request.function_type.value,
                request.provider_id,
                request.model_name,
                request.temperature,
                request.max_tokens,
            ))
            await db.commit()

        logger.info(f"Saved assignment: {request.function_type.value} -> provider {request.provider_id}, model {request.model_name}")

        # Return the saved assignment with joined provider info
        assignments = await self.get_all_assignments()
        for a in assignments:
            if a.function_type == request.function_type:
                return a
        return None

    async def delete_assignment(self, function_type: ModelFunctionType) -> bool:
        """Delete a feature assignment (revert to env var defaults)."""
        async with self._connect() as db:
            cursor = await db.execute(
                "DELETE FROM model_assignments WHERE function_type = ?",
                (function_type.value,)
            )
            await db.commit()
            deleted = cursor.rowcount > 0

        if deleted:
            logger.info(f"Deleted assignment for {function_type.value}, reverting to env defaults")
        return deleted

    # ── Model Fetching ──

    async def fetch_models_for_provider(self, provider_id: int) -> FetchModelsResponse:
        """Fetch available models using a saved provider's credentials."""
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT api_url, api_key FROM model_providers WHERE id = ?", (provider_id,))
            row = await cursor.fetchone()

        if not row:
            return FetchModelsResponse(success=False, message="Provider not found")

        return await self._fetch_models_from_api(row["api_url"], row["api_key"])

    async def fetch_models(self, request: FetchModelsRequest) -> FetchModelsResponse:
        """Fetch available models with ad-hoc or saved credentials."""
        api_key = request.api_key
        api_url = request.api_url

        # If provider_id given, look up saved credentials
        if request.provider_id:
            async with self._connect() as db:
                db.row_factory = aiosqlite.Row
                cursor = await db.execute(
                    "SELECT api_url, api_key FROM model_providers WHERE id = ?",
                    (request.provider_id,)
                )
                row = await cursor.fetchone()
                if row:
                    api_key = row["api_key"]
                    if not api_url:
                        api_url = row["api_url"]

        if not api_key:
            return FetchModelsResponse(success=False, message="No API key available")

        return await self._fetch_models_from_api(api_url, api_key)

    async def _fetch_models_from_api(self, api_url: str, api_key: str) -> FetchModelsResponse:
        """Internal: call a provider's /models endpoint."""
        try:
            url = api_url.rstrip('/')
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

    # ── Connection Testing ──

    async def test_connection(self, request: TestConnectionRequest) -> TestConnectionResponse:
        """Test a model connection by sending a minimal chat completion request."""
        api_key = (request.api_key or "").strip()

        # If no usable key provided and provider_id given, look up saved key
        if not api_key and request.provider_id:
            api_key = await self.get_provider_api_key(request.provider_id)
            if not api_key:
                return TestConnectionResponse(success=False, message="No saved API key found for provider")

        if not api_key:
            return TestConnectionResponse(success=False, message="No API key provided")

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

    # ── Config Resolution (critical — backward compatible) ──

    async def get_effective_config(self, function_type: ModelFunctionType) -> ResolvedConfigResponse:
        """Get effective config: database assignment if exists, else env var fallback.

        Response shape is UNCHANGED — downstream consumers depend on it.
        """
        # Try database first: join assignments with providers
        async with self._connect() as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("""
                SELECT a.model_name, a.temperature, a.max_tokens, p.api_url, p.api_key
                FROM model_assignments a
                JOIN model_providers p ON a.provider_id = p.id
                WHERE a.function_type = ?
            """, (function_type.value,))
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
            max_tokens=128000,
        )

    # ── Static data ──

    def get_providers(self) -> List[ProviderInfo]:
        """Return the list of known provider types (static reference)."""
        return PROVIDERS

    # ── Internal helpers ──

    def _provider_row_to_response(self, row) -> ModelProviderResponse:
        """Convert a database row to a ModelProviderResponse."""
        api_key = row["api_key"]
        return ModelProviderResponse(
            id=row["id"],
            name=row["name"],
            provider_type=row["provider_type"],
            api_url=row["api_url"],
            api_key_masked=_mask_api_key(api_key),
            api_key_set=bool(api_key),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def _assignment_row_to_response(self, row) -> ModelAssignmentResponse:
        """Convert a joined database row to a ModelAssignmentResponse."""
        return ModelAssignmentResponse(
            function_type=ModelFunctionType(row["function_type"]),
            provider_id=row["provider_id"],
            provider_name=row["provider_name"],
            provider_type=row["provider_type"],
            model_name=row["model_name"],
            temperature=row["temperature"],
            max_tokens=row["max_tokens"],
            updated_at=row["updated_at"],
        )


model_settings_service = ModelSettingsService()
