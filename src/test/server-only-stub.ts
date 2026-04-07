/**
 * Stub for the `server-only` package used during Vitest runs.
 *
 * The real `server-only` package throws at module evaluation when imported
 * outside a Next.js Server Component bundle. Vitest evaluates modules in a
 * Node environment, so the throw fires and any test that transitively imports
 * `@/lib/config/backend` (or `@/lib/api/server/backend-proxy`) crashes before
 * a single assertion runs.
 *
 * Aliasing the real package to this empty module in `vitest.config.ts` makes
 * the import a no-op, allowing the server modules to evaluate cleanly under
 * the test runner. Production builds bypass this alias entirely — Next.js
 * resolves the real package via its bundler, and the original protections
 * stay in place.
 *
 * See: T07 spec §2.1 (vitest.config.ts) — server-only externalization.
 */
export {}
