/**
 * PreviewGainRouter — makes clip volume above 100% audible in the preview
 * (ME-06).
 *
 * `HTMLMediaElement.volume` only accepts [0,1], while export applies up to 2×
 * (`MAX_EFFECTIVE_VOLUME`). An element whose effective volume exceeds 1 is routed
 * once through `MediaElementAudioSourceNode → GainNode → destination`; from then
 * on its `volume` stays 1 and the gain stage carries BOTH the volume and the
 * mute (a detached video mutes its decode element), so the result never depends
 * on whether the browser applies `volume` / `muted` before the source node.
 *
 * Only same-origin (or `blob:`) sources are routed: a cross-origin source
 * without CORS is silenced by WebAudio. An element routed once can never be
 * un-routed, so the preview host recycles it before a cross-origin url is
 * assigned ({@link needsRecycleFor}). A suspended AudioContext is never routed
 * into (it would be silent); the router asks it to resume and retries next frame.
 */

import { MAX_EFFECTIVE_VOLUME } from '../../timeline/infrastructure/effectiveVolume';

const GAIN_EPSILON = 1e-3;
const GAIN_SMOOTHING_SECONDS = 0.01;

export type ApplyVolumeOutcome = 'element' | 'boosted' | 'unboostable';

/** The element's own volume in [0,1]; non-finite → 0. */
export function clampElementVolume(volume: number): number {
  if (!Number.isFinite(volume) || volume <= 0) return 0;
  return volume >= 1 ? 1 : volume;
}

/** An effective volume in [0, MAX_EFFECTIVE_VOLUME]; non-finite → 0. */
function clampEffectiveVolume(volume: number): number {
  if (!Number.isFinite(volume) || volume <= 0) return 0;
  return Math.min(volume, MAX_EFFECTIVE_VOLUME);
}

/** Split an effective [0,2] volume into the element volume and the extra gain above it. */
export function splitPreviewVolume(volume: number): { elementVolume: number; gain: number } {
  const gain = Number.isFinite(volume) && volume > 1 ? Math.min(volume, MAX_EFFECTIVE_VOLUME) : 1;
  return { elementVolume: clampElementVolume(volume), gain };
}

/** Whether WebAudio can route `src` audibly: `blob:` or the page's own origin. */
export function isBoostableSource(src: string, origin: string): boolean {
  if (!src) return false;
  if (/^blob:/i.test(src)) return true;
  try {
    return new URL(src, origin).origin === origin;
  } catch {
    return false;
  }
}

interface GainRoute {
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  /** The effective volume last requested for this element. */
  volume: number;
  /** The gain value last scheduled, so a steady frame schedules nothing. */
  appliedGain: number | null;
  onVolumeChange: () => void;
}

export interface PreviewGainRouterOptions {
  /** The page origin; defaults to `window.location.origin`. */
  origin?: () => string;
  /** Creates the AudioContext lazily; returns null where WebAudio is unavailable. */
  createContext?: () => AudioContext | null;
}

function defaultCreateContext(): AudioContext | null {
  return typeof AudioContext === 'undefined' ? null : new AudioContext();
}

export class PreviewGainRouter {
  private _context: AudioContext | null = null;
  private readonly _routes = new Map<HTMLMediaElement, GainRoute>();
  private readonly _origin: () => string;
  private readonly _createContext: () => AudioContext | null;

  constructor(options: PreviewGainRouterOptions = {}) {
    this._origin = options.origin ?? (() => window.location.origin);
    this._createContext = options.createContext ?? defaultCreateContext;
  }

  /** Write an effective [0,2] volume to `element`, routing it through gain when needed. */
  apply(element: HTMLMediaElement, volume: number): ApplyVolumeOutcome {
    const { elementVolume, gain } = splitPreviewVolume(volume);
    const route = this._routes.get(element);
    if (route) {
      route.volume = clampEffectiveVolume(volume);
      this._syncRoute(element, route);
      return gain > 1 + GAIN_EPSILON ? 'boosted' : 'element';
    }
    element.volume = elementVolume;
    if (gain <= 1 + GAIN_EPSILON) return 'element';
    // `src` first: the pools assign it in the same frame as the volume, while
    // `currentSrc` still names the previous resource until the load algorithm
    // settles — routing on it would silence a cross-origin clip for its duration.
    if (!isBoostableSource(element.src || element.currentSrc, this._origin())) return 'unboostable';
    const context = this._ensureContext();
    if (!context) return 'element';
    if (context.state !== 'running') {
      context.resume().catch((error: unknown) => {
        console.warn('[PreviewGainRouter] AudioContext resume failed', error);
      });
      return 'element';
    }
    return this._route(element, context, gain) ? 'boosted' : 'element';
  }

  isRouted(element: HTMLMediaElement): boolean {
    return this._routes.has(element);
  }

  /** Whether `element` is routed and so must be replaced before playing `url`. */
  needsRecycleFor(element: HTMLMediaElement, url: string): boolean {
    return this._routes.has(element) && !isBoostableSource(url, this._origin());
  }

  /** Disconnect `element`'s route (the host is discarding the element). */
  release(element: HTMLMediaElement): void {
    const route = this._routes.get(element);
    if (!route) return;
    this._routes.delete(element);
    element.removeEventListener('volumechange', route.onVolumeChange);
    route.source.disconnect();
    route.gain.disconnect();
  }

  /** Resume a suspended context; called when playback starts. */
  async resume(): Promise<void> {
    const context = this._context;
    if (!context || context.state !== 'suspended') return;
    try {
      await context.resume();
    } catch (error) {
      console.warn('[PreviewGainRouter] AudioContext resume failed', error);
    }
  }

  dispose(): void {
    Array.from(this._routes.keys()).forEach((element) => this.release(element));
    const context = this._context;
    this._context = null;
    context?.close().catch((error: unknown) => {
      console.warn('[PreviewGainRouter] AudioContext close failed', error);
    });
  }

  private _ensureContext(): AudioContext | null {
    if (!this._context) this._context = this._createContext();
    return this._context;
  }

  private _route(element: HTMLMediaElement, context: AudioContext, volume: number): boolean {
    let source: MediaElementAudioSourceNode;
    try {
      source = context.createMediaElementSource(element);
    } catch (error) {
      console.warn('[PreviewGainRouter] could not route element through gain', error);
      return false;
    }
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(context.destination);
    const route: GainRoute = {
      source,
      gain,
      volume,
      appliedGain: null,
      onVolumeChange: () => this._syncRoute(element, route),
    };
    element.addEventListener('volumechange', route.onVolumeChange);
    this._routes.set(element, route);
    this._syncRoute(element, route);
    return true;
  }

  /** A routed element plays at volume 1; its volume and mute live in the gain. */
  private _syncRoute(element: HTMLMediaElement, route: GainRoute): void {
    if (element.volume !== 1) element.volume = 1;
    const target = element.muted ? 0 : route.volume;
    if (route.appliedGain === target || !this._context) return;
    route.appliedGain = target;
    route.gain.gain.setTargetAtTime(target, this._context.currentTime, GAIN_SMOOTHING_SECONDS);
  }
}
