/**
 * System Settings API client
 *
 * Provides typed methods for managing system-level configuration
 * (TTS, YouTube, upload, watermark, video analysis) persisted in PostgreSQL.
 *
 * Refactored in T05 to use the secure-by-default `http.*` wrapper. The
 * previous local `getAuthHeaders()` helper has been removed — auth is now
 * injected globally by `src/lib/api/http-client.ts`.
 */

import { http } from '@/lib/api/http-client';

// ── Types ──

export interface SystemSettingItem {
  key: string;
  value: any;
  default_value: any;
  value_type: string;
  description?: string;
  updated_at?: string;
  updated_by?: string;
}

export interface SettingsCategory {
  name: string;
  label: string;
  description: string;
}

export interface AuditLogEntry {
  id: string;
  setting_type: string;
  category?: string;
  key?: string;
  action: string;
  changed_by?: string;
  changed_at: string;
}

export interface CategoriesResponse {
  success: boolean;
  categories: SettingsCategory[];
}

export interface CategorySettingsResponse {
  success: boolean;
  category: string;
  settings: SystemSettingItem[];
}

export interface SettingUpdateResponse {
  success: boolean;
  message: string;
  setting?: SystemSettingItem;
}

export interface BatchUpdateResponse {
  success: boolean;
  message: string;
  settings?: SystemSettingItem[];
}

export interface ResetResponse {
  success: boolean;
  message: string;
  settings?: SystemSettingItem[];
}

export interface AuditLogResponse {
  success: boolean;
  logs: AuditLogEntry[];
  total: number;
}

// ── Helpers ──

const API_BASE = '/api/system-settings';

// ── API Methods ──

/**
 * Fetch all available settings categories with labels and descriptions.
 */
export async function getCategories(): Promise<CategoriesResponse> {
  return http.get<CategoriesResponse>(`${API_BASE}/categories`);
}

/**
 * Fetch all settings within a given category.
 */
export async function getCategorySettings(category: string): Promise<CategorySettingsResponse> {
  return http.get<CategorySettingsResponse>(`${API_BASE}/${category}`);
}

/**
 * Update a single setting value by category and key.
 */
export async function updateSetting(
  category: string,
  key: string,
  value: any,
): Promise<SettingUpdateResponse> {
  return http.put<SettingUpdateResponse>(`${API_BASE}/${category}/${key}`, { value });
}

/**
 * Batch-update multiple settings within a category.
 * @param settings - Record mapping setting keys to their new values.
 */
export async function updateCategorySettings(
  category: string,
  settings: Record<string, any>,
): Promise<BatchUpdateResponse> {
  return http.put<BatchUpdateResponse>(`${API_BASE}/${category}`, { settings });
}

/**
 * Reset all settings in a category to their factory default values.
 */
export async function resetCategory(category: string): Promise<ResetResponse> {
  return http.post<ResetResponse>(`${API_BASE}/${category}/reset`);
}

/**
 * Reset ALL settings across all categories to factory defaults.
 */
export async function resetAll(): Promise<ResetResponse> {
  return http.post<ResetResponse>(`${API_BASE}/reset-all`);
}

/**
 * Fetch audit log entries with optional filters.
 */
export async function getAuditLog(params?: {
  category?: string;
  limit?: number;
  offset?: number;
}): Promise<AuditLogResponse> {
  const searchParams = new URLSearchParams();
  if (params?.category) searchParams.set('category', params.category);
  if (params?.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params?.offset !== undefined) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();

  return http.get<AuditLogResponse>(`${API_BASE}/audit-log${qs ? `?${qs}` : ''}`);
}
