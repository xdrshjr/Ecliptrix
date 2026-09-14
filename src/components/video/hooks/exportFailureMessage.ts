/**
 * exportFailureMessage — what a failed export tells the user (EX3-08).
 *
 * The composition status carries backend English (`error_summary`,
 * `recovery_suggestions`). That text belongs in the log; the user reads which
 * clips failed and at what stage, in their own language.
 *
 * Errors are recognised by `name`, like the poller's `TimeoutError`, so this
 * module does not import the API module that the export hook's tests mock.
 */

import type { CompositionErrorDetails } from '@/lib/api/videoComposition';
import type { SupportedLocale, Translations } from '@/lib/i18n';
import { formatNameList } from './exportDegradations';

const COMPOSITION_FAILED_ERROR_NAME = 'CompositionFailedError';
const CANCELLED_STAGE = 'cancelled';
const MEDIA_RESOLUTION_STAGE = 'media_resolution';
/** The backend reports `video_normalization`; `normalization` is the spec's name for it. */
const NORMALIZATION_STAGES: ReadonlySet<string> = new Set(['normalization', 'video_normalization']);

/** The poller's own mark on its "no progress" timeout (EXO-07). */
const STALLED_CODE = 'COMPOSITION_STALLED';

/**
 * Whether polling gave up because the export stopped making progress. The
 * poller and http-client both name their timeouts `TimeoutError`; a single
 * status request that timed out is no stall and must not claim "10 minutes
 * without progress".
 */
export function isExportTimeout(error: unknown): boolean {
  return error instanceof Error
    && error.name === 'TimeoutError'
    && (error as Error & { code?: unknown }).code === STALLED_CODE;
}

function compositionFailureDetails(error: unknown): CompositionErrorDetails | null {
  if (!(error instanceof Error) || error.name !== COMPOSITION_FAILED_ERROR_NAME) return null;
  return (error as Error & { details?: CompositionErrorDetails }).details ?? {};
}

function failedClipNames(details: CompositionErrorDetails): string[] {
  return (details.failed_videos ?? [])
    .map((video) => video.video_name)
    .filter((name): name is string => typeof name === 'string' && name.trim() !== '');
}

function fillClipTemplate(
  template: string,
  names: string[],
  t: Translations,
  locale?: SupportedLocale,
): string {
  return template
    .replace('{count}', String(names.length))
    .replace('{names}', formatNameList(names, t, locale));
}

/**
 * Localized text for a failed export, or null when the user cancelled it
 * (a cancel is not an error). A stage that names its failed clips says which
 * clips; any other composition failure reads as a rendering failure.
 */
export function describeExportFailure(
  error: unknown,
  t: Translations,
  locale?: SupportedLocale,
): string | null {
  if (isExportTimeout(error)) return t.videoExport.exportTimeout;
  const details = compositionFailureDetails(error);
  if (!details) return t.videoExport.exportFailed;
  const stage = details.composition_stage ?? '';
  if (stage === CANCELLED_STAGE) return null;
  const names = failedClipNames(details);
  if (names.length > 0 && stage === MEDIA_RESOLUTION_STAGE) {
    return fillClipTemplate(t.videoExport.failedStageMediaResolution, names, t, locale);
  }
  if (names.length > 0 && NORMALIZATION_STAGES.has(stage)) {
    return fillClipTemplate(t.videoExport.failedStageNormalization, names, t, locale);
  }
  return t.videoExport.failedStageCompose;
}
