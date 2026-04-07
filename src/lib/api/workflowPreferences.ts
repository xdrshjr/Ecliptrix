/**
 * Workflow preferences API client.
 *
 * Single owner of the `userId` → `user_id` body key rename that previously
 * lived in `src/app/api/workflow-preferences/{save,load}/route.ts`. T04
 * reduced both routes to dumb passthroughs (Pattern A) and explicitly
 * delegated this rename here per the body-reshape contract documented in
 * spec §10.
 *
 * Backend FastAPI models (`WorkflowPreferencesSaveRequest` /
 * `WorkflowPreferencesLoadRequest`) use snake_case (`user_id`); the React
 * components keep using camelCase (`userId`). This module is the only
 * place that bridges the two.
 *
 * All calls go through the secure-by-default `http.*` wrapper from S03.
 */

import { http } from '@/lib/api/http-client';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single per-workflow preference entry. Backend stores it as snake_case
 * but the frontend works in camelCase here (the rename is applied in the
 * `save` function below).
 */
export interface WorkflowPreferenceEntry {
  workflow_id: string;
  workflow_name: string;
  /** Maps to the React `enabled` flag in the UI. */
  is_expanded: boolean;
  tool_description?: string | null;
}

export type WorkflowPreferencesMap = Record<string, WorkflowPreferenceEntry>;

export interface SavePreferencesResponse {
  success: boolean;
  message?: string;
  saved_count?: number;
  timestamp?: string;
}

export interface LoadPreferencesResponse {
  success: boolean;
  message?: string;
  preferences: WorkflowPreferencesMap;
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save workflow preferences for a user.
 *
 * The frontend passes `userId` (camelCase). This function renames it to
 * `user_id` so the backend's pydantic model can deserialize it cleanly.
 * Without this rename the backend returns 422 Unprocessable Entity.
 */
export async function save(
  userId: string,
  preferences: WorkflowPreferencesMap,
): Promise<SavePreferencesResponse> {
  return http.post<SavePreferencesResponse>('/api/workflow-preferences/save', {
    user_id: userId,
    preferences,
  });
}

/**
 * Load workflow preferences for a user.
 *
 * Same `userId → user_id` rename as `save`. Returns the raw preferences map;
 * callers (e.g. `WorkflowConfigModal`) can convert it to whatever shape they
 * need (`Map<string, ...>` etc.).
 */
export async function load(userId: string): Promise<LoadPreferencesResponse> {
  return http.post<LoadPreferencesResponse>('/api/workflow-preferences/load', {
    user_id: userId,
  });
}
