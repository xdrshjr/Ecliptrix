/**
 * Playback v2 — proxy-tier hit-rate meter.
 *
 * Spec: docs/plans/video-editor-playback-v2-phase4/spec.md §3.2.1 / §4.2.2
 *       evaluation R-P1-6 (selectPlaybackUrl must remain pure)
 *
 * `selectPlaybackUrl` is treated as a pure function by 50+ call sites
 * (useMemo, SWR select). Recording hits inside it would multiply the
 * sample count by every cache miss. We therefore expose a tiny meter the
 * PlaybackEngine drives once per `attachActiveMaterial`, so the recorded
 * frequency equals actual playback starts.
 */

export type ProxyTier = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

export interface ProxyHitSnapshot {
  hitRate: number;
  total: number;
  perTier: Record<ProxyTier, number>;
}

export interface IProxyHitMeter {
  recordTier(tier: ProxyTier): void;
  snapshotHitRate(): number;
  snapshot(): ProxyHitSnapshot;
  reset(): void;
}

const ALL_TIERS: readonly ProxyTier[] = ['P1', 'P2', 'P3', 'P4', 'P5'];
/**
 * Same-origin proxy paths (P2 / P3) are considered cache hits — the
 * editor avoids the upstream CDN. P1 / P4 / P5 mean we still go through
 * an extra hop and count as a miss for hit-rate purposes.
 */
const HIT_TIERS: ReadonlyArray<ProxyTier> = ['P2', 'P3'];

export class ProxyHitMeter implements IProxyHitMeter {
  private _counts: Record<ProxyTier, number> = {
    P1: 0,
    P2: 0,
    P3: 0,
    P4: 0,
    P5: 0,
  };

  recordTier(tier: ProxyTier): void {
    if (!ALL_TIERS.includes(tier)) return;
    this._counts[tier] += 1;
  }

  snapshotHitRate(): number {
    const total = ALL_TIERS.reduce((acc, t) => acc + this._counts[t], 0);
    if (total === 0) return 0;
    const hits = HIT_TIERS.reduce((acc, t) => acc + this._counts[t], 0);
    return hits / total;
  }

  snapshot(): ProxyHitSnapshot {
    const total = ALL_TIERS.reduce((acc, t) => acc + this._counts[t], 0);
    return {
      hitRate: this.snapshotHitRate(),
      total,
      perTier: { ...this._counts },
    };
  }

  reset(): void {
    this._counts = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0 };
  }
}
