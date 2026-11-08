/**
 * Client-side API wrapper.
 *
 * Responsibilities, all of which are easy to forget at a call site:
 *  - send the CSRF header on cookie-authenticated writes (double submit);
 *  - unwrap the shared envelope and throw a typed `ApiError`;
 *  - on 401, send the browser to /login once (a revoked session must not leave
 *    the user staring at a page that will never load).
 */

export interface ApiEnvelope<T> {
  success: boolean
  message: string | null
  timestamp: string
  data: T
}

export interface ApiErrorBody {
  success: false
  message: string
  error_code: string
  error_details?: { fields?: { path: string; message: string }[]; [key: string]: unknown }
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details: ApiErrorBody['error_details']

  constructor(code: string, message: string, status: number, details?: ApiErrorBody['error_details']) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }

  /** Field-level messages keyed by input path, for inline form errors. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const field of this.details?.fields ?? []) out[field.path] = field.message
    return out
  }
}

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|;\s*)ecs_csrf=([^;]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  /** Set false for endpoints that must not trigger the global 401 redirect. */
  redirectOnUnauthorized?: boolean
}

let redirecting = false

function redirectToLogin(): void {
  if (typeof window === 'undefined' || redirecting) return
  redirecting = true
  const next = `${window.location.pathname}${window.location.search}`
  window.location.assign(`/login?reason=session-expired&next=${encodeURIComponent(next)}`)
}

/** Perform a request and return the unwrapped `data`. */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers = new Headers({ Accept: 'application/json' })

  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (MUTATING.has(method)) {
    const csrf = readCsrfCookie()
    if (csrf) headers.set('X-CSRF-Token', csrf)
  }

  const response = await fetch(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    credentials: 'same-origin',
  })

  const text = await response.text()
  const payload = text ? (JSON.parse(text) as ApiEnvelope<T> | ApiErrorBody) : null

  if (!response.ok) {
    const errorBody = payload as ApiErrorBody | null
    const code = errorBody?.error_code ?? 'internal_error'
    const message = errorBody?.message ?? `请求失败（HTTP ${response.status}）`
    if (response.status === 401 && options.redirectOnUnauthorized !== false) {
      redirectToLogin()
    }
    throw new ApiError(code, message, response.status, errorBody?.error_details)
  }

  return (payload as ApiEnvelope<T>).data
}

export const api = {
  get: <T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
}
