/**
 * Domain-typed errors for the video preview pipeline.
 *
 * `NoPlayableSourceError` is thrown when every URL in the resolver's
 * preference chain (cacheUrl → serverUrl → url) fails to load on the
 * `<video>` element. Callers translate this into a user-facing toast
 * (i18n key `videoPlayerPanel.errorNoPlayableSource`) instead of letting
 * the raw `MEDIA_ERR_SRC_NOT_SUPPORTED` rejection bubble up.
 */
export class NoPlayableSourceError extends Error {
  readonly code = 'NO_PLAYABLE_SOURCE' as const;

  constructor(public readonly attempted: string[]) {
    super(`No playable source among: ${attempted.join(', ')}`);
    this.name = 'NoPlayableSourceError';
  }
}
