"""
Service for managing model settings stored in PostgreSQL.

Two-layer architecture:
  - model_providers: provider credentials (name, type, API URL, API key)
  - model_assignments: feature -> provider+model mapping

Migrated from SQLite (aiosqlite) to PostgreSQL (async SQLAlchemy).
"""

import os
import time
import uuid
from typing import Optional, List, Tuple

import httpx
from sqlalchemy import select, update, delete
from sqlalchemy.orm import selectinload

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
from app.models.db_models import ModelProvider, ModelAssignment
from app.database import async_session_factory
from app.config import Settings, get_settings
from app.logger import get_logger

logger = get_logger(__name__)

# Known providers with default API URLs
PROVIDERS: List[ProviderInfo] = [
    # Generic providers (api_format defaults to "openai", no default_models — use /models API)
    ProviderInfo(id="deepseek", name="DeepSeek",
                 default_api_url="https://api.deepseek.com/v1", region="domestic",
                 api_format="openai", default_models=[]),
    ProviderInfo(id="alibaba", name="Alibaba",
                 default_api_url="https://dashscope.aliyuncs.com/compatible-mode/v1", region="domestic",
                 api_format="openai", default_models=[]),
    ProviderInfo(id="zhipu", name="Zhipu AI",
                 default_api_url="https://open.bigmodel.cn/api/paas/v4", region="domestic",
                 api_format="openai", default_models=[]),
    ProviderInfo(id="openai", name="OpenAI",
                 default_api_url="https://api.openai.com/v1", region="international",
                 api_format="openai", default_models=[]),
    ProviderInfo(id="anthropic", name="Anthropic",
                 default_api_url="https://api.anthropic.com/v1", region="international",
                 api_format="openai", default_models=[]),
    ProviderInfo(id="google", name="Google",
                 default_api_url="https://generativelanguage.googleapis.com/v1beta/openai", region="international",
                 api_format="openai", default_models=[]),
    # Coding Plan providers
    ProviderInfo(id="kimi_coding", name="Kimi Coding Plan",
                 default_api_url="https://api.kimi.com/coding", region="domestic",
                 api_format="anthropic", default_models=["kimi-k2.5"]),
    ProviderInfo(id="codex", name="Codex (OpenAI)",
                 default_api_url="https://api.openai.com/v1", region="international",
                 api_format="openai", default_models=["codex-mini-latest"]),
    ProviderInfo(id="claude_coding", name="Claude (Anthropic)",
                 default_api_url="https://api.anthropic.com", region="international",
                 api_format="anthropic", default_models=["claude-sonnet-4-20250514", "claude-opus-4-20250514"]),
    ProviderInfo(id="glm_coding", name="GLM Coding Plan",
                 default_api_url="https://open.bigmodel.cn/api/coding/paas/v4", region="domestic",
                 api_format="openai", default_models=["glm-5.1", "glm-5-turbo"]),
]

# Provider types that use Anthropic Messages API format instead of OpenAI.
# Kept as fallback for api_format="auto" resolution.
ANTHROPIC_FORMAT_TYPES = {"kimi_coding", "claude_coding", "anthropic"}


def _get_default_models_for_type(provider_type: str) -> List[str]:
    """Look up default_models from PROVIDERS by provider_type id.

    Returns the pre-configured model list for providers that don't expose a /models endpoint
    (e.g., coding plan providers). Returns [] for generic providers that use /models API.
    """
    for p in PROVIDERS:
        if p.id == provider_type:
            return list(p.default_models)  # Return a copy to avoid mutation
    return []


def _resolve_api_format(request_format: Optional[str], db_format: Optional[str], provider_type: str) -> str:
    """Resolve the effective API format with priority: request > db > auto-infer.

    Priority order:
      1. request_format — user explicitly specified in the current request (e.g., test-connection)
      2. db_format — saved in the provider's database record
      3. Auto-infer from provider_type using ANTHROPIC_FORMAT_TYPES

    Args:
        request_format: Format from the current API request (may be None).
        db_format: Format stored in the DB provider record (may be None or "auto").
        provider_type: The provider type identifier.

    Returns:
        "openai" or "anthropic" — never returns "auto".
    """
    # Priority 1: explicit request-level override
    if request_format and request_format in ("openai", "anthropic"):
        return request_format

    # Priority 2: DB-stored format (if not "auto")
    if db_format and db_format in ("openai", "anthropic"):
        return db_format

    # Priority 3: auto-infer from provider_type
    return "anthropic" if provider_type in ANTHROPIC_FORMAT_TYPES else "openai"


