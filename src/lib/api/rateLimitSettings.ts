/**
 * Rate-limit settings API client.
 *
 * Talks to the backend admin API (`rate_limit_settings_router`,
 * `prefix="/api/rate-limit"`, all `require_admin`) via the secure-by-default
 * `http.*` wrapper, which auto-injects `Authorization: Bearer <token>`. The
 * Next.js proxy routes under `src/app/api/rate-limit/*` forward that header
 * (plus legacy `x-session-token`) to FastAPI through the `backend-proxy`
 * helper, so `require_admin` sees the caller's session.
 *
 * Contract (TODO 03 — match exactly):
 *   GET  /api/rate-limit/config  -> { config: { enabled, window_seconds,
 *                                       limits: {5 flat keys}, meta: {per key} } }
 *   PUT  /api/rate-limit/config  -> body is ANY SUBSET of the 7 keys at the TOP
 *                                   LEVEL (flat, NOT nested under limits).
 *                                   Unknown key / out-of-range -> 422 (nothing
 *                                   written). Returns the same envelope as GET.
 *   POST /api/rate-limit/reset   -> no body; resets all 7; returns GET envelope.
 *   GET  /api/rate-limit/status  -> { status: { enabled, active_keys,
 *                                       total_checked, total_blocked } }
 *
 * Spec: docs/plans/api-authz-rate-limiting/specs/04-frontend-admin-ui-and-429.md §2.2
 */

import { http } from '@/lib/api/http-client';

// ---------------------------------------------------------------------------
// Types — mirror the backend JSON shape 1:1
// ---------------------------------------------------------------------------

/** The five flat numeric limit keys (SystemSetting key names). */
export interface RateLimitLimits {
  default_per_user_per_min: number;
  default_per_ip_per_min: number;
  ai_generation_per_min: number;
  auth_per_ip_per_min: number;
  media_serving_per_min: number;
}

/** Per-field metadata (type/min/max/description) used to drive the form. */
export interface RateLimitFieldMeta {
  default: number | boolean;
  type: 'number' | 'boolean';
  min: number | null;
  max: number | null;
  description: string;
}

/** The 7 meta keys: the 5 limits + `enabled` + `window_seconds`. */
export type RateLimitMetaKey =
  | 'enabled'
  | 'window_seconds'
  | keyof RateLimitLimits;

export type RateLimitMeta = Record<RateLimitMetaKey, RateLimitFieldMeta>;

export interface RateLimitConfig {
  enabled: boolean;
  window_seconds: number;
  limits: RateLimitLimits;
  meta: RateLimitMeta;
}

/** GET /config and PUT /config and POST /reset all return this envelope. */
interface RateLimitConfigEnvelope {
  success?: boolean;
  message?: string;
  config: RateLimitConfig;
}

export interface RateLimitStatus {
  enabled: boolean;
  active_keys: number;
  total_checked: number;
  total_blocked: number;
}

interface RateLimitStatusEnvelope {
  success?: boolean;
  message?: string;
  status: RateLimitStatus;
}

/**
 * The subset of keys that `updateConfig` accepts — any combination of the 7
 * top-level keys. `enabled` is boolean; everything else is numeric.
 */
export interface RateLimitConfigUpdate {
  enabled?: boolean;
  window_seconds?: number;
  default_per_user_per_min?: number;
  default_per_ip_per_min?: number;
  ai_generation_per_min?: number;
  auth_per_ip_per_min?: number;
  media_serving_per_min?: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const CONFIG_PATH = '/api/rate-limit/config';
const RESET_PATH = '/api/rate-limit/reset';
const STATUS_PATH = '/api/rate-limit/status';

/** GET the current effective config + meta. Admin-only (backend require_admin). */
export async function getConfig(): Promise<RateLimitConfig> {
  const res = await http.get<RateLimitConfigEnvelope>(CONFIG_PATH);
  return res.config;
}

/**
 * PUT a subset of the 7 flat keys. Returns the new effective config.
 * Out-of-range / unknown keys -> backend 422 (thrown as ApiError by http-client,
 * nothing written).
 */
export async function updateConfig(
  payload: RateLimitConfigUpdate,
): Promise<RateLimitConfig> {
  const res = await http.put<RateLimitConfigEnvelope>(CONFIG_PATH, payload);
  return res.config;
}

/** POST /reset — reset all 7 keys to backend defaults. Returns new config. */
export async function resetConfig(): Promise<RateLimitConfig> {
  const res = await http.post<RateLimitConfigEnvelope>(RESET_PATH);
  return res.config;
}

/** GET the read-only live status counters. */
export async function getStatus(): Promise<RateLimitStatus> {
  const res = await http.get<RateLimitStatusEnvelope>(STATUS_PATH);
  return res.status;
}

export const rateLimitSettingsApi = {
  getConfig,
  updateConfig,
  resetConfig,
  getStatus,
};
