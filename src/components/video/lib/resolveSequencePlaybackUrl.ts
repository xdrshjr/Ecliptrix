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
import { toAbsolutePlaybackUrl } from './selectPlaybackUrl';

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
  | 'cacheUrl'
  | 'serverUrl'
  | 'url'
  | 'sequence-url-fallback';

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
): ResolvedPlaybackUrl | null {
  if (!seq) return null;

  const list = Array.isArray(materials) ? materials : [];
  const material = seq.materialId
    ? list.find(m => m.id === seq.materialId)
    : undefined;

  if (material) {
    const candidates: string[] = [];
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
    if (
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
