# Agent Summary: google-dev-01

## Meta
- **Agent:** google-dev-01
- **Role:** DEV
- **Task:** TODO 01 — Backend Model Changes & DB Migration
- **Phase:** 1
- **Timestamp:** 2026-04-07T02:38:00
- **Verdict:** COMPLETED

## Key Decisions
- Used `Literal["auto", "openai", "anthropic"]` for Pydantic validation on `ModelProviderCreate.api_format` and `ModelProviderUpdate.api_format`, providing compile-time and runtime type safety
- Kept `ANTHROPIC_FORMAT_TYPES` as the auto-inference fallback set, per spec. This preserves backward compatibility when `api_format="auto"` (the default)
- `_resolve_api_format` accepts three inputs (request, db, provider_type) with clear priority chain: request > db > auto-infer. Returns only "openai" or "anthropic", never "auto"
- `_get_default_models_for_type` returns a copy of the list to prevent accidental mutation of the PROVIDERS singleton
- Migration uses `server_default="auto"` and `nullable=False` so existing rows get the default automatically with no data loss
- The `anthropic` provider type in the generic providers list has `api_format="openai"` because its generic form uses the OpenAI-compatible `/v1` endpoint. The Anthropic Messages format is only used when explicitly configured or auto-inferred for `claude_coding`/`kimi_coding`

## Execution Flow
1. Read all planning documents (master-plan, spec-01, todo-01, task-orchestration)
2. Read all source files (model_settings_models.py, db_models.py, model_settings_service.py, model_settings_router.py)
3. Read reference migration (003_add_settings_tables.py) and API test scripts (kimi, glm)
4. Confirmed migration chain: 001 -> 002 -> 003 -> 004, next is 005
5. Extended Pydantic models: ProviderInfo (+api_format, +default_models), ModelProviderCreate (+api_format with Literal), ModelProviderUpdate (+api_format Optional Literal), ModelProviderResponse (+api_format)
6. Added `api_format` column to ORM `ModelProvider` with default="auto" and server_default="auto"
7. Created Alembic migration 005_add_api_format_to_providers.py
8. Updated PROVIDERS list: corrected kimi_coding (name, region), glm_coding (name, URL, models), added api_format/default_models to all entries
9. Removed `CODING_PROVIDER_MODELS` dictionary
10. Added `_get_default_models_for_type()` helper function
11. Added `_resolve_api_format()` helper function with 3-tier priority
12. Added `_get_provider_db_format()` async helper method to service class
13. Updated `create_provider` to persist api_format
14. Updated `update_provider` to support api_format updates
15. Updated `_provider_to_response` to include api_format
16. Updated `fetch_models_for_provider` and `fetch_models` to use `_get_default_models_for_type`
17. Updated `test_connection` to use `_resolve_api_format` instead of direct ANTHROPIC_FORMAT_TYPES check
18. Ran syntax validation on all 5 files — all pass
19. Ran comprehensive unit tests on Pydantic models (field defaults, Literal validation, rejection of invalid values)
20. Ran comprehensive unit tests on helper functions (_get_default_models_for_type, _resolve_api_format)
21. Verified CODING_PROVIDER_MODELS has zero references remaining in codebase

## Artifacts
- **Created:** `alembic/versions/005_add_api_format_to_providers.py`
- **Modified:** `app/models/model_settings_models.py`, `app/models/db_models.py`, `app/services/model_settings_service.py`

## Interfaces Touched
- **Produces:**
  - `api_format` field on all provider Pydantic models (Create/Update/Response/Info) — consumed by frontend (TODO 03, 04)
  - `default_models` field on ProviderInfo — consumed by frontend for smart form defaults (TODO 03)
  - `_resolve_api_format()` function — consumed by TODO 02 (connection test enhancement)
  - `_get_provider_db_format()` method — consumed by TODO 02
  - `_get_default_models_for_type()` function — consumed by TODO 02
  - DB migration 005 — must be run before any code expecting the api_format column
- **Consumes:** nothing — Phase 1, no dependencies

## Issues & Risks
- The `anthropic` provider type (generic, id="anthropic") has `api_format="openai"` in PROVIDERS because its default_api_url points to `/v1` which is the OpenAI-compatible endpoint. However, `ANTHROPIC_FORMAT_TYPES` still includes `"anthropic"`, so auto-inference for the `anthropic` provider type will resolve to Anthropic format. This means a user who creates a provider with type `anthropic` and leaves api_format as "auto" will get Anthropic format, which is correct behavior. But the static ProviderInfo shows "openai" — this is intentional (the static info is reference data, not the runtime format resolution).
- Migration 005 uses `nullable=False` with `server_default="auto"`. If there are existing rows in model_providers, PostgreSQL will apply the server_default automatically during ALTER TABLE. This is safe.
- The `_resolve_api_format` function's first argument is passed as `None` in `test_connection` because the current `TestConnectionRequest` model does not yet have an `api_format` field — that is planned for TODO 02 (spec-02).

## Context for Downstream
The `api_format` field is now available across all backend layers (Pydantic models, ORM, DB). TODO 02 should add `api_format` to `TestConnectionRequest` and pass it as the first argument to `_resolve_api_format()`. Frontend agents (TODO 03-05) can now consume the `api_format` and `default_models` fields from the `/providers/known` and `/providers/saved` API responses.
