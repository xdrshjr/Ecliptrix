import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Same-origin streaming proxy for YouTube preview playback.
// ─────────────────────────────────────────────────────────────────
// The video editor's search modal previews a selected YouTube result in a
// native `<video>` that points here (spec: youtube-preview-stream-proxy).
// Replaces the old `<iframe youtube.com/embed>` which tripped YouTube's
// anti-bot "Sign in to confirm you're not a bot" challenge.
//
// The browser needs:
//   - `Range` header forwarding so the player can seek/scrub
//   - `content-type`, `content-length`, `accept-ranges`, `content-range`,
//     `cache-control` headers passed back so seeking actually works
//   - everything else (Set-Cookie, internal backend headers) suppressed
//
// `?video_id=` is forwarded automatically by the passthrough helper. The
// backend path uses `/preview/stream`; the same-origin URL is `/preview-stream`
// (the dash-vs-slash difference is intentional).
export const { GET } = createPassthroughRoute(
  '/api/youtube/preview/stream',
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
    timeoutMs: 300_000,
  },
)
