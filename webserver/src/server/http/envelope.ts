import { NextResponse } from 'next/server'
import { ERROR_CODE, REQUEST_ID_HEADER, type ErrorCode } from '@/server/auth/constants'
import { AppError } from '@/server/http/errors'

/**
 * Response envelope.
 *
 * Shape follows the root project's `BaseResponse` / `ErrorResponse`
 * (`backend-services/basic-service/app/models/base_models.py`) so a developer
 * moving between the desktop backend and this service reads the same keys:
 * `success`, `message`, `timestamp`, `data` plus `error_code` /
 * `error_details` on failure.
 *
 * `error.{code,message,details}` is also emitted because the web console needs
 * a nested shape to switch on. Both are cheap; keep them in sync.
 */

export interface SuccessEnvelope<T> {
  success: true
  message: string | null
  timestamp: string
  data: T
}

export interface ErrorEnvelope {
  success: false
  message: string
  timestamp: string
  error_code: ErrorCode
  error_details?: Record<string, unknown>
  error: {
    code: ErrorCode
    message: string
    details?: Record<string, unknown>
  }
}

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
} as const

/** 200 (or `status`) with the shared envelope. */
export function ok<T>(data: T, init: { message?: string | null; status?: number; requestId?: string } = {}): NextResponse {
  const body: SuccessEnvelope<T> = {
    success: true,
    message: init.message ?? null,
    timestamp: new Date().toISOString(),
    data,
  }
  const response = NextResponse.json(body, { status: init.status ?? 200 })
  response.headers.set('Cache-Control', NO_STORE_HEADERS['Cache-Control'])
  if (init.requestId) response.headers.set(REQUEST_ID_HEADER, init.requestId)
  return response
}

/** Error response straight from an AppError, preserving retry hints. */
export function fail(error: AppError, requestId?: string): NextResponse {
  const body: ErrorEnvelope = {
    success: false,
    message: error.message,
    timestamp: new Date().toISOString(),
    error_code: error.code,
    error_details: error.details,
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  }
  const response = NextResponse.json(body, { status: error.status })
  response.headers.set('Cache-Control', NO_STORE_HEADERS['Cache-Control'])
  if (error.retryAfterSeconds !== undefined) {
    response.headers.set('Retry-After', String(Math.ceil(error.retryAfterSeconds)))
  }
  if (requestId) response.headers.set(REQUEST_ID_HEADER, requestId)
  return response
}

/** Convenience for guards that only need "not found". */
export function notFound(message = '资源不存在', requestId?: string): NextResponse {
  return fail(new AppError(ERROR_CODE.notFound, message), requestId)
}
