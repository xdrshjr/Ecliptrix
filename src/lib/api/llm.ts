/**
 * LLM API client for fetching available models.
 *
 * Browser-only — uses the unified `http` wrapper which auto-injects auth and
 * routes the request through the Next.js proxy at `/api/llm/models` (S06).
 *
 * Spec: docs/plans/unified-api-auth-refactor/specs/06-direct-browser-call-migration.md §4.2
 */

import { http } from '@/lib/api/http-client';
import { LLMModelsResponse, LLMModel } from '@/types';

/**
 * Fetch all available LLM models from the backend.
 *
 * @returns Promise<LLMModel[]> List of available LLM models
 * @throws `MissingAuthError` / `SessionExpiredError` / `ApiError` from the HTTP wrapper
 */
export async function fetchLLMModels(): Promise<LLMModel[]> {
  const data = await http.get<LLMModelsResponse>('/api/llm/models');
  return data.models;
}
