/**
 * System Settings API client
 *
 * Provides typed methods for managing system-level configuration
 * (TTS, YouTube, upload, watermark, video analysis) persisted in PostgreSQL.
 *
 * All methods send the session token from localStorage for admin auth.
 */

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

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined'
    ? localStorage.getItem('ecliptrix-session-token')
    : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
}

async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.detail || `Request failed with status ${response.status}`);
  }
  return data as T;
}

// ── API Methods ──

/**
 * Fetch all available settings categories with labels and descriptions.
 */
export async function getCategories(): Promise<CategoriesResponse> {
  const response = await fetch(`${API_BASE}/categories`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse<CategoriesResponse>(response);
}

/**
 * Fetch all settings within a given category.
 */
export async function getCategorySettings(category: string): Promise<CategorySettingsResponse> {
  const response = await fetch(`${API_BASE}/${category}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse<CategorySettingsResponse>(response);
}

/**
 * Update a single setting value by category and key.
 */
export async function updateSetting(
  category: string,
  key: string,
  value: any,
): Promise<SettingUpdateResponse> {
  const response = await fetch(`${API_BASE}/${category}/${key}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ value }),
  });
  return handleResponse<SettingUpdateResponse>(response);
}

/**
 * Batch-update multiple settings within a category.
 * @param settings - Record mapping setting keys to their new values.
 */
export async function updateCategorySettings(
  category: string,
  settings: Record<string, any>,
): Promise<BatchUpdateResponse> {
  const response = await fetch(`${API_BASE}/${category}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ settings }),
  });
  return handleResponse<BatchUpdateResponse>(response);
}

/**
 * Reset all settings in a category to their factory default values.
 */
export async function resetCategory(category: string): Promise<ResetResponse> {
  const response = await fetch(`${API_BASE}/${category}/reset`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  return handleResponse<ResetResponse>(response);
}

/**
 * Reset ALL settings across all categories to factory defaults.
 */
export async function resetAll(): Promise<ResetResponse> {
  const response = await fetch(`${API_BASE}/reset-all`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  return handleResponse<ResetResponse>(response);
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

  const response = await fetch(`${API_BASE}/audit-log${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse<AuditLogResponse>(response);
}
