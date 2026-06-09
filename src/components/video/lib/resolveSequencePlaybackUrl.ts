/**
 * resolveSequencePlaybackUrl — pick a playable URL for a sequence at play
 * time, with an ordered fallback chain.
 *
 * Why this exists (see docs/plans/video-reentry-play-no-source-fix/spec.md):
 *
 *   `VideoSequenceItem.url` is frozen at the moment the timeline emitted
 *   its current state — it does not see a `cacheUrl` patched in by
 *   `useRemoteMaterialPrefetch` after that emission. Reading the LIVE
 *   `MaterialItem` by `seq.materialId` defeats RC-4: the sequence is
 *   never glued to a stale URL because we recompute against the freshest
 *   material every time this helper is called.
 *
 * Pure function — no DOM, no network, no observability outside its
 * arguments. Safe to call from `useMemo`.
 */

import type { MaterialItem } from '@/types';
import { toAbsolutePlaybackUrl, effectivePreviewUrl } from './selectPlaybackUrl';

/**
 * Structural shape of a sequence — accepts both
 * `timeline/domain/ports.VideoSequenceItem` (`cacheUrl?: string`) and
 * `types/videoEditingTypes.VideoSequenceItem` (`cacheUrl?: string | null`).
 * The cacheUrl-typing discrepancy between the two declarations predates
 * this spec (P2-2) and is out of scope for the fix.
 */
export interface SequenceLike {
  url?: string;
  cacheUrl?: string | null;
  materialId?: string;
}

export type ResolvedPlaybackUrlSource =
  | 'localProxy'
  | 'previewProxy'
  | 'cacheUrl'
  | 'serverUrl'
  | 'url'
  | 'sequence-url-fallback';

export interface ResolveSequencePlaybackUrlOptions {
  /**
   * When true AND the resolved material's `previewProxyStatus === 'cached'`,
   * the 480p preview-proxy URL is pushed to the FRONT of the candidate chain
   * (becomes `url`), with the original `cacheUrl → serverUrl → url` ladder
   * demoted to `fallbacks`. When false / omitted, behaviour is byte-for-byte
   * identical to the pre-proxy resolver (spec §3.2.3 C1 invariant).
   *
   * The flag value is injected by the caller (VideoPlayerPanel locks
   * `isPreviewProxyEnabled()` at mount) so this stays a pure function — no
   * `localStorage` reads inside, which keeps it `useMemo`-safe and unit
   * testable.
   */
  preferPreviewProxy?: boolean;
  /**
   * Round-2 (docs/plans/video-editor-client-preview-download/spec.md §3.3.4):
   * when true AND the material's `localProxyStatus === 'ready'` AND a
   * `localProxyUrl` (a `blob:` object URL of the whole low-bitrate file) is
   * present, the local blob is pushed to the VERY FRONT of the chain (P0),
   * above even the preview-proxy tier, so playback runs from local memory with
   * zero network. Not ready / not opted-in → byte-for-byte identical to before
   * (the round-1 preview-proxy chain is untouched).
   *
   * Locked at mount by the caller (`isLocalPreviewEnabled()`), same purity
   * contract as {@link preferPreviewProxy}.
   */
  preferLocalProxy?: boolean;
}

export interface ResolvedPlaybackUrl {
  /** Primary URL the player should try first. Never an empty string. */
  url: string;
  /** Ordered list of additional candidates if `url` fails to load. */
  fallbacks: string[];
  /** Diagnostic — which field produced `url`. */
  source: ResolvedPlaybackUrlSource;
}

function pushIfNew(list: string[], value: string | null | undefined): void {
  if (!value) return;
  if (list.includes(value)) return;
  list.push(value);
}

