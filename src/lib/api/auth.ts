/**
 * Auth API client.
 *
 * Single owner of the `result.user` → frontend `User` reshape that previously
 * lived in `src/app/api/auth/login/route.ts`. T04 reduced that route to a
 * dumb passthrough (Pattern A) and explicitly delegated the camelCase
 * normalization here per the body-reshape contract documented in spec §10.
 *
 * All calls go through the secure-by-default `http.*` wrapper from S03.
 * `login`, `register`, and `validateSession` are public endpoints
 * (`requireAuth: false`) — they are in the backend allowlist (T01) and run
 * before any session token exists. `logout` requires auth so the backend
 * can invalidate the server-side session row.
 */

import { http } from '@/lib/api/http-client';
import type {
  LoginCredentials,
  SessionValidationRequest,
  SessionValidationResponse,
  User,
  UserRole,
} from '@/types/auth';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LoginSuccess {
  success: true;
  user: User;
  sessionToken: string | null;
  message?: string;
}

export interface LoginFailure {
  success: false;
  error: string;
  user?: undefined;
  sessionToken?: undefined;
  message?: string;
}

export type LoginResult = LoginSuccess | LoginFailure;

export interface RegisterPayload {
  username: string;
  password: string;
  email?: string;
  fullName?: string;
}

export interface RegisterResult {
  success: boolean;
  user?: User;
  message?: string;
  error?: string;
}

export interface LogoutResult {
  success: boolean;
  message?: string;
}

// ---------------------------------------------------------------------------
// Internal: snake_case → camelCase normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a raw backend user object to the frontend `User` shape.
 *
 * Mirrors the helper that previously lived in `AuthContext.tsx`. Kept here
 * because (a) S04 removed the equivalent reshape from the route handler and
 * (b) any future caller of `auth.login` should get a normalized result
 * without re-implementing the field map.
 */
function normalizeUser(raw: Record<string, unknown> | null | undefined): User {
  if (!raw || typeof raw !== 'object') {
    return {
      id: '',
      username: '',
    };
  }

  const id = (raw.id as string | undefined) ?? '';
  const username = (raw.username as string | undefined) ?? '';
  const email = raw.email as string | undefined;
  const avatar = raw.avatar as string | undefined;
  const fullName = (raw.fullName ?? raw.full_name) as string | undefined;
  const avatarUrl = (raw.avatarUrl ?? raw.avatar_url) as string | undefined;
  const userRole = (raw.userRole ?? raw.user_role) as UserRole | undefined;
  const isAdmin = (raw.isAdmin ?? raw.is_admin) as boolean | undefined;
  const isRoot = (raw.isRoot ?? raw.is_root) as boolean | undefined;

  return {
    id,
    username,
    email,
    avatar,
    fullName,
    avatarUrl,
    userRole,
    isAdmin,
    isRoot,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Backend raw login envelope. Defined inline because no other module needs it.
 */
interface RawLoginEnvelope {
  success?: boolean;
  user?: Record<string, unknown> | null;
  session_token?: string | null;
  sessionToken?: string | null;
  message?: string;
  error?: string;
}

/**
 * Log a user in. Returns a discriminated union — successful logins carry the
 * normalized `User` and the session token; failures carry an `error` string
 * suitable for inline display.
 *
 * Network / HTTP errors propagate as the typed errors from S03 (`ApiError`,
 * `TimeoutError`, etc.) — callers that want a unified failure shape should
 * wrap this call in `try/catch` and map the error themselves.
 */
export async function login(credentials: LoginCredentials): Promise<LoginResult> {
  const raw = await http.post<RawLoginEnvelope>(
    '/api/auth/login',
    credentials,
    { requireAuth: false },
  );

  if (raw && raw.success && raw.user) {
    return {
      success: true,
      user: normalizeUser(raw.user),
      sessionToken: raw.session_token ?? raw.sessionToken ?? null,
      message: raw.message,
    };
  }

  return {
    success: false,
    error: raw?.error ?? raw?.message ?? 'Login failed',
    message: raw?.message,
  };
}

/**
 * Register a new user. Public endpoint; no auth required.
 */
export async function register(payload: RegisterPayload): Promise<RegisterResult> {
  const body = {
    username: payload.username,
    password: payload.password,
    email: payload.email,
    full_name: payload.fullName,
  };

  const raw = await http.post<RawLoginEnvelope>('/api/auth/register', body, {
    requireAuth: false,
  });

  if (raw && raw.success && raw.user) {
    return {
      success: true,
      user: normalizeUser(raw.user),
      message: raw.message,
    };
  }

  return {
    success: false,
    error: raw?.error ?? raw?.message ?? 'Registration failed',
    message: raw?.message,
  };
}

/**
 * Validate a session token (public — runs before any auth header is set).
 *
 * Returns the raw `SessionValidationResponse` envelope. The caller (typically
 * `AuthContext`) decides what to do with the `valid` / `reason` fields.
 */
export async function validateSession(
  request: SessionValidationRequest,
): Promise<SessionValidationResponse> {
  return http.post<SessionValidationResponse>(
    '/api/auth/validate-session',
    request,
    { requireAuth: false },
  );
}

/**
 * Server-side logout. Requires a valid session token because the backend
 * needs to know which session row to invalidate. The wrapper auto-injects
 * the Authorization header.
 *
 * Defensive: failures are not swallowed here. Callers can catch `ApiError`
 * if they want to ignore the network result and force a client-side logout
 * regardless.
 */
export async function logout(): Promise<LogoutResult> {
  return http.post<LogoutResult>('/api/auth/logout', null);
}