def _mask_api_key(key: str) -> str:
    """Mask an API key showing first 4 and last 4 characters."""
    if not key or len(key) <= 8:
        return "****"
    return f"{key[:4]}{'*' * (len(key) - 8)}{key[-4:]}"


def _parse_uuid(value: str) -> uuid.UUID:
    """Parse a string to UUID, raising ValueError on invalid format."""
    return uuid.UUID(str(value))


class ModelSettingsService:
    """Service for managing provider credentials and feature model assignments.

    Uses async SQLAlchemy with PostgreSQL via async_session_factory.
    """

    # ── Provider CRUD ──

    async def create_provider(self, request: ModelProviderCreate) -> ModelProviderResponse:
        """Create a new provider credential."""
        async with async_session_factory() as session:
            provider = ModelProvider(
                name=request.name,
                provider_type=request.provider_type,
                api_url=request.api_url,
                api_key=request.api_key,
                api_format=request.api_format,
            )
            session.add(provider)
            await session.commit()
            await session.refresh(provider)

        logger.info(f"Created provider: {request.name} (id={provider.id}, api_format={request.api_format})")
        return self._provider_to_response(provider)

    async def update_provider(self, provider_id: str, request: ModelProviderUpdate) -> Optional[ModelProviderResponse]:
        """Update a provider credential. Use '__KEEP__' for api_key to preserve existing."""
        pid = _parse_uuid(provider_id)

        async with async_session_factory() as session:
            stmt = select(ModelProvider).where(ModelProvider.id == pid)
            result = await session.execute(stmt)
            provider = result.scalar_one_or_none()

            if not provider:
                return None

            if request.name is not None:
                provider.name = request.name
            if request.provider_type is not None:
                provider.provider_type = request.provider_type
            if request.api_url is not None:
                provider.api_url = request.api_url

            # Handle __KEEP__ sentinel for API key
            if request.api_key is not None and request.api_key != '__KEEP__':
                provider.api_key = request.api_key

            if request.api_format is not None:
                provider.api_format = request.api_format

            await session.commit()
            await session.refresh(provider)

        logger.info(f"Updated provider id={provider_id}")
        return self._provider_to_response(provider)

    async def delete_provider(self, provider_id: str) -> bool:
        """Delete a provider and cascade-delete its assignments."""
        pid = _parse_uuid(provider_id)

        async with async_session_factory() as session:
            stmt = select(ModelProvider).where(ModelProvider.id == pid)
            result = await session.execute(stmt)
            provider = result.scalar_one_or_none()

            if not provider:
                return False

            await session.delete(provider)
            await session.commit()

        logger.info(f"Deleted provider id={provider_id} (assignments cascade-deleted)")
        return True

    async def get_all_providers(self) -> List[ModelProviderResponse]:
        """Get all saved provider credentials (API keys masked)."""
        async with async_session_factory() as session:
            stmt = select(ModelProvider).order_by(ModelProvider.created_at)
            result = await session.execute(stmt)
            providers = result.scalars().all()
            return [self._provider_to_response(p) for p in providers]

    async def get_provider(self, provider_id: str) -> Optional[ModelProviderResponse]:
        """Get a single provider by ID (API key masked)."""
        pid = _parse_uuid(provider_id)

        async with async_session_factory() as session:
            stmt = select(ModelProvider).where(ModelProvider.id == pid)
            result = await session.execute(stmt)
            provider = result.scalar_one_or_none()
            if provider:
                return self._provider_to_response(provider)
            return None

    async def get_provider_api_key(self, provider_id: str) -> Optional[str]:
        """Get the raw API key for a provider (internal use only)."""
        pid = _parse_uuid(provider_id)

        async with async_session_factory() as session:
            stmt = select(ModelProvider.api_key).where(ModelProvider.id == pid)
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            return row if row else None

    # ── Assignment CRUD ──

    async def get_all_assignments(self) -> List[ModelAssignmentResponse]:
        """Get all feature model assignments (joined with provider info)."""
        async with async_session_factory() as session:
            stmt = (
                select(ModelAssignment)
                .options(selectinload(ModelAssignment.provider))
                .order_by(ModelAssignment.function_type)
            )
            result = await session.execute(stmt)
            assignments = result.scalars().all()
            return [self._assignment_to_response(a) for a in assignments]

    async def save_assignment(self, request: ModelAssignmentRequest) -> Optional[ModelAssignmentResponse]:
        """Save or update a feature model assignment (upsert by function_type)."""
        pid = _parse_uuid(request.provider_id)

        # Verify provider exists
        async with async_session_factory() as session:
            provider_check = await session.execute(
                select(ModelProvider).where(ModelProvider.id == pid)
            )
            provider = provider_check.scalar_one_or_none()
            if not provider:
                return None

        await self._validate_assignment_connection(request, provider)

        async with async_session_factory() as session:
            # Check if assignment already exists
            stmt = select(ModelAssignment).where(
                ModelAssignment.function_type == request.function_type.value
            )
            result = await session.execute(stmt)
            existing = result.scalar_one_or_none()

            if existing:
                existing.provider_id = pid
                existing.model_name = request.model_name
                existing.temperature = request.temperature
                existing.max_tokens = request.max_tokens
            else:
                assignment = ModelAssignment(
                    function_type=request.function_type.value,
                    provider_id=pid,
                    model_name=request.model_name,
                    temperature=request.temperature,
                    max_tokens=request.max_tokens,
                )
                session.add(assignment)

            await session.commit()

        logger.info(f"Saved assignment: {request.function_type.value} -> provider {request.provider_id}, model {request.model_name}")

        # Return the saved assignment with joined provider info
        assignments = await self.get_all_assignments()
        for a in assignments:
            if a.function_type == request.function_type:
                return a
        return None

    async def _validate_assignment_connection(
        self,
        request: ModelAssignmentRequest,
        provider: ModelProvider,
    ) -> None:
        """Validate CHAT assignments before they become resolved runtime config."""
        if request.function_type != ModelFunctionType.CHAT:
            return

        api_format = provider.api_format
        if api_format not in ("openai", "anthropic"):
            api_format = None

        result = await self.test_connection(
            TestConnectionRequest(
                api_url=provider.api_url,
                api_key=provider.api_key,
                model_name=request.model_name,
                provider_id=str(provider.id),
                provider_type=provider.provider_type,
                api_format=api_format,
            )
        )

        if result.success:
            return

        message = result.message or "unknown error"
        logger.warning(
            "Rejected CHAT assignment for provider %s model %s: %s",
            provider.id,
            request.model_name,
            message,
        )
        raise ValueError(f"CHAT model connection test failed: {message}")

    async def delete_assignment(self, function_type: ModelFunctionType) -> bool:
        """Delete a feature assignment (revert to env var defaults)."""
        async with async_session_factory() as session:
            stmt = delete(ModelAssignment).where(
                ModelAssignment.function_type == function_type.value
            )
            result = await session.execute(stmt)
            await session.commit()
            deleted = result.rowcount > 0

        if deleted:
            logger.info(f"Deleted assignment for {function_type.value}, reverting to env defaults")
        return deleted

    # ── Model Fetching ──

    async def fetch_models_for_provider(self, provider_id: str) -> FetchModelsResponse:
        """Fetch available models using a saved provider's credentials."""
        pid = _parse_uuid(provider_id)

        async with async_session_factory() as session:
            stmt = select(ModelProvider).where(ModelProvider.id == pid)
            result = await session.execute(stmt)
            provider = result.scalar_one_or_none()

        if not provider:
            return FetchModelsResponse(success=False, message="Provider not found")

        # Return pre-configured models for providers without a /models endpoint
        default_models = _get_default_models_for_type(provider.provider_type)
        if default_models:
            return FetchModelsResponse(success=True, message=f"Found {len(default_models)} models", models=default_models)

        return await self._fetch_models_from_api(provider.api_url, provider.api_key)

    async def fetch_models(self, request: FetchModelsRequest) -> FetchModelsResponse:
        """Fetch available models with ad-hoc or saved credentials."""
        api_key = request.api_key
        api_url = request.api_url
        provider_type = request.provider_type or ""

        # If provider_id given, look up saved credentials
        if request.provider_id:
            pid = _parse_uuid(request.provider_id)
            async with async_session_factory() as session:
                stmt = select(ModelProvider).where(ModelProvider.id == pid)
                result = await session.execute(stmt)
                provider = result.scalar_one_or_none()
                if provider:
                    api_key = provider.api_key
                    if not api_url:
                        api_url = provider.api_url
                    if not provider_type:
                        provider_type = provider.provider_type

        # Return pre-configured models for providers without a /models endpoint
        default_models = _get_default_models_for_type(provider_type)
        if default_models:
            return FetchModelsResponse(success=True, message=f"Found {len(default_models)} models", models=default_models)

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

    async def _resolve_provider_type(self, request_provider_type: str = None, provider_id: str = None) -> str:
        """Resolve provider_type from request or DB lookup."""
        if request_provider_type:
            return request_provider_type
        if provider_id:
            pid = _parse_uuid(provider_id)
            async with async_session_factory() as session:
                stmt = select(ModelProvider.provider_type).where(ModelProvider.id == pid)
                result = await session.execute(stmt)
                row = result.scalar_one_or_none()
                if row:
                    return row
        return ""

    async def _get_provider_db_format(self, provider_id: Optional[str] = None) -> Optional[str]:
        """Look up the api_format stored in the DB for a provider."""
        if not provider_id:
            return None
        try:
            pid = _parse_uuid(provider_id)
            async with async_session_factory() as session:
                stmt = select(ModelProvider.api_format).where(ModelProvider.id == pid)
                result = await session.execute(stmt)
                return result.scalar_one_or_none()
        except Exception:
            return None

    async def test_connection(self, request: TestConnectionRequest) -> TestConnectionResponse:
        """Test a model connection by sending a minimal request (OpenAI or Anthropic format).

        Uses 3-tier format resolution: request.api_format > DB provider api_format > auto-infer.
        On success, populates model_info with the model name and resolved format.
        """
        api_key = (request.api_key or "").strip()

        # If no usable key provided and provider_id given, look up saved key
        if not api_key and request.provider_id:
            api_key = await self.get_provider_api_key(request.provider_id)
            if not api_key:
                return TestConnectionResponse(success=False, message="No saved API key found for provider")

        if not api_key:
            return TestConnectionResponse(success=False, message="No API key provided")

        # Determine provider_type and resolve API format via 3-tier priority
        provider_type = await self._resolve_provider_type(request.provider_type, request.provider_id)
        db_format = await self._get_provider_db_format(request.provider_id)
        api_format = _resolve_api_format(request.api_format, db_format, provider_type)

        if api_format == "anthropic":
            result = await self._test_anthropic_connection(request.api_url, api_key, request.model_name, provider_type)
        else:
            result = await self._test_openai_connection(request.api_url, api_key, request.model_name)

        # Populate model_info on successful connection
        if result.success:
            result.model_info = {"model": request.model_name, "format_used": api_format}

        return result

    async def _test_openai_connection(self, api_url: str, api_key: str,
                                       model_name: str) -> TestConnectionResponse:
        """Test connection using OpenAI Chat Completions API format."""
        start = time.time()
        try:
            url = api_url.rstrip('/')
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
                        "model": model_name,
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

    async def _test_anthropic_connection(self, api_url: str, api_key: str, model_name: str,
                                          provider_type: str) -> TestConnectionResponse:
        """Test connection using Anthropic Messages API format (for Kimi Coding, Claude, etc.)."""
        start = time.time()
        try:
            url = api_url.rstrip('/')
            if url.endswith('/v1/messages'):
                pass  # already correct
            elif url.endswith('/v1'):
                url = f"{url}/messages"
            else:
                url = f"{url}/v1/messages"

            headers = {
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            }
            # Kimi Coding endpoint checks User-Agent
            if provider_type == "kimi_coding":
                headers["User-Agent"] = "claude-code/1.0"

            payload = {
                "model": model_name,
                "max_tokens": 5,
                "messages": [{"role": "user", "content": "hi"}],
            }

            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, headers=headers, json=payload)

            latency = int((time.time() - start) * 1000)

            if resp.status_code == 200:
                return TestConnectionResponse(success=True, message="Connection successful", latency_ms=latency)
            else:
                detail = resp.text[:200] if resp.text else f"HTTP {resp.status_code}"
                return TestConnectionResponse(success=False, message=f"Error: {detail}", latency_ms=latency)

        except httpx.TimeoutException:
            latency = int((time.time() - start) * 1000)
            return TestConnectionResponse(success=False, message="Connection timed out (30s)", latency_ms=latency)
        except Exception as e:
            latency = int((time.time() - start) * 1000)
            return TestConnectionResponse(success=False, message=f"Connection failed: {str(e)}", latency_ms=latency)

    # ── Config Resolution (critical — backward compatible) ──

    async def get_effective_config(self, function_type: ModelFunctionType) -> ResolvedConfigResponse:
        """Get effective config: database assignment if exists, else env var fallback.

        Response shape is UNCHANGED — downstream consumers depend on it.
        """
        if function_type == ModelFunctionType.RESEARCH:
            return await self.resolve_research_config()
        # Try database first: join assignments with providers
        async with async_session_factory() as session:
            stmt = (
                select(ModelAssignment)
                .options(selectinload(ModelAssignment.provider))
                .where(ModelAssignment.function_type == function_type.value)
            )
            result = await session.execute(stmt)
            assignment = result.scalar_one_or_none()

        if assignment and assignment.provider:
            # Prefer the provider's explicit api_format; fall back to auto-infer
            # from provider_type (existing 3-tier rule) so DB-assigned Anthropic
            # providers surface as api_type="anthropic".
            db_api_type = _resolve_api_format(
                None,
                assignment.provider.api_format,
                assignment.provider.provider_type or "",
            )
            return ResolvedConfigResponse(
                success=True,
                source="database",
                api_url=assignment.provider.api_url,
                api_key=***REMOVED***,
                model_name=assignment.model_name,
                temperature=assignment.temperature,
                max_tokens=assignment.max_tokens,
                provider_type=assignment.provider.provider_type,
                api_type=db_api_type,
            )

        # Fallback to env vars
        settings = get_settings()
        env_map = {
            ModelFunctionType.CHAT: (
                settings.llm_api_url, settings.llm_api_key, settings.llm_model,
                settings.llm_api_type,
            ),
            ModelFunctionType.FAST: (
                settings.fast_llm_api_url or settings.llm_api_url,
                ***REMOVED*** or settings.llm_api_key,
                settings.fast_llm_model or settings.llm_model,
                settings.fast_llm_api_type,
            ),
            ModelFunctionType.VIDEO_CUT: self._video_cut_env_group(settings),
            ModelFunctionType.VISION: (
                settings.vl_llm_api_url or settings.llm_api_url,
                settings.vl_llm_api_key or settings.llm_api_key,
                settings.vl_llm_model,
                settings.vl_llm_api_type,
            ),
            ModelFunctionType.CODING: (
                os.getenv("CODING_LLM_API_URL", settings.llm_api_url),
                os.getenv("CODING_LLM_API_KEY", settings.llm_api_key),
                os.getenv("CODING_LLM_MODEL", "kimi-k2.5"),
                os.getenv("CODING_LLM_API_TYPE", "openai"),
            ),
        }
        api_url, api_key, model_name, api_type = env_map.get(
            function_type,
            (settings.llm_api_url, settings.llm_api_key, settings.llm_model, settings.llm_api_type),
        )
        api_type = (api_type or "openai").strip().lower()
        if api_type not in ("openai", "anthropic"):
            api_type = "openai"
        return ResolvedConfigResponse(
            success=True,
            source="environment",
            api_url=api_url,
            api_key=api_key,
            model_name=model_name,
            temperature=0.7,
            max_tokens=128000,
            api_type=api_type,
        )

    # ── Static data ──

    async def _research_assignment(self, function_type):
        async with async_session_factory() as session:
            result = await session.execute(
                select(ModelAssignment)
                .options(selectinload(ModelAssignment.provider))
                .where(ModelAssignment.function_type == function_type.value))
            assignment = result.scalar_one_or_none()
        if assignment is None:
            return None
        provider = assignment.provider
        if provider is None:
            from app.models.web_research_models import WebResearchError
            raise WebResearchError("configuration_invalid")
        return (provider.api_url, provider.api_key, assignment.model_name,
                _resolve_api_format(None, provider.api_format,
                                    provider.provider_type or ""))

    async def resolve_toolkit_digest_config(self):
        """文档分层摘要档位（spec §3.3.5 / §3.9）。

        `research` 档直接委托 `resolve_research_config`，因此也不新增
        `ModelFunctionType` 枚举；`fast` 档的回落链是 fast → chat。
        """
        from app.services.system_settings_service import toolkit_settings
        if toolkit_settings()["document_digest_model"] == "research":
            return await self.resolve_research_config()
        return await self._resolve_staged_config([
            (ModelFunctionType.FAST, "fast_llm"),
            (ModelFunctionType.CHAT, "llm"),
        ])

    async def resolve_research_config(self):
        """独立成组回落，绝不借用其他用途 resolver 的逐字段回落。"""
        return await self._resolve_staged_config([
            (ModelFunctionType.RESEARCH, "research_llm"),
            (ModelFunctionType.FAST, "fast_llm"),
            (ModelFunctionType.CHAT, "llm"),
        ])

    async def resolve_vision_config(self):
        """视觉审阅档位（agent-visual-review spec §4.6）。

        直接复用 `_resolve_staged_config`，语义全部继承：每档先查 DB 分配、
        再查 env 组；组内缺项或 `api_type` 非法即 `configuration_invalid`
        （不做逐字段借位）；三档全空 → `provider_not_configured`。

        这一层同时修好一个既存问题：`get_effective_config(VISION)` 今天无任何
        调用方，两处 VL 调用直接读 `settings.vl_llm_*`，用户在面板里绑的
        VISION 分配其实不生效。视觉域改走这里，分配才真正接线。
        """
        return await self._resolve_staged_config([
            (ModelFunctionType.VISION, "vl_llm"),
            (ModelFunctionType.CHAT, "llm"),
            (ModelFunctionType.FAST, "fast_llm"),
        ])

    async def _resolve_staged_config(self, stages):
        """按 stages 顺序成组回落；组内缺项即 configuration_invalid。"""
        from app.models.web_research_models import WebResearchError
        settings = get_settings()
        for function_type, prefix in stages:
            assigned = await self._research_assignment(function_type)
            environment = tuple(getattr(settings, prefix + suffix)
                                for suffix in ("_api_url", "_api_key",
                                               "_model", "_api_type"))
            if (prefix == "fast_llm" and not any(environment[:2])
                    and environment[2] == "qwen3-next-80b-a3b-instruct"
                    and not os.getenv("FAST_LLM_MODEL")):
                environment = None
            for source, group in [("database", assigned),
                                  ("environment", environment)]:
                if group is None or not any(group[:3]):
                    continue
                if not all(group[:3]) or group[3] not in {"openai", "anthropic"}:
                    raise WebResearchError("configuration_invalid")
                return ResolvedConfigResponse(
                    success=True, source=source, api_url=group[0],
                    api_key=group[1], model_name=group[2], api_type=group[3],
                    temperature=0.2, max_tokens=1800)
        raise WebResearchError("provider_not_configured")

    def get_providers(self) -> List[ProviderInfo]:
        """Return the list of known provider types (static reference)."""
        return PROVIDERS

    # ── Internal helpers ──

    def _provider_to_response(self, provider: ModelProvider) -> ModelProviderResponse:
        """Convert an ORM ModelProvider to a ModelProviderResponse."""
        api_key = provider.api_key or ""
        return ModelProviderResponse(
            id=str(provider.id),
            name=provider.name,
            provider_type=provider.provider_type,
            api_url=provider.api_url,
            api_key_masked=_mask_api_key(api_key),
            api_key_set=bool(api_key),
            api_format=provider.api_format or "auto",
            created_at=provider.created_at.isoformat() if provider.created_at else None,
            updated_at=provider.updated_at.isoformat() if provider.updated_at else None,
        )

    def _assignment_to_response(self, assignment: ModelAssignment) -> ModelAssignmentResponse:
        """Convert an ORM ModelAssignment (with loaded provider) to a ModelAssignmentResponse."""
        return ModelAssignmentResponse(
            function_type=ModelFunctionType(assignment.function_type),
            provider_id=str(assignment.provider_id),
            provider_name=assignment.provider.name if assignment.provider else "Unknown",
            provider_type=assignment.provider.provider_type if assignment.provider else "unknown",
            model_name=assignment.model_name,
            temperature=assignment.temperature,
            max_tokens=assignment.max_tokens,
            updated_at=assignment.updated_at.isoformat() if assignment.updated_at else None,
        )

    @staticmethod
    def _video_cut_env_group(
        settings: Settings,
    ) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
        """VIDEO_CUT env fallback as (api_url, api_key, model, api_type).

        Falls back as a whole group: pairing LLM_API_URL with
        VIDEO_CUT_LLM_API_TYPE could send openai-format requests to an
        anthropic endpoint. The key still falls back to LLM_API_KEY so an old
        .env that only set VIDEO_CUT_LLM_API_URL keeps working.
        """
        if not settings.video_cut_llm_api_url:
            return (
                settings.llm_api_url,
                settings.llm_api_key,
                settings.llm_model,
                settings.llm_api_type,
            )
        return (
            settings.video_cut_llm_api_url,
            ***REMOVED*** or settings.llm_api_key,
            settings.video_cut_llm_model or settings.llm_model,
            settings.video_cut_llm_api_type,
        )


model_settings_service = ModelSettingsService()
