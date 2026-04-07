import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// SWEEP-EXCEPTION: response header allowlist for video Range seeking
// ─────────────────────────────────────────────────────────────────
// Pattern E (counts against the 5-route escape-hatch budget).
// Catch-all proxy for backend-served static files. The browser needs:
//   - `Range` header forwarding so video players can seek
//   - `content-type`, `content-length`, `accept-ranges`, `content-range`,
//     `cache-control` headers passed back so seeking actually works
//   - everything else (Set-Cookie, internal backend headers) suppressed
// The helper now supports `responseHeaderAllowlist` natively, which keeps
// this route a one-liner instead of the previous 60-line hand-rolled fetch.
export const { GET } = createPassthroughRoute(
  (p) => `/api/storage/files/${(p.path as string[]).join('/')}`,
  {
    streaming: true,
    forwardHeaders: ['range'],
    responseHeaderAllowlist: [
      'content-type',
      'content-length',
      'accept-ranges',
      'content-range',
      'cache-control',
    ],
  },
)