export function resolveSequencePlaybackUrl(
  seq: SequenceLike | null | undefined,
  materials: MaterialItem[] | null | undefined,
  opts?: ResolveSequencePlaybackUrlOptions,
): ResolvedPlaybackUrl | null {
  if (!seq) return null;

  const list = Array.isArray(materials) ? materials : [];
  const material = seq.materialId
    ? list.find(m => m.id === seq.materialId)
    : undefined;

  if (material) {
    const candidates: string[] = [];

    // -1. local blob (round-2, P0) — the whole low-bitrate file resident in
    //     browser memory as a `blob:` URL. Highest priority so playback is
    //     pure-local (zero network). Only when the caller opted in AND the
    //     local download finished (`ready`). Sits ABOVE the preview-proxy tier;
    //     when not ready / not opted in, `localPrimary` stays undefined and the
    //     existing chain is byte-identical.
    let localPrimary: string | undefined;
    if (
      opts?.preferLocalProxy === true &&
      material.localProxyStatus === 'ready' &&
      material.localProxyUrl
    ) {
      localPrimary = material.localProxyUrl;
    }
    pushIfNew(candidates, localPrimary);

    // 0. preview-proxy (480p ladder) — only when the caller opted in AND the
    //    proxy is `cached`. This is the C1 fix: the resolver is the single
    //    proxy-aware source-of-truth so the value <video>.src is assigned
    //    (assignSequenceSrc) stays byte-identical to the value the
    //    needs-source-change comparison reads (getSequencePreviewSrc). When
    //    not cached / not opted in, `proxyPrimary` stays undefined and the
    //    chain below is unchanged.
    let proxyPrimary: string | undefined;
    if (
      opts?.preferPreviewProxy === true &&
      (material.previewProxyStatus ?? '') === 'cached'
    ) {
      const pp = effectivePreviewUrl(material, {
        preferPreviewProxy: true,
        fallback: 'origin',
      });
      const proxyLocal = toAbsolutePlaybackUrl(material.previewProxyLocalUrl);
      // effectivePreviewUrl(fallback:'origin') only returns a non-proxy URL
      // when the proxy field is empty; guard so a half-populated row can't
      // mislabel the original chain as a proxy tier.
      if (pp && pp === proxyLocal) {
        proxyPrimary = pp;
      }
    }
    pushIfNew(candidates, proxyPrimary);
    // 1. cacheUrl (absolutised; SSR returns undefined and we skip).
    pushIfNew(candidates, toAbsolutePlaybackUrl(material.cacheUrl));
    // 2. serverUrl (cross-session durable URL).
    pushIfNew(candidates, material.serverUrl ?? undefined);
    // 3. url (raw remote, e.g. CDN / blob).
    pushIfNew(candidates, material.url ?? undefined);

    if (candidates.length === 0) {
      // Material exists but has no usable URL anywhere. The sequence's
      // own `url` snapshot might still be playable — try it as a last resort.
      if (seq.url) {
        return {
          url: seq.url,
          fallbacks: [],
          source: 'sequence-url-fallback',
        };
      }
      return null;
    }

    const [primary, ...rest] = candidates;
    let primarySource: ResolvedPlaybackUrlSource;
    if (localPrimary && primary === localPrimary) {
      primarySource = 'localProxy';
    } else if (proxyPrimary && primary === proxyPrimary) {
      primarySource = 'previewProxy';
    } else if (
      material.cacheUrl &&
      toAbsolutePlaybackUrl(material.cacheUrl) === primary
    ) {
      primarySource = 'cacheUrl';
    } else if (material.serverUrl && material.serverUrl === primary) {
      primarySource = 'serverUrl';
    } else {
      primarySource = 'url';
    }

    return {
      url: primary,
      fallbacks: rest,
      source: primarySource,
    };
  }

  // Material has been pruned from the list; the sequence still carries a
  // URL string from its last extraction. Treat it as the sole candidate.
  if (seq.url) {
    return {
      url: seq.url,
      fallbacks: [],
      source: 'sequence-url-fallback',
    };
  }

  return null;
}
